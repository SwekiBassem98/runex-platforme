/**
 * Inter-dépôts « au scan » — livraison et retours.
 *
 * Le flux reprend celui que les agences pratiquent déjà :
 *
 *  1. **Bordereau d'abord.** L'agence de départ choisit l'agence d'arrivée
 *     (livraison) ou l'agence de l'expéditeur (retours), le livreur — son
 *     immatriculation est reprise automatiquement — et la date. Le bordereau
 *     est « En attente ».
 *  2. **Chargement au scan.** Chaque colis scanné monte dans le bordereau et
 *     quitte le stock du dépôt (en route). Un interrupteur Ajouter / Retirer
 *     permet de corriger une erreur en rescannant. Un colis qui n'a rien à
 *     faire dans ce camion est refusé avec son motif : destination différente
 *     (un colis pour Nabeul ne monte pas dans un bordereau pour Sfax), colis
 *     absent du dépôt, déjà dans un autre bordereau, engagé dans une tournée…
 *  3. **Acceptation pièce par pièce** à l'arrivée. Chaque étiquette de pièce
 *     est scannée ; un colis est reçu quand toutes ses pièces le sont,
 *     « partiellement reçu » sinon. Le bordereau reste ouvert tant qu'une pièce
 *     manque.
 *
 * Garde-fous : chaque écriture verrouille la ligne du bordereau (`FOR UPDATE`)
 * et passe par la machine à états du colis, conditionnée au statut lu — deux
 * postes qui scannent en même temps ne peuvent pas compter deux fois la même
 * pièce ni charger un colis dans deux camions.
 */

