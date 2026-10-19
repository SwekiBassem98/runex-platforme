/**
 * Retours expéditeur — bons de retour, comme chez ADEX.
 *
 * 1. « Ajouter un bon de retour » : on choisit l'expéditeur, le bon est créé
 *    (en préparation) avec son numéro.
 * 2. On choisit le livreur qui le portera, le matricule du véhicule et la date.
 * 3. On scanne les colis retournés au dépôt de cet expéditeur pour les ajouter
 *    au bon (ou les retirer) ; les articles repris lors d'un échange
 *    s'ajoutent de la même façon. La liste des colis encore au dépôt pour cet
 *    expéditeur est affichée à côté.
 * 4. « Imprimer » : bon de retour (livreur, véhicule, expéditeur, colis,
 *    cachet et signature).
 * 5. L'état suit la restitution : en préparation → en cours de livraison
 *    (le livreur part avec les colis) → remis à l'expéditeur. Un bon parti
 *    peut revenir au dépôt (non remis) ; un bon en préparation peut être
 *    remis directement au guichet, ou annulé.
 * 6. Remise : comme pour le paiement d'un bordereau, l'exploitation saisit le
 *    code de remise du bon (6 chiffres). Seul l'expéditeur le voit, dans son
 *    espace « Retours » : il le donne quand il a reçu ses colis.
 * 7. Suppression (administrateur) : un bon en préparation, remis ou annulé
 *    peut être supprimé ; un bon en cours de livraison doit d'abord revenir
 *    au dépôt.
 */

import crypto from 'node:crypto';
import { Prisma, type ReturnSlipStatus } from '@prisma/client';
import { NotificationEvent, PackageStatus, PACKAGE_STATUS_LABELS, RoleType } from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { BusinessRuleError, asUuid } from '../../common/errors/api-error';
import { codeASixChiffres, nextReturnSlipNumber, tunisDayStamp } from '../../common/database/numbering';
import { packageCodeWhere } from '../../common/scan/package-code';
import { periode } from '../../common/dates/periode';
import { packageWorkflowService } from '../colis/package-workflow.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';

export interface ActeurRetour {
  id?: string;
  fullName: string;
  role: RoleType;
  shipperId?: string;
  depositId?: string;
}

/** Libellés des états d'un bon, tels qu'affichés partout. */
export const ETATS_BON: Record<ReturnSlipStatus, string> = {
  PREPARE: 'En préparation',
  EN_COURS: 'En cours de livraison',
  REMIS: 'Remis à l’expéditeur',
  ANNULE: 'Annulé',
};

/** Changements d'état autorisés depuis chaque état. */
const SUIVANTS: Record<ReturnSlipStatus, ReturnSlipStatus[]> = {
  PREPARE: ['EN_COURS', 'REMIS', 'ANNULE'],
  EN_COURS: ['REMIS', 'PREPARE'],
  REMIS: [],
  ANNULE: [],
};

export interface ColisBon {
  id: string;
  kind: 'COLIS' | 'ECHANGE';
  trackingNumber: string;
  barcode: string;
  status: string;
  statusLabel: string;
  content: string;
  pieceCount: number;
  amount: number;
  customerName: string;
  customerPhone: string | null;
  address: string;
  reason: string | null;
  depositName: string | null;
  date: string;
}

export interface BonRetourLigne {
  id: string;
  slipNumber: string;
  status: ReturnSlipStatus;
  statusLabel: string;
  nextStatuses: { status: ReturnSlipStatus; label: string }[];
  shipperId: string;
  shipperName: string;
  driverId: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  plannedDate: string | null;
  colisCount: number;
  piecesCount: number;
  createdAt: string;
  createdBy: string | null;
  departedAt: string | null;
  handedOverAt: string | null;
  handedOverBy: string | null;
  receiverName: string | null;
  notes: string | null;
  /**
   * Code de remise : présent pour l'expéditeur seulement, tant que le bon
   * n'est ni remis ni annulé. Jamais renvoyé à l'exploitation.
   */
  handoverCode?: string;
}

export interface BonRetourDetail extends BonRetourLigne {
  shipperPhone: string | null;
  shipperAddress: string | null;
  depositName: string | null;
  colis: ColisBon[];
  /** Colis encore au dépôt pour cet expéditeur (à ajouter). Vide hors préparation. */
  colisAuDepot: ColisBon[];
  /** Articles repris lors d'un échange, en attente de restitution. */
  echangesAuDepot: ColisBon[];
}

export interface ResumeExpediteurARendre {
  shipperId: string;
  shipperName: string;
  colis: number;
  echanges: number;
}

