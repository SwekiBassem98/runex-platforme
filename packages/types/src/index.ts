/**
 * @logixpress/types
 * Définition unifiée des types de domaine, énumérations et contrats d'API.
 * Partagé entre le Backend NestJS, le Frontend Web Next.js et l'application Mobile Livreur.
 */

// Les énumérations du colis sont réexportées plus bas (voir `package-status`)
// mais doivent aussi être dans la portée de ce fichier, les DTO de cette page
// s'y réfèrent directement.
import { PackageStatus, PackageType, PackageSize } from './package-status';
export {
  PackageStatus,
  PackageType,
  PackageSize,
  PACKAGE_STATUS_LABELS,
  packageStatusLabel,
} from './package-status';

export enum RoleType {
  ADMIN = 'ADMIN',
  GESTIONNAIRE = 'GESTIONNAIRE',
  EXPEDITEUR = 'EXPEDITEUR',
  LIVREUR = 'LIVREUR',
  AGENT_DEPOT = 'AGENT_DEPOT',
  FINANCE = 'FINANCE',
}

export enum PermissionCode {
  // Colis
  COLIS_READ = 'COLIS_READ',
  COLIS_CREATE = 'COLIS_CREATE',
  COLIS_UPDATE = 'COLIS_UPDATE',
  COLIS_CANCEL = 'COLIS_CANCEL',
  COLIS_ASSIGN = 'COLIS_ASSIGN',
  COLIS_DELIVER = 'COLIS_DELIVER',
  COLIS_RETURN = 'COLIS_RETURN',

  // Expéditeurs
  EXPEDITEUR_READ = 'EXPEDITEUR_READ',
  EXPEDITEUR_CREATE = 'EXPEDITEUR_CREATE',
  EXPEDITEUR_UPDATE = 'EXPEDITEUR_UPDATE',

  // Livreurs
  LIVREUR_READ = 'LIVREUR_READ',
  LIVREUR_CREATE = 'LIVREUR_CREATE',
  LIVREUR_UPDATE = 'LIVREUR_UPDATE',

  // Paiements & Finances
  PAYMENT_READ = 'PAYMENT_READ',
  PAYMENT_VALIDATE = 'PAYMENT_VALIDATE',
  PAYMENT_EXPORT = 'PAYMENT_EXPORT',
  /**
   * Caisse interne : les encaissements COD de la plateforme.
   *
   * Distinct de `PAYMENT_READ`, qui ouvre les bordereaux d'un expéditeur sur
   * ses propres colis. Confondre les deux donnerait à chaque expéditeur le
   * cash de tous les autres : le total encaissé, et le reliquat de chaque
   * livreur. C'est un relevé de la caisse, pas une donnée client.
   */
  PAYMENT_CASH_READ = 'PAYMENT_CASH_READ',
  /** Signer un encaissement : la caisse compte, elle ne se contente pas de lire. */
  PAYMENT_CASH_VALIDATE = 'PAYMENT_CASH_VALIDATE',

  // Runsheets
  RUNSHEET_READ = 'RUNSHEET_READ',
  RUNSHEET_CREATE = 'RUNSHEET_CREATE',
  RUNSHEET_VALIDATE = 'RUNSHEET_VALIDATE',

  // Rapports & Audits
  REPORT_READ = 'REPORT_READ',
  /**
   * Sortie d'un rapport hors de l'application.
   *
   * Séparé de `REPORT_READ` comme `INVENTORY_EXPORT` l'est de
   * `INVENTORY_READ` : lire un chiffre chez soi n'est pas le même acte que
   * l'emporter. Un expéditeur lit ses propres chiffres sans pouvoir en extraire
   * l'ensemble.
   */
  REPORT_EXPORT = 'REPORT_EXPORT',
  AUDIT_READ = 'AUDIT_READ',

