/**
 * Inventaire — exceptions / colis suspects.
 *
 * Répond à : « colis perdus, non envoyés, non traçables, suspects ».
 *
 * Règles structurantes :
 *  1. Aucun nouveau PackageStatus n'est introduit : les catégories sont des
 *     lectures calculées à partir des colonnes existantes (status,
 *     currentDepositId, assignedDriverId, runsheet, transfer, timeline,
 *     dates, attempts). Un libellé « PERDU » n'est jamais produit : la donnée
 *     ne permet pas de conclure qu'un colis est définitivement perdu, seulement
 *     qu'il est suspect / à investiguer.
 *  2. Le seuillage temporel est explicite, documenté et surchargeable par
 *     requête (`stuckHours`, `blockedHours`, `nonTraceableHours`,
 *     `nonEnvoyeHours`). Les valeurs par défaut sont des règles métier
 *     observables (48h pour le retard, 72h pour le blocage) — pas des
 *     constantes magiques.
 *  3. Le filtrage reste en base pour le socle (dépôt, livreur, statut, recherche,
 *     période) ; l'évaluation de la suspicion est serveur (pas dans React) et
 *     paginée ; la charge reste proportionnelle au filtre de base, pas à la
 *     table entière (cap `MAX_SCAN`).
 */

import { getPrisma } from '../../common/database/prisma-context';
import { asUuid, badRequest } from '../../common/errors/api-error';
import { periode } from '../../common/dates/periode';
import {
  PACKAGE_STATUS_LABELS,
  PackageStatus,
  PackageType,
  PaymentStatus,
  TERMINAL_PACKAGE_STATUSES,
} from '@logixpress/types';

// ---------------------------------------------------------------------------
// Seuils (heures) — documentés, configurables par requête.
// ---------------------------------------------------------------------------

/** Au-delà de 48h sans mouvement dans un état non terminal → « En retard ». */
export const DEFAULT_STUCK_HOURS = 48;
/** Au-delà de 72h → « Bloqué » (critique). */
export const DEFAULT_BLOCKED_HOURS = 72;
/** Sans événement au-delà de 24h après création → « Non traçable ». */
export const DEFAULT_NON_TRACABLE_HOURS = 24;
/** Statut CREE sans réception au-delà de 48h → « Non envoyé ». */
export const DEFAULT_NON_ENVOYE_HOURS = 48;
/** Retour / échec bloqué au-delà de 48h → « Retour / problème ». */
export const DEFAULT_RETOUR_STUCK_HOURS = 48;

/** Plafond de scan : on n'évalue jamais plus de N colis d'un coup. */
const MAX_SCAN = 5000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000';

export enum InventoryExceptionCategory {
  NON_TRACABLE = 'NON_TRACABLE',
  INCOHERENT = 'INCOHERENT',
  EN_RETARD = 'EN_RETARD',
  BLOQUE = 'BLOQUE',
  NON_ENVOYE = 'NON_ENVOYE',
  RETOUR_PROBLEME = 'RETOUR_PROBLEME',
  A_SURVEILLER = 'A_SURVEILLER',
}

export enum InventoryExceptionSeverity {
  CRITIQUE = 'critique',
  HAUTE = 'haute',
  MOYENNE = 'moyenne',
  BASSE = 'basse',
}

export const EXCEPTION_CATEGORY_LABELS: Record<InventoryExceptionCategory, string> = {
  [InventoryExceptionCategory.NON_TRACABLE]: 'Non traçable',
  [InventoryExceptionCategory.INCOHERENT]: 'Incohérent',
  [InventoryExceptionCategory.EN_RETARD]: 'En retard',
  [InventoryExceptionCategory.BLOQUE]: 'Bloqué',
  [InventoryExceptionCategory.NON_ENVOYE]: 'Non envoyé / en attente',
  [InventoryExceptionCategory.RETOUR_PROBLEME]: 'Retour / problème',
  [InventoryExceptionCategory.A_SURVEILLER]: 'À surveiller',
};

export const EXCEPTION_SEVERITY_LABELS: Record<InventoryExceptionSeverity, string> = {
  [InventoryExceptionSeverity.CRITIQUE]: 'Critique',
  [InventoryExceptionSeverity.HAUTE]: 'Haute',
  [InventoryExceptionSeverity.MOYENNE]: 'Moyenne',
  [InventoryExceptionSeverity.BASSE]: 'Basse',
};