const COLIS_SELECT = {
  id: true,
  trackingNumber: true,
  barcode: true,
  status: true,
  pieceCount: true,
  totalPrice: true,
  contentSummary: true,
  updatedAt: true,
  shipperId: true,
  returnSlipId: true,
  currentDepositId: true,
  customer: { select: { fullName: true, primaryPhone: true } },
  customerAddress: { select: { streetAddress: true, delegation: true, governorate: true } },
  currentDeposit: { select: { name: true } },
  returns: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { reason: true, createdAt: true } },
} satisfies Prisma.PackageSelect;

const ECHANGE_SELECT = {
  id: true,
  oldPackageBarcode: true,
  returnedItemSummary: true,
  returnSlipId: true,
  createdAt: true,
  package: {
    select: {
      trackingNumber: true,
      shipperId: true,
      customer: { select: { fullName: true, primaryPhone: true } },
      customerAddress: { select: { streetAddress: true, delegation: true, governorate: true } },
      currentDeposit: { select: { name: true } },
    },
  },
} satisfies Prisma.ExchangeRecordSelect;

type ColisRow = Prisma.PackageGetPayload<{ select: typeof COLIS_SELECT }>;
type EchangeRow = Prisma.ExchangeRecordGetPayload<{ select: typeof ECHANGE_SELECT }>;

const adresse = (a: { streetAddress: string | null; delegation: string | null; governorate: string | null } | null) =>
  [a?.streetAddress, a?.delegation, a?.governorate].filter(Boolean).join(', ');

function versColis(p: ColisRow): ColisBon {
  return {
    id: p.id,
    kind: 'COLIS',
    trackingNumber: p.trackingNumber,
    barcode: p.barcode,
    status: p.status,
    statusLabel: PACKAGE_STATUS_LABELS[p.status as PackageStatus] ?? p.status,
    content: p.contentSummary ?? '',
    pieceCount: p.pieceCount,
    amount: Number(p.totalPrice),
    customerName: p.customer.fullName,
    customerPhone: p.customer.primaryPhone ?? null,
    address: adresse(p.customerAddress),
    reason: p.returns[0]?.reason ?? null,
    depositName: p.currentDeposit?.name ?? null,
    date: (p.returns[0]?.createdAt ?? p.updatedAt).toISOString(),
  };
}

function versEchange(e: EchangeRow): ColisBon {
  return {
    id: e.id,
    kind: 'ECHANGE',
    trackingNumber: e.package.trackingNumber,
    barcode: e.oldPackageBarcode,
    status: 'ECHANGE',
    statusLabel: 'Article repris (échange)',
    content: e.returnedItemSummary,
    pieceCount: 1,
    amount: 0,
    customerName: e.package.customer.fullName,
    customerPhone: e.package.customer.primaryPhone ?? null,
    address: adresse(e.package.customerAddress),
    reason: 'Échange',
    depositName: e.package.currentDeposit?.name ?? null,
    date: e.createdAt.toISOString(),
  };
}

/** Comparaison à temps constant de deux codes. */
function memeCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const INCLUDE_LIGNE = {
  shipper: { select: { companyName: true, phone: true, address: true } },
  driver: { select: { id: true, licensePlate: true, user: { select: { fullName: true } } } },
  packages: { select: { pieceCount: true } },
  _count: { select: { exchanges: true } },
} satisfies Prisma.ReturnSlipInclude;

type LigneRow = Prisma.ReturnSlipGetPayload<{ include: typeof INCLUDE_LIGNE }>;

export class RetoursExpediteurService {
  /** Colis retournés à rendre (statut retour, hors bon) — périmètre de l'agent. */
  private whereColisAuDepot(acteur: ActeurRetour, shipperId?: string): Prisma.PackageWhereInput {
    return {
      deletedAt: null,
      status: 'RETOUR_DEPOT',
      returnSlipId: null,
      ...(shipperId ? { shipperId } : {}),
      ...(acteur.role === RoleType.AGENT_DEPOT && acteur.depositId ? { currentDepositId: acteur.depositId } : {}),
    };
  }

  /** Articles repris lors d'un échange, pas encore rendus. */
  private whereEchangesAuDepot(shipperId?: string): Prisma.ExchangeRecordWhereInput {
    return {
      returnSlipId: null,
      returnedToShipperAt: null,
      package: { deletedAt: null, status: 'LIVRE', ...(shipperId ? { shipperId } : {}) },
    };
  }