  /**
   * Recherche opérationnelle transversale.
   *
   * Distincte de `COLIS_READ` : la recherche porte aussi sur les expéditeurs,
   * les livreurs, les runsheets et les dépôts. Lui accorder `COLIS_READ`
   * ouvrirait l'annuaire complet de la plateforme à quiconque peut déjà lire
   * des colis.
   */
  SEARCH_GLOBAL = 'SEARCH_GLOBAL',

  /**
   * Inventaire et historique complet des colis.
   *
   * `COLIS_READ` donne la liste du jour et les colis du moment. L'historique,
   * lui, permet de remonter le temps sans limite et de le croiser avec l'argent
   * — c'est le relevé d'audit de l'exploitation.
   */
  INVENTORY_READ = 'INVENTORY_READ',
  /**
   * Extraire l'inventaire hors du système.
   *
   * Séparé de `INVENTORY_READ` : consulter une liste et en copier le contenu
   * sont deux gestes différents. Un profil qui doit approuver des colis n'a pas
   * à pouvoir les extraire.
   */
  INVENTORY_EXPORT = 'INVENTORY_EXPORT',

  // Opérations Entrepôt
  DEPOT_SCAN = 'DEPOT_SCAN',
  /// Consulter le référentiel des dépôts et leur stock.
  DEPOT_READ = 'DEPOT_READ',
  /// Créer, modifier et désactiver un dépôt.
  DEPOT_MANAGE = 'DEPOT_MANAGE',
  INTERDEPOT_READ = 'INTERDEPOT_READ',
  INTERDEPOT_MANAGE = 'INTERDEPOT_MANAGE',

  // Ramassages
  RAMASSAGE_READ = 'RAMASSAGE_READ',
  RAMASSAGE_DEMANDE = 'RAMASSAGE_DEMANDE',
  RAMASSAGE_MANAGE = 'RAMASSAGE_MANAGE',