export interface InventoryExceptionParams {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  shipperId?: string;
  driverId?: string;
  depositId?: string;
  city?: string;
  governorate?: string;
  type?: string;
  paymentStatus?: string;
  returnStatus?: string;
  category?: string; // filter by exception category
  severity?: string;
  page?: number;
  limit?: number;
  stuckHours?: number;
  blockedHours?: number;
  nonTraceableHours?: number;
  nonEnvoyeHours?: number;
  scope?: { shipperId?: string; assignedDriverId?: string; depositId?: string };
}

export interface InventoryExceptionRow {
  id: string;
  trackingNumber: string;
  barcode: string;
  status: PackageStatus;
  statusLabel: string;
  packageType: PackageType;
  customerName: string;
  customerPhone: string;
  governorate: string;
  city: string;
  locality: string | null;
  shipperId: string;
  shipperName: string;
  driverId: string | null;
  driverName: string | null;
  depositId: string | null;
  depositName: string | null;
  runsheetNumber: string | null;
  runsheetId: string | null;
  runsheetStatus: string | null;
  pieceCount: number;
  totalPrice: string;
  collectedAmount: string;
  paymentStatus: PaymentStatus | null;
  returnStatus: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  lastEventAt: string | null;
  lastEventTitle: string | null;
  ageHours: number;
  hoursSinceUpdate: number;
  timelineCount: number;
  deliveryAttemptsCount: number;
  exceptionCategory: InventoryExceptionCategory;
  severity: InventoryExceptionSeverity;
  reasons: string[];
  // for detail
  // raw timeline accessible via detail endpoint
}

