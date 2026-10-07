/**
 * Inventaire et historique des colis.
 *
 * `ColisService.findAll` répond à « où en sont les colis aujourd'hui ».
 * Ce module répond à une autre question : sur une période donnée, quels colis
 * ont transité, par quel expéditeur, quel livreur, quel dépôt, et qu'en a-t-il
 * été tiré financièrement. D'où une borne de date absente, des croisements avec
 * la caisse et les retours, et un tri stable — sans lequel une pagination fait
 * disparaître des lignes entre deux pages.
 *
 * Trois règles structurent le module :
 *
 *   1. le filtrage se fait en base, jamais dans le navigateur. L'historique
 *      peut compter des dizaines de milliers de lignes ; tout télécharger pour
 *      n'en garder que la page courante est ce qui fait tomber un poste ;
 *   2. l'export réutilise le prédicat de la liste. Un export qui ne respecte
 *      pas les filtres affichés est pire qu'aucun export : l'utilisateur
 *      croirait avoir extrait 12 lignes alors qu'il en a 12 000 ;
 *   3. le tri est déterministe. `createdAt` seul n'est pas unique — deux colis
 *      créés dans la même milliseconde existent — et sans second critère la
 *      page 2 peut répéter une ligne déjà vue en page 1.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { asUuid, badRequest } from '../../common/errors/api-error';
import { buildCsv, MAX_EXPORT_ROWS, timestampedFilename } from '../../common/csv/csv';
import { periode } from '../../common/dates/periode';
import {
  PACKAGE_STATUS_LABELS,
  PaymentStatus,
  PackageStatus,
  PackageType,
} from '@logixpress/types';

/** Page par défaut, et plafond : au-delà, l'export — et non la page — est l'outil adapté. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Plafond d'export.
 *
 * Un export est une extraction complète de données clients. Au-delà de ce
 * nombre de lignes, l'téléchargement est refusé avec le décompte exact :
 * mieux vaut un message qui dit « 120 000 lignes, resserrez vos filtres » qu'un
 * fichier que le poste n'arrive plus à ouvrir.
 */

/** Identifiant qui ne correspond à aucune ligne : neutralise un filtre enum inconnu. */
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * États de retour.
 *
 * Le modèle ne porte pas de statut sur `ReturnRecord` : un retour est un fait
 * consigné par son registre et par le statut du colis qu'il suit. Déduire
 * l'étape depuis le statut du colis évite d'ajouter une colonne qui
 * redoublerait une information déjà présente, et qui divergerait d'elle.
 */
export const RETURN_STATUSES = {
  /** Aucun retour : le colis n'a jamais fait le chemin inverse. */
  NONE: 'AUCUN_RETOUR',
  /** Revenu au dépôt, en attente de réexpédition. */
  IN_DEPOT: 'RETOUR_DEPOT',
  /** Repart en tournée de retour. */
  IN_TRANSIT: 'EN_RUNSHEET_RETOUR',
  /** Restitué à l'expéditeur : le cycle est clos. */
  TO_SHIPPER: 'RETOURNE_EXPEDITEUR',
} as const;

export type ReturnStatus = (typeof RETURN_STATUSES)[keyof typeof RETURN_STATUSES];

/** Statuts colis qui signifient « ce colis est en train de revenir ». */
const RETURN_DEPOT_STATUSES: PackageStatus[] = [
  PackageStatus.RETOUR_DEPOT,
  PackageStatus.EN_RUNSHEET_RETOUR,
];

/** Étiquettes lisibles, dérivées du libellé de colis plutôt que d'un second dictionnaire. */
export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  [RETURN_STATUSES.NONE]: 'Aucun retour',
  [RETURN_STATUSES.IN_DEPOT]: 'Revenu au dépôt',
  [RETURN_STATUSES.IN_TRANSIT]: 'En tournée de retour',
  [RETURN_STATUSES.TO_SHIPPER]: 'Restitué à l\'expéditeur',
};

