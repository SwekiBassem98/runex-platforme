/**
 * Changement de prix demandé par un expéditeur.
 *
 * Un expéditeur ne change plus le prix d'un colis créé : il le demande. La
 * demande est envoyée à l'administration (notification), le colis garde son
 * prix tant qu'elle n'est pas approuvée. À l'approbation, le prix du colis,
 * le montant à encaisser (prix + frais) et l'attendu de la tournée sont mis à
 * jour, puis l'expéditeur et le livreur sont prévenus. Au refus, seul
 * l'expéditeur est prévenu.
 *
 * Une seule demande en attente par colis : une nouvelle demande remplace la
 * précédente (index unique partiel en base).
 */

import { Prisma, type PriceChangeStatus } from '@prisma/client';
import { NotificationEvent, PackageStatus, isLockedForEditing } from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { BusinessRuleError, asUuid } from '../../common/errors/api-error';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import { notificationAudience, ROLE_GROUP } from '../notifications/audience';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface PriceChangeDto {
  id: string;
  packageId: string;
  trackingNumber: string;
  status: PriceChangeStatus;
  packageStatus: string;
  shipperId: string;
  shipperName: string;
  customerName: string;
  previousGoodsPrice: number;
  previousTotal: number;
  newGoodsPrice: number;
  newTotal: number;
  deliveryFee: number;
  reason: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const INCLUDE = {
  package: {
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      deliveryFee: true,
      shipperId: true,
      shipper: { select: { companyName: true } },
      customer: { select: { fullName: true } },
    },
  },
} satisfies Prisma.PriceChangeRequestInclude;

type Row = Prisma.PriceChangeRequestGetPayload<{ include: typeof INCLUDE }>;

async function nomsUtilisateurs(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniques = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniques.length) return new Map();
  const rows = await getPrisma().user.findMany({ where: { id: { in: uniques } }, select: { id: true, fullName: true } });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