  /**
   * Administration des comptes.
   *
   * Aucune permission existante ne couvrait la gestion des utilisateurs :
   * `EXPEDITEUR_*` et `LIVREUR_*` portent sur les fiches métier (l'entreprise,
   * le chauffeur), pas sur les comptes qui s'y rattachent. Les trois codes sont
   * donc ajoutés, et réservés à l'administration.
   *
   * `USER_READ` est distinct des deux autres pour la même raison que partout
   * ailleurs dans cette énumération : lister les comptes et en créer sont deux
   * gestes qui n'engagent pas la même responsabilité. Un profil d'audit peut
   * avoir à lire sans jamais écrire.
   */
  USER_READ = 'USER_READ',
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: RoleType;
  permissions: PermissionCode[];
  shipperId?: string;
  shipperName?: string;
  driverId?: string;
  driverName?: string;
  depositId?: string;
  depositName?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export enum RunsheetStatus {
  BROUILLON = 'BROUILLON',
  PREPARE = 'PREPARE',
  ASSIGNE = 'ASSIGNE',
  EN_COURS = 'EN_COURS',
  TERMINE = 'TERMINE',
  VALIDE = 'VALIDE',
  ANNULE = 'ANNULE',
  // Compatibilité
  EN_ATTENTE = 'EN_ATTENTE',
  VALIDEE_DEPART = 'VALIDEE_DEPART',
  RETOUR_DEPOT = 'RETOUR_DEPOT',
  CLOTUREE_CONFORME = 'CLOTUREE_CONFORME',
  CLOTUREE_DEFICIT = 'CLOTUREE_DEFICIT',
  ANNULEE = 'ANNULEE',
}

export enum PickupStatus {
  A_CONFIRMER = 'A_CONFIRMER',
  EN_ATTENTE = 'EN_ATTENTE',
  ASSIGNE = 'ASSIGNE',
  EN_COURS = 'EN_COURS',
  EFFECTUE = 'EFFECTUE',
  ANNULE = 'ANNULE',
}

export enum InterDepotStatus {
  CRE = 'CRE',
  PREPARE = 'PREPARE',
  EN_TRANSIT = 'EN_TRANSIT',
  RECU = 'RECU',
  ANNULE = 'ANNULE',
}

/** Libellé français d'un statut de transfert inter-dépôts. */
export const INTER_DEPOT_STATUS_LABELS: Readonly<Record<InterDepotStatus, string>> = {
  CRE: 'Créé',
  PREPARE: 'Préparé',
  EN_TRANSIT: 'En transit',
  RECU: 'Reçu',
  ANNULE: 'Annulé',
};

/**
 * Cycle de vie d'un transfert inter-dépôts.
 *
 * Source de vérité unique, consommée par l'API (validation) et l'interface
 * (affichage des actions disponibles). Toute transition absente de cette
 * table est refusée par le backend avec une erreur 409.
 */
export const INTER_DEPOT_TRANSITIONS: Readonly<
  Record<InterDepotStatus, readonly InterDepotStatus[]>
> = {
  CRE: [InterDepotStatus.PREPARE, InterDepotStatus.EN_TRANSIT, InterDepotStatus.ANNULE],
  PREPARE: [InterDepotStatus.EN_TRANSIT, InterDepotStatus.ANNULE],
  EN_TRANSIT: [InterDepotStatus.RECU, InterDepotStatus.ANNULE],
  RECU: [],
  ANNULE: [],
};

/** Statuts de transfert à ne plus considerer comme « en cours ». */
export const INTER_DEPOT_OPEN_STATUSES: readonly InterDepotStatus[] = [
  InterDepotStatus.CRE,
  InterDepotStatus.PREPARE,
  InterDepotStatus.EN_TRANSIT,
];

/** Un statut de transfert est-il terminal ? */
export function isInterDepotTerminal(status: InterDepotStatus): boolean {
  return (INTER_DEPOT_TRANSITIONS[status] ?? []).length === 0;
}

/** La transition est-elle autorisée par le modèle métier ? */
export function canTransitionInterDepot(
  from: InterDepotStatus,
  to: InterDepotStatus
): boolean {
  return (INTER_DEPOT_TRANSITIONS[from] ?? []).includes(to);
}

/** État opérationnel d'un dépôt. */
export enum DepositStatus {
  ACTIF = 'ACTIF',
  MAINTENANCE = 'MAINTENANCE',
  FERME = 'FERME',
}

/** Libellé français d'un état de dépôt. */
export const DEPOSIT_STATUS_LABELS: Readonly<Record<DepositStatus, string>> = {
  ACTIF: 'Actif',
  MAINTENANCE: 'En maintenance',
  FERME: 'Fermé',
};

export enum PaymentMethod {
  ESPECE = 'ESPECE',
  CHEQUE = 'CHEQUE',
  VIREMENT = 'VIREMENT',
  TRAITE = 'TRAITE',
  // Réservés en base mais non proposés : ils rejoindront
  // `PAYMENT_METHOD_REGISTRY` le jour où le canal existera.
  CARTE_BANCAIRE = 'CARTE_BANCAIRE',
  PAIEMENT_EN_LIGNE = 'PAIEMENT_EN_LIGNE',
}

export enum PaymentVoucherStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  CONFIRME = 'CONFIRME',
  PAYE = 'PAYE',
  ANNULE = 'ANNULE',
}

/**
 * Cycle de vie d'un encaissement COD.
 *
 * Passer à `VALIDE` n'est pas un changement d'étiquette : c'est une
 * opération de caisse qui écrit le validateur et l'horodatage, et la base
 * refuse la ligne dès que l'un des deux manque. Aucun écran ne peut se
 * déclarer payé tout seul.
 */
export enum PaymentStatus {
  EN_ATTENTE = 'EN_ATTENTE',
  VALIDE = 'VALIDE',
  ECARTE = 'ECARTE',
  REMBOURSE = 'REMBOURSE',
  ANNULE = 'ANNULE',
}