export interface InventoryFilterParams {
  /** Terme libre : numéro de suivi, code-barres, référence, nom ou téléphone. */
  search?: string;
  /** Borne basse sur la date de création, incluse. */
  dateFrom?: string;
  /** Borne haute sur la date de création, exclusive : le lendemain entier reste inclus. */
  dateTo?: string;
  status?: string;
  shipperId?: string;
  driverId?: string;
  depositId?: string;
  /**
   * Municipalité de livraison.
   *
   * L'adresse ne porte pas de colonne « ville » : elle porte une délégation
   * (la commune) et parfois un lieu-dit. `city` couvre les deux, parce que
   * l'utilisateur tape ce qu'il connaît. Le gouvernorat reste un filtre à part
   * : le confondre avec la commune donnerait « Tunis » pour tout le
   * gouvernorat, ce qui n'aide pas à trouver un colis.
   */
  city?: string;
  governorate?: string;
  type?: string;
  paymentStatus?: string;
  returnStatus?: string;
  page?: number;
  limit?: number;
  /** Isolation des données, posée par le middleware à partir du jeton. */
  scope?: {
    shipperId?: string;
    assignedDriverId?: string;
    depositId?: string;
  };
}

export interface InventoryRowDto {
  id: string;
  trackingNumber: string;
  barcode: string;
  status: PackageStatus;
  statusLabel: string;
  packageType: PackageType;
  customerName: string;
  customerPhone: string;
  governorate: string;
  /** Municipalité de livraison. */
  city: string;
  locality: string | null;
  shipperId: string;
  shipperName: string;
  driverId: string | null;
  driverName: string | null;
  depositId: string | null;
  depositName: string | null;
  runsheetNumber: string | null;
  pieceCount: number;
  /** Montant en `string` : un `Decimal` ne doit jamais transiter par `Number`. */
  totalPrice: string;
  collectedAmount: string;
  paymentStatus: PaymentStatus | null;
  returnStatus: ReturnStatus;
  createdAt: string;
  deliveredAt: string | null;
}

export interface InventoryListResult {
  rows: InventoryRowDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Valeurs effectives des filtres, pour l'écran et pour le nom du fichier exporté. */
  appliedFilters: Record<string, string>;
}

/** Colonnes minimales : l'historique n'a pas besoin du timeline ni des tentatives. */
const ROW_SELECT = {
  id: true,
  trackingNumber: true,
  barcode: true,
  status: true,
  packageType: true,
  pieceCount: true,
  totalPrice: true,
  collectedAmount: true,
  createdAt: true,
  deliveredAt: true,
  customer: { select: { fullName: true, primaryPhone: true } },
  customerAddress: { select: { governorate: true, delegation: true, locality: true } },
  shipper: { select: { id: true, companyName: true } },
  assignedDriver: { select: { id: true, driverCode: true, user: { select: { fullName: true } } } },
  currentDeposit: { select: { id: true, name: true } },
  currentRunsheet: { select: { runsheetNumber: true } },
  payment: { select: { status: true } },
} as const;

type RowRecord = {
  [K in keyof typeof ROW_SELECT]: unknown;
};

function toRow(row: RowRecord): InventoryRowDto {
  const r = row as unknown as {
    id: string;
    trackingNumber: string;
    barcode: string;
    status: PackageStatus;
    packageType: PackageType;
    pieceCount: number;
    totalPrice: { toFixed(n: number): string };
    collectedAmount: { toFixed(n: number): string };
    createdAt: Date;
    deliveredAt: Date | null;
    customer: { fullName: string; primaryPhone: string };
    customerAddress: { governorate: string; delegation: string; locality: string | null } | null;
    shipper: { id: string; companyName: string };
    assignedDriver: { id: string; driverCode: string; user: { fullName: string } | null } | null;
    currentDeposit: { id: string; name: string } | null;
    currentRunsheet: { runsheetNumber: string } | null;
    payment: { status: PaymentStatus } | null;
  };

  return {
    id: r.id,
    trackingNumber: r.trackingNumber,
    barcode: r.barcode,
    status: r.status,
    statusLabel: PACKAGE_STATUS_LABELS[r.status] ?? r.status,
    packageType: r.packageType,
    customerName: r.customer?.fullName ?? '',
    customerPhone: r.customer?.primaryPhone ?? '',
    governorate: r.customerAddress?.governorate ?? '',
    city: r.customerAddress?.delegation ?? '',
    locality: r.customerAddress?.locality ?? null,
    shipperId: r.shipper?.id ?? '',
    shipperName: r.shipper?.companyName ?? '',
    driverId: r.assignedDriver?.id ?? null,
    driverName: r.assignedDriver?.user?.fullName ?? null,
    depositId: r.currentDeposit?.id ?? null,
    depositName: r.currentDeposit?.name ?? null,
    runsheetNumber: r.currentRunsheet?.runsheetNumber ?? null,
    pieceCount: r.pieceCount,
    totalPrice: r.totalPrice.toFixed(3),
    collectedAmount: r.collectedAmount.toFixed(3),
    paymentStatus: r.payment?.status ?? null,
    returnStatus: returnStatusOf(r.status),
    createdAt: r.createdAt.toISOString(),
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
  };
}