  /** Par expéditeur : combien de colis et d'articles d'échange attendent un bon. */
  async aRendre(acteur: ActeurRetour): Promise<ResumeExpediteurARendre[]> {
    const prisma = getPrisma();
    const [colis, echanges] = await Promise.all([
      prisma.package.groupBy({ by: ['shipperId'], where: this.whereColisAuDepot(acteur), _count: { _all: true } }),
      prisma.exchangeRecord.findMany({ where: this.whereEchangesAuDepot(), select: { package: { select: { shipperId: true } } } }),
    ]);
    const parExp = new Map<string, { colis: number; echanges: number }>();
    for (const c of colis) parExp.set(c.shipperId, { colis: c._count._all, echanges: 0 });
    for (const e of echanges) {
      const g = parExp.get(e.package.shipperId) ?? { colis: 0, echanges: 0 };
      g.echanges += 1;
      parExp.set(e.package.shipperId, g);
    }
    if (!parExp.size) return [];
    const noms = await prisma.shipper.findMany({ where: { id: { in: [...parExp.keys()] } }, select: { id: true, companyName: true } });
    return noms
      .map((s) => ({ shipperId: s.id, shipperName: s.companyName, ...parExp.get(s.id)! }))
      .sort((a, b) => b.colis + b.echanges - (a.colis + a.echanges));
  }

