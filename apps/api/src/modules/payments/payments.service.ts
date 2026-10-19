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
import { Prisma } from '@prisma/client';
import { NotificationEvent } from '@logixpress/types';
import { notFound, badRequest, conflict, asUuid, BusinessRuleError } from '../../common/errors/api-error';
import { auditService } from '../../common/audit/audit.service';
import { codeASixChiffres, nextVoucherNumber } from '../../common/database/numbering';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import { SELECT_TARIF, calculerNet, tarifDepuisConfig, arrondi3 } from '../../common/tarifs/tarif-expediteur';

/** Statuts « livré » d'un colis (la livraison partielle compte). */
const LIVRES = ['LIVRE', 'LIVRAISON_PARTIELLE'] as const;

/** Colis d'un expéditeur prêts à entrer dans un bordereau. */
export interface CandidatsBordereau {
  shipperId: string;
  shipperName: string;
  livres: number;
  retournes: number;
  encaisse: number;
  fraisLivraison: number;
  fraisRetour: number;
  fraisGestion: number;
  /** Taux de R.A.S. en % (3 = 3 %), 0 quand elle ne s'applique pas. */
  tauxRas: number;
  ras: number;
  netEstime: number;
}

function memeCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Colis éligibles : livrés dont l'encaissement n'attend plus la caisse (aucun
 * paiement « en attente »), et retournés à l'expéditeur — hors bordereau.
 */