function returnStatusOf(status: PackageStatus): ReturnStatus {
  if (status === 'RETOURNE_EXPEDITEUR') return RETURN_STATUSES.TO_SHIPPER;
  if (status === 'EN_RUNSHEET_RETOUR') return RETURN_STATUSES.IN_TRANSIT;
  if (status === 'RETOUR_DEPOT') return RETURN_STATUSES.IN_DEPOT;
  return RETURN_STATUSES.NONE;
}

export class InventoryService {
  /**
   * Traduit les filtres de requête en prédicat Prisma.
   *
   * Exporté parce que l'export CSV doit s'appuyer sur exactement ce même
   * prédicat. Dupliquer cette méthode « pour l'export » garantitait un jour
   * qu'un filtre marche à l'écran et pas dans le fichier — l'utilisateur
   * croirait avoir extrait 12 lignes alors qu'il en a 12 000.
   */
  buildWhere(params: InventoryFilterParams = {}) {
    const and: Record<string, unknown>[] = [];

    // Un colis supprimé reste supprimé : il ne doit pas réapparaître dans un
    // relevé historique, même s'il est encore référencé par un audit.
    and.push({ deletedAt: null });

    // Isolation des données. Posée par le middleware, jamais par le client :
    // un expéditeur ne doit pas pouvoir élargir sa fenêtre de vue en
    //demandant la page 1 sur 4.
    if (params.scope?.shipperId) and.push({ shipperId: params.scope.shipperId });
    if (params.scope?.assignedDriverId) and.push({ assignedDriverId: params.scope.assignedDriverId });
    if (params.scope?.depositId) and.push({ currentDepositId: params.scope.depositId });

    const term = params.search?.trim();
    if (term) {
      // Un numéro est parfois saisi avec des espaces ou des tirets. On retire
      // la ponctuation des deux côtés avant de comparer, sans quoi « 26-1002 »
      // ne trouve pas « 261002 ».
      const bare = term.replace(/[\s-]/g, '');
      and.push({
        OR: [
          { trackingNumber: { contains: term, mode: 'insensitive' } },
          { trackingNumber: { contains: bare, mode: 'insensitive' } },
          { barcode: { contains: term, mode: 'insensitive' } },
          { barcode: { contains: bare, mode: 'insensitive' } },
          { shipperReference: { contains: term, mode: 'insensitive' } },
          { customer: { fullName: { contains: term, mode: 'insensitive' } } },
          { customer: { primaryPhone: { contains: term } } },
          { customer: { secondaryPhone: { contains: term } } },
          { shipper: { companyName: { contains: term, mode: 'insensitive' } } },
          { assignedDriver: { user: { fullName: { contains: term, mode: 'insensitive' } } } },
        ],
      });
    }

    const range = periode(params.dateFrom, params.dateTo);
    if (range) and.push({ createdAt: range });

    if (params.status && params.status !== 'ALL') {
      const status = asEnum(params.status, Object.values(PackageStatus) as string[]);
      if (!status) {
        // Un statut inconnu ne doit pas faire échouer la requête en 500 : il
        // ne correspond à rien, donc on le neutralise.
        and.push({ id: IMPOSSIBLE_ID });
      } else {
        and.push({ status: status as PackageStatus });
      }
    }

    if (params.type && params.type !== 'ALL') {
      const type = asEnum(params.type, Object.values(PackageType) as string[]);
      if (type) and.push({ packageType: type as PackageType });
      else and.push({ id: IMPOSSIBLE_ID });
    }

    if (params.paymentStatus && params.paymentStatus !== 'ALL') {
      const payment = asEnum(params.paymentStatus, Object.values(PaymentStatus) as string[]);
      if (payment) {
        and.push({ payment: { is: { status: payment as PaymentStatus } } });
      } else {
        // `TOUS` distingue « aucun encaissement ouvert » de « tous les
        // encaissements », deux populations très différentes pour la caisse.
        if (params.paymentStatus === 'TOUS') and.push({ payment: { is: null } });
        else and.push({ id: IMPOSSIBLE_ID });
      }
    }

    if (params.returnStatus && params.returnStatus !== 'ALL') {
      const wanted = asEnum(params.returnStatus, Object.values(RETURN_STATUSES) as string[]);
      if (wanted === RETURN_STATUSES.NONE) {
        and.push({ status: { notIn: [...RETURN_DEPOT_STATUSES, 'RETOURNE_EXPEDITEUR'] } });
      } else if (wanted === RETURN_STATUSES.IN_DEPOT) {
        and.push({ status: 'RETOUR_DEPOT' });
      } else if (wanted === RETURN_STATUSES.IN_TRANSIT) {
        and.push({ status: 'EN_RUNSHEET_RETOUR' });
      } else if (wanted === RETURN_STATUSES.TO_SHIPPER) {
        and.push({ status: 'RETOURNE_EXPEDITEUR' });
      } else {
        and.push({ id: IMPOSSIBLE_ID });
      }
    }

    if (params.city && params.city !== 'ALL') {
      and.push({
        customerAddress: {
          OR: [
            { delegation: { contains: params.city, mode: 'insensitive' } },
            { locality: { contains: params.city, mode: 'insensitive' } },
          ],
        },
      });
    }

    if (params.governorate && params.governorate !== 'ALL') {
      and.push({ customerAddress: { governorate: params.governorate } });
    }

    const shipperId = asUuid(params.shipperId);
    if (params.shipperId && params.shipperId !== 'ALL' && !shipperId) {
      throw badRequest('Identifiant d\'expéditeur invalide.');
    }
    if (shipperId) and.push({ shipperId });

    const driverId = asUuid(params.driverId);
    if (params.driverId && params.driverId !== 'ALL' && !driverId) {
      throw badRequest('Identifiant de livreur invalide.');
    }
    if (driverId) and.push({ assignedDriverId: driverId });

    const depositId = asUuid(params.depositId);
    if (params.depositId && params.depositId !== 'ALL' && !depositId) {
      throw badRequest('Identifiant de dépôt invalide.');
    }
    if (depositId) and.push({ currentDepositId: depositId });

    return and.length === 1 ? and[0] : { AND: and };
  }