  async lister(
    acteur: ActeurRetour,
    params: { status?: string; shipperId?: string; driverId?: string; from?: string; to?: string; q?: string }
  ): Promise<BonRetourLigne[]> {
    const where: Prisma.ReturnSlipWhereInput = {};
    if (params.status && params.status in ETATS_BON) where.status = params.status as ReturnSlipStatus;
    const shipperId = acteur.role === RoleType.EXPEDITEUR ? acteur.shipperId : asUuid(params.shipperId ?? null);
    if (acteur.role === RoleType.EXPEDITEUR && !shipperId) return [];
    if (shipperId) where.shipperId = shipperId;
    const driverId = asUuid(params.driverId ?? null);
    if (driverId) where.driverId = driverId;
    const p = periode(params.from, params.to);
    if (p) where.createdAt = p;
    if (params.q?.trim()) where.slipNumber = { contains: params.q.trim(), mode: 'insensitive' };
    const rows = await getPrisma().returnSlip.findMany({
      where,
      include: INCLUDE_LIGNE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const noms = await this.noms(rows.flatMap((r) => [r.createdByUserId, r.handedOverById]));
    return rows.map((r) => this.versLigne(r, noms, acteur));
  }

  /** Crée un bon (en préparation) pour un expéditeur. */
  async creer(
    payload: { shipperId?: unknown; driverId?: unknown; vehiclePlate?: unknown; plannedDate?: unknown; notes?: unknown },
    acteur: ActeurRetour
  ): Promise<BonRetourDetail> {
    const shipperId = asUuid(typeof payload.shipperId === 'string' ? payload.shipperId : null);
    if (!shipperId) throw new BusinessRuleError('Choisissez un expéditeur.', 400);
    const prisma = getPrisma();
    const bon = await prisma.$transaction(async (tx) => {
      const shipper = await tx.shipper.findUnique({ where: { id: shipperId }, select: { companyName: true } });
      if (!shipper) throw new BusinessRuleError('Expéditeur introuvable.', 404);
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
      await auditService.record(
        {
          entityType: 'RETURN_SLIP',
          entityId: cree.id,
          action: 'RETURN_SLIP_CREE',
          reason: `Bon ${slipNumber} créé pour ${shipper.companyName}`,
          userId: acteur.id,
        },
        tx
      );
      return cree;
    });
    if (payload.driverId || payload.vehiclePlate || payload.plannedDate) {
      return this.modifier(bon.id, payload, acteur);
    }
    return this.detail(bon.id, acteur);
  }

  /** Livreur, véhicule, date, note — tant que le bon est en préparation. */
  async modifier(
    id: string,
    payload: { driverId?: unknown; vehiclePlate?: unknown; plannedDate?: unknown; notes?: unknown },
    acteur: ActeurRetour
  ): Promise<BonRetourDetail> {
    const bon = await this.bonModifiable(id);
    const data: Prisma.ReturnSlipUncheckedUpdateInput = {};
    if (payload.driverId !== undefined) {
      if (payload.driverId === null || payload.driverId === '') {
        data.driverId = null;
      } else {
        const driverId = asUuid(String(payload.driverId));
        const driver = driverId
          ? await getPrisma().driver.findFirst({ where: { id: driverId, deletedAt: null }, select: { id: true, licensePlate: true } })
          : null;
        if (!driver) throw new BusinessRuleError('Livreur introuvable.', 400);
        data.driverId = driver.id;
        // Matricule du véhicule : celui du livreur, sauf saisie explicite.
        if (payload.vehiclePlate === undefined && driver.licensePlate) data.vehiclePlate = driver.licensePlate;
      }
    }
    if (payload.vehiclePlate !== undefined) {
      data.vehiclePlate = typeof payload.vehiclePlate === 'string' ? payload.vehiclePlate.trim().slice(0, 30) || null : null;
    }
    if (payload.plannedDate !== undefined) {
      const v = typeof payload.plannedDate === 'string' ? payload.plannedDate.trim() : '';
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BusinessRuleError('Date invalide (AAAA-MM-JJ).', 400);
      data.plannedDate = v ? new Date(`${v}T00:00:00.000Z`) : null;
    }
    if (payload.notes !== undefined) {
      data.notes = typeof payload.notes === 'string' ? payload.notes.slice(0, 255) || null : null;
    }
    await getPrisma().returnSlip.update({ where: { id: bon.id }, data });
    await auditService.record({
      entityType: 'RETURN_SLIP',
      entityId: bon.id,
      action: 'RETURN_SLIP_MODIFIE',
      reason: `Bon ${bon.slipNumber} : livreur / véhicule / date mis à jour`,
      userId: acteur.id,
    });
    return this.detail(bon.id, acteur);
  }

  /**
   * Scan d'un code-barres : ajoute (ou retire) le colis — ou l'article repris
   * d'un échange — au bon. Les refus disent pourquoi, en clair.
   */
  async scanner(
    id: string,
    payload: { code?: unknown; mode?: unknown },
    acteur: ActeurRetour
  ): Promise<{ bon: BonRetourDetail; message: string }> {
    const code = typeof payload.code === 'string' ? payload.code.trim() : '';
    if (!code) throw new BusinessRuleError('Scannez ou saisissez un code-barres.', 400);
    const retirer = payload.mode === 'retirer';
    const bon = await this.bonModifiable(id);
    const prisma = getPrisma();

    const message = await prisma.$transaction(async (tx) => {
      const pkg = await tx.package.findFirst({
        where: { deletedAt: null, ...packageCodeWhere(code) },
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          shipperId: true,
          returnSlipId: true,
          currentDepositId: true,
          shipper: { select: { companyName: true } },
          exchangeRecord: { select: { id: true, returnSlipId: true, returnedToShipperAt: true } },
        },
      });
      const echangeParCode = pkg
        ? null
        : await tx.exchangeRecord.findFirst({
            where: { oldPackageBarcode: code },
            select: {
              id: true,
              returnSlipId: true,
              returnedToShipperAt: true,
              package: { select: { trackingNumber: true, shipperId: true, status: true, shipper: { select: { companyName: true } } } },
            },
          });
      if (!pkg && !echangeParCode) throw new BusinessRuleError(`Code « ${code} » inconnu.`, 404);

      // Article repris d'un échange : par son propre code, ou par le colis livré qui l'a remplacé.
      const echange =
        echangeParCode ??
        (pkg && pkg.status === 'LIVRE' && pkg.exchangeRecord
          ? { ...pkg.exchangeRecord, package: { trackingNumber: pkg.trackingNumber, shipperId: pkg.shipperId, status: pkg.status, shipper: pkg.shipper } }
          : null);

      if (echange) {
        if (echange.package.shipperId !== bon.shipperId) {
          throw new BusinessRuleError(`Cet article appartient à ${echange.package.shipper.companyName}, pas à l'expéditeur du bon.`, 409);
        }
        if (retirer) {
          if (echange.returnSlipId !== bon.id) throw new BusinessRuleError("Cet article n'est pas dans ce bon.", 409);
          await tx.exchangeRecord.update({ where: { id: echange.id }, data: { returnSlipId: null } });
          return `Article d'échange du colis ${echange.package.trackingNumber} retiré du bon.`;
        }
        if (echange.returnedToShipperAt) throw new BusinessRuleError("Cet article a déjà été rendu à l'expéditeur.", 409);
        if (echange.returnSlipId === bon.id) throw new BusinessRuleError('Cet article est déjà dans ce bon.', 409);
        if (echange.returnSlipId) throw new BusinessRuleError('Cet article est déjà dans un autre bon de retour.', 409);
        await tx.exchangeRecord.update({ where: { id: echange.id }, data: { returnSlipId: bon.id } });
        return `Article d'échange du colis ${echange.package.trackingNumber} ajouté au bon.`;
      }

      const p = pkg!;
      if (p.shipperId !== bon.shipperId) {
        throw new BusinessRuleError(`Le colis ${p.trackingNumber} appartient à ${p.shipper.companyName}, pas à l'expéditeur du bon.`, 409);
      }
      if (retirer) {
        if (p.returnSlipId !== bon.id) throw new BusinessRuleError(`Le colis ${p.trackingNumber} n'est pas dans ce bon.`, 409);
        await tx.package.update({ where: { id: p.id }, data: { returnSlipId: null } });
        return `Colis ${p.trackingNumber} retiré du bon.`;
      }
      if (p.returnSlipId === bon.id) throw new BusinessRuleError(`Le colis ${p.trackingNumber} est déjà dans ce bon.`, 409);
      if (p.returnSlipId) throw new BusinessRuleError(`Le colis ${p.trackingNumber} est déjà dans un autre bon de retour.`, 409);
      if (p.status !== 'RETOUR_DEPOT') {
        const libelle = PACKAGE_STATUS_LABELS[p.status as PackageStatus] ?? p.status;
        throw new BusinessRuleError(
          `Le colis ${p.trackingNumber} est « ${libelle} » : seul un colis retourné au dépôt peut partir dans un bon de retour.`,
          409
        );
      }
      if (acteur.role === RoleType.AGENT_DEPOT && acteur.depositId && p.currentDepositId !== acteur.depositId) {
        throw new BusinessRuleError(`Le colis ${p.trackingNumber} n'est pas dans votre dépôt.`, 409);
      }
      await tx.package.update({ where: { id: p.id }, data: { returnSlipId: bon.id } });
      return `Colis ${p.trackingNumber} ajouté au bon.`;
    });

    await this.recompter(bon.id);
    return { bon: await this.detail(bon.id, acteur), message };
  }

  /** Changement d'état du bon, avec ses effets sur les colis. */
  async changerEtat(
    id: string,
    payload: { status?: unknown; receiverName?: unknown; code?: unknown },
    acteur: ActeurRetour
  ): Promise<{ bon: BonRetourDetail; message: string }> {
    const uuid = asUuid(id);
    if (!uuid) throw new BusinessRuleError('Bon de retour introuvable.', 404);
    const cible = String(payload.status ?? '') as ReturnSlipStatus;
    if (!(cible in ETATS_BON)) throw new BusinessRuleError('État inconnu.', 400);
    const receveur = typeof payload.receiverName === 'string' ? payload.receiverName.trim().slice(0, 150) : '';
    const codeSaisi = typeof payload.code === 'string' || typeof payload.code === 'number' ? String(payload.code).replace(/\s+/g, '') : '';
    const prisma = getPrisma();

    // Bon ancien sans code : on lui en attribue un, que l'expéditeur lit
    // dans son espace, avant toute remise.
    if (cible === 'REMIS') {
      const actuel = await prisma.returnSlip.findUnique({ where: { id: uuid }, select: { handoverCode: true, status: true } });
      if (actuel && !actuel.handoverCode && (actuel.status === 'PREPARE' || actuel.status === 'EN_COURS')) {
        await prisma.returnSlip.update({ where: { id: uuid }, data: { handoverCode: codeASixChiffres() } });
      }
    }

    const { bon, depart } = await prisma.$transaction(
      async (tx) => {
        const verrou = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ReturnSlip" WHERE id = ${uuid}::uuid FOR UPDATE`;
        if (!verrou.length) throw new BusinessRuleError('Bon de retour introuvable.', 404);
        const b = await tx.returnSlip.findUniqueOrThrow({
          where: { id: uuid },
          include: {
            shipper: { select: { companyName: true } },
            driver: { select: { id: true, userId: true, user: { select: { fullName: true } } } },
            packages: { select: { id: true, status: true, currentDeposit: { select: { name: true } } } },
            exchanges: { select: { id: true } },
          },
        });
        const depart = b.status;
        if (!SUIVANTS[depart].includes(cible)) {
          throw new BusinessRuleError(`Un bon « ${ETATS_BON[depart]} » ne peut pas passer à « ${ETATS_BON[cible]} ».`, 409);
        }
        const acteurWf = { id: acteur.id, fullName: acteur.fullName, role: acteur.role };
        const nb = b.packages.length + b.exchanges.length;

        if (cible === 'EN_COURS') {
          if (!b.driver) throw new BusinessRuleError('Choisissez le livreur qui porte le bon avant de le lancer.', 409);
          if (!nb) throw new BusinessRuleError('Le bon est vide : ajoutez au moins un colis.', 409);
          for (const p of b.packages) {
            await packageWorkflowService.transition({
              packageId: p.id,
              to: PackageStatus.EN_RUNSHEET_RETOUR,
              actor: acteurWf,
              title: 'En cours de restitution',
              note: `Bon de retour ${b.slipNumber} — livreur ${b.driver.user.fullName}`,
              location: p.currentDeposit?.name ?? undefined,
              auditAction: 'RETURN_SLIP_EN_COURS',
              data: { assignedDriverId: b.driver.id },
              client: tx,
            });
          }
          await tx.returnSlip.update({ where: { id: uuid }, data: { status: 'EN_COURS', departedAt: new Date() } });
        } else if (cible === 'REMIS') {
          if (!nb) throw new BusinessRuleError('Le bon est vide : rien à remettre.', 409);
          // Double validation, comme le paiement : le code que l'expéditeur
          // donne une fois ses colis reçus.
          if (!codeSaisi) {
            throw new BusinessRuleError(`Saisissez le code de remise donné par ${b.shipper.companyName}.`, 400);
          }
          if (!b.handoverCode || !memeCode(codeSaisi, b.handoverCode)) {
            throw new BusinessRuleError(
              `Code de remise incorrect. Demandez à ${b.shipper.companyName} le code du bon ${b.slipNumber} (visible dans son espace « Retours »).`,
              403
            );
          }
          for (const p of b.packages) {
            await packageWorkflowService.transition({
              packageId: p.id,
              to: PackageStatus.RETOURNE_EXPEDITEUR,
              actor: acteurWf,
              title: "Colis restitué à l'expéditeur",
              note: `Bon de retour ${b.slipNumber}${receveur ? ` — reçu par ${receveur}` : ''}`,
              location: depart === 'EN_COURS' ? "Chez l'expéditeur" : (p.currentDeposit?.name ?? undefined),
              auditAction: 'RESTORED_TO_SHIPPER',
              data: { assignedDriverId: null, currentRunsheetId: null },
              client: tx,
            });
          }
          const maintenant = new Date();
          await tx.returnRecord.updateMany({
            where: { packageId: { in: b.packages.map((p) => p.id) }, restoredToShipperAt: null },
            data: { restoredToShipperAt: maintenant, isPhysicalChecked: true },
          });
          await tx.exchangeRecord.updateMany({ where: { returnSlipId: uuid }, data: { returnedToShipperAt: maintenant } });
          await tx.returnSlip.update({
            where: { id: uuid },
            data: {
              status: 'REMIS',
              handedOverAt: maintenant,
              handedOverById: acteur.id ?? null,
              receiverName: receveur || null,
            },
          });
        } else if (cible === 'PREPARE') {
          // Revenu au dépôt sans être remis : les colis redeviennent « retour dépôt ».
          for (const p of b.packages) {
            await packageWorkflowService.transition({
              packageId: p.id,
              to: PackageStatus.RETOUR_DEPOT,
              actor: acteurWf,
              title: 'Revenu au dépôt (bon de retour non remis)',
              reason: `Bon de retour ${b.slipNumber} non remis à l'expéditeur`,
              location: p.currentDeposit?.name ?? 'Dépôt',
              auditAction: 'RETURN_SLIP_REVENU',
              data: { assignedDriverId: null },
              client: tx,
            });
          }
          await tx.returnSlip.update({ where: { id: uuid }, data: { status: 'PREPARE', departedAt: null } });
        } else if (cible === 'ANNULE') {
          await tx.package.updateMany({ where: { returnSlipId: uuid }, data: { returnSlipId: null } });
          await tx.exchangeRecord.updateMany({ where: { returnSlipId: uuid }, data: { returnSlipId: null } });
          await tx.returnSlip.update({ where: { id: uuid }, data: { status: 'ANNULE', packagesCount: 0 } });
        }

        await auditService.recordOrFail(
          {
            entityType: 'RETURN_SLIP',
            entityId: uuid,
            action:
              cible === 'REMIS'
                ? 'RETURN_SLIP_REMIS'
                : cible === 'EN_COURS'
                  ? 'RETURN_SLIP_EN_COURS'
                  : cible === 'ANNULE'
                    ? 'RETURN_SLIP_ANNULE'
                    : 'RETURN_SLIP_REVENU',
            reason: `Bon ${b.slipNumber} (${b.shipper.companyName}) : ${ETATS_BON[depart]} → ${ETATS_BON[cible]}, ${nb} colis`,
            previousValues: { status: depart },
            newValues: cible === 'REMIS' ? { status: cible, codeRemiseVerifie: true } : { status: cible },
            userId: acteur.id,
          },
          tx
        );
        return { bon: b, depart };
      },
      { timeout: 30000 }
    );

    // Notifications : l'expéditeur suit ses retours, le livreur sait ce qu'il porte.
    const shipperUsers = (await prisma.shipperUser.findMany({ where: { shipperId: bon.shipperId }, select: { userId: true } })).map((u) => u.userId);
    const nb = bon.packages.length + bon.exchanges.length;
    if (cible === 'EN_COURS') {
      await notificationDispatcher
        .notify({
          event: NotificationEvent.COLIS_RETURNED,
          title: 'Retours en route',
          content:
            `Bon de retour ${bon.slipNumber} : ${nb} colis en route vers vous avec ${bon.driver?.user.fullName ?? 'notre livreur'}.` +
            (bon.handoverCode ? ` À réception, donnez le code de remise ${bon.handoverCode}.` : ''),
          relatedEntity: 'RETURN_SLIP',
          relatedEntityId: bon.id,
          userIds: shipperUsers,
        })
        .catch(() => undefined);
      if (bon.driver?.userId) {
        await notificationDispatcher
          .notify({
            event: NotificationEvent.COLIS_RETURNED,
            title: 'Bon de retour à livrer',
            content: `Bon ${bon.slipNumber} : ${nb} colis à rendre à ${bon.shipper.companyName}. Faites signer le bon.`,
            relatedEntity: 'RETURN_SLIP',
            relatedEntityId: bon.id,
            userIds: [bon.driver.userId],
          })
          .catch(() => undefined);
      }
    } else if (cible === 'REMIS') {
      await notificationDispatcher
        .notify({
          event: NotificationEvent.COLIS_RETURNED,
          title: 'Retours remis',
          content: `Bon ${bon.slipNumber} : ${nb} colis vous ont été restitués.`,
          relatedEntity: 'RETURN_SLIP',
          relatedEntityId: bon.id,
          userIds: shipperUsers,
        })
        .catch(() => undefined);
    }

    const messages: Record<ReturnSlipStatus, string> = {
      EN_COURS: `Bon ${bon.slipNumber} en cours de livraison : ${nb} colis confiés à ${bon.driver?.user.fullName ?? 'le livreur'}.`,
      REMIS: `Bon ${bon.slipNumber} remis à ${bon.shipper.companyName} : ${nb} colis restitués.`,
      PREPARE:
        depart === 'EN_COURS'
          ? `Bon ${bon.slipNumber} revenu au dépôt : les colis sont de nouveau à rendre.`
          : `Bon ${bon.slipNumber} en préparation.`,
      ANNULE: `Bon ${bon.slipNumber} annulé : ses colis sont de nouveau à rendre.`,
    };
    return { bon: await this.detail(uuid, acteur), message: messages[cible] };
  }

  /**
   * Suppression d'un bon (administrateur). En préparation : ses colis
   * redeviennent « à rendre ». Remis ou annulé : seul le document disparaît,
   * les colis gardent leur état et leur historique. En cours de livraison :
   * refusé, le bon doit d'abord revenir au dépôt.
   */
  async supprimer(id: string, acteur: ActeurRetour): Promise<{ slipNumber: string; message: string }> {
    const uuid = asUuid(id);
    if (!uuid) throw new BusinessRuleError('Bon de retour introuvable.', 404);
    const prisma = getPrisma();
    return prisma.$transaction(async (tx) => {
      const verrou = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ReturnSlip" WHERE id = ${uuid}::uuid FOR UPDATE`;
      if (!verrou.length) throw new BusinessRuleError('Bon de retour introuvable.', 404);
      const b = await tx.returnSlip.findUniqueOrThrow({
        where: { id: uuid },
        include: { shipper: { select: { companyName: true } }, _count: { select: { packages: true, exchanges: true } } },
      });
      if (b.status === 'EN_COURS') {
        throw new BusinessRuleError(
          `Le bon ${b.slipNumber} est en cours de livraison : passez-le d'abord en « Revenu au dépôt », puis supprimez-le.`,
          409
        );
      }
      const nb = b._count.packages + b._count.exchanges;
      await tx.package.updateMany({ where: { returnSlipId: uuid }, data: { returnSlipId: null } });
      await tx.exchangeRecord.updateMany({ where: { returnSlipId: uuid }, data: { returnSlipId: null } });
      await tx.returnSlip.delete({ where: { id: uuid } });
      await auditService.recordOrFail(
        {
          entityType: 'RETURN_SLIP',
          entityId: uuid,
          action: 'RETURN_SLIP_SUPPRIME',
          reason: `Bon ${b.slipNumber} (${b.shipper.companyName}, ${ETATS_BON[b.status]}, ${nb} colis) supprimé par ${acteur.fullName}`,
          previousValues: { slipNumber: b.slipNumber, status: b.status, shipper: b.shipper.companyName, colis: nb },
          userId: acteur.id,
        },
        tx
      );
      const suite =
        b.status === 'PREPARE' && nb
          ? ` : ses ${nb} colis sont de nouveau à rendre.`
          : b.status === 'REMIS'
            ? ' : les colis restent « retournés à l’expéditeur ».'
            : '.';
      return { slipNumber: b.slipNumber, message: `Bon ${b.slipNumber} supprimé${suite}` };
    });
  }

  async detail(id: string, acteur: ActeurRetour): Promise<BonRetourDetail> {
    const uuid = asUuid(id);
    const prisma = getPrisma();
    const r = uuid
      ? await prisma.returnSlip.findUnique({
          where: { id: uuid },
          include: {
            ...INCLUDE_LIGNE,
            packages: { select: COLIS_SELECT, orderBy: { trackingNumber: 'asc' } },
            exchanges: { select: ECHANGE_SELECT, orderBy: { createdAt: 'asc' } },
          },
        })
      : null;
    if (!r || (acteur.role === RoleType.EXPEDITEUR && r.shipperId !== acteur.shipperId)) {
      throw new BusinessRuleError('Bon de retour introuvable.', 404);
    }
    const enPreparation = r.status === 'PREPARE' && acteur.role !== RoleType.EXPEDITEUR;
    const [auDepot, echanges, noms] = await Promise.all([
      enPreparation
        ? prisma.package.findMany({
            where: this.whereColisAuDepot(acteur, r.shipperId),
            select: COLIS_SELECT,
            orderBy: { updatedAt: 'asc' },
            take: 500,
          })
        : Promise.resolve([] as ColisRow[]),
      enPreparation
        ? prisma.exchangeRecord.findMany({ where: this.whereEchangesAuDepot(r.shipperId), select: ECHANGE_SELECT, take: 500 })
        : Promise.resolve([] as EchangeRow[]),
      this.noms([r.createdByUserId, r.handedOverById]),
    ]);
    const colis = [...r.packages.map(versColis), ...r.exchanges.map(versEchange)];
    const ligne = this.versLigne(
      { ...r, packages: r.packages.map((p) => ({ pieceCount: p.pieceCount })), _count: { exchanges: r.exchanges.length } },
      noms,
      acteur
    );
    const depot = r.packages.find((p) => p.currentDeposit)?.currentDeposit?.name ?? null;
    return {
      ...ligne,
      shipperPhone: r.shipper.phone ?? null,
      shipperAddress: r.shipper.address ?? null,
      depositName: depot,
      colis,
      colisAuDepot: auDepot.map(versColis),
      echangesAuDepot: echanges.map(versEchange),
    };
  }

  private async bonModifiable(id: string) {
    const uuid = asUuid(id);
    const bon = uuid ? await getPrisma().returnSlip.findUnique({ where: { id: uuid } }) : null;
    if (!bon) throw new BusinessRuleError('Bon de retour introuvable.', 404);
    if (bon.status !== 'PREPARE') {
      throw new BusinessRuleError(`Ce bon est « ${ETATS_BON[bon.status]} » : il ne peut plus être modifié.`, 409);
    }
    return bon;
  }

  private async recompter(id: string): Promise<void> {
    const prisma = getPrisma();
    const [p, e] = await Promise.all([
      prisma.package.count({ where: { returnSlipId: id } }),
      prisma.exchangeRecord.count({ where: { returnSlipId: id } }),
    ]);
    await prisma.returnSlip.update({ where: { id }, data: { packagesCount: p + e } });
  }

  private async noms(ids: (string | null)[]): Promise<Map<string, string>> {
    const uniques = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniques.length) return new Map();
    const rows = await getPrisma().user.findMany({ where: { id: { in: uniques } }, select: { id: true, fullName: true } });
    return new Map(rows.map((u) => [u.id, u.fullName]));
  }