function whereCandidats(shipperId?: string): Prisma.PackageWhereInput {
  return {
    deletedAt: null,
    paymentVoucherId: null,
    ...(shipperId ? { shipperId } : {}),
    OR: [
      { status: { in: [...LIVRES] }, NOT: { payment: { is: { status: 'EN_ATTENTE' } } } },
      { status: 'RETOURNE_EXPEDITEUR' },
    ],
  };
}

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
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(candidate, 'hex');
  // Condensat stocké d'une autre longueur : refus, pas une 500.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(actual, expected);
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
      managementFeesTotal: Number(record.managementFeesTotal),
      withholdingTaxRate: Number(record.withholdingTaxRate),
      netPayable: Number(record.netPayable),
      paidAt: record.paidAt?.toISOString(),
      createdAt: record.createdAt.toISOString(),
      // Le code ne sort que vers l'expéditeur, et seulement s'il sert encore.
      ...(actor.shipperId && record.status !== 'PAYE' && record.status !== 'ANNULE'
        ? { withdrawalCode: record.withdrawalCode }
        : {}),
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
      managementFeesTotal: Number(record.managementFeesTotal),
      withholdingTaxRate: Number(record.withholdingTaxRate),
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

    // Code du bordereau (donné par l'expéditeur, comme chez ADEX) ou, pour les
    // anciens bordereaux, le code secret permanent de l'expéditeur.
    const codeBordereau = voucher.withdrawalCode ? memeCode(secretCode.trim(), voucher.withdrawalCode) : false;
    if (!codeBordereau && !verifyPaymentCode(secretCode.trim(), voucher.shipper.config?.secretPaymentCode ?? null)) {
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

    const delivered = voucher.packages.filter((p) => p.status === 'LIVRE' || p.status === 'LIVRAISON_PARTIELLE');
    const returned = voucher.packages.filter((p) => p.status === 'RETOURNE_EXPEDITEUR');

    const gross = delivered.reduce((sum, p) => sum + Number(p.collectedAmount ?? 0), 0);
    const deliveryFees = delivered.reduce((sum, p) => sum + Number(p.deliveryFee ?? 0), 0);
    const returnFees = returned.reduce((sum, p) => sum + Number(p.returnFee ?? 0), 0);
    // Tarif de l'expéditeur : frais de gestion par paiement, R.A.S. sur le net.
    const tarif = tarifDepuisConfig(voucher.shipper.config);
    const { ras: withheld, net } = calculerNet({
      encaisse: gross,
      fraisLivraison: deliveryFees,
      fraisRetour: returnFees,
      fraisGestion: tarif.gestion,
      tauxRas: tarif.tauxRas,
    });

    await prisma.paymentVoucher.update({
      where: { id: voucherId },
      data: {
        deliveredCount: delivered.length,
        returnedCount: returned.length,
        grossCashCollected: gross,
        deliveryFeesTotal: deliveryFees,
        returnFeesTotal: returnFees,
        withholdingTaxTotal: withheld,
        managementFeesTotal: tarif.gestion,
        withholdingTaxRate: tarif.tauxRas,
        netPayable: net,
      },
    });

    return (await this.findById(voucherId))!;
  }

  /** Par expéditeur : ce qui peut entrer dans un nouveau bordereau. */
  async candidats(shipperId?: string): Promise<CandidatsBordereau[]> {
    const prisma = getPrisma();
    const rows = await prisma.package.findMany({
      where: whereCandidats(shipperId ? (asUuid(shipperId) ?? undefined) : undefined),
      select: {
        shipperId: true,
        status: true,
        collectedAmount: true,
        deliveryFee: true,
        returnFee: true,
        shipper: { select: { companyName: true, config: { select: SELECT_TARIF } } },
      },
      take: 20000,
    });
    const parExp = new Map<string, CandidatsBordereau & { tarif: ReturnType<typeof tarifDepuisConfig> }>();
    for (const r of rows) {
      const g = parExp.get(r.shipperId) ?? {
        shipperId: r.shipperId,
        shipperName: r.shipper.companyName,
        livres: 0,
        retournes: 0,
        encaisse: 0,
        fraisLivraison: 0,
        fraisRetour: 0,
        fraisGestion: 0,
        tauxRas: 0,
        ras: 0,
        netEstime: 0,
        tarif: tarifDepuisConfig(r.shipper.config),
      };
      if (r.status === 'RETOURNE_EXPEDITEUR') {
        g.retournes += 1;
        // Un retour sans frais fixés prend les frais de retour de l'expéditeur.
        g.fraisRetour += Number(r.returnFee ?? 0) > 0 ? Number(r.returnFee) : g.tarif.retour;
      } else {
        g.livres += 1;
        g.encaisse += Number(r.collectedAmount ?? 0);
        g.fraisLivraison += Number(r.deliveryFee ?? 0);
      }
      parExp.set(r.shipperId, g);
    }
    return [...parExp.values()]
      .map(({ tarif, ...g }) => {
        const calcul = calculerNet({
          encaisse: g.encaisse,
          fraisLivraison: g.fraisLivraison,
          fraisRetour: g.fraisRetour,
          fraisGestion: tarif.gestion,
          tauxRas: tarif.tauxRas,
        });
        return {
          ...g,
          encaisse: arrondi3(g.encaisse),
          fraisLivraison: arrondi3(g.fraisLivraison),
          fraisRetour: arrondi3(g.fraisRetour),
          fraisGestion: tarif.gestion,
          tauxRas: Math.round(tarif.tauxRas * 10000) / 100,
          ras: calcul.ras,
          netEstime: calcul.net,
        };
      })
      .sort((a, b) => b.netEstime - a.netEstime);
  }

  /**
   * Crée le bordereau d'un expéditeur avec tous ses colis éligibles (ou ceux
   * choisis). Un code de retrait à 6 chiffres est généré : l'expéditeur le
   * voit dans son espace et le donne à la caisse pour être payé.
   */
  async creerBordereau(
    payload: { shipperId?: unknown; packageIds?: unknown; notes?: unknown },
    actor: PaymentVoucherActor
  ): Promise<PaymentVoucherDto> {
    const shipperId = asUuid(typeof payload.shipperId === 'string' ? payload.shipperId : null);
    if (!shipperId) throw badRequest('Expéditeur requis.');
    const ids = Array.isArray(payload.packageIds)
      ? payload.packageIds.map((x) => asUuid(String(x))).filter((x): x is string => !!x)
      : null;
    const prisma = getPrisma();
    const voucher = await prisma.$transaction(async (tx) => {
      const shipper = await tx.shipper.findUnique({
        where: { id: shipperId },
        select: { companyName: true, config: { select: SELECT_TARIF } },
      });
      if (!shipper) throw notFound('Expéditeur introuvable.');
      const where = { ...whereCandidats(shipperId), ...(ids ? { id: { in: ids } } : {}) };
      const candidats = await tx.package.findMany({ where, select: { id: true } });
      if (!candidats.length) {
        throw new BusinessRuleError('Aucun colis livré (encaissement validé) ou retourné à régler pour cet expéditeur.', 409);
      }
      await tx.$queryRaw`SELECT id FROM "Package" WHERE id IN (${Prisma.join(candidats.map((c) => Prisma.sql`${c.id}::uuid`))}) FOR UPDATE`;
      const voucherNumber = await nextVoucherNumber(tx);
      const cree = await tx.paymentVoucher.create({
        data: {
          voucherNumber,
          shipperId,
          status: 'CONFIRME',
          netPayable: 0,
          withdrawalCode: codeASixChiffres(),
          notes: typeof payload.notes === 'string' ? payload.notes.slice(0, 500) || null : null,
        },
      });
      const { count } = await tx.package.updateMany({
        where: { id: { in: candidats.map((c) => c.id) }, paymentVoucherId: null },
        data: { paymentVoucherId: cree.id },
      });
      if (!count) throw conflict('Ces colis viennent d’être pris dans un autre bordereau.');
      // Frais de retour : ceux du tarif de l'expéditeur, figés sur le colis
      // au moment du bordereau (un colis qui en porte déjà les garde).
      const fraisRetour = tarifDepuisConfig(shipper.config).retour;
      if (fraisRetour > 0) {
        await tx.package.updateMany({
          where: { paymentVoucherId: cree.id, status: 'RETOURNE_EXPEDITEUR', returnFee: 0 },
          data: { returnFee: fraisRetour },
        });
      }
      await auditService.record(
        {
          entityType: 'PAYMENT_VOUCHER',
          entityId: cree.id,
          action: 'PAYMENT_VOUCHER_CREE',
          reason: `Bordereau ${voucherNumber} : ${count} colis pour ${shipper.companyName}`,
          userId: actor.id ?? null,
        },
        tx
      );
      return cree;
    });
    const dto = await this.recalculate(voucher.id);
    const users = (await prisma.shipperUser.findMany({ where: { shipperId }, select: { userId: true } })).map((u) => u.userId);
    await notificationDispatcher
      .notify({
        event: NotificationEvent.PAYMENT_VALIDATED,
        title: 'Bordereau de paiement prêt',
        content:
          `Bordereau ${dto.voucherNumber} : ${dto.netPayable.toFixed(3)} DT à percevoir. ` +
          'Donnez le code du bordereau (espace « Bordereaux ») à la caisse pour être payé.',
        relatedEntity: 'PAYMENT_VOUCHER',
        relatedEntityId: dto.id,
        userIds: users,
      })
      .catch(() => undefined);
    return dto;
  }

  /** Fiche d'un bordereau avec ses colis ; le code ne sort que vers l'expéditeur. */
  async detail(idOrNumber: string, actor: PaymentVoucherActor): Promise<PaymentVoucherDto> {
    const prisma = getPrisma();
    const uuid = asUuid(idOrNumber);
    const record = await prisma.paymentVoucher.findFirst({
      where: uuid ? { id: uuid } : { voucherNumber: idOrNumber },
      include: {
        packages: {
          select: {
            id: true,
            trackingNumber: true,
            status: true,
            totalPrice: true,
            collectedAmount: true,
            deliveryFee: true,
            returnFee: true,
            customer: { select: { fullName: true } },
          },
          orderBy: { trackingNumber: 'asc' },
        },
      },
    });
    if (!record || (actor.shipperId && record.shipperId !== actor.shipperId)) throw notFound('Bordereau introuvable.');
    const base = (await this.findById(record.id))!;
    return {
      ...base,
      ...(actor.shipperId && record.status !== 'PAYE' && record.status !== 'ANNULE'
        ? { withdrawalCode: record.withdrawalCode }
        : {}),
      colis: record.packages.map((p) => ({
        id: p.id,
        trackingNumber: p.trackingNumber,
        status: p.status,
        customerName: p.customer.fullName,
        totalPrice: Number(p.totalPrice),
        collectedAmount: Number(p.collectedAmount ?? 0),
        deliveryFee: Number(p.deliveryFee ?? 0),
        returnFee: Number(p.returnFee ?? 0),
      })),
    };
  }

  /** Annule un bordereau non réglé : ses colis redeviennent éligibles. */
  async annulerBordereau(idOrNumber: string, actor: PaymentVoucherActor): Promise<PaymentVoucherDto> {
    const prisma = getPrisma();
    const uuid = asUuid(idOrNumber);
    const v = await prisma.paymentVoucher.findFirst({ where: uuid ? { id: uuid } : { voucherNumber: idOrNumber } });
    if (!v) throw notFound('Bordereau introuvable.');
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentVoucher.updateMany({
        where: { id: v.id, status: { in: ['EN_ATTENTE', 'CONFIRME'] } },
        data: { status: 'ANNULE' },
      });
      if (!count) throw conflict('Seul un bordereau non réglé peut être annulé.');
      await tx.package.updateMany({ where: { paymentVoucherId: v.id }, data: { paymentVoucherId: null } });
      await auditService.record(
        {
          entityType: 'PAYMENT_VOUCHER',
          entityId: v.id,
          action: 'PAYMENT_VOUCHER_CREE',
          reason: `Bordereau ${v.voucherNumber} annulé`,
          previousValues: { status: v.status },
          newValues: { status: 'ANNULE' },
          userId: actor.id ?? null,
        },
        tx
      );
    });
    return (await this.findById(v.id))!;
  }
}

export const paymentsService = new PaymentsService();