import type { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import {
  InterDepotStatus,
  InterDepotType,
  INTER_DEPOT_STATUS_LABELS,
  INTER_DEPOT_OPEN_STATUSES,
  PackageStatus,
  PACKAGE_STATUS_LABELS,
  RoleType,
  NotificationEvent,
  pieceBarcode,
} from '@logixpress/types';
import { notFound, badRequest, conflict, asUuid, ApiError } from '../../common/errors/api-error';
import { packageWorkflowService } from '../colis/package-workflow.service';
import { nextTransferNumber, tunisDayStamp } from '../../common/database/numbering';
import { mainHubId } from '../../common/routing/deposit-routing';

/* ------------------------------------------------------------------ */
/* Types publics                                                      */
/* ------------------------------------------------------------------ */

export interface InterDepotActor {
  id?: string;
  fullName: string;
  role: RoleType;
  /** Dépôt de l'opérateur (agent de dépôt, ou dépôt de rattachement). */
  depositId?: string | null;
}

export type InterDepotDirection = 'ENVOI' | 'RECEPTION';

export interface TransferItemDto {
  packageId: string;
  trackingNumber: string;
  barcode: string;
  shipperName: string;
  customerName: string;
  destination: string;
  pieceCount: number;
  /** Taille déclarée (LEGERE, MOYENNE, LOURDE, VOLUMINEUSE) : colonne « Type pièce ». */
  sizeCategory: string;
  receivedPieces: number;
  receivedPieceNumbers: number[];
  /** `EN_ROUTE`, `PARTIEL`, `RECU`. */
  receptionState: 'EN_ROUTE' | 'PARTIEL' | 'RECU';
  packageStatus: PackageStatus;
  packageStatusLabel: string;
  addedAt: string;
  receivedAt: string | null;
}

/** Une étape de la chronologie visuelle du mouvement (compatibilité). */
export interface MovementStep {
  key: string;
  label: string;
  status: InterDepotStatus;
  location: string;
  description: string;
  timestamp: string | null;
  reached: boolean;
}

export interface InterDepotDto {
  id: string;
  transferNumber: string;
  type: InterDepotType;
  typeLabel: string;
  sourceDeposit: string;
  sourceDepositId: string;
  destinationDeposit: string;
  destinationDepositId: string;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  departureAt: string | null;
  scheduledDate: string | null;
  sealNumber: string | null;
  status: InterDepotStatus;
  statusLabel: string;
  /** Sens du bordereau pour le dépôt qui le consulte. */
  direction: InterDepotDirection | null;
  /** Nombre de colis (« commandes »). */
  totalPackages: number;
  /** Nombre de pièces (« colis » au sens des étiquettes). */
  totalPieces: number;
  receivedPackages: number;
  receivedPieces: number;
  partialPackages: number;
  /** Colis dont aucune ou une partie seulement des pièces est arrivée. */
  discrepancy: number;
  hasDiscrepancy: boolean;
  /** Chargement encore modifiable (aucune pièce acceptée à l'arrivée). */
  editable: boolean;
  notes: string | null;
  dispatchNotes: string | null;
  receptionNotes: string | null;
  items: TransferItemDto[];
  /** Compatibilité avec les anciens écrans et l'application mobile. */
  packages: { id: string; trackingNumber: string; status: PackageStatus; pieceCount: number; customerName: string }[];
  movement: MovementStep[];
  allowedTransitions: InterDepotStatus[];
  createdAt: string;
  preparedAt: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

export interface InterDepotStats {
  total: number;
  sentPending: number;
  sentReceived: number;
  toReceive: number;
  received: number;
}

export interface ScanResult {
  mode: 'add' | 'remove';
  message: string;
  trackingNumber: string;
  transfer: InterDepotDto;
}

export interface AcceptanceResult {
  message: string;
  trackingNumber: string;
  pieceNumber: number;
  pieceCount: number;
  receivedPieces: number;
  packageComplete: boolean;
  transferNumber: string;
  transferStatus: InterDepotStatus;
}

/* ------------------------------------------------------------------ */
/* Constantes                                                         */
/* ------------------------------------------------------------------ */

const OPEN = INTER_DEPOT_OPEN_STATUSES as readonly string[];

/** Statuts depuis lesquels un colis de livraison peut monter dans un bordereau. */
const LOADABLE_DELIVERY: readonly string[] = ['RECU_DEPOT', 'RECU_DEPOT_DESTINATION'];
/** Statut d'un retour prêt à repartir vers l'agence de son expéditeur. */
const LOADABLE_RETURN: readonly string[] = ['RETOUR_DEPOT'];

const TRANSFER_INCLUDE = {
  sourceDeposit: { select: { id: true, name: true, city: true, isMainHub: true } },
  destinationDeposit: { select: { id: true, name: true, city: true, isMainHub: true } },
  transporterDriver: {
    select: { id: true, licensePlate: true, user: { select: { fullName: true, phone: true } } },
  },
  items: {
    orderBy: { addedAt: 'asc' },
    include: {
      pieces: { select: { pieceNumber: true }, orderBy: { pieceNumber: 'asc' } },
      package: {
        select: {
          id: true,
          trackingNumber: true,
          barcode: true,
          status: true,
          pieceCount: true,
          sizeCategory: true,
          customer: { select: { fullName: true } },
          customerAddress: { select: { governorate: true, delegation: true } },
          shipper: { select: { companyName: true, brandName: true } },
        },
      },
    },
  },
} satisfies Prisma.InterDepotTransferInclude;

type TransferRecord = Prisma.InterDepotTransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

const statusLabel = (s: string) => PACKAGE_STATUS_LABELS[s as PackageStatus] ?? s;
const typeLabel = (t: InterDepotType) =>
  t === InterDepotType.RETOUR ? 'Inter-dépôt retours et échanges' : 'Inter-dépôt livraison';

/** Motif lisible d'un colis qui ne peut pas monter dans un bordereau. */
function loadRefusal(status: string, type: InterDepotType): string {
  switch (status) {
    case 'CREE':
    case 'RAMASSAGE_PROGRAMME':
    case 'RAMASSE':
      return "n'a pas encore été réceptionné au dépôt (passez-le d'abord en acceptation magasin)";
    case 'AFFECTE_RUNSHEET':
    case 'EN_COURS_LIVRAISON':
    case 'EN_RUNSHEET_RETOUR':
      return 'est engagé dans une tournée';
    case 'REPORTE':
    case 'ECHEC_LIVRAISON':
    case 'LIVRAISON_PARTIELLE':
      return 'est encore dans le processus de livraison';
    case 'EN_LOT_INTER_DEPOT':
    case 'EN_TRANSIT_INTER_DEPOT':
      return 'est déjà en route dans un autre inter-dépôt';
    case 'LIVRE':
      return 'est déjà livré';
    case 'RETOURNE_EXPEDITEUR':
      return 'a déjà été rendu à son expéditeur';
    case 'ANNULE':
      return 'est annulé';
    case 'RETOUR_DEPOT':
      return type === InterDepotType.LIVRAISON
        ? "est un retour : chargez-le dans un inter-dépôt retours"
        : 'ne peut pas être chargé';
    case 'RECU_DEPOT':
    case 'RECU_DEPOT_DESTINATION':
      return type === InterDepotType.RETOUR
        ? "n'est pas un retour : chargez-le dans un inter-dépôt livraison"
        : 'ne peut pas être chargé';
    default:
      return `est au statut « ${statusLabel(status)} »`;
  }
}

/* ------------------------------------------------------------------ */
/* Lecture d'un code scanné                                            */
/* ------------------------------------------------------------------ */

interface ParsedCode {
  raw: string;
  base: string;
  piece: number | null;
}

/**
 * Un scan est soit le code du colis (code-barres ou numéro de suivi), soit
 * l'étiquette d'une pièce : `<code colis>-<n°>`.
 */
function parseCode(input: unknown): ParsedCode {
  const raw = String(input ?? '').trim();
  if (!raw) throw badRequest('Scannez ou saisissez un code-barres.');
  if (raw.length > 80 || !/^[A-Za-z0-9-]+$/.test(raw)) {
    throw badRequest('Code-barres illisible.');
  }
  const m = /^(.+)-(\d{1,3})$/.exec(raw);
  if (m) return { raw, base: m[1]!, piece: Number(m[2]) };
  return { raw, base: raw, piece: null };
}

async function findPackageByCode(client: Prisma.TransactionClient | ReturnType<typeof getPrisma>, code: ParsedCode) {
  const select = {
    id: true,
    trackingNumber: true,
    barcode: true,
    status: true,
    pieceCount: true,
    deletedAt: true,
    currentDepositId: true,
    originDepositId: true,
    destinationDepositId: true,
    assignedDriverId: true,
    currentRunsheetId: true,
    interDepotTransferId: true,
    destinationDeposit: { select: { name: true } },
    originDeposit: { select: { name: true } },
  } as const;
  // Le code complet d'abord (un numéro de suivi peut lui-même contenir un tiret).
  const exact = await client.package.findFirst({
    where: { deletedAt: null, OR: [{ barcode: code.raw }, { trackingNumber: code.raw }] },
    select,
  });
  if (exact) return { pkg: exact, piece: null as number | null };
  if (code.piece !== null) {
    const byBase = await client.package.findFirst({
      where: { deletedAt: null, OR: [{ barcode: code.base }, { trackingNumber: code.base }] },
      select,
    });
    if (byBase) return { pkg: byBase, piece: code.piece };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class InterDepotsService {
  private get prisma() {
    return getPrisma();
  }

  /* ---------------------------- lecture ---------------------------- */

  /** Dépôt d'où l'opérateur travaille : le sien, sinon celui demandé, sinon le hub. */
  async operatingDepositId(actor: InterDepotActor, requested?: unknown): Promise<string> {
    if (actor.role === RoleType.AGENT_DEPOT) {
      if (!actor.depositId) throw new ApiError("Votre compte n'est rattaché à aucun dépôt.", 403);
      return actor.depositId;
    }
    const asked = typeof requested === 'string' && requested ? asUuid(requested) : null;
    if (typeof requested === 'string' && requested && !asked) throw badRequest('Identifiant de dépôt invalide.');
    const id = asked ?? actor.depositId ?? (await mainHubId(this.prisma));
    if (!id) throw new ApiError('Aucun dépôt configuré.', 503);
    const deposit = await this.prisma.deposit.findUnique({ where: { id }, select: { id: true } });
    if (!deposit) throw notFound('Dépôt introuvable.');
    return deposit.id;
  }

  async list(filters: {
    type?: string;
    status?: string;
    start?: string;
    end?: string;
    viewerDepositId?: string | null;
    sourceDepositId?: string;
    destinationDepositId?: string;
    driverId?: string | null;
  }): Promise<{ rows: InterDepotDto[]; stats: InterDepotStats }> {
    const where: Prisma.InterDepotTransferWhereInput = {};
    if (filters.type) {
      if (!Object.values(InterDepotType).includes(filters.type as InterDepotType)) {
        throw badRequest(`Type d'inter-dépôt inconnu : ${filters.type}.`);
      }
      where.type = filters.type as InterDepotType;
    }
    const range = this.dateRange(filters.start, filters.end);
    if (range) where.createdAt = range;
    if (filters.viewerDepositId) {
      where.OR = [{ sourceDepositId: filters.viewerDepositId }, { destinationDepositId: filters.viewerDepositId }];
    }
    if (filters.driverId) where.transporterDriverId = filters.driverId;
    const src = filters.sourceDepositId ? asUuid(filters.sourceDepositId) : null;
    const dst = filters.destinationDepositId ? asUuid(filters.destinationDepositId) : null;
    if (src) where.sourceDepositId = src;
    if (dst) where.destinationDepositId = dst;

    const all = await this.prisma.interDepotTransfer.findMany({
      where,
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const viewer = filters.viewerDepositId ?? null;
    const dtos = all.map((r) => this.toDto(r, viewer));

    const stats: InterDepotStats = { total: dtos.length, sentPending: 0, sentReceived: 0, toReceive: 0, received: 0 };
    for (const t of dtos) {
      const open = OPEN.includes(t.status);
      const done = t.status === InterDepotStatus.RECU;
      if (!viewer || t.sourceDepositId === viewer) {
        if (open) stats.sentPending++;
        if (done) stats.sentReceived++;
      }
      if (!viewer || t.destinationDepositId === viewer) {
        if (open) stats.toReceive++;
        if (done) stats.received++;
      }
    }

    let rows = dtos;
    if (filters.status && filters.status !== 'ALL') {
      const s = String(filters.status);
      if (s === 'EN_ATTENTE') rows = rows.filter((t) => OPEN.includes(t.status));
      else rows = rows.filter((t) => t.status === s);
    }
    return { rows, stats };
  }

  async findByNumber(identifier: string, viewerDepositId?: string | null): Promise<InterDepotDto | null> {
    const record = await this.prisma.interDepotTransfer.findFirst({
      where: this.lookupWhere(identifier),
      include: TRANSFER_INCLUDE,
    });
    return record ? this.toDto(record, viewerDepositId ?? null) : null;
  }

  /** Référentiels du formulaire : agences et livreurs (avec immatriculation). */
  async formOptions() {
    const [deposits, drivers] = await Promise.all([
      this.prisma.deposit.findMany({
        where: { isActive: true },
        select: { id: true, name: true, code: true, isMainHub: true, governorate: true, status: true },
        orderBy: [{ isMainHub: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.driver.findMany({
        where: { isActive: true, deletedAt: null, user: { isActive: true } },
        select: {
          id: true,
          driverCode: true,
          licensePlate: true,
          vehicleType: true,
          user: { select: { fullName: true, phone: true, deposit: { select: { id: true, name: true } } } },
        },
        orderBy: { user: { fullName: 'asc' } },
      }),
    ]);
    return {
      deposits: deposits.filter((d) => d.status !== 'FERME'),
      drivers: drivers.map((d) => ({
        id: d.id,
        driverCode: d.driverCode,
        fullName: d.user.fullName,
        phone: d.user.phone,
        licensePlate: d.licensePlate,
        vehicleType: d.vehicleType,
        depositId: d.user.deposit?.id ?? null,
        depositName: d.user.deposit?.name ?? null,
        label: `${d.user.fullName}${d.user.deposit ? ` - ${d.user.deposit.name}` : ''}`,
      })),
    };
  }

  /**
   * Colis du dépôt de départ qui peuvent monter dans ce bordereau (panneau de
   * gauche de l'écran d'édition).
   */
  async candidates(identifier: string) {
    const transfer = await this.requireTransfer(identifier);
    const base: Prisma.PackageWhereInput = {
      deletedAt: null,
      currentDepositId: transfer.sourceDepositId,
      interDepotTransferId: null,
      ...(transfer.type === InterDepotType.RETOUR ? {} : { assignedDriverId: null, currentRunsheetId: null }),
    };
    const where: Prisma.PackageWhereInput =
      transfer.type === InterDepotType.RETOUR
        ? { ...base, status: { in: LOADABLE_RETURN as never }, originDepositId: transfer.destinationDepositId }
        : {
            ...base,
            status: { in: LOADABLE_DELIVERY as never },
            ...(transfer.destinationDeposit.isMainHub
              ? { destinationDepositId: { not: transfer.sourceDepositId } }
              : { destinationDepositId: transfer.destinationDepositId }),
          };
    const rows = await this.prisma.package.findMany({
      where,
      select: {
        id: true,
        trackingNumber: true,
        barcode: true,
        pieceCount: true,
        sizeCategory: true,
        status: true,
        shipper: { select: { companyName: true, brandName: true } },
        customer: { select: { fullName: true } },
        customerAddress: { select: { governorate: true, delegation: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((p) => ({
      id: p.id,
      trackingNumber: p.trackingNumber,
      barcode: p.barcode,
      pieceCount: p.pieceCount,
      sizeCategory: p.sizeCategory,
      status: p.status,
      shipperName: p.shipper.brandName || p.shipper.companyName,
      customerName: p.customer.fullName,
      destination: [p.customerAddress.delegation, p.customerAddress.governorate].filter(Boolean).join(', '),
    }));
  }

  /**
   * Écran d'acceptation d'un dépôt : colis attendus (bordereaux ouverts vers
   * ce dépôt) et compteurs « reçus / partiellement reçus ».
   */
  async acceptanceBoard(depositId: string, type: InterDepotType) {
    const transfers = await this.prisma.interDepotTransfer.findMany({
      where: { destinationDepositId: depositId, type, status: { in: OPEN as never } },
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    const dtos = transfers.map((t) => this.toDto(t, depositId));
    const expected = dtos.flatMap((t) =>
      t.items
        .filter((i) => i.receptionState !== 'RECU')
        .map((i) => ({ ...i, transferNumber: t.transferNumber, sourceDeposit: t.sourceDeposit }))
    );
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await this.prisma.interDepotItem.findMany({
      where: {
        transfer: { destinationDepositId: depositId, type },
        OR: [{ receivedAt: { gte: since } }, { pieces: { some: { scannedAt: { gte: since } } } }],
      },
      include: {
        pieces: { select: { pieceNumber: true, scannedAt: true }, orderBy: { pieceNumber: 'asc' } },
        transfer: { select: { transferNumber: true } },
        package: {
          select: {
            trackingNumber: true,
            barcode: true,
            pieceCount: true,
            sizeCategory: true,
            status: true,
            shipper: { select: { companyName: true, brandName: true } },
          },
        },
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    const accepted = recent.map((i) => ({
      trackingNumber: i.package.trackingNumber,
      barcode: i.package.barcode,
      shipperName: i.package.shipper.brandName || i.package.shipper.companyName,
      pieceCount: i.pieceCount,
      receivedPieces: i.receivedPieces,
      sizeCategory: i.package.sizeCategory,
      state: i.receivedPieces >= i.pieceCount ? 'RECU' : 'PARTIEL',
      transferNumber: i.transfer.transferNumber,
      lastScanAt: i.pieces.length ? i.pieces[i.pieces.length - 1]!.scannedAt.toISOString() : null,
    }));
    accepted.sort((a, b) => String(b.lastScanAt).localeCompare(String(a.lastScanAt)));
    return {
      depositId,
      type,
      receivedCount: accepted.filter((a) => a.state === 'RECU').length,
      partialCount: accepted.filter((a) => a.state === 'PARTIEL').length,
      expectedCount: expected.length,
      expected,
      accepted,
      openTransfers: dtos.map((t) => ({
        transferNumber: t.transferNumber,
        sourceDeposit: t.sourceDeposit,
        totalPackages: t.totalPackages,
        totalPieces: t.totalPieces,
        receivedPieces: t.receivedPieces,
        status: t.status,
        statusLabel: t.statusLabel,
      })),
    };
  }

  /* ---------------------------- écriture --------------------------- */

  /** Ouvre un bordereau (en-tête seul) : « Enregistrer ». */
  async create(
    actor: InterDepotActor,
    payload: {
      type?: string;
      sourceDepositId?: string;
      destinationDepositId?: string;
      transporterDriverId?: string;
      vehiclePlate?: string;
      departureAt?: string;
      notes?: string;
      packageIds?: unknown;
    }
  ): Promise<InterDepotDto> {
    if (payload.packageIds !== undefined) {
      throw badRequest(
        "Les colis ne se joignent plus à la création : enregistrez le bordereau, puis scannez chaque colis."
      );
    }
    const type = (payload.type ? String(payload.type).toUpperCase() : InterDepotType.LIVRAISON) as InterDepotType;
    if (!Object.values(InterDepotType).includes(type)) throw badRequest(`Type d'inter-dépôt inconnu : ${payload.type}.`);

    const sourceId = await this.operatingDepositId(actor, payload.sourceDepositId);
    const destinationId = asUuid(payload.destinationDepositId ?? '');
    if (!destinationId) {
      throw badRequest(type === InterDepotType.RETOUR ? "Choisissez l'agence source des retours." : "Choisissez l'agence de destination.");
    }
    if (destinationId === sourceId) {
      throw badRequest("L'agence choisie est votre propre dépôt : un inter-dépôt relie deux agences différentes.");
    }
    const [source, destination] = await Promise.all([
      this.prisma.deposit.findUnique({ where: { id: sourceId } }),
      this.prisma.deposit.findUnique({ where: { id: destinationId } }),
    ]);
    if (!source || !destination) throw notFound('Agence introuvable.');
    if (!source.isActive || source.status === 'FERME') throw conflict(`Le dépôt ${source.name} est fermé.`);
    if (!destination.isActive || destination.status === 'FERME') throw conflict(`L'agence ${destination.name} est fermée.`);

    const driverId = asUuid(payload.transporterDriverId ?? '');
    if (!driverId) throw badRequest('Choisissez le livreur qui transporte le bordereau.');
    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, deletedAt: null },
      include: { user: { select: { fullName: true, isActive: true } } },
    });
    if (!driver) throw notFound('Livreur introuvable.');
    if (!driver.isActive || !driver.user.isActive) throw conflict(`Le livreur ${driver.user.fullName} est inactif.`);

    const plate = this.parsePlate(payload.vehiclePlate) ?? driver.licensePlate ?? null;
    const departureAt = this.parseDateTime(payload.departureAt) ?? new Date();
    const notes = payload.notes ? String(payload.notes).trim().slice(0, 500) : null;

    const created = await this.prisma.$transaction(async (tx) => {
      const transferNumber = await nextTransferNumber(tx, type === InterDepotType.RETOUR ? 'R' : 'D', tunisDayStamp());
      const t = await tx.interDepotTransfer.create({
        data: {
          transferNumber,
          type,
          sourceDepositId: sourceId,
          destinationDepositId: destinationId,
          transporterDriverId: driver.id,
          vehiclePlate: plate,
          departureAt,
          scheduledDate: departureAt,
          createdByUserId: actor.id ?? null,
          status: 'CRE',
          notes,
        },
      });
      await auditService.record(
        {
          entityType: 'TRANSFER',
          entityId: t.id,
          action: 'TRANSFERT_CRE',
          userId: actor.id ?? null,
          reason: `Bordereau ${transferNumber} (${typeLabel(type)}) : ${source.name} → ${destination.name}, livreur ${driver.user.fullName}.`,
          newValues: { status: 'CRE', type, vehiclePlate: plate },
        },
        tx
      );
      return t;
    });
    return (await this.findByNumber(created.id, sourceId))!;
  }

  /** Modifie l'en-tête (livreur, immatriculation, date) tant que rien n'est accepté. */
  async updateHeader(
    identifier: string,
    actor: InterDepotActor,
    payload: { transporterDriverId?: string; vehiclePlate?: string; departureAt?: string; notes?: string }
  ): Promise<InterDepotDto> {
    const transfer = await this.requireTransfer(identifier);
    if (transfer.status !== 'CRE') {
      throw conflict(`Le bordereau ${transfer.transferNumber} n'est plus modifiable (${INTER_DEPOT_STATUS_LABELS[transfer.status as InterDepotStatus]}).`);
    }
    const data: Prisma.InterDepotTransferUncheckedUpdateInput = {};
    if (payload.transporterDriverId !== undefined) {
      const driverId = asUuid(payload.transporterDriverId);
      if (!driverId) throw badRequest('Livreur invalide.');
      const driver = await this.prisma.driver.findFirst({
        where: { id: driverId, deletedAt: null, isActive: true },
        select: { id: true, licensePlate: true },
      });
      if (!driver) throw notFound('Livreur introuvable ou inactif.');
      data.transporterDriverId = driver.id;
      if (payload.vehiclePlate === undefined) data.vehiclePlate = driver.licensePlate ?? null;
    }
    if (payload.vehiclePlate !== undefined) data.vehiclePlate = this.parsePlate(payload.vehiclePlate);
    if (payload.departureAt !== undefined) {
      const at = this.parseDateTime(payload.departureAt);
      if (!at) throw badRequest('Date de départ invalide.');
      data.departureAt = at;
      data.scheduledDate = at;
    }
    if (payload.notes !== undefined) data.notes = String(payload.notes ?? '').trim().slice(0, 500) || null;

    const result = await this.prisma.interDepotTransfer.updateMany({
      where: { id: transfer.id, status: 'CRE' },
      data: data as Prisma.InterDepotTransferUncheckedUpdateManyInput,
    });
    if (result.count !== 1) throw conflict('Le bordereau vient d’être modifié : rechargez-le.');
    await auditService.record({
      entityType: 'TRANSFER',
      entityId: transfer.id,
      action: 'TRANSFERT_ENTETE',
      userId: actor.id ?? null,
      reason: `En-tête du bordereau ${transfer.transferNumber} modifié par ${actor.fullName}.`,
      newValues: JSON.parse(JSON.stringify(data)),
    });
    return (await this.findByNumber(transfer.id, transfer.sourceDepositId))!;
  }

  /** Scan de chargement : « Ajouter au inter dépôt » / « Retirer de l'inter dépôt ». */
  async scan(identifier: string, actor: InterDepotActor, payload: { code?: unknown; mode?: unknown }): Promise<ScanResult> {
    const mode = String(payload.mode ?? 'add').toLowerCase() === 'remove' ? 'remove' : 'add';
    const code = parseCode(payload.code);
    const transfer = await this.requireTransfer(identifier);
    const found = await findPackageByCode(this.prisma, code);
    if (!found) throw notFound(`Aucun colis ne correspond au code ${code.raw}.`);
    const pkg = found.pkg;

    if (mode === 'remove') {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, transfer.id);
        if (locked.status !== 'CRE') {
          throw conflict(`Le bordereau ${transfer.transferNumber} est déjà en cours d'acceptation : plus aucun retrait possible.`);
        }
        const item = await tx.interDepotItem.findUnique({
          where: { transferId_packageId: { transferId: transfer.id, packageId: pkg.id } },
        });
        if (!item) throw conflict(`Le colis ${pkg.trackingNumber} ne fait pas partie de ce bordereau.`);
        if (item.receivedPieces > 0) throw conflict(`Le colis ${pkg.trackingNumber} est déjà accepté à l'arrivée.`);
        await packageWorkflowService.transition({
          packageId: pkg.id,
          to: item.previousStatus as unknown as PackageStatus,
          actor: { id: actor.id, fullName: actor.fullName, role: RoleType.AGENT_DEPOT },
          title: `Retiré de l'inter-dépôt ${transfer.transferNumber}`,
          note: `Retiré par ${actor.fullName}`,
          location: transfer.sourceDeposit.name,
          transferNumber: transfer.transferNumber,
          auditAction: 'INTERDEPOT_RETRAIT',
          reason: `Retiré de l'inter-dépôt ${transfer.transferNumber}`,
          data: { currentDepositId: item.previousDepositId ?? transfer.sourceDepositId, interDepotTransferId: null },
          client: tx,
        });
        await tx.interDepotItem.delete({ where: { id: item.id } });
        await tx.interDepotTransfer.update({
          where: { id: transfer.id },
          data: { totalPackages: { decrement: 1 }, totalPieces: { decrement: item.pieceCount } },
        });
      });
      return {
        mode,
        message: `Colis ${pkg.trackingNumber} retiré du bordereau.`,
        trackingNumber: pkg.trackingNumber,
        transfer: (await this.findByNumber(transfer.id, transfer.sourceDepositId))!,
      };
    }

    // --- Ajout : contrôles nommés, du plus parlant au plus général ---
    if (pkg.interDepotTransferId === transfer.id) {
      throw conflict(`Le colis ${pkg.trackingNumber} est déjà dans ce bordereau.`);
    }
    if (pkg.interDepotTransferId) {
      const other = await this.prisma.interDepotTransfer.findUnique({
        where: { id: pkg.interDepotTransferId },
        select: { transferNumber: true },
      });
      throw conflict(`Le colis ${pkg.trackingNumber} est déjà chargé dans l'inter-dépôt ${other?.transferNumber ?? ''}.`.trim());
    }
    const loadable = transfer.type === InterDepotType.RETOUR ? LOADABLE_RETURN : LOADABLE_DELIVERY;
    if (!loadable.includes(pkg.status)) {
      throw conflict(`Le colis ${pkg.trackingNumber} ${loadRefusal(pkg.status, transfer.type as InterDepotType)}.`);
    }
    if (pkg.currentDepositId !== transfer.sourceDepositId) {
      throw conflict(`Le colis ${pkg.trackingNumber} n'est pas dans votre dépôt (${transfer.sourceDeposit.name}).`);
    }
    if (transfer.type === InterDepotType.RETOUR) {
      // Un retour revenu au dépôt garde la trace de son dernier livreur ; seule
      // une tournée encore ouverte (marchandise pas encore remise) bloque.
      if (pkg.currentRunsheetId) {
        const rs = await this.prisma.runsheet.findUnique({
          where: { id: pkg.currentRunsheetId },
          select: { runsheetNumber: true, status: true },
        });
        if (rs && !['RETOUR_DEPOT', 'CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT', 'ANNULEE'].includes(rs.status)) {
          throw conflict(`Le retour ${pkg.trackingNumber} est encore sur la tournée ${rs.runsheetNumber} : clôturez-la d'abord.`);
        }
      }
    } else if (pkg.assignedDriverId || pkg.currentRunsheetId) {
      throw conflict(`Le colis ${pkg.trackingNumber} est affecté à un livreur : retirez-le de sa tournée d'abord.`);
    }
    if (transfer.type === InterDepotType.RETOUR) {
      if (pkg.originDepositId !== transfer.destinationDepositId) {
        throw conflict(
          `Ce retour appartient à l'agence ${pkg.originDeposit.name} : il ne peut pas partir vers ${transfer.destinationDeposit.name}.`
        );
      }
    } else if (transfer.destinationDeposit.isMainHub) {
      if (pkg.destinationDepositId === transfer.sourceDepositId) {
        throw conflict(`Le colis ${pkg.trackingNumber} est destiné à votre propre agence : il n'a pas à partir.`);
      }
    } else if (pkg.destinationDepositId !== transfer.destinationDepositId) {
      throw conflict(
        `Le colis ${pkg.trackingNumber} est destiné à l'agence ${pkg.destinationDeposit.name} : ` +
          `il ne peut pas monter dans un inter-dépôt vers ${transfer.destinationDeposit.name}.`
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTransfer(tx, transfer.id);
      if (locked.status !== 'CRE') {
        throw conflict(`Le bordereau ${transfer.transferNumber} est déjà en cours d'acceptation : plus aucun ajout possible.`);
      }
      await tx.interDepotItem.create({
        data: {
          transferId: transfer.id,
          packageId: pkg.id,
          pieceCount: Math.max(1, pkg.pieceCount),
          previousStatus: pkg.status as never,
          previousDepositId: pkg.currentDepositId,
          addedByUserId: actor.id ?? null,
        },
      });
      await packageWorkflowService.transition({
        packageId: pkg.id,
        to: PackageStatus.EN_TRANSIT_INTER_DEPOT,
        actor: { id: actor.id, fullName: actor.fullName, role: RoleType.AGENT_DEPOT },
        title:
          transfer.type === InterDepotType.RETOUR
            ? `Retour en route vers ${transfer.destinationDeposit.name}`
            : `En route vers ${transfer.destinationDeposit.name}`,
        note: `Inter-dépôt ${transfer.transferNumber}${transfer.transporterDriver ? ` — ${transfer.transporterDriver.user.fullName}` : ''}`,
        location: `Inter-dépôt ${transfer.sourceDeposit.name} → ${transfer.destinationDeposit.name}`,
        transferNumber: transfer.transferNumber,
        auditAction: 'INTERDEPOT_CHARGEMENT',
        data: {
          currentDepositId: null,
          interDepotTransferId: transfer.id,
          ...(transfer.type === InterDepotType.RETOUR ? { assignedDriverId: null, currentRunsheetId: null } : {}),
        },
        client: tx,
      });
      await tx.interDepotTransfer.update({
        where: { id: transfer.id },
        data: { totalPackages: { increment: 1 }, totalPieces: { increment: Math.max(1, pkg.pieceCount) } },
      });
    });
    return {
      mode,
      message: `Colis ${pkg.trackingNumber} ajouté (${Math.max(1, pkg.pieceCount)} pièce(s)).`,
      trackingNumber: pkg.trackingNumber,
      transfer: (await this.findByNumber(transfer.id, transfer.sourceDepositId))!,
    };
  }

  /** Acceptation à l'arrivée, une pièce par scan. */
  async acceptScan(actor: InterDepotActor, depositId: string, payload: { code?: unknown; type?: unknown }): Promise<AcceptanceResult> {
    const type = String(payload.type ?? InterDepotType.LIVRAISON).toUpperCase() as InterDepotType;
    if (!Object.values(InterDepotType).includes(type)) throw badRequest("Type d'inter-dépôt inconnu.");
    const code = parseCode(payload.code);
    const found = await findPackageByCode(this.prisma, code);
    if (!found) throw notFound(`Aucun colis ne correspond au code ${code.raw}.`);
    const pkg = found.pkg;

    const item = await this.prisma.interDepotItem.findFirst({
      where: { packageId: pkg.id, transfer: { status: { in: OPEN as never } } },
      include: { transfer: { include: { destinationDeposit: { select: { name: true } }, sourceDeposit: { select: { name: true } } } } },
    });
    if (!item) {
      throw conflict(`Le colis ${pkg.trackingNumber} n'est attendu dans aucun inter-dépôt en cours.`);
    }
    if (item.transfer.destinationDepositId !== depositId) {
      throw conflict(
        `Le colis ${pkg.trackingNumber} voyage vers ${item.transfer.destinationDeposit.name} (bordereau ${item.transfer.transferNumber}), pas vers votre dépôt.`
      );
    }
    if (item.transfer.type !== type) {
      throw conflict(
        type === InterDepotType.RETOUR
          ? `Le colis ${pkg.trackingNumber} arrive par un inter-dépôt livraison : acceptez-le dans « Acceptation inter dépôt ».`
          : `Le colis ${pkg.trackingNumber} arrive par un inter-dépôt retours : acceptez-le dans « Acceptation inter dépôt retours ».`
      );
    }
    let pieceNumber = found.piece;
    if (pieceNumber === null) {
      if (item.pieceCount > 1) {
        throw conflict(
          `Le colis ${pkg.trackingNumber} compte ${item.pieceCount} pièces : scannez l'étiquette de chaque pièce (${pieceBarcode(pkg.barcode, 1)}, ${pieceBarcode(pkg.barcode, 2)}…).`
        );
      }
      pieceNumber = 1;
    }
    if (pieceNumber < 1 || pieceNumber > item.pieceCount) {
      throw badRequest(`Pièce ${pieceNumber} inexistante : le colis ${pkg.trackingNumber} compte ${item.pieceCount} pièce(s).`);
    }

    const now = new Date();
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockTransfer(tx, item.transferId);
      const fresh = await tx.interDepotItem.findUnique({ where: { id: item.id }, include: { pieces: true } });
      if (!fresh) throw conflict('Bordereau modifié entre-temps : rescannez.');
      if (fresh.pieces.some((p) => p.pieceNumber === pieceNumber)) {
        throw conflict(`Pièce ${pieceNumber}/${fresh.pieceCount} du colis ${pkg.trackingNumber} déjà reçue.`);
      }
      await tx.interDepotPieceScan.create({
        data: { itemId: fresh.id, pieceNumber: pieceNumber!, scannedByUserId: actor.id ?? null, scannedAt: now },
      });
      const receivedPieces = fresh.pieces.length + 1;
      const complete = receivedPieces >= fresh.pieceCount;
      await tx.interDepotItem.update({
        where: { id: fresh.id },
        data: {
          receivedPieces,
          ...(complete ? { receivedAt: now, receivedByUserId: actor.id ?? null } : {}),
        },
      });
      if (complete) {
        const arrival =
          type === InterDepotType.RETOUR
            ? PackageStatus.RETOUR_DEPOT
            : pkg.destinationDepositId === depositId
              ? PackageStatus.RECU_DEPOT_DESTINATION
              : PackageStatus.RECU_DEPOT;
        await packageWorkflowService.transition({
          packageId: pkg.id,
          to: arrival,
          actor: { id: actor.id, fullName: actor.fullName, role: RoleType.AGENT_DEPOT },
          title:
            type === InterDepotType.RETOUR
              ? `Retour reçu à ${item.transfer.destinationDeposit.name}`
              : `Reçu à ${item.transfer.destinationDeposit.name}`,
          note: `Inter-dépôt ${item.transfer.transferNumber} — ${fresh.pieceCount} pièce(s) acceptée(s)`,
          location: item.transfer.destinationDeposit.name,
          transferNumber: item.transfer.transferNumber,
          auditAction: 'INTERDEPOT_ACCEPTATION',
          reason: `Accepté par inter-dépôt ${item.transfer.transferNumber}`,
          data: { currentDepositId: depositId, interDepotTransferId: null },
          client: tx,
        });
      }
      const items = await tx.interDepotItem.findMany({
        where: { transferId: item.transferId },
        select: { pieceCount: true, receivedPieces: true },
      });
      const done = items.filter((i) => i.receivedPieces >= i.pieceCount).length;
      const allDone = done === items.length;
      const status = allDone ? 'RECU' : 'RECU_PARTIEL';
      await tx.interDepotTransfer.update({
        where: { id: item.transferId },
        data: {
          status: status as never,
          receivedPackages: done,
          ...(allDone ? { receivedAt: now } : {}),
        },
      });
      if (allDone || item.transfer.status === 'CRE') {
        await auditService.record(
          {
            entityType: 'TRANSFER',
            entityId: item.transferId,
            action: allDone ? 'TRANSFERT_RECU' : 'TRANSFERT_RECU_PARTIEL',
            userId: actor.id ?? null,
            reason: allDone
              ? `Bordereau ${item.transfer.transferNumber} entièrement reçu (${items.length} colis).`
              : `Acceptation du bordereau ${item.transfer.transferNumber} commencée.`,
            previousValues: { status: item.transfer.status },
            newValues: { status },
          },
          tx
        );
      }
      return { receivedPieces, complete, status, allDone, pieceCount: fresh.pieceCount };
    });

    if (outcome.allDone) {
      await notificationDispatcher
        .notify({
          event: NotificationEvent.INTER_DEPOT_RECEIVED,
          title: `Inter-dépôt ${item.transfer.transferNumber} reçu`,
          content: `Bordereau ${item.transfer.sourceDeposit.name} → ${item.transfer.destinationDeposit.name} entièrement accepté.`,
          relatedEntity: 'INTER_DEPOT',
          relatedEntityId: item.transferId,
          transferId: item.transferId,
          actorUserId: actor.id,
        })
        .catch(() => undefined);
    }

    return {
      message: outcome.complete
        ? `Colis ${pkg.trackingNumber} reçu (${outcome.pieceCount}/${outcome.pieceCount}).`
        : `Pièce ${pieceNumber}/${outcome.pieceCount} du colis ${pkg.trackingNumber} reçue — colis partiellement reçu.`,
      trackingNumber: pkg.trackingNumber,
      pieceNumber: pieceNumber!,
      pieceCount: outcome.pieceCount,
      receivedPieces: outcome.receivedPieces,
      packageComplete: outcome.complete,
      transferNumber: item.transfer.transferNumber,
      transferStatus: outcome.status as InterDepotStatus,
    };
  }

  /** Annulation : seulement tant qu'aucune pièce n'est acceptée. Les colis reviennent. */
  async cancel(identifier: string, actor: InterDepotActor): Promise<InterDepotDto> {
    const transfer = await this.requireTransfer(identifier);
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockTransfer(tx, transfer.id);
      if (locked.status !== 'CRE') {
        throw conflict(
          locked.status === 'ANNULE'
            ? `Le bordereau ${transfer.transferNumber} est déjà annulé.`
            : `Le bordereau ${transfer.transferNumber} est déjà en acceptation à l'arrivée : il ne peut plus être annulé.`
        );
      }
      const items = await tx.interDepotItem.findMany({ where: { transferId: transfer.id } });
      for (const item of items) {
        await packageWorkflowService.transition({
          packageId: item.packageId,
          to: item.previousStatus as unknown as PackageStatus,
          actor: { id: actor.id, fullName: actor.fullName, role: RoleType.AGENT_DEPOT },
          title: `Inter-dépôt ${transfer.transferNumber} annulé`,
          note: `Colis remis en stock à ${transfer.sourceDeposit.name}`,
          location: transfer.sourceDeposit.name,
          transferNumber: transfer.transferNumber,
          auditAction: 'INTERDEPOT_ANNULATION',
          reason: `Inter-dépôt ${transfer.transferNumber} annulé`,
          data: { currentDepositId: item.previousDepositId ?? transfer.sourceDepositId, interDepotTransferId: null },
          client: tx,
        });
      }
      await tx.interDepotItem.deleteMany({ where: { transferId: transfer.id } });
      await tx.interDepotTransfer.update({
        where: { id: transfer.id },
        data: { status: 'ANNULE', cancelledAt: new Date(), totalPackages: 0, totalPieces: 0 },
      });
      await auditService.record(
        {
          entityType: 'TRANSFER',
          entityId: transfer.id,
          action: 'TRANSFERT_ANNULE',
          userId: actor.id ?? null,
          reason: `Bordereau ${transfer.transferNumber} annulé par ${actor.fullName} (${items.length} colis remis en stock).`,
          previousValues: { status: 'CRE' },
          newValues: { status: 'ANNULE' },
        },
        tx
      );
    });
    return (await this.findByNumber(transfer.id, transfer.sourceDepositId))!;
  }

  /* ---------------------------- internes --------------------------- */

  async requireTransfer(identifier: string): Promise<TransferRecord> {
    const record = await this.prisma.interDepotTransfer.findFirst({
      where: this.lookupWhere(identifier),
      include: TRANSFER_INCLUDE,
    });
    if (!record) throw notFound('Inter-dépôt introuvable.');
    return record;
  }

  private async lockTransfer(tx: Prisma.TransactionClient, id: string): Promise<{ status: string }> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM "InterDepotTransfer" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound('Inter-dépôt introuvable.');
    return rows[0]!;
  }

  private lookupWhere(identifier: string): Prisma.InterDepotTransferWhereInput {
    const id = asUuid(identifier);
    return id ? { OR: [{ transferNumber: identifier }, { id }] } : { transferNumber: identifier };
  }

  private parsePlate(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const plate = String(value).trim().replace(/\s+/g, ' ').toUpperCase();
    if (!plate) return null;
    if (plate.length > 30 || !/^[0-9A-Z ]+$/.test(plate)) throw badRequest('Immatriculation invalide (ex. 3687 TUN 203).');
    return plate;
  }

  private parseDateTime(value: unknown): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw badRequest('Date de départ invalide.');
    const yearMs = 366 * 24 * 3600 * 1000;
    if (Math.abs(d.getTime() - Date.now()) > yearMs) throw badRequest('Date de départ hors plage (± 1 an).');
    return d;
  }

  private dateRange(start?: string, end?: string): Prisma.DateTimeFilter | null {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (start && !day.test(start)) throw badRequest('Date de début invalide (AAAA-MM-JJ).');
    if (end && !day.test(end)) throw badRequest('Date de fin invalide (AAAA-MM-JJ).');
    if (!start && !end) return null;
    // Journées de Tunis (UTC+1, sans heure d'été).
    const from = start ? new Date(`${start}T00:00:00+01:00`) : undefined;
    const to = end ? new Date(new Date(`${end}T00:00:00+01:00`).getTime() + 24 * 3600 * 1000) : undefined;
    return { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  }

  private toDto(record: TransferRecord, viewer: string | null): InterDepotDto {
    const status = record.status as InterDepotStatus;
    const items: TransferItemDto[] = record.items.map((i) => {
      const received = i.pieces.map((p) => p.pieceNumber);
      const state = i.receivedPieces >= i.pieceCount ? 'RECU' : i.receivedPieces > 0 ? 'PARTIEL' : 'EN_ROUTE';
      return {
        packageId: i.package.id,
        trackingNumber: i.package.trackingNumber,
        barcode: i.package.barcode,
        shipperName: i.package.shipper.brandName || i.package.shipper.companyName,
        customerName: i.package.customer.fullName,
        destination: [i.package.customerAddress.delegation, i.package.customerAddress.governorate].filter(Boolean).join(', '),
        pieceCount: i.pieceCount,
        sizeCategory: i.package.sizeCategory,
        receivedPieces: i.receivedPieces,
        receivedPieceNumbers: received,
        receptionState: state,
        packageStatus: i.package.status as PackageStatus,
        packageStatusLabel: statusLabel(i.package.status),
        addedAt: i.addedAt.toISOString(),
        receivedAt: i.receivedAt?.toISOString() ?? null,
      };
    });
    const receivedPackages = items.filter((i) => i.receptionState === 'RECU').length;
    const partialPackages = items.filter((i) => i.receptionState === 'PARTIEL').length;
    const receivedPieces = items.reduce((s, i) => s + i.receivedPieces, 0);
    const totalPieces = items.reduce((s, i) => s + i.pieceCount, 0);
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    const direction: InterDepotDirection | null =
      viewer === record.sourceDepositId ? 'ENVOI' : viewer === record.destinationDepositId ? 'RECEPTION' : null;
    const started = status !== InterDepotStatus.CRE;

    return {
      id: record.id,
      transferNumber: record.transferNumber,
      type: record.type as InterDepotType,
      typeLabel: typeLabel(record.type as InterDepotType),
      sourceDeposit: record.sourceDeposit.name,
      sourceDepositId: record.sourceDepositId,
      destinationDeposit: record.destinationDeposit.name,
      destinationDepositId: record.destinationDepositId,
      driverId: record.transporterDriver?.id ?? null,
      driverName: record.transporterDriver?.user.fullName ?? null,
      driverPhone: record.transporterDriver?.user.phone ?? null,
      vehiclePlate: record.vehiclePlate ?? record.transporterDriver?.licensePlate ?? null,
      departureAt: iso(record.departureAt ?? record.createdAt),
      scheduledDate: iso(record.scheduledDate),
      sealNumber: record.sealNumber,
      status,
      statusLabel: INTER_DEPOT_STATUS_LABELS[status] ?? status,
      direction,
      totalPackages: items.length,
      totalPieces,
      receivedPackages,
      receivedPieces,
      partialPackages,
      discrepancy: started ? items.length - receivedPackages : 0,
      hasDiscrepancy: started && receivedPackages < items.length,
      editable: status === InterDepotStatus.CRE,
      notes: record.notes,
      dispatchNotes: record.dispatchNotes,
      receptionNotes: record.receptionNotes,
      items,
      packages: items.map((i) => ({
        id: i.packageId,
        trackingNumber: i.trackingNumber,
        status: i.packageStatus,
        pieceCount: i.pieceCount,
        customerName: i.customerName,
      })),
      movement: [
        {
          key: 'CRE',
          label: 'Bordereau ouvert',
          status: InterDepotStatus.CRE,
          location: record.sourceDeposit.name,
          description: `${items.length} colis chargé(s)`,
          timestamp: iso(record.createdAt),
          reached: true,
        },
        {
          key: 'RECU',
          label: 'Accepté à l’arrivée',
          status: InterDepotStatus.RECU,
          location: record.destinationDeposit.name,
          description: `${receivedPackages}/${items.length} colis reçus`,
          timestamp: iso(record.receivedAt),
          reached: status === InterDepotStatus.RECU,
        },
      ],
      allowedTransitions:
        status === InterDepotStatus.CRE
          ? [InterDepotStatus.ANNULE]
          : [],
      createdAt: record.createdAt.toISOString(),
      preparedAt: iso(record.preparedAt),
      shippedAt: iso(record.shippedAt),
      receivedAt: iso(record.receivedAt),
      cancelledAt: iso(record.cancelledAt),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export const interDepotsService = new InterDepotsService();