export interface InventoryExceptionListResult {
  rows: InventoryExceptionRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appliedFilters: Record<string, string>;
  thresholds: { stuckHours: number; blockedHours: number; nonTraceableHours: number; nonEnvoyeHours: number };
}

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
  updatedAt: true,
  deliveredAt: true,
  currentDepositId: true,
  originDepositId: true,
  destinationDepositId: true,
  assignedDriverId: true,
  currentRunsheetId: true,
  interDepotTransferId: true,
  receivedAt: true,
  deliveryAttemptsCount: true,
  shipperId: true,
  deletedAt: true,
  customer: { select: { fullName: true, primaryPhone: true } },
  customerAddress: { select: { governorate: true, delegation: true, locality: true } },
  shipper: { select: { id: true, companyName: true } },
  assignedDriver: { select: { id: true, driverCode: true, isActive: true, user: { select: { fullName: true } } } },
  currentDeposit: { select: { id: true, name: true } },
  currentRunsheet: { select: { id: true, runsheetNumber: true, status: true, driverId: true } },
  interDepotTransfer: { select: { id: true, transferNumber: true, status: true } },
  statusHistory: { select: { status: true, title: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  payment: { select: { status: true } },
} as const;

type RawRow = {
  id: string;
  trackingNumber: string;
  barcode: string;
  status: PackageStatus;
  packageType: PackageType;
  pieceCount: number;
  totalPrice: { toFixed(n: number): string };
  collectedAmount: { toFixed(n: number): string };
  createdAt: Date;
  updatedAt: Date;
  deliveredAt: Date | null;
  currentDepositId: string | null;
  originDepositId: string;
  destinationDepositId: string;
  assignedDriverId: string | null;
  currentRunsheetId: string | null;
  interDepotTransferId: string | null;
  receivedAt: Date | null;
  deliveryAttemptsCount: number;
  shipperId: string;
  deletedAt: Date | null;
  customer: { fullName: string; primaryPhone: string } | null;
  customerAddress: { governorate: string; delegation: string; locality: string | null } | null;
  shipper: { id: string; companyName: string } | null;
  assignedDriver: { id: string; driverCode: string; isActive: boolean; user: { fullName: string } | null } | null;
  currentDeposit: { id: string; name: string } | null;
  currentRunsheet: { id: string; runsheetNumber: string; status: string; driverId: string } | null;
  interDepotTransfer: { id: string; transferNumber: string; status: string } | null;
  statusHistory: { status: string; title: string; createdAt: Date }[];
  payment: { status: PaymentStatus } | null;
};

function toExceptionRow(
  raw: RawRow,
  evaluation: { category: InventoryExceptionCategory; severity: InventoryExceptionSeverity; reasons: string[] }
): InventoryExceptionRow {
  const last = raw.statusHistory.length > 0 ? raw.statusHistory[raw.statusHistory.length - 1] : null;
  const now = new Date();
  const ageHours = Math.floor((now.getTime() - raw.createdAt.getTime()) / 3600000);
  const hoursSinceUpdate = Math.floor((now.getTime() - raw.updatedAt.getTime()) / 3600000);
  // returnStatus derived
  let returnStatus = 'AUCUN_RETOUR';
  if (raw.status === 'RETOURNE_EXPEDITEUR') returnStatus = 'RETOURNE_EXPEDITEUR';
  else if (raw.status === 'EN_RUNSHEET_RETOUR') returnStatus = 'EN_RUNSHEET_RETOUR';
  else if (raw.status === 'RETOUR_DEPOT') returnStatus = 'RETOUR_DEPOT';

  return {
    id: raw.id,
    trackingNumber: raw.trackingNumber,
    barcode: raw.barcode,
    status: raw.status as PackageStatus,
    statusLabel: PACKAGE_STATUS_LABELS[raw.status as PackageStatus] ?? raw.status,
    packageType: raw.packageType as PackageType,
    customerName: raw.customer?.fullName ?? '',
    customerPhone: raw.customer?.primaryPhone ?? '',
    governorate: raw.customerAddress?.governorate ?? '',
    city: raw.customerAddress?.delegation ?? '',
    locality: raw.customerAddress?.locality ?? null,
    shipperId: raw.shipper?.id ?? '',
    shipperName: raw.shipper?.companyName ?? '',
    driverId: raw.assignedDriver?.id ?? null,
    driverName: raw.assignedDriver?.user?.fullName ?? null,
    depositId: raw.currentDeposit?.id ?? null,
    depositName: raw.currentDeposit?.name ?? null,
    runsheetNumber: raw.currentRunsheet?.runsheetNumber ?? null,
    runsheetId: raw.currentRunsheet?.id ?? null,
    runsheetStatus: raw.currentRunsheet?.status ?? null,
    pieceCount: raw.pieceCount,
    totalPrice: raw.totalPrice.toFixed(3),
    collectedAmount: raw.collectedAmount.toFixed(3),
    paymentStatus: raw.payment?.status ?? null,
    returnStatus,
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
    deliveredAt: raw.deliveredAt ? raw.deliveredAt.toISOString() : null,
    lastEventAt: last ? last.createdAt.toISOString() : null,
    lastEventTitle: last ? last.title : null,
    ageHours,
    hoursSinceUpdate,
    timelineCount: raw.statusHistory.length,
    deliveryAttemptsCount: raw.deliveryAttemptsCount,
    exceptionCategory: evaluation.category,
    severity: evaluation.severity,
    reasons: evaluation.reasons,
  };
}

function thresholdsFrom(params: InventoryExceptionParams) {
  const stuckHours = params.stuckHours && params.stuckHours > 0 ? Math.floor(params.stuckHours) : DEFAULT_STUCK_HOURS;
  const blockedHours = params.blockedHours && params.blockedHours > 0 ? Math.floor(params.blockedHours) : DEFAULT_BLOCKED_HOURS;
  const nonTraceableHours = params.nonTraceableHours && params.nonTraceableHours > 0 ? Math.floor(params.nonTraceableHours) : DEFAULT_NON_TRACABLE_HOURS;
  const nonEnvoyeHours = params.nonEnvoyeHours && params.nonEnvoyeHours > 0 ? Math.floor(params.nonEnvoyeHours) : DEFAULT_NON_ENVOYE_HOURS;
  // blocked must be > stuck
  const effectiveBlocked = blockedHours <= stuckHours ? stuckHours + 24 : blockedHours;
  return { stuckHours, blockedHours: effectiveBlocked, nonTraceableHours, nonEnvoyeHours };
}

function isTerminal(status: string): boolean {
  return (TERMINAL_PACKAGE_STATUSES as readonly string[]).includes(status);
}

/**
 * Évalue un colis et produit 0..N raisons, la catégorie primaire et la sévérité.
 *
 * Chaque condition est objective, fondée sur les colonnes existantes. Aucun
 * seuil n'est caché : tous sont paramétrables et documentés.
 */
function evaluatePackage(
  pkg: RawRow,
  now: Date,
  th: { stuckHours: number; blockedHours: number; nonTraceableHours: number; nonEnvoyeHours: number }
): { category: InventoryExceptionCategory; severity: InventoryExceptionSeverity; reasons: string[] } | null {
  const reasons: string[] = [];
  const categories = new Set<InventoryExceptionCategory>();
  const hoursSinceCreated = (now.getTime() - pkg.createdAt.getTime()) / 3600000;
  const hoursSinceUpdate = (now.getTime() - pkg.updatedAt.getTime()) / 3600000;
  const status = pkg.status as string;

  // ---- NON_TRACABLE ----
  if (pkg.statusHistory.length === 0) {
    reasons.push('Aucun événement de traçabilité — colis sans historique.');
    categories.add(InventoryExceptionCategory.NON_TRACABLE);
  } else if (
    pkg.statusHistory.length === 1 &&
    pkg.statusHistory[0].status === 'CREE' &&
    hoursSinceCreated >= th.nonTraceableHours
  ) {
    const h = Math.floor(hoursSinceCreated);
    reasons.push(`Non traçable : seul l'événement de création il y a ${h}h, aucun mouvement depuis.`);
    categories.add(InventoryExceptionCategory.NON_TRACABLE);
  } else if (
    pkg.statusHistory.length === 1 &&
    hoursSinceCreated >= th.nonTraceableHours * 2 &&
    status === 'CREE'
  ) {
    const h = Math.floor(hoursSinceCreated);
    reasons.push(`Non traçable : une seule trace (création) depuis ${h}h, colis jamais pris en charge.`);
    categories.add(InventoryExceptionCategory.NON_TRACABLE);
  }

  // ---- INCOHERENT ----
  // Dépôt manquant alors que le statut l'exige
  const needsDepositStatuses = ['RECU_DEPOT', 'RECU_DEPOT_DESTINATION', 'RETOUR_DEPOT'];
  if (needsDepositStatuses.includes(status) && !pkg.currentDepositId) {
    reasons.push(`Incohérent : statut « ${PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status} » mais aucun dépôt courant.`);
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }
  // EN_LOT / EN_TRANSIT sans transfert
  if (['EN_LOT_INTER_DEPOT', 'EN_TRANSIT_INTER_DEPOT'].includes(status) && !pkg.interDepotTransferId) {
    reasons.push(`Incohérent : statut « ${PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status} » sans transfert inter-dépôt actif.`);
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }
  // EN_TRANSIT devrait avoir currentDepositId nul
  if (status === 'EN_TRANSIT_INTER_DEPOT' && pkg.currentDepositId) {
    reasons.push('Incohérent : en transit inter-dépôt mais encore rattaché à un dépôt courant.');
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }
  // Affecté / en cours sans livreur
  if (['AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON'].includes(status) && !pkg.assignedDriverId) {
    reasons.push(`Incohérent : statut « ${PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status} » sans livreur assigné.`);
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }
  if (pkg.currentRunsheetId && !pkg.assignedDriverId) {
    reasons.push('Incohérent : tournée assignée sans livreur.');
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }
  // Incohérence livreur / tournée
  if (pkg.currentRunsheet && pkg.assignedDriverId && pkg.currentRunsheet.driverId !== pkg.assignedDriverId) {
    reasons.push(
      `Incohérent : colis affecté au livreur ${pkg.assignedDriverId.slice(0, 8)}… mais tournée ${pkg.currentRunsheet.runsheetNumber} appartient à un autre livreur.`
    );
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }
  // Tournée clôturée / annulée mais colis encore affecté
  if (
    pkg.currentRunsheet &&
    ['ANNULEE', 'CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT'].includes(pkg.currentRunsheet.status) &&
    ['AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON'].includes(status)
  ) {
    reasons.push(`Incohérent : colis encore « ${PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status} » mais tournée ${pkg.currentRunsheet.runsheetNumber} est ${pkg.currentRunsheet.status}.`);
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }
  // Livreur désactivé mais colis non terminal
  if (pkg.assignedDriver && !pkg.assignedDriver.isActive && !isTerminal(status)) {
    reasons.push('Incohérent : livreur désactivé mais colis non clôturé.');
    categories.add(InventoryExceptionCategory.INCOHERENT);
  }

  // ---- NON_ENVOYE ----
  if (status === 'CREE' && hoursSinceCreated >= th.nonEnvoyeHours) {
    const d = Math.floor(hoursSinceCreated / 24);
    const h = Math.floor(hoursSinceCreated);
    reasons.push(`Non envoyé : créé il y a ${d > 0 ? `${d}j (${h}h)` : `${h}h`} sans prise en charge dépôt.`);
    categories.add(InventoryExceptionCategory.NON_ENVOYE);
  }

  // ---- RETOUR_PROBLEME ----
  const retourStatuses = ['RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'ECHEC_LIVRAISON', 'REPORTE', 'LIVRAISON_PARTIELLE'];
  if (retourStatuses.includes(status)) {
    if (hoursSinceUpdate >= DEFAULT_RETOUR_STUCK_HOURS) {
      const h = Math.floor(hoursSinceUpdate);
      reasons.push(`Retour / problème bloqué depuis ${h}h au statut « ${PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status} ».`);
      categories.add(InventoryExceptionCategory.RETOUR_PROBLEME);
    } else if (pkg.deliveryAttemptsCount >= 3) {
      reasons.push(`Retour / problème : ${pkg.deliveryAttemptsCount} tentatives sans issue.`);
      categories.add(InventoryExceptionCategory.RETOUR_PROBLEME);
    } else if (status === 'ECHEC_LIVRAISON' || status === 'REPORTE') {
      // Même récent, un échec/report est un problème à surveiller
      if (!categories.has(InventoryExceptionCategory.RETOUR_PROBLEME) && hoursSinceUpdate >= th.nonTraceableHours) {
        reasons.push(`À investiguer : « ${PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status} » depuis ${Math.floor(hoursSinceUpdate)}h.`);
        categories.add(InventoryExceptionCategory.RETOUR_PROBLEME);
      }
    }
  }
  if (pkg.deliveryAttemptsCount >= 3 && !isTerminal(status) && !categories.has(InventoryExceptionCategory.RETOUR_PROBLEME)) {
    reasons.push(`Tentatives multiples : ${pkg.deliveryAttemptsCount} tentatives, colis non livré.`);
    categories.add(InventoryExceptionCategory.RETOUR_PROBLEME);
  }

  // ---- BLOQUE / EN_RETARD (non terminal, stagnation) ----
  if (!isTerminal(status)) {
    if (hoursSinceUpdate >= th.blockedHours) {
      const h = Math.floor(hoursSinceUpdate);
      // Éviter le doublon si déjà catégorisé BLOQUE via autre règle : on ajoute quand même la raison temporelle
      const label = PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status;
      const reason = `Bloqué depuis ${h}h au statut « ${label} » (seuil ${th.blockedHours}h).`;
      if (!reasons.some((r) => r.includes('Bloqué depuis'))) {
        reasons.push(reason);
      }
      categories.add(InventoryExceptionCategory.BLOQUE);
    } else if (hoursSinceUpdate >= th.stuckHours) {
      const h = Math.floor(hoursSinceUpdate);
      const label = PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status;
      const reason = `En retard depuis ${h}h au statut « ${label} » (seuil ${th.stuckHours}h).`;
      if (!reasons.some((r) => r.includes('En retard depuis') || r.includes('Bloqué depuis'))) {
        reasons.push(reason);
      }
      // Ne pas écraser BLOQUE
      if (!categories.has(InventoryExceptionCategory.BLOQUE)) {
        categories.add(InventoryExceptionCategory.EN_RETARD);
      }
    }
  }

  // ---- A_SURVEILLER (fallback) ----
  // Si le colis a des signes faibles mais n'a déclenché aucune catégorie forte
  if (reasons.length === 0) {
    if (pkg.deliveryAttemptsCount >= 2 && !isTerminal(status)) {
      reasons.push(`À surveiller : ${pkg.deliveryAttemptsCount} tentatives, statut « ${PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status} ».`);
      categories.add(InventoryExceptionCategory.A_SURVEILLER);
    } else if (!isTerminal(status) && hoursSinceUpdate >= th.nonTraceableHours && pkg.statusHistory.length <= 2) {
      // Peu d'histoire mais pas encore seuil bloqué
      // On ne veut pas sur-détecter les colis frais (<24h) avec 2 événements (normal)
      // Donc on exige au moins 36h ?
      if (hoursSinceUpdate >= 36) {
        reasons.push(`À surveiller : peu de traçabilité (${pkg.statusHistory.length} événement(s)) depuis ${Math.floor(hoursSinceUpdate)}h.`);
        categories.add(InventoryExceptionCategory.A_SURVEILLER);
      }
    }
  }

  if (reasons.length === 0) return null;

  // Catégorie primaire par priorité (la plus grave l'emporte)
  const priority: InventoryExceptionCategory[] = [
    InventoryExceptionCategory.INCOHERENT,
    InventoryExceptionCategory.BLOQUE,
    InventoryExceptionCategory.NON_TRACABLE,
    InventoryExceptionCategory.RETOUR_PROBLEME,
    InventoryExceptionCategory.NON_ENVOYE,
    InventoryExceptionCategory.EN_RETARD,
    InventoryExceptionCategory.A_SURVEILLER,
  ];
  let primary = InventoryExceptionCategory.A_SURVEILLER;
  for (const p of priority) if (categories.has(p)) { primary = p; break; }

  // Sévérité dérivée de la catégorie primaire + contexte
  let severity: InventoryExceptionSeverity = InventoryExceptionSeverity.BASSE;
  if (primary === InventoryExceptionCategory.INCOHERENT || primary === InventoryExceptionCategory.BLOQUE) {
    severity = InventoryExceptionSeverity.CRITIQUE;
  } else if (
    primary === InventoryExceptionCategory.NON_TRACABLE ||
    primary === InventoryExceptionCategory.RETOUR_PROBLEME ||
    primary === InventoryExceptionCategory.NON_ENVOYE
  ) {
    // NON_TRACABLE sans histoire = critique, avec une histoire = haute
    if (primary === InventoryExceptionCategory.NON_TRACABLE && pkg.statusHistory.length === 0) severity = InventoryExceptionSeverity.CRITIQUE;
    else severity = InventoryExceptionSeverity.HAUTE;
  } else if (primary === InventoryExceptionCategory.EN_RETARD) {
    severity = InventoryExceptionSeverity.MOYENNE;
  } else if (primary === InventoryExceptionCategory.A_SURVEILLER) {
    severity = InventoryExceptionSeverity.BASSE;
  }

  // Dédupliquer raisons
  const uniqueReasons = Array.from(new Set(reasons));

  return { category: primary, severity, reasons: uniqueReasons };
}

// ---------------------------------------------------------------------------
// Filtre de base (socle inventaire) — en base, jamais en mémoire.
// ---------------------------------------------------------------------------

function buildBaseWhere(params: InventoryExceptionParams) {
  const and: Record<string, unknown>[] = [];
  and.push({ deletedAt: null });

  if (params.scope?.shipperId) and.push({ shipperId: params.scope.shipperId });
  if (params.scope?.assignedDriverId) and.push({ assignedDriverId: params.scope.assignedDriverId });
  // deposit scope : comme dans reports, on élargit à current + origin + destination ?
  // Pour l'inventaire, le socle historique est currentDepositId — cohérent avec
  // inventory.service. On garde la même sémantique.
  if (params.scope?.depositId) and.push({ currentDepositId: params.scope.depositId });

  const term = params.search?.trim();
  if (term) {
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
    if (!status) and.push({ id: IMPOSSIBLE_ID });
    else and.push({ status: status as PackageStatus });
  }

  if (params.type && params.type !== 'ALL') {
    const type = asEnum(params.type, Object.values(PackageType) as string[]);
    if (type) and.push({ packageType: type as PackageType });
    else and.push({ id: IMPOSSIBLE_ID });
  }

  if (params.paymentStatus && params.paymentStatus !== 'ALL') {
    const payment = asEnum(params.paymentStatus, Object.values(PaymentStatus) as string[]);
    if (payment) and.push({ payment: { is: { status: payment as PaymentStatus } } });
    else {
      if (params.paymentStatus === 'TOUS') and.push({ payment: { is: null } });
      else and.push({ id: IMPOSSIBLE_ID });
    }
  }

  if (params.returnStatus && params.returnStatus !== 'ALL') {
    const RETURN_STATUSES = { NONE: 'AUCUN_RETOUR', IN_DEPOT: 'RETOUR_DEPOT', IN_TRANSIT: 'EN_RUNSHEET_RETOUR', TO_SHIPPER: 'RETOURNE_EXPEDITEUR' } as const;
    const wanted = asEnum(params.returnStatus, Object.values(RETURN_STATUSES) as string[]);
    if (wanted === RETURN_STATUSES.NONE) and.push({ status: { notIn: ['RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'RETOURNE_EXPEDITEUR'] } });
    else if (wanted === RETURN_STATUSES.IN_DEPOT) and.push({ status: 'RETOUR_DEPOT' });
    else if (wanted === RETURN_STATUSES.IN_TRANSIT) and.push({ status: 'EN_RUNSHEET_RETOUR' });
    else if (wanted === RETURN_STATUSES.TO_SHIPPER) and.push({ status: 'RETOURNE_EXPEDITEUR' });
    else and.push({ id: IMPOSSIBLE_ID });
  }

  if (params.city && params.city !== 'ALL') {
    and.push({
      customerAddress: { OR: [{ delegation: { contains: params.city, mode: 'insensitive' } }, { locality: { contains: params.city, mode: 'insensitive' } }] },
    });
  }
  if (params.governorate && params.governorate !== 'ALL') and.push({ customerAddress: { governorate: params.governorate } });

  const shipperId = asUuid(params.shipperId);
  if (params.shipperId && params.shipperId !== 'ALL' && !shipperId) throw badRequest("Identifiant d'expéditeur invalide.");
  if (shipperId) and.push({ shipperId });

  const driverId = asUuid(params.driverId);
  if (params.driverId && params.driverId !== 'ALL' && !driverId) throw badRequest('Identifiant de livreur invalide.');
  if (driverId) and.push({ assignedDriverId: driverId });

  const depositId = asUuid(params.depositId);
  if (params.depositId && params.depositId !== 'ALL' && !depositId) throw badRequest('Identifiant de dépôt invalide.');
  if (depositId) and.push({ currentDepositId: depositId });

  return and.length === 1 ? and[0] : { AND: and };
}

function asEnum(value: string, allowed: string[]): string | null {
  return allowed.includes(value) ? value : null;
}

function describeFilters(params: InventoryExceptionParams): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string | undefined, empty = 'ALL') => { if (v && v !== empty && v.trim()) out[k] = v.trim(); };
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
  put('categorie', params.category);
  put('severite', params.severity);
  return out;
}

export class InventoryExceptionsService {
  /**
   * Colis à évaluer.
   *
   * Un colis terminé (livré, restitué, annulé) n'est suspect que s'il n'a
   * aucune trace : les colis en cours sont lus en priorité, LES PLUS ANCIENS
   * D'ABORD — ce sont eux que l'inventaire doit faire remonter. L'ancienne
   * lecture prenait les 2 000 plus récents, si bien qu'au-delà de ce volume les
   * colis réellement bloqués depuis longtemps disparaissaient de la liste.
   */
  private async scanCandidates(baseWhere: Record<string, unknown>) {
    const prisma = getPrisma();
    const terminal = TERMINAL_PACKAGE_STATUSES as unknown as string[];
    const [actifs, sansTrace] = await Promise.all([
      prisma.package.findMany({
        where: { AND: [baseWhere, { status: { notIn: terminal as never } }] },
        select: ROW_SELECT,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: MAX_SCAN,
      }),
      prisma.package.findMany({
        where: { AND: [baseWhere, { status: { in: terminal as never } }, { statusHistory: { none: {} } }] },
        select: ROW_SELECT,
        take: 500,
      }),
    ]);
    return [...actifs, ...sansTrace];
  }

  async list(params: InventoryExceptionParams = {}): Promise<InventoryExceptionListResult> {
    const prisma = getPrisma();
    const th = thresholdsFrom(params);
    const now = new Date();

    const baseWhere = buildBaseWhere(params);

    // Filtrage socle en base, puis évaluation de la suspicion en mémoire
    // sur un plafond `MAX_SCAN`. Évite le scan complet en mémoire quand
    // l'inventaire comptera des dizaines de milliers de lignes : le socle
    // (dépôt, recherche, statut) réduit déjà fortement le candidat.
    const candidates = await this.scanCandidates(baseWhere);

    const evaluated: { row: RawRow; eval: ReturnType<typeof evaluatePackage> }[] = [];
    for (const c of candidates) {
      const ev = evaluatePackage(c as unknown as RawRow, now, th);
      if (ev) evaluated.push({ row: c as unknown as RawRow, eval: ev });
    }

    // Filtres post-évaluation (catégorie / sévérité) — toujours côté serveur.
    let filtered = evaluated;
    if (params.category && params.category !== 'ALL') {
      const cat = params.category as InventoryExceptionCategory;
      if (Object.values(InventoryExceptionCategory).includes(cat)) {
        filtered = filtered.filter((e) => e.eval!.category === cat);
      } else {
        filtered = [];
      }
    }
    if (params.severity && params.severity !== 'ALL') {
      const sev = params.severity as InventoryExceptionSeverity;
      if (Object.values(InventoryExceptionSeverity).includes(sev)) {
        filtered = filtered.filter((e) => e.eval!.severity === sev);
      } else {
        filtered = [];
      }
    }

    // Tri : critique > haute > moyenne > basse, puis plus ancien en premier
    const severityRank: Record<string, number> = { critique: 0, haute: 1, moyenne: 2, basse: 3 };
    filtered.sort((a, b) => {
      const ra = severityRank[a.eval!.severity] ?? 9;
      const rb = severityRank[b.eval!.severity] ?? 9;
      if (ra !== rb) return ra - rb;
      return b.row.updatedAt.getTime() - a.row.updatedAt.getTime();
    });

    const total = filtered.length;
    const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
    const requested = params.limit && params.limit > 0 ? Math.floor(params.limit) : DEFAULT_LIMIT;
    const limit = Math.min(requested, MAX_LIMIT);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const slice = filtered.slice((page - 1) * limit, page * limit);

    const rows = slice.map(({ row, eval: ev }) => toExceptionRow(row, ev!));

    return {
      rows,
      total,
      page,
      limit,
      totalPages,
      appliedFilters: describeFilters(params),
      thresholds: th,
    };
  }

  async facets(params: InventoryExceptionParams = {}) {
    const prisma = getPrisma();
    const th = thresholdsFrom(params);
    const now = new Date();

    // Facettes socle (shippers, drivers, deposits) = même que inventaire, mais
    // scoped. Les compteurs de statuts restent sur le scope, pas sur les
    // exceptions, pour que le filtre reste utile même sans exception.
    const baseWhere = buildBaseWhere({ ...params, category: undefined, severity: undefined, status: undefined, search: undefined });
    // Pour les catégories/sevérités, il faut évaluer
    const candidates = await this.scanCandidates(baseWhere);
    const evaluated = candidates
      .map((c) => evaluatePackage(c as unknown as RawRow, now, th))
      .filter(Boolean) as { category: InventoryExceptionCategory; severity: InventoryExceptionSeverity }[];

    const byCategory = new Map<string, number>();
    const bySeverity = new Map<string, number>();
    const byStatus = new Map<string, number>();
    for (const ev of evaluated) {
      byCategory.set(ev.category, (byCategory.get(ev.category) ?? 0) + 1);
      bySeverity.set(ev.severity, (bySeverity.get(ev.severity) ?? 0) + 1);
    }
    // status facets from candidates' rows that are suspicious
    const statusCounts = new Map<string, number>();
    for (let i = 0; i < candidates.length; i++) {
      const ev = evaluatePackage(candidates[i] as unknown as RawRow, now, th);
      if (!ev) continue;
      const s = (candidates[i] as RawRow).status as string;
      statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
    }

    const scope: Record<string, unknown> = {};
    if (params.scope?.shipperId) scope.shipperId = params.scope.shipperId;
    if (params.scope?.assignedDriverId) scope.assignedDriverId = params.scope.assignedDriverId;
    if (params.scope?.depositId) scope.currentDepositId = params.scope.depositId;

    const [shippers, drivers, deposits] = await Promise.all([
      prisma.shipper.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, companyName: true }, orderBy: { companyName: 'asc' }, take: 200 }),
      prisma.driver.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, driverCode: true, user: { select: { fullName: true } } }, orderBy: { driverCode: 'asc' }, take: 200 }),
      prisma.deposit.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 }),
    ]);

    return {
      shippers: shippers.map((s) => ({ id: s.id, label: s.companyName })),
      drivers: drivers.map((d) => ({ id: d.id, label: `${d.driverCode} — ${d.user?.fullName ?? '—'}` })),
      deposits: deposits.map((d) => ({ id: d.id, label: d.name })),
      categories: Object.values(InventoryExceptionCategory).map((c) => ({
        value: c,
        label: EXCEPTION_CATEGORY_LABELS[c],
        count: byCategory.get(c) ?? 0,
      })),
      severities: Object.values(InventoryExceptionSeverity).map((s) => ({
        value: s,
        label: EXCEPTION_SEVERITY_LABELS[s],
        count: bySeverity.get(s) ?? 0,
      })),
      statuses: Object.values(PackageStatus).map((s) => ({
        value: s,
        label: PACKAGE_STATUS_LABELS[s] ?? s,
        count: statusCounts.get(s) ?? 0,
      })),
      totalExceptions: evaluated.length,
      totalScanned: candidates.length,
      thresholds: th,
    };
  }

  async getById(id: string, scope?: InventoryExceptionParams['scope']) {
    const prisma = getPrisma();
    const pkg = await prisma.package.findUnique({
      where: { id },
      select: {
        ...ROW_SELECT,
        statusHistory: { select: { id: true, status: true, title: true, description: true, locationName: true, operatorName: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        originDeposit: { select: { id: true, name: true } },
        destinationDeposit: { select: { id: true, name: true } },
        deliveryAttempts: { select: { id: true, result: true, reasonCode: true, attemptedAt: true, driverComment: true }, orderBy: { attemptedAt: 'desc' } },
      },
    });
    if (!pkg || pkg.deletedAt) return null;
    // scope check
    if (scope?.shipperId && pkg.shipperId !== scope.shipperId) return null;
    if (scope?.assignedDriverId && pkg.assignedDriverId !== scope.assignedDriverId) return null;
    if (scope?.depositId && pkg.currentDepositId !== scope.depositId) return null;

    const th = thresholdsFrom({});
    const now = new Date();
    // Narrow to RawRow for evaluation
    const ev = evaluatePackage(pkg as unknown as RawRow, now, th);
    // Even if not suspicious, we return detail (empty reasons) — UI affiche "Information indisponible" si besoin
    return {
      detail: pkg,
      exception: ev,
    };
  }
}

export const inventoryExceptionsService = new InventoryExceptionsService();