/** Libellés français, pour les écrans et les messages d'erreur. */
export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  EN_ATTENTE: 'En attente de validation',
  VALIDE: 'Validé',
  ECARTE: 'Écarté',
  REMBOURSE: 'Remboursé',
  ANNULE: 'Annulé',
};

/**
 * Moyens de paiement effectivement proposés.
 *
 * La base en connaît d'autres — virement, traite, carte, paiement en ligne —
 * mais seuls ceux listés ici sont acceptés par l'API. C'est le point
 * d'extension : ajouter la carte revient à ajouter une entrée, sans
 * migration ni modification des écrans de saisie, qui lisent cette liste.
 */
export const PAYMENT_METHOD_REGISTRY = [
  {
    value: PaymentMethod.ESPECE,
    label: 'Espèces',
    /**
     * Un moyen sans référence n'a rien à rapprocher. Le chèque, lui, sans
     * numéro, est un papier que personne ne retrouvera.
     */
    requiresReference: false,
  },
  { value: PaymentMethod.CHEQUE, label: 'Chèque', requiresReference: true },
] as const satisfies readonly {
  value: PaymentMethod;
  label: string;
  requiresReference: boolean;
}[];

export type SupportedPaymentMethod = (typeof PAYMENT_METHOD_REGISTRY)[number]['value'];

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  ESPECE: 'Espèces',
  CHEQUE: 'Chèque',
  VIREMENT: 'Virement',
  TRAITE: 'Traite',
  CARTE_BANCAIRE: 'Carte bancaire',
  PAIEMENT_EN_LIGNE: 'Paiement en ligne',
};

/** Un moyen est-il utilisable par l'API ? */
export function isSupportedPaymentMethod(value: string): value is SupportedPaymentMethod {
  return PAYMENT_METHOD_REGISTRY.some((method) => method.value === value);
}

/** Ce moyen exige-t-il une référence de transaction ? */
export function paymentMethodRequiresReference(method: PaymentMethod): boolean {
  const entry = PAYMENT_METHOD_REGISTRY.find(
    (candidate) => candidate.value === (method as SupportedPaymentMethod)
  );
  return entry ? entry.requiresReference : false;
}


export enum NotificationType {
  COLIS_CREE = 'COLIS_CREE',
  COLIS_ASSIGNE = 'COLIS_ASSIGNE',
  PRIX_MODIFIE_URGENT = 'PRIX_MODIFIE_URGENT',
  COLIS_REPORTE = 'COLIS_REPORTE',
  COLIS_LIVRE = 'COLIS_LIVRE',
  RAMASSAGE_DEMANDE = 'RAMASSAGE_DEMANDE',
  RAMASSAGE_CONFIRME = 'RAMASSAGE_CONFIRME',
  RAMASSAGE_AFFECTE = 'RAMASSAGE_AFFECTE',
  RAMASSAGE_TERMINE = 'RAMASSAGE_TERMINE',
  RAMASSAGE_ANNULE = 'RAMASSAGE_ANNULE',
  RUNSHEET_CLOTUREE = 'RUNSHEET_CLOTUREE',
  PAIEMENT_DISPONIBLE = 'PAIEMENT_DISPONIBLE',
  SYSTEM_ALERT = 'SYSTEM_ALERT',
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    [key: string]: unknown;
  };
}

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: RoleType;
  agencyId?: string;
  agencyName?: string;
}