  async list(params: InventoryFilterParams = {}): Promise<InventoryListResult> {
    const prisma = getPrisma();
    const where = this.buildWhere(params);

    const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
    const requested = params.limit && params.limit > 0 ? Math.floor(params.limit) : DEFAULT_LIMIT;
    const limit = Math.min(requested, MAX_LIMIT);

    const [total, records] = await Promise.all([
      prisma.package.count({ where }),
      prisma.package.findMany({
        where,
        select: ROW_SELECT,
        // `createdAt` puis `id` : le second critère rend la pagination
        // reproductible d'une page à l'autre.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      rows: records.map((r) => toRow(r as unknown as RowRecord)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      appliedFilters: describeFilters(params),
    };
  }

  /**
   * Export CSV de l'inventaire, filtré exactement comme la liste.
   *
   * Le nombre de lignes est compter avant d'écrire quoi que ce soit : inutile
   * de fabriquer un fichier de 12 000 lignes pour le refuser ensuite.
   */
  async exportCsv(
    params: InventoryFilterParams = {},
    actor: { id: string; fullName: string }
  ): Promise<{ csv: string; filename: string; rowCount: number }> {
    const prisma = getPrisma();
    const where = this.buildWhere(params);
    const total = await prisma.package.count({ where });

    if (total > MAX_EXPORT_ROWS) {
      throw badRequest(
        `Export refusé : ${total.toLocaleString('fr-TN')} lignes correspondent à ces filtres, ` +
          `pour un maximum de ${MAX_EXPORT_ROWS.toLocaleString('fr-TN')}. ` +
          'Ressserrez la période ou les critères.'
      );
    }

    // Une seule requête, sans `skip`/`take` : la liste est bornée par le
    // contrôle ci-dessus, donc la mémoire reste proportionnelle au plafond.
    const records = await prisma.package.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const rows = records.map((r) => toRow(r as unknown as RowRecord));
    const header = [
      'Numero colis',
      'Code-barres',
      'Destinataire',
      'Telephone',
      'Gouvernorat',
      'Commune',
      'Lieu-dit',
      'Statut',
      'Type',
      'Expediteur',
      'Livreur',
      'Depot',
      'Runsheet',
      'Pieces',
      'Montant a encaisser (TND)',
      'Montant encaisse (TND)',
      'Statut paiement',
      'Statut retour',
      'Cree le',
      'Livre le',
    ];

    const csv = buildCsv(
      header,
      rows.map((row) => [
        row.trackingNumber,
        row.barcode,
        row.customerName,
        row.customerPhone,
        row.governorate,
        row.city,
        row.locality ?? '',
        row.statusLabel,
        row.packageType,
        row.shipperName,
        row.driverName ?? '',
        row.depositName ?? '',
        row.runsheetNumber ?? '',
        String(row.pieceCount),
        row.totalPrice,
        row.collectedAmount,
        row.paymentStatus ?? 'AUCUN',
        RETURN_STATUS_LABELS[row.returnStatus],
        row.createdAt,
        row.deliveredAt ?? '',
      ])
    );

    const scope = describeFilters(params);
    const suffix = Object.keys(scope).length ? `_${Object.keys(scope).sort().join('-')}` : '';
    const filename = timestampedFilename('inventaire', suffix);

    // Un export est une sortie de données : il laisse une trace consultable.
    await auditService.record({
      entityType: 'PACKAGE',
      entityId: 'INVENTORY_EXPORT',
      action: 'EXPORT',
      userId: actor.id,
      reason: `Export de l'inventaire (${rows.length} lignes)${
        Object.keys(scope).length ? ` — filtres : ${JSON.stringify(scope)}` : ''
      }`,
    });

    return { csv, filename, rowCount: rows.length };
  }

  /** Valeurs proposées à l'écran : sans elles, le filtre est une devinette. */
  async facets(params: InventoryFilterParams = {}) {
    const prisma = getPrisma();
    const scope: Record<string, unknown> = {};
    if (params.scope?.shipperId) scope.shipperId = params.scope.shipperId;
    if (params.scope?.assignedDriverId) scope.assignedDriverId = params.scope.assignedDriverId;
    if (params.scope?.depositId) scope.currentDepositId = params.scope.depositId;

    const [shippers, drivers, deposits, cities, governorates, statuses] = await Promise.all([
      prisma.shipper.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, companyName: true },
        orderBy: { companyName: 'asc' },
        take: 200,
      }),
      prisma.driver.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, driverCode: true, user: { select: { fullName: true } } },
        orderBy: { driverCode: 'asc' },
        take: 200,
      }),
      prisma.deposit.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 100,
      }),
      prisma.customerAddress.findMany({
        distinct: ['delegation'],
        select: { delegation: true },
        where: { delegation: { not: '' } },
        orderBy: { delegation: 'asc' },
      }),
      prisma.customerAddress.findMany({
        distinct: ['governorate'],
        select: { governorate: true },
        where: { governorate: { not: '' } },
        orderBy: { governorate: 'asc' },
      }),
      prisma.package.groupBy({
        by: ['status'],
        where: { ...scope, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const byStatus = new Map(statuses.map((s) => [s.status as string, s._count._all]));

    return {
      shippers: shippers.map((s) => ({ id: s.id, label: s.companyName })),
      drivers: drivers.map((d) => ({
        id: d.id,
        label: `${d.driverCode} — ${d.user?.fullName ?? '—'}`,
      })),
      deposits: deposits.map((d) => ({ id: d.id, label: d.name })),
      cities: cities.map((c) => c.delegation).filter(Boolean),
      governorates: governorates.map((g) => g.governorate).filter(Boolean),
      statuses: Object.values(PackageStatus).map((status) => ({
        value: status,
        label: PACKAGE_STATUS_LABELS[status] ?? status,
        count: byStatus.get(status) ?? 0,
      })),
      packageTypes: Object.values(PackageType).map((type) => ({ value: type, label: type })),
      paymentStatuses: Object.values(PaymentStatus).map((status) => ({ value: status, label: status })),
      returnStatuses: Object.values(RETURN_STATUSES).map((value) => ({
        value,
        label: RETURN_STATUS_LABELS[value],
      })),
    };
  }
}

function asEnum(value: string, allowed: string[]): string | null {
  return allowed.includes(value) ? value : null;
}

/**
 * Bornes de dates.
 *
 * `dateTo` est traité en début de journée suivante : filtrer « jusqu'au
 * 12/10 » et exclure tout ce qui est né le 12 à 14 h serait la faute la plus
 * naturelle et la plus coûteuse de cet écran.
 */
/** Résumé lisible des filtres actifs, réutilisé par l'écran et par le nom de fichier. */
function describeFilters(params: InventoryFilterParams): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string | undefined, empty = 'ALL') => {
    if (value && value !== empty && value.trim()) out[key] = value.trim();
  };
  put('search', params.search);
  put('du', params.dateFrom);
  put('au', params.dateTo);
  put('statut', params.status);
  put('expediteur', params.shipperId);
  put('livreur', params.driverId);
  put('depot', params.depositId);
  put('ville', params.city);
  put('gouvernorat', params.governorate);
  put('type', params.type);
  put('paiement', params.paymentStatus);
  put('retour', params.returnStatus);
  return out;
}

export const inventoryService = new InventoryService();