function toDto(r: Row, noms: Map<string, string>): PriceChangeDto {
  return {
    id: r.id,
    packageId: r.packageId,
    trackingNumber: r.package.trackingNumber,
    status: r.status,
    packageStatus: r.package.status,
    shipperId: r.package.shipperId,
    shipperName: r.package.shipper.companyName,
    customerName: r.package.customer.fullName,
    previousGoodsPrice: Number(r.previousGoodsPrice),
    previousTotal: Number(r.previousTotal),
    newGoodsPrice: Number(r.newGoodsPrice),
    newTotal: Number(r.newTotal),
    deliveryFee: Number(r.package.deliveryFee),
    reason: r.reason,
    requestedBy: r.requestedByUserId ? (noms.get(r.requestedByUserId) ?? null) : null,
    decidedBy: r.decidedByUserId ? (noms.get(r.decidedByUserId) ?? null) : null,
    decisionNote: r.decisionNote,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function versDtos(rows: Row[]): Promise<PriceChangeDto[]> {
  const noms = await nomsUtilisateurs(rows.flatMap((r) => [r.requestedByUserId, r.decidedByUserId]));
  return rows.map((r) => toDto(r, noms));
}

interface Acteur {
  id?: string;
  fullName: string;
  shipperId?: string;
}

export class PriceChangeService {
  /**
   * Enregistre (ou remplace) la demande d'un expéditeur. Le colis n'est pas
   * modifié. Retourne `null` si le prix demandé est déjà le prix du colis.
   */
  async demander(
    packageId: string,
    nouveauPrix: number,
    raison: string | null,
    acteur: Acteur
  ): Promise<PriceChangeDto | null> {
    if (!Number.isFinite(nouveauPrix) || nouveauPrix < 0) {
      throw new BusinessRuleError('Le prix du colis doit être un nombre positif ou nul.', 400);
    }
    const prisma = getPrisma();
    const resultat = await prisma.$transaction(async (tx) => {
      const pkg = await tx.package.findUnique({
        where: { id: packageId },
        select: { id: true, status: true, totalPrice: true, declaredValue: true, deliveryFee: true, shipperId: true, trackingNumber: true },
      });
      if (!pkg || (acteur.shipperId && pkg.shipperId !== acteur.shipperId)) {
        throw new BusinessRuleError('Colis introuvable.', 404);
      }
      if (isLockedForEditing(pkg.status as PackageStatus)) {
        throw new BusinessRuleError('Ce colis est clôturé : son prix ne peut plus changer.', 409);
      }
      const frais = Number(pkg.deliveryFee);
      const prixActuel = r3(Number(pkg.declaredValue ?? Math.max(Number(pkg.totalPrice) - frais, 0)));
      const prix = r3(nouveauPrix);
      const total = r3(prix + frais);
      if (total === r3(Number(pkg.totalPrice))) {
        // Retour au prix actuel : la demande en attente n'a plus d'objet.
        await tx.priceChangeRequest.updateMany({
          where: { packageId, status: 'EN_ATTENTE' },
          data: { status: 'REFUSEE', decisionNote: "Annulée par l'expéditeur", decidedAt: new Date(), decidedByUserId: acteur.id ?? null },
        });
        return null;
      }
      const enAttente = await tx.priceChangeRequest.findFirst({ where: { packageId, status: 'EN_ATTENTE' } });
      const data = {
        previousGoodsPrice: new Prisma.Decimal(prixActuel),
        previousTotal: pkg.totalPrice,
        newGoodsPrice: new Prisma.Decimal(prix),
        newTotal: new Prisma.Decimal(total),
        reason: raison?.slice(0, 255) || null,
        requestedByUserId: acteur.id ?? null,
      };
      const demande = enAttente
        ? await tx.priceChangeRequest.update({ where: { id: enAttente.id }, data: { ...data, createdAt: new Date() }, include: INCLUDE })
        : await tx.priceChangeRequest.create({ data: { packageId, ...data }, include: INCLUDE });
      await auditService.record(
        {
          entityType: 'PRICE_CHANGE',
          entityId: demande.id,
          action: 'PRICE_CHANGE_DEMANDE',
          reason: `Colis ${pkg.trackingNumber} : ${prixActuel.toFixed(3)} → ${prix.toFixed(3)} DT`,
          previousValues: { goodsPrice: prixActuel, totalPrice: Number(pkg.totalPrice) },
          newValues: { goodsPrice: prix, totalPrice: total },
          userId: acteur.id,
        },
        tx
      );
      await tx.packageTimeline.create({
        data: {
          packageId,
          status: pkg.status,
          title: 'Changement de prix demandé',
          description: `Prix demandé : ${prix.toFixed(3)} DT (actuel ${prixActuel.toFixed(3)} DT). En attente d'approbation.`,
          operatorName: acteur.fullName,
        },
      });
      return demande;
    });
    if (!resultat) return null;

    const admins = await notificationAudience.usersByRole(ROLE_GROUP.EXPLOITATION);
    await notificationDispatcher
      .notify({
        event: NotificationEvent.AMOUNT_CHANGED,
        title: 'Changement de prix à approuver',
        content:
          `${resultat.package.shipper.companyName} demande de passer le colis #${resultat.package.trackingNumber} ` +
          `de ${Number(resultat.previousGoodsPrice).toFixed(3)} à ${Number(resultat.newGoodsPrice).toFixed(3)} DT.`,
        relatedEntity: 'PRICE_CHANGE',
        relatedEntityId: resultat.id,
        userIds: admins,
        actorUserId: acteur.id ?? null,
      })
      .catch(() => undefined);
    return (await versDtos([resultat]))[0]!;
  }

  async lister(params: { status?: string; shipperId?: string; packageId?: string }): Promise<PriceChangeDto[]> {
    const where: Prisma.PriceChangeRequestWhereInput = {};
    if (params.status && ['EN_ATTENTE', 'APPROUVEE', 'REFUSEE'].includes(params.status)) {
      where.status = params.status as PriceChangeStatus;
    }
    if (params.packageId) where.packageId = asUuid(params.packageId) ?? '00000000-0000-0000-0000-000000000000';
    if (params.shipperId) where.package = { shipperId: params.shipperId };
    const rows = await getPrisma().priceChangeRequest.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ createdAt: 'desc' }],
      take: 300,
    });
    return versDtos(rows);
  }

  async compterEnAttente(): Promise<number> {
    return getPrisma().priceChangeRequest.count({ where: { status: 'EN_ATTENTE' } });
  }

  /** Approuve ou refuse. L'approbation applique le nouveau prix au colis. */
  async decider(id: string, approuver: boolean, note: string | null, acteur: Acteur): Promise<PriceChangeDto> {
    const uuid = asUuid(id);
    if (!uuid) throw new BusinessRuleError('Demande introuvable.', 404);
    const prisma = getPrisma();
    const demande = await prisma.$transaction(async (tx) => {
      const verrou = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "PriceChangeRequest" WHERE id = ${uuid}::uuid FOR UPDATE`;
      if (!verrou.length) throw new BusinessRuleError('Demande introuvable.', 404);
      const d = await tx.priceChangeRequest.findUniqueOrThrow({ where: { id: uuid }, include: INCLUDE });
      if (d.status !== 'EN_ATTENTE') {
        throw new BusinessRuleError('Cette demande a déjà été traitée.', 409);
      }
      const pkg = await tx.package.findUniqueOrThrow({
        where: { id: d.packageId },
        select: { id: true, status: true, totalPrice: true, deliveryFee: true, currentRunsheetId: true },
      });
      if (approuver && isLockedForEditing(pkg.status as PackageStatus)) {
        throw new BusinessRuleError('Le colis est clôturé entre-temps : le prix ne peut plus changer. Refusez la demande.', 409);
      }
      const maj = await tx.priceChangeRequest.update({
        where: { id: uuid },
        data: {
          status: approuver ? 'APPROUVEE' : 'REFUSEE',
          decidedByUserId: acteur.id ?? null,
          decisionNote: note?.slice(0, 255) || null,
          decidedAt: new Date(),
        },
        include: INCLUDE,
      });
      if (approuver) {
        const frais = Number(pkg.deliveryFee);
        const total = r3(Number(d.newGoodsPrice) + frais);
        const delta = r3(total - Number(pkg.totalPrice));
        await tx.package.update({
          where: { id: pkg.id },
          data: { declaredValue: d.newGoodsPrice, totalPrice: new Prisma.Decimal(total) },
        });
        if (pkg.currentRunsheetId && delta !== 0 && pkg.status !== 'ANNULE') {
          await tx.runsheet.update({
            where: { id: pkg.currentRunsheetId },
            data: { expectedCash: { increment: new Prisma.Decimal(delta) } },
          });
        }
      }
      await auditService.recordOrFail(
        {
          entityType: 'PRICE_CHANGE',
          entityId: uuid,
          action: approuver ? 'PRICE_CHANGE_APPROUVE' : 'PRICE_CHANGE_REFUSE',
          reason:
            `Colis ${d.package.trackingNumber} : ${Number(d.previousGoodsPrice).toFixed(3)} → ${Number(d.newGoodsPrice).toFixed(3)} DT` +
            (note ? ` — ${note}` : ''),
          previousValues: { goodsPrice: Number(d.previousGoodsPrice), totalPrice: Number(d.previousTotal) },
          newValues: approuver ? { goodsPrice: Number(d.newGoodsPrice), totalPrice: Number(d.newTotal) } : undefined,
          userId: acteur.id,
        },
        tx
      );
      await tx.packageTimeline.create({
        data: {
          packageId: d.packageId,
          status: pkg.status,
          title: approuver ? 'Nouveau prix approuvé' : 'Changement de prix refusé',
          description: approuver
            ? `Prix ${Number(d.newGoodsPrice).toFixed(3)} DT, à encaisser ${r3(Number(d.newGoodsPrice) + Number(pkg.deliveryFee)).toFixed(3)} DT.`
            : `Le prix reste ${Number(d.previousGoodsPrice).toFixed(3)} DT.${note ? ` Motif : ${note}` : ''}`,
          operatorName: acteur.fullName,
        },
      });
      return maj;
    });

    const prix = `${Number(demande.newGoodsPrice).toFixed(3)} DT`;
    const shipperUsers = (
      await getPrisma().shipperUser.findMany({ where: { shipperId: demande.package.shipperId }, select: { userId: true } })
    ).map((u) => u.userId);
    await notificationDispatcher
      .notify({
        event: NotificationEvent.AMOUNT_CHANGED,
        title: approuver ? 'Nouveau prix approuvé' : 'Changement de prix refusé',
        content: approuver
          ? `Le prix du colis #${demande.package.trackingNumber} est maintenant ${prix}.`
          : `Votre demande de prix (${prix}) pour le colis #${demande.package.trackingNumber} a été refusée.${note ? ` Motif : ${note}` : ''}`,
        relatedEntity: 'PACKAGE',
        relatedEntityId: demande.packageId,
        userIds: shipperUsers,
      })
      .catch(() => undefined);
    if (approuver) {
      // Le livreur (s'il y en a un) doit connaître le nouveau montant à encaisser.
      const pkg = await getPrisma().package.findUnique({
        where: { id: demande.packageId },
        select: { totalPrice: true, assignedDriver: { select: { userId: true } } },
      });
      if (pkg?.assignedDriver?.userId) {
        await notificationDispatcher
          .notify({
            event: NotificationEvent.AMOUNT_CHANGED,
            title: 'Montant modifié sur un colis',
            content: `Colis #${demande.package.trackingNumber} : montant à encaisser ${Number(pkg.totalPrice).toFixed(3)} DT.`,
            relatedEntity: 'PACKAGE',
            relatedEntityId: demande.packageId,
            userIds: [pkg.assignedDriver.userId],
          })
          .catch(() => undefined);
      }
    }
    return (await versDtos([demande]))[0]!;
  }
}

export const priceChangeService = new PriceChangeService();