export interface PackageDto {
  id: string;
  trackingNumber: string;
  barcode: string;
  customerName: string;
  customerPhone: string;
  governorate: string;
  delegation: string;
  address: string;
  packageType: PackageType;
  status: PackageStatus;
  sizeCategory: PackageSize;
  pieceCount: number;
  contentSummary: string;
  allowOpen: boolean;
  totalPrice: number; // Montant TND
  collectedAmount: number;
  deliveryFee: number;
  shipperId: string;
  shipperName: string;
  assignedDriverId?: string;
  assignedDriverName?: string;
  runsheetNumber?: string;
  runsheetId?: string;
  pickupReference?: string;
  expectedDeliveryDate?: string;
  supplierContact?: string;
  driverNote?: string;
  returnedItemDescription?: string;
  returnedItemBarcode?: string;
  deliveredPieces?: number;
  /**
   * Où se trouve le colis, en clair. Toujours renseigné, contrairement à
   * `currentDepositId`/`currentDepositName` qui sont absents pendant un
   * transfert inter-dépôts : sans ce champ, un colis en route et un colis posé
   * au dépôt seraient indiscernables.
   */
  currentLocation?: string;
  /** Absents pour un colis en cours de transfert inter-dépôts. */
  currentDepositId?: string;
  currentDepositName?: string;
  notes?: string;
  paymentStatus?: 'NON_REGLE' | 'EN_BORDEREAU' | 'PAYE';
  isCancelled?: boolean;
  cancellationReason?: string;
  cancelledAt?: string;
  /**
   * Bilan d'une livraison partielle, quand elle a eu lieu.
   *
   * `deliveredPieces + returnedPieces` vaut toujours `pieceCount`, et
   * `amountCollected + amountReturned` vaut toujours `originalAmount`. Le
   * frontend peut donc afficher un bilan fermé sans refaire le calcul, et un
   * human peut le vérifier à l'œil.
   */
  partialDelivery?: PartialDeliveryRecord;
  /** Historique des retours de ce colis : un même colis peut revenir plusieurs fois. */
  returns?: ReturnRecord[];
  exchange?: ExchangeRecord;
  trackingTimeline?: TrackingTimelineEvent[];
  deliveryAttempts?: DeliveryAttempt[];
  auditLogs?: AuditModificationLog[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Bilan d'une livraison partielle.
 *
 * Les deux descriptions disent ce que le client a reçu et ce qui repart ;
 * les deux quantités disent combien ; les deux montants disent ce que
 * l'opération coûte. Les deux couples se ferment : sans cela, le dépôt et
 * le client seraient facturés de deux façons différentes.
 */
export interface PartialDeliveryRecord {
  /** Ce que le client a effectivement reçu. */
  deliveredDescription: string;
  /** Ce qui repart au dépôt et sera restitué. */
  returnedDescription: string;
  deliveredPieces: number;
  returnedPieces: number;
  /** Montant initialement dû pour l'ensemble du colis. */
  originalAmount: number;
  amountCollected: number;
  amountReturned: number;
  reason: string;
  driverId?: string;
  validatedAt: string;
}

/** Un retour au dépôt : ce que le livreur ramène, et où il le ramène. */
export interface ReturnRecord {
  id: string;
  returnNumber: string;
  reason: string;
  /** Ce que le livreur ramène, décrit pièce par pièce quand il en a une partie. */
  returnedItems?: string;
  returnedQuantity?: number;
  /** Montant ramené au dépôt, spécimen compris s'il y en avait. */
  amount?: number;
  returnDepositId: string;
  returnDepositName?: string;
  driverId?: string;
  driverName?: string;
  createdAt: string;
}

/** Un échange : l'article repris, l'article de remplacement, et ce que ça coûte. */
export interface ExchangeRecord {
  id: string;
  /** Colis d'origine, celui sur lequel l'échange est enregistré. */
  packageId: string;
  /** Article repris chez le client. */
  oldPackageBarcode: string;
  returnedItemSummary: string;
  /** Article de remplacement remis au client. */
  newPackageBarcode: string;
  /**
   * Écart financier : positif quand le client doit payer la différence,
   * négatif quand il y a droit à remboursement, nul à valeur égale.
   * Nul est un résultat, pas une absence d'information.
   */
  financialDifference?: number;
  driverId?: string;
  driverName?: string;
  createdAt: string;
}

/**
 * Livraison partielle : le livreur ne remet qu'une partie du contenu.
 *
 * Les quatre champs de description et de quantité sont tous requis. Une
 * livraison partielle dont on ne sait pas ce qui a été livré ni ce qui
 * repart n'est pas un bilan, c'est un trou : le dépôt réceptionne un
 * contenu qu'il ne peut pas rapprocher du dossier.
 */
export interface PartialDeliveryRequest {
  /** Pièces remises au client. Strictement entre 0 et `pieceCount`. */
  deliveredPieces: number;
  /** Ce que le client a reçu, décrit et non compté. */
  deliveredDescription: string;
  /** Ce qui repart au dépôt. */
  returnedDescription: string;
  /** Montant encaissé sur la part livrée. */
  collectedAmount: number;
  /**
   * Montant repris. Calculé par le système quand il est omis ; déclaré
   * quand il est fourni, et alors vérifié : les trois montants doivent se
   * fermer sur le montant dû.
   */
  returnedAmount?: number;
  reason: string;
  driverNote?: string;
  /** Moyen de paiement : `ESPECE` ou `CHEQUE` par défaut. */
  paymentMethod?: string;
  /** Référence du chèque, exigée si le moyen en réclame une. */
  transactionRef?: string;
}

/**
 * Retour au dépôt : le client refuse, le colis est refusé, ou la livraison
 * n'est plus possible.
 */
export interface ReturnRequest {
  reason: string;
  /** Ce que le livreur ramène, quand il n'est pas obvious d'après le colis. */
  returnedItems?: string;
  /**
   * Pièces ramenées. Par défaut, tout le colis : un retour est en pratique
   * toujours total, et « tout le colis » est un fait, pas une estimation.
   */
  returnedQuantity?: number;
  /**
   * Montant ramené au dépôt, spécimen compris s'il y en avait. Par défaut,
   * ce que le livreur transporte déjà.
   */
  amount?: number;
  driverNote?: string;
}

/** Échange : un article repris, un article de remplacement remis sur-le-champ. */
export interface ExchangeRequest {
  /** Article repris chez le client, décrit et codé. */
  oldPackageBarcode: string;
  returnedItemSummary: string;
  /** Article de remplacement remis au client. */
  newPackageBarcode: string;
  /**
   * Écart financier de l'échange. À fournir quand il n'est pas nul : un
   * échange à valeur égale n'a pas d'écart, un échange au rabais en a un.
   */
  financialDifference?: number;
  note?: string;
}

/** Report : la livraison est repoussée, le motif et la reprise sont datés. */
export interface PostponeRequest {
  reason: string;
  /** Date de la prochaine tentative. */
  rescheduledDate?: string;
  /** Ce que le livreur retient pour la tournée. */
  driverNote?: string;
  /** Ce que le client a été dit, et qu'on aura à lui redire. */
  customerNote?: string;
}

export interface TrackingTimelineEvent {
  timestamp: string;
  status: PackageStatus;
  label: string;
  location: string;
  actor?: string;
  notes?: string;
}

export interface DeliveryAttempt {
  id?: string;
  attemptNumber: number;
  timestamp: string;
  driverName: string;
  status: 'LIVRE' | 'REPORTE' | 'ECHEC';
  /**
   * Motif normalisé de l'échec, distinct du commentaire libre du livreur.
   *
   * C'est le champ qui agrège : taux d'échec par motif, par zone, par
   * livreur. Un motif libre ne permet aucun de ces découpages.
   */
  reasonCode?: 'INJOIGNABLE' | 'ADRESSE_INCORRECTE' | 'PAS_D_ARGENT' | 'REFUSEE';
  /** Durée de l'appel au destinataire : preuve que le client a été contacté. */
  callDurationSeconds?: number;
  reason?: string;
  /** Ce que le client a été dit sur cette tentative. */
  customerNote?: string;
  /** Date de la reprise, quand le colis a été reporté. */
  rescheduledFor?: string;
  customerContacted: boolean;
  notes?: string;
}

export interface AuditModificationLog {
  id: string;
  timestamp: string;
  modifiedBy: string;
  userRole: string;
  changes: {
    field: string;
    fieldLabel: string;
    oldValue: any;
    newValue: any;
  }[];
  driverNotified: boolean;
  notificationMessage?: string;
  reason?: string;
}

export interface RunsheetSummaryDto {
  id: string;
  runsheetNumber: string;
  driverId: string;
  driverName: string;
  depositId: string;
  depositName: string;
  status: RunsheetStatus;
  tourDate: string;
  totalPackages: number;
  totalPieces: number;
  pendingCount: number;
  deliveredCount: number;
  postponedCount: number;
  returnedCount: number;
  expectedCash: number;
  collectedCash: number;
  collectedChecks: number;
  deficitAmount: number;
  failedCount?: number;
  notes?: string;
  packages?: PackageDto[];
  validatedAt?: string;
  closedAt?: string;
  createdAt: string;
}

export interface PickupAppointmentDto {
  id: string;
  referenceNumber: string;
  shipperId: string;
  shipperName: string;
  scheduledDate: string;
  timeSlotStartHour: number;
  timeSlotEndHour: number;
  pickupAddress: string;
  contactPerson: string;
  contactPhone: string;
  /**
   * Quantité annoncée par l'expéditeur à la demande du rendez-vous. C'est un
   * engagement, jamais un relevé : elle n'est pas réécrite à la clôture.
   */
  packageEstimate: number;
  /**
   * Quantité réellement collectée, déduite des colis rattachés au rendez-vous.
   * Un client ne peut pas la déclarer : le serveur la recalcule à partir de la
   * relation, faute de quoi un ramassage annoncerait 15 colis pour 10 reality.
   */
  actualPickedCount: number;
  /**
   * Écart estimation / réel, conservé tel quel : c'est un fait opérationnel
   * (marchandise annoncée non présentée) et non une erreur de saisie à
   * corriger. Nul quand les deux concordent.
   */
  quantityDiscrepancy: number;
  /** Colis rattachés au rendez-vous, pour l'affichage du détail. */
  packages?: PickupPackageRef[];
  status: PickupStatus;
  assignedDriverId?: string;
  assignedDriverName?: string;
  notes?: string;
  createdAt: string;
  confirmedAt?: string;
  completedAt?: string;
}

/** Colis rattaché à un ramassage : la trace de ce qui a été réellement collecté. */
export interface PickupPackageRef {
  id: string;
  trackingNumber: string;
  status: PackageStatus;
  customerName: string;
  totalPrice: number;
}

/**
 * Un montant, tel qu'il circule entre l'API et les écrans.
 *
 * Une chaîne, et non un nombre. `58.10` écrit en JSON redevient un flottant
 * chez le navigateur et peut s'afficher `58.099999999999994` dans un rapport
 * de caisse. La chaîne préserve l'exactitude affichée ; c'est la base, en
 * `NUMERIC`, qui fait foi.
 */
export type Money = string;

export interface PaymentDto {
  id: string;
  paymentNumber: string;
  status: PaymentStatus;
  method: PaymentMethod;

  packageId: string;
  packageTrackingNumber: string;
  shipperId: string;
  shipperName: string;
  runsheetId?: string;
  runsheetNumber?: string;
  driverId?: string;
  driverName?: string;

  /** Ce que le client devait laisser. */
  amountExpected: Money;
  /** Ce que le livreur a réellement pris. */
  amountCollected: Money;
  /** Ce qui a été rendu au client. */
  amountRefunded: Money;
  deliveryFee: Money;
  /**
   * Reste dû : `expected − collected − refunded`. Un montant nul ne veut pas
   * dire « tout est rentré » — un écart peut être nul des deux côtés. C'est
   * pourquoi `isBalanced` existe à côté.
   */
  amountOutstanding: Money;
  /** Le bilan se referme-t-il ? Base de la validation. */
  isBalanced: boolean;

  collectedAt: string;
  validatedAt?: string;
  validatedByUserId?: string;
  validatedByName?: string;
  transactionRef?: string;
  discrepancyReason?: string;
  notes?: string;
  createdAt: string;
}

/** Les cinq chiffres que la caisse regarde chaque jour. */
export interface PaymentSummaryDto {
  totalExpected: Money;
  totalCollected: Money;
  totalRefunded: Money;
  totalDeliveryFees: Money;
  /** Pris par les livreurs, pas encore validés : la caisse en est responsable. */
  pending: Money;
  pendingCount: number;
  validated: Money;
  validatedCount: number;
  /** Écart cumulé entre dû et encaissé, tous statuts confondus. */
  discrepancy: Money;
  discrepancyCount: number;
  byStatus: Record<string, { count: number; collected: Money }>;
}

/** Cumul d'encaissements pour un expéditeur. */
export interface ShipperPaymentsDto {
  shipperId: string;
  shipperName: string;
  count: number;
  totalExpected: Money;
  totalCollected: Money;
  pending: Money;
  validated: Money;
  discrepancy: Money;
  discrepancyCount: number;
}

/** Cumul d'encaissements pour un livreur. */
export interface DriverPaymentsDto {
  driverId: string;
  driverName: string;
  count: number;
  totalCollected: Money;
  pending: Money;
  validated: Money;
  discrepancy: Money;
  discrepancyCount: number;
}

/** Action de caisse : valider, écarter ou rembourser. Jamais « poser paid ». */
export interface PaymentValidationRequest {
  /** Référence de chèque ou de virement, exigée pour ces moyens. */
  transactionRef?: string;
  notes?: string;
}

export interface PaymentRejectionRequest {
  /** Obligatoire : un écart sans motif n'est qu'un chiffre qu'on ne regarde pas. */
  reason: string;
  notes?: string;
}

export interface PaymentRefundRequest {
  /** Montant rendu au client, au millième. */
  amount: string;
  reason: string;
}

export interface PaymentVoucherDto {
  id: string;
  voucherNumber: string;
  shipperId: string;
  shipperName: string;
  status: PaymentVoucherStatus;
  paymentMethod: PaymentMethod;
  deliveredCount: number;
  returnedCount: number;
  grossCashCollected: number;
  grossChecksCollected: number;
  deliveryFeesTotal: number;
  returnFeesTotal: number;
  withholdingTaxTotal: number;
  netPayable: number;
  scheduledDate?: string;
  paidAt?: string;
  createdAt: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  services: {
    api: { status: 'up' };
    database: {
      status: 'up' | 'down';
      latencyMs?: number;
      /** Raison de l'indisponibilité (message d'erreur brut du client). */
      message?: string;
    };
    redis: {
      status: 'up' | 'down';
      latencyMs?: number;
      /** `true` si l'API ne peut pas fonctionner sans Redis (REDIS_REQUIRED). */
      required?: boolean;
      message?: string;
    };
    /** Canal temps réel des notifications, et nombre d'écrans connectés. */
    realtime: {
      status: 'up' | 'down';
      sockets: number;
    };
  };
  version: string;
}

// Machine à états et règles d'édition des colis : source de vérité partagée
// entre l'API (validation) et le frontend (affichage des actions possibles).
export * from './package-workflow';

// Catalogue des événements notifiés : partagé par l'API (producteur) et le
// frontend (centre de notifications).
export * from './notifications';

// Catalogue du journal d'audit : codes d'actions, libellés et familles.
// Partagé pour qu'un filtre de l'écran et une requête du serveur ne puissent
// pas diverger sur ce qu'est une action.
export * from './audit';
export * from './reports';
