/**
 * Service des bordereaux d'expéditeur (paiements).
 *
 * Un bordereau regroupe les colis d'un expéditeur livrés ou retournés sur une
 * période, et le montant net que RUNEX lui doit après déduction des
 * frais et de la retenue à la source. Le décaissement est conditionné par la
 * saisie du code secret de l'expéditeur : c'est une double validation
 *(originaire + régisseur) qui protège la caisse.
 */

import crypto from 'node:crypto';
import { getPrisma } from '../../common/database/prisma-context';
import type { PaymentVoucherDto, PaymentVoucherStatus, PaymentMethod } from '@logixpress/types';
import { PaymentVoucherStatus as SharedVoucherStatus, PaymentMethod as SharedMethod } from '@logixpress/types';
import { notFound, badRequest, conflict } from '../../common/errors/api-error';
import { auditService } from '../../common/audit/audit.service';

const PBKDF2_ITERATIONS = 50000;
const PBKDF2_KEY_LENGTH = 32;
const PBKDF2_DIGEST = 'sha256';

export interface PaymentVoucherActor {
  id?: string;
  fullName: string;
  shipperId?: string;
}

/** Vérifie un code secret face au condensat stocké en base. */
function verifyPaymentCode(input: string, stored: string | null): boolean {
  if (!stored || !input) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto
    .pbkdf2Sync(input, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    .toString('hex');
  // Comparaison à temps constant : la durée de la comparaison ne doit pas
  // révéler le nombre de caractères corrects.
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

export class PaymentsService {
  /**
   * Liste les bordereaux, du plus récent au plus ancien.
   *
   * Un expéditeur ne voit que ses propres bordereaux : le périmètre provient
   * du jeton, jamais d'un paramètre de requête.
   */
  async findAll(actor: PaymentVoucherActor): Promise<PaymentVoucherDto[]> {
    const prisma = getPrisma();
    const records = await prisma.paymentVoucher.findMany({
      where: actor.shipperId ? { shipperId: actor.shipperId } : undefined,
      include: { shipper: { select: { companyName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return records.map((record) => ({
      id: record.id,
      voucherNumber: record.voucherNumber,
      shipperId: record.shipperId,
      shipperName: record.shipper.companyName,
      status: record.status as unknown as PaymentVoucherStatus,
      paymentMethod: record.paymentMethod as unknown as PaymentMethod,
      deliveredCount: record.deliveredCount,
      returnedCount: record.returnedCount,
      grossCashCollected: Number(record.grossCashCollected),
      grossChecksCollected: Number(record.grossChecksCollected),
      deliveryFeesTotal: Number(record.deliveryFeesTotal),
      returnFeesTotal: Number(record.returnFeesTotal),
      withholdingTaxTotal: Number(record.withholdingTaxTotal),
      netPayable: Number(record.netPayable),
      paidAt: record.paidAt?.toISOString(),
      createdAt: record.createdAt.toISOString(),
    }));
  }

  async findById(id: string): Promise<PaymentVoucherDto | null> {
    const prisma = getPrisma();
    const record = await prisma.paymentVoucher.findUnique({
      where: { id },
      include: { shipper: { select: { companyName: true } } },
    });
    if (!record) return null;
    return {
      id: record.id,
      voucherNumber: record.voucherNumber,
      shipperId: record.shipperId,
      shipperName: record.shipper.companyName,
      status: record.status as unknown as PaymentVoucherStatus,
      paymentMethod: record.paymentMethod as unknown as PaymentMethod,
      deliveredCount: record.deliveredCount,
      returnedCount: record.returnedCount,
      grossCashCollected: Number(record.grossCashCollected),
      grossChecksCollected: Number(record.grossChecksCollected),
      deliveryFeesTotal: Number(record.deliveryFeesTotal),
      returnFeesTotal: Number(record.returnFeesTotal),
      withholdingTaxTotal: Number(record.withholdingTaxTotal),
      netPayable: Number(record.netPayable),
      paidAt: record.paidAt?.toISOString(),
      createdAt: record.createdAt.toISOString(),
    };
  }

  /**
   * Décaissement d'un bordereau.
   *
   * Trois verrous successifs : le code secret doit correspondre au
   * condensat de l'expéditeur, le bordereau ne doit pas déjà être payé, et
   * l'écriture est atomique (relecture de la ligne pour écarter deux
   * décaissements simultanés).
   */
  async validateAndPay(
    voucherNumber: string,
    secretCode: string,
    method: PaymentMethod = SharedMethod.ESPECE,
    actor: PaymentVoucherActor = { fullName: 'Régisseur' },
    transactionRef?: string
  ): Promise<
    | { success: true; data: PaymentVoucherDto; message: string }
    | { success: false; message: string; httpStatus: number }
  > {
    const prisma = getPrisma();

    const voucher = await prisma.paymentVoucher.findUnique({
      where: { voucherNumber },
      include: { shipper: { include: { config: true } } },
    });

    if (!voucher) {
      return { success: false, message: 'Bordereau introuvable.', httpStatus: 404 };
    }

    if (!secretCode || !secretCode.trim()) {
      return {
        success: false,
        message: 'Code secret invalide pour débloquer le paiement.',
        httpStatus: 400,
      };
    }

    if (!verifyPaymentCode(secretCode.trim(), voucher.shipper.config?.secretPaymentCode ?? null)) {
      return {
        success: false,
        message: 'Code secret invalide pour débloquer le paiement.',
        httpStatus: 400,
      };
    }

    if (voucher.status === SharedVoucherStatus.PAYE) {
      return {
        success: false,
        message: `Le bordereau #${voucher.voucherNumber} est déjà réglé.`,
        httpStatus: 409,
      };
    }

    if (voucher.status === SharedVoucherStatus.ANNULE) {
      return {
        success: false,
        message: `Le bordereau #${voucher.voucherNumber} est annulé et ne peut plus être réglé.`,
        httpStatus: 409,
      };
    }

    // Mise à jour conditionnée : si un autre régisseur a décaissé entre-temps,
    // `count` vaut 0 et l'on ne crédite pas deux fois le bordereau.
    //
    // Le décaissement et sa trace partent dans une transaction. Un bordereau
    // payé sans trace laisserait le régisseur incapable de prouver plus tard
    // qu'il a été réglé — et l'écart, une fois passé, ne se rattrape pas.
    const debite = await prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentVoucher.updateMany({
        where: { id: voucher.id, status: { not: SharedVoucherStatus.PAYE } },
        data: {
          status: SharedVoucherStatus.PAYE,
          paymentMethod: method as never,  // enum Prisma et enum partagée portent les mêmes valeurs
          paidAt: new Date(),
          secretCodeVerified: true,
          transactionRef: transactionRef ?? null,
          validatedByUserId: actor.id ?? null,
        },
      });
      if (count === 0) return false;

      await auditService.record(
        {
          entityType: 'PAYMENT_VOUCHER',
          entityId: voucher.id,
          action: 'PAYMENT_VOUCHER_PAID',
          reason:
            `Bordereau ${voucher.voucherNumber} réglé : ${Number(voucher.netPayable).toFixed(3)} DT ` +
            `pour ${voucher.shipper.companyName}, en ${method}.`,
          previousValues: { status: voucher.status },
          newValues: {
            status: SharedVoucherStatus.PAYE,
            netPayable: Number(voucher.netPayable).toFixed(3),
            paymentMethod: method,
            transactionRef: transactionRef ?? null,
          },
          userId: actor.id ?? null,
        },
        tx
      );
      return true;
    });

    if (!debite) {
      return {
        success: false,
        message: `Le bordereau #${voucher.voucherNumber} est déjà réglé.`,
        httpStatus: 409,
      };
    }

    const updated = await this.findById(voucher.id);
    return {
      success: true,
      data: updated!,
      message:
        `Paiement de ${Number(voucher.netPayable).toFixed(3)} DT effectué ` +
        `pour ${voucher.shipper.companyName}.`,
    };
  }

  /**
   * Recalcule les agrégats d'un bordereau à partir des colis qui lui sont
   * rattachés, puis met à jour son net payable.
   *
   * La retenue à la source est un pourcentage prélevé par l'État sur le
   * chiffre d'affaires du transporteur, non sur la valeur des marchandises :
   * elle porte donc sur les frais de livraison, au taux configuré pour
   * l'expéditeur (1 % par défaut).
   *
   *   net = (espèces + chèques encaissés) − frais de livraison
   *         − frais de retour − retenue à la source.
   */
  async recalculate(voucherId: string): Promise<PaymentVoucherDto> {
    const prisma = getPrisma();

    const voucher = await prisma.paymentVoucher.findUnique({
      where: { id: voucherId },
      include: {
        shipper: { include: { config: true } },
        packages: {
          select: {
            status: true,
            collectedAmount: true,
            deliveryFee: true,
            returnFee: true,
          },
        },
      },
    });
    if (!voucher) {
      throw notFound(`Bordereau ${voucherId} introuvable.`);
    }

    const delivered = voucher.packages.filter((p) => p.status === 'LIVRE');
    const returned = voucher.packages.filter((p) => p.status === 'RETOURNE_EXPEDITEUR');

    const gross = delivered.reduce((sum, p) => sum + Number(p.collectedAmount ?? 0), 0);
    const deliveryFees = delivered.reduce((sum, p) => sum + Number(p.deliveryFee ?? 0), 0);
    const returnFees = returned.reduce((sum, p) => sum + Number(p.returnFee ?? 0), 0);
    const rate = Number(voucher.shipper.config?.withholdingTaxRate ?? 0);
    const withheld = deliveryFees * rate;
    const net = gross - deliveryFees - returnFees - withheld;

    await prisma.paymentVoucher.update({
      where: { id: voucherId },
      data: {
        deliveredCount: delivered.length,
        returnedCount: returned.length,
        grossCashCollected: gross,
        deliveryFeesTotal: deliveryFees,
        returnFeesTotal: returnFees,
        withholdingTaxTotal: withheld,
        netPayable: net,
      },
    });

    return (await this.findById(voucherId))!;
  }
}

export const paymentsService = new PaymentsService();
