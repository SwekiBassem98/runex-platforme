/**
 * Retours expéditeur (comme ADEX).
 *
 * Les colis retournés au dépôt attendent d'être rendus à leur expéditeur.
 * L'exploitation les voit groupés par expéditeur, prépare un bon de retour
 * (imprimable), et la remise se confirme avec le code du bon : l'expéditeur
 * le lit dans son espace et le donne au guichet, comme pour un bordereau de
 * paiement. À la remise, chaque colis passe « Restitué à l'expéditeur ».
 */

import { Prisma, type ReturnSlipStatus } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { NotificationEvent, PackageStatus, RoleType } from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { BusinessRuleError, asUuid } from '../../common/errors/api-error';
import { codeASixChiffres, nextReturnSlipNumber, tunisDayStamp } from '../../common/database/numbering';
import { packageWorkflowService } from '../colis/package-workflow.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';

/** Statuts d'un colis revenu au dépôt et pas encore rendu. */
const A_RENDRE = ['RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR'] as const;

export interface ActeurRetour {
  id?: string;
  fullName: string;
  role: RoleType;
  shipperId?: string;
  depositId?: string;
}

export interface ColisARendre {
  id: string;
  trackingNumber: string;
  status: string;
  customerName: string;
  governorate: string | null;
  pieceCount: number;
  totalPrice: number;
  returnFee: number;
  reason: string | null;
  depositName: string | null;
  returnedAt: string;
}

export interface GroupeRetours {
  shipperId: string;
  shipperName: string;
  shipperPhone: string | null;
  colis: ColisARendre[];
}

export interface BonRetourDto {
  id: string;
  slipNumber: string;
  status: ReturnSlipStatus;
  shipperId: string;
  shipperName: string;
  shipperPhone: string | null;
  shipperAddress: string | null;
  packagesCount: number;
  /** Visible du seul expéditeur : il le donne au guichet pour récupérer ses retours. */
  handoverCode?: string;
  createdBy: string | null;
  createdAt: string;
  handedOverAt: string | null;
  handedOverBy: string | null;
  receiverName: string | null;
  notes: string | null;
  colis?: ColisARendre[];
}

const COLIS_SELECT = {
  id: true,
  trackingNumber: true,
  status: true,
  pieceCount: true,
  totalPrice: true,
  returnFee: true,
  updatedAt: true,
  customer: { select: { fullName: true } },
  customerAddress: { select: { governorate: true } },
  currentDeposit: { select: { name: true } },
  returns: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { reason: true, createdAt: true } },
} satisfies Prisma.PackageSelect;

type ColisRow = Prisma.PackageGetPayload<{ select: typeof COLIS_SELECT }>;

function versColis(p: ColisRow): ColisARendre {
  return {
    id: p.id,
    trackingNumber: p.trackingNumber,
    status: p.status,
    customerName: p.customer.fullName,
    governorate: p.customerAddress?.governorate ?? null,
    pieceCount: p.pieceCount,
    totalPrice: Number(p.totalPrice),
    returnFee: Number(p.returnFee ?? 0),
    reason: p.returns[0]?.reason ?? null,
    depositName: p.currentDeposit?.name ?? null,
    returnedAt: (p.returns[0]?.createdAt ?? p.updatedAt).toISOString(),
  };
}

function memeCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class RetoursExpediteurService {
  private colisWhere(acteur: ActeurRetour, shipperId?: string): Prisma.PackageWhereInput {
    return {
      deletedAt: null,
      status: { in: [...A_RENDRE] },
      returnSlipId: null,
      ...(shipperId ? { shipperId } : {}),
      ...(acteur.role === RoleType.AGENT_DEPOT && acteur.depositId ? { currentDepositId: acteur.depositId } : {}),
    };
  }

  /** Colis à rendre, groupés par expéditeur. */
  async aRendre(acteur: ActeurRetour, shipperId?: string): Promise<GroupeRetours[]> {
    const rows = await getPrisma().package.findMany({
      where: this.colisWhere(acteur, shipperId ? (asUuid(shipperId) ?? undefined) : undefined),
      select: { ...COLIS_SELECT, shipperId: true, shipper: { select: { companyName: true, phone: true } } },
      orderBy: [{ updatedAt: 'asc' }],
      take: 2000,
    });
    const groupes = new Map<string, GroupeRetours>();
    for (const r of rows) {
      const g = groupes.get(r.shipperId) ?? {
        shipperId: r.shipperId,
        shipperName: r.shipper.companyName,
        shipperPhone: r.shipper.phone ?? null,
        colis: [],
      };
      g.colis.push(versColis(r));
      groupes.set(r.shipperId, g);
    }
    return [...groupes.values()].sort((a, b) => b.colis.length - a.colis.length);
  }

  /** Prépare un bon de retour pour un expéditeur (tous ses retours, ou ceux choisis). */
  async creer(
    payload: { shipperId?: unknown; packageIds?: unknown; notes?: unknown },
    acteur: ActeurRetour
  ): Promise<BonRetourDto> {
    const shipperId = asUuid(typeof payload.shipperId === 'string' ? payload.shipperId : null);
    if (!shipperId) throw new BusinessRuleError('Expéditeur requis.', 400);
    const ids = Array.isArray(payload.packageIds)
      ? payload.packageIds.map((x) => asUuid(String(x))).filter((x): x is string => !!x)
      : null;
    const prisma = getPrisma();
    const bon = await prisma.$transaction(async (tx) => {
      const shipper = await tx.shipper.findUnique({ where: { id: shipperId }, select: { id: true, companyName: true } });
      if (!shipper) throw new BusinessRuleError('Expéditeur introuvable.', 404);
      const where = { ...this.colisWhere(acteur, shipperId), ...(ids ? { id: { in: ids } } : {}) };
      // Verrou des lignes : deux bons simultanés ne prennent pas les mêmes colis.
      const candidats = await tx.package.findMany({ where, select: { id: true } });
      if (!candidats.length) throw new BusinessRuleError("Aucun colis retourné à rendre pour cet expéditeur.", 409);
      await tx.$queryRaw`SELECT id FROM "Package" WHERE id IN (${Prisma.join(candidats.map((c) => Prisma.sql`${c.id}::uuid`))}) FOR UPDATE`;
      const slipNumber = await nextReturnSlipNumber(tx, tunisDayStamp());
      const cree = await tx.returnSlip.create({
        data: {
          slipNumber,
          shipperId,
          handoverCode: codeASixChiffres(),
          createdByUserId: acteur.id ?? null,
          notes: typeof payload.notes === 'string' ? payload.notes.slice(0, 255) || null : null,
        },
      });
      const { count } = await tx.package.updateMany({
        where: { ...where, id: { in: candidats.map((c) => c.id) }, returnSlipId: null },
        data: { returnSlipId: cree.id },
      });
      if (!count) throw new BusinessRuleError('Ces colis viennent d’être pris dans un autre bon.', 409);
      await tx.returnSlip.update({ where: { id: cree.id }, data: { packagesCount: count } });
      await auditService.record(
        {
          entityType: 'RETURN_SLIP',
          entityId: cree.id,
          action: 'RETURN_SLIP_CREE',
          reason: `Bon ${slipNumber} : ${count} colis pour ${shipper.companyName}`,
          newValues: { packages: count },
          userId: acteur.id,
        },
        tx
      );
      return cree;
    });

    const users = (await prisma.shipperUser.findMany({ where: { shipperId }, select: { userId: true } })).map((u) => u.userId);
    await notificationDispatcher
      .notify({
        event: NotificationEvent.COLIS_RETURNED,
        title: 'Retours prêts à récupérer',
        content: `Bon de retour ${bon.slipNumber} : vos colis retournés sont prêts. Présentez le code du bon (espace « Retours ») pour les récupérer.`,
        relatedEntity: 'RETURN_SLIP',
        relatedEntityId: bon.id,
        userIds: users,
      })
      .catch(() => undefined);
    return this.detail(bon.id, acteur);
  }

  async lister(acteur: ActeurRetour, params: { status?: string; shipperId?: string }): Promise<BonRetourDto[]> {
    const where: Prisma.ReturnSlipWhereInput = {};
    if (params.status && ['PREPARE', 'REMIS', 'ANNULE'].includes(params.status)) where.status = params.status as ReturnSlipStatus;
    const shipperId = acteur.role === RoleType.EXPEDITEUR ? acteur.shipperId : asUuid(params.shipperId ?? null);
    if (acteur.role === RoleType.EXPEDITEUR && !shipperId) return [];
    if (shipperId) where.shipperId = shipperId;
    const rows = await getPrisma().returnSlip.findMany({
      where,
      include: { shipper: { select: { companyName: true, phone: true, address: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const noms = await this.noms(rows.flatMap((r) => [r.createdByUserId, r.handedOverById]));
    return rows.map((r) => this.versDto(r, acteur, noms));
  }

  async detail(id: string, acteur: ActeurRetour): Promise<BonRetourDto> {
    const uuid = asUuid(id);
    const r = uuid
      ? await getPrisma().returnSlip.findUnique({
          where: { id: uuid },
          include: {
            shipper: { select: { companyName: true, phone: true, address: true } },
            packages: { select: COLIS_SELECT, orderBy: { trackingNumber: 'asc' } },
          },
        })
      : null;
    if (!r || (acteur.role === RoleType.EXPEDITEUR && r.shipperId !== acteur.shipperId)) {
      throw new BusinessRuleError('Bon de retour introuvable.', 404);
    }
    const noms = await this.noms([r.createdByUserId, r.handedOverById]);
    return { ...this.versDto(r, acteur, noms), colis: r.packages.map(versColis) };
  }

  /** Remise à l'expéditeur, confirmée par le code du bon. */
  async remettre(
    id: string,
    payload: { code?: unknown; receiverName?: unknown },
    acteur: ActeurRetour
  ): Promise<BonRetourDto> {
    const uuid = asUuid(id);
    if (!uuid) throw new BusinessRuleError('Bon de retour introuvable.', 404);
    const code = typeof payload.code === 'string' ? payload.code.trim() : '';
    if (!code) throw new BusinessRuleError("Saisissez le code donné par l'expéditeur.", 400);
    const prisma = getPrisma();
    const bon = await prisma.$transaction(async (tx) => {
      const verrou = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ReturnSlip" WHERE id = ${uuid}::uuid FOR UPDATE`;
      if (!verrou.length) throw new BusinessRuleError('Bon de retour introuvable.', 404);
      const b = await tx.returnSlip.findUniqueOrThrow({
        where: { id: uuid },
        include: { packages: { select: { id: true, status: true, currentDeposit: { select: { name: true } } } }, shipper: { select: { companyName: true } } },
      });
      if (b.status !== 'PREPARE') throw new BusinessRuleError(`Ce bon est déjà ${b.status === 'REMIS' ? 'remis' : 'annulé'}.`, 409);
      if (!memeCode(code, b.handoverCode)) throw new BusinessRuleError('Code incorrect.', 400);
      const receveur = typeof payload.receiverName === 'string' ? payload.receiverName.trim().slice(0, 150) : '';
      for (const p of b.packages) {
        await packageWorkflowService.transition({
          packageId: p.id,
          to: PackageStatus.RETOURNE_EXPEDITEUR,
          actor: { id: acteur.id, fullName: acteur.fullName, role: acteur.role },
          title: "Colis restitué à l'expéditeur",
          note: `Bon de retour ${b.slipNumber}${receveur ? ` — remis à ${receveur}` : ''}`,
          location: p.currentDeposit?.name ?? undefined,
          auditAction: 'RESTORED_TO_SHIPPER',
          data: { assignedDriverId: null, currentRunsheetId: null },
          client: tx,
        });
      }
      await tx.returnRecord.updateMany({
        where: { packageId: { in: b.packages.map((p) => p.id) }, restoredToShipperAt: null },
        data: { restoredToShipperAt: new Date(), isPhysicalChecked: true },
      });
      await tx.returnSlip.update({
        where: { id: uuid },
        data: { status: 'REMIS', handedOverAt: new Date(), handedOverById: acteur.id ?? null, receiverName: receveur || null },
      });
      await auditService.recordOrFail(
        {
          entityType: 'RETURN_SLIP',
          entityId: uuid,
          action: 'RETURN_SLIP_REMIS',
          reason: `Bon ${b.slipNumber} remis à ${b.shipper.companyName}${receveur ? ` (${receveur})` : ''} : ${b.packages.length} colis`,
          userId: acteur.id,
        },
        tx
      );
      return b;
    }, { timeout: 30000 });

    const users = (await prisma.shipperUser.findMany({ where: { shipperId: bon.shipperId }, select: { userId: true } })).map((u) => u.userId);
    await notificationDispatcher
      .notify({
        event: NotificationEvent.COLIS_RETURNED,
        title: 'Retours remis',
        content: `Bon ${bon.slipNumber} : ${bon.packages.length} colis vous ont été restitués.`,
        relatedEntity: 'RETURN_SLIP',
        relatedEntityId: bon.id,
        userIds: users,
      })
      .catch(() => undefined);
    return this.detail(uuid, acteur);
  }

  /** Annule un bon préparé : ses colis redeviennent « à rendre ». */
  async annuler(id: string, acteur: ActeurRetour): Promise<BonRetourDto> {
    const uuid = asUuid(id);
    if (!uuid) throw new BusinessRuleError('Bon de retour introuvable.', 404);
    await getPrisma().$transaction(async (tx) => {
      const b = await tx.returnSlip.findUnique({ where: { id: uuid } });
      if (!b) throw new BusinessRuleError('Bon de retour introuvable.', 404);
      if (b.status !== 'PREPARE') throw new BusinessRuleError('Seul un bon préparé peut être annulé.', 409);
      await tx.package.updateMany({ where: { returnSlipId: uuid }, data: { returnSlipId: null } });
      await tx.returnSlip.update({ where: { id: uuid }, data: { status: 'ANNULE' } });
      await auditService.record(
        { entityType: 'RETURN_SLIP', entityId: uuid, action: 'RETURN_SLIP_ANNULE', reason: `Bon ${b.slipNumber} annulé`, userId: acteur.id },
        tx
      );
    });
    return this.detail(uuid, acteur);
  }

  private async noms(ids: (string | null)[]): Promise<Map<string, string>> {
    const uniques = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniques.length) return new Map();
    const rows = await getPrisma().user.findMany({ where: { id: { in: uniques } }, select: { id: true, fullName: true } });
    return new Map(rows.map((u) => [u.id, u.fullName]));
  }

  private versDto(
    r: Prisma.ReturnSlipGetPayload<{ include: { shipper: { select: { companyName: true; phone: true; address: true } } } }>,
    acteur: ActeurRetour,
    noms: Map<string, string>
  ): BonRetourDto {
    return {
      id: r.id,
      slipNumber: r.slipNumber,
      status: r.status,
      shipperId: r.shipperId,
      shipperName: r.shipper.companyName,
      shipperPhone: r.shipper.phone ?? null,
      shipperAddress: r.shipper.address ?? null,
      packagesCount: r.packagesCount,
      ...(acteur.role === RoleType.EXPEDITEUR && r.status === 'PREPARE' ? { handoverCode: r.handoverCode } : {}),
      createdBy: r.createdByUserId ? (noms.get(r.createdByUserId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      handedOverAt: r.handedOverAt?.toISOString() ?? null,
      handedOverBy: r.handedOverById ? (noms.get(r.handedOverById) ?? null) : null,
      receiverName: r.receiverName,
      notes: r.notes,
    };
  }
}

export const retoursExpediteurService = new RetoursExpediteurService();