  private versLigne(r: LigneRow, noms: Map<string, string>, acteur: ActeurRetour): BonRetourLigne {
    const colisCount = r.packages.length + r._count.exchanges;
    const codeVisible =
      acteur.role === RoleType.EXPEDITEUR && !!r.handoverCode && (r.status === 'PREPARE' || r.status === 'EN_COURS');
    return {
      ...(codeVisible ? { handoverCode: r.handoverCode! } : {}),
      id: r.id,
      slipNumber: r.slipNumber,
      status: r.status,
      statusLabel: ETATS_BON[r.status],
      nextStatuses: SUIVANTS[r.status].map((s) => ({
        status: s,
        label: s === 'PREPARE' ? 'Revenu au dépôt (non remis)' : ETATS_BON[s],
      })),
      shipperId: r.shipperId,
      shipperName: r.shipper.companyName,
      driverId: r.driver?.id ?? null,
      driverName: r.driver?.user.fullName ?? null,
      vehiclePlate: r.vehiclePlate,
      plannedDate: r.plannedDate ? r.plannedDate.toISOString().slice(0, 10) : null,
      colisCount: r.status === 'ANNULE' ? r.packagesCount : colisCount,
      piecesCount: r.packages.reduce((s, p) => s + p.pieceCount, 0) + r._count.exchanges,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdByUserId ? (noms.get(r.createdByUserId) ?? null) : null,
      departedAt: r.departedAt?.toISOString() ?? null,
      handedOverAt: r.handedOverAt?.toISOString() ?? null,
      handedOverBy: r.handedOverById ? (noms.get(r.handedOverById) ?? null) : null,
      receiverName: r.receiverName,
      notes: r.notes,
    };
  }
}

export const retoursExpediteurService = new RetoursExpediteurService();
