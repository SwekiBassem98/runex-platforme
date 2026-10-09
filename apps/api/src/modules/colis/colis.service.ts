/**
 * Service métier « Colis ».
 *
 * Toute la logique de cycle de vie du colis vit ici : création, affectation,
 * suivi, livraisons, retours, annulation. Les données sont persistées dans
 * PostgreSQL via Prisma ; l'historique complet est écrit dans
 * `PackageTimeline` à chaque changement de statut.
 *
 * Deux règles structurent le module :
 *
 *  1. **Transitions explicites** — un changement de statut passe par
 *     `applyStatusChange`, qui refuse toute transition absente de la table
 *     partagée `PACKAGE_STATUS_TRANSITIONS`.
 *  2. **Droits d'édition** — l'expéditeur maîtrise son colis tant qu'il n'est
 *     ni reçu au dépôt ni affecté à un livreur ; au-delà, la modification est
 *     restreinte, tracée, et notifiée au chauffeur.
 */

import { resolveDestinationDepositId, resolveShipperDepositId } from '../../common/routing/deposit-routing';
import { packageCodeWhere } from '../../common/scan/package-code';
import { Prisma, PackageStatus as PrismaPackageStatus } from '@prisma/client';
import {
  PackageStatus,
  PackageType,
  PackageSize,
  RoleType,
  canTransition,
  isTerminalStatus,
  isLockedForEditing,
  isFullyEditableByShipper,
  isRestrictedForShipper,
  canShipperCancelOrDelete,
  allowedNextStatuses,
  CRITICAL_EDITABLE_FIELDS,
  FIELD_LABELS,
  NotificationEvent,
  packageStatusLabel,
  PaymentStatus,
  PACKAGE_SIZE_SHORT_LABELS,
  BON_LIVRAISON_RIEN_A_SIGNALER,
  pieceBarcode,
} from '@logixpress/types';
import type {
  BonLivraisonDto,
  BonLivraisonLigne,
  PackageDto,
  PartialDeliveryRequest,
  ReturnRequest,
  ExchangeRequest,
  PostponeRequest,
} from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { cashService, toDecimal } from '../payments/cash.service';
import { runsheetsService } from '../runsheets/runsheets.service';
import { periode } from '../../common/dates/periode';
import { nextCustomerCode, nextReturnNumber } from '../../common/database/numbering';
import { toPackageDto, PACKAGE_INCLUDE, type PackageWithRelations } from '../../common/database/mappers';
import { auditService } from '../../common/audit/audit.service';
import { zonesService } from '../zones/zones.service';
import { notificationService } from '../../common/notifications/notification.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import { BusinessRuleError } from '../../common/errors/api-error';
import {
  packageWorkflowService,
  type TransitionCommand,
} from './package-workflow.service';
import { generateBusinessNumber, barcodeFor } from '../depot/package-identity';

export interface ScopeFilter {
  shipperId?: string;
  assignedDriverId?: string;
  depositId?: string;
}

export interface ColisFilterParams {
  search?: string;
  status?: string;
  city?: string;
  /** Zone de livraison (identifiant). */
  zone?: string;
  driver?: string;
  type?: string;
  paymentStatus?: string;
  date?: string;
  page?: number;
  limit?: number;
  scope?: ScopeFilter;
}

/** Acteur exécutant une action de livraison. */
export interface DriverActor {
  id?: string;
  fullName: string;
  role: RoleType;
  driverId?: string;
}

/** Convertit un statut issu du schéma Prisma en statut partagé.
 *
 * Les deux énumérations portent les mêmes valeurs ; TypeScript les traite
 * néanmoins comme des types distincts, d'où la conversion explicite.
 */
function toSharedStatus(status: PrismaPackageStatus): PackageStatus {
  return status as unknown as PackageStatus;
}

/** Le statut existe-t-il dans la machine à états ? */
function isPackageStatus(value: string): value is PackageStatus {
  return (Object.values(PackageStatus) as string[]).includes(value);
}

/**
 * Construit le filtre permettant de retrouver un colis par UUID **ou** par
 * numéro de suivi / code-barres.
 *
 * Le test de format est indispensable : demander `id: '260929900002'` fait
 * échouer PostgreSQL (« invalid length: expected length 32 »), la valeur
 * étant inevitably convertie en UUID. On n'interroge donc la colonne `id`
 * que pour une valeur qui en a effectivement la forme.
 */
function packageIdentifierWhere(identifier: string): Prisma.PackageWhereInput {
  // UUID, numéro de suivi, code-barres ou étiquette de pièce (`code-N`) :
  // le code lu sur le bon de livraison mène toujours au colis.
  return packageCodeWhere(identifier);
}

/**
 * Localisation d'un colis pour sa chronologie.
 *
 * Un colis en cours de transfert inter-dépôts n'appartient plus à aucun
 * dépôt : le dire explicitement vaut mieux qu'afficher le dernier dépôt
 * connu, qui ferait croire à une présence locale inexistante.
 */
function packageLocation(record: {
  currentDeposit: { name: string } | null;
  interDepotTransfer: { transferNumber: string } | null;
}): string {
  if (record.currentDeposit) return record.currentDeposit.name;
  if (record.interDepotTransfer) {
    return `En transfert ${record.interDepotTransfer.transferNumber}`;
  }
  return 'En transit';
}

/** Nombre de passages autorisés chez le destinataire avant retour au dépôt. */
const MAX_DELIVERY_ATTEMPTS = 3;

/**
 * Arrondi au millième, la précision des colonnes `Decimal(10,3)`.
 *
 * Les montants sont saisis par des humains et calculés en flottant : 58.5
 * moins 40.1 vaut 18.400000000000006 en JavaScript. Écrit tel quel, un bilan
 * pourtant juste se retrouve refusé par la contrainte SQL qui exige que
 * l'encaissé et le repris s'additionnent exactement. Arrondir avant d'écrire
 * est donc la condition pour que l'égalité tienne.
 */
/** Date facultative saisie par le livreur ; une valeur illisible est refusée. */
function parseOptionalDate(value: unknown, label: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new BusinessRuleError(`Le champ « ${label} » n'est pas une date valide.`, 400);
  }
  return date;
}

/** Statuts où un colis est entre les mains d'un livreur ou en transfert : pas de réaffectation. */
const NOT_REASSIGNABLE: PackageStatus[] = [
  PackageStatus.EN_COURS_LIVRAISON,
  PackageStatus.LIVRAISON_PARTIELLE,
  PackageStatus.EN_LOT_INTER_DEPOT,
  PackageStatus.EN_TRANSIT_INTER_DEPOT,
  PackageStatus.EN_RUNSHEET_RETOUR,
  PackageStatus.RETOUR_DEPOT,
];

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * Motifs d'échec de livraison, et leur conséquence par défaut.
 *
 * Un défaut temporaire (le client ne répond pas) se rejoue ; un défaut de
 * fond (mauvaise adresse, refus de payer, refus du colis) ne se rejoue pas
 * sans intervention : inutile de présenter trois fois un colis dont personne
 * ne veut. D'où `DEFENSIVE_REASONS`, qui bascule automatiquement en échec
 * définitif quand le livreur ne tranche pas lui-même.
 */
export type FailedDeliveryReason =
  | 'INJOIGNABLE'
  | 'ADRESSE_INCORRECTE'
  | 'PAS_D_ARGENT'
  | 'REFUSEE';

const FAILED_DELIVERY_REASONS: readonly FailedDeliveryReason[] = [
  'INJOIGNABLE',
  'ADRESSE_INCORRECTE',
  'PAS_D_ARGENT',
  'REFUSEE',
];

const DEFENSIVE_REASONS = new Set<FailedDeliveryReason>([
  'ADRESSE_INCORRECTE',
  'PAS_D_ARGENT',
  'REFUSEE',
]);

const FAILED_DELIVERY_LABELS: Record<FailedDeliveryReason, string> = {
  INJOIGNABLE: 'Destinataire injoignable',
  ADRESSE_INCORRECTE: 'Adresse introuvable ou incorrecte',
  PAS_D_ARGENT: 'Destinataire sans espèces suffisantes',
  REFUSEE: 'Livraison refusée par le destinataire',
};

/** Erreur métier portant le code HTTP approprié.
 *
 * Réexportée depuis `common/errors` : le service domaine et ce module doivent
 * partager la même classe, sans créer de cycle d'import entre eux.
 */
export { BusinessRuleError } from '../../common/errors/api-error';
/**
 * Empêche un livreur d'agir sur un colis qui ne lui est pas affecté.
 *
 * Les rôles de bureau interviennent sur l'ensemble du parc ; le livreur est
 * cantonné à ses propres colis. Le service domaine rejoue cette règle à
 * l'écriture ; celle-ci permet d'échouer avant toute requête supplémentaire,
 * avec un message qui parle du colis et non de la machine à états.
 */
function assertDriverOwnsPackage(pkg: { assignedDriverId: string | null }, user: DriverActor): void {
  if (user.role === RoleType.ADMIN || user.role === RoleType.GESTIONNAIRE) return;
  if (user.role !== RoleType.LIVREUR) {
    // Défense en profondeur : la route l'interdit déjà. Un expéditeur ou un
    // autre profil ne déclare jamais un événement de livraison.
    throw new BusinessRuleError("Action réservée au livreur affecté ou à l'exploitation.", 403);
  }
  if (!user.driverId || !pkg.assignedDriverId || pkg.assignedDriverId !== user.driverId) {
    throw new BusinessRuleError("Ce colis n'est pas affecté à ce livreur.", 403);
  }
}

export class ColisService {
  private get prisma() {
    return getPrisma();
  }

  /* ---------------------------------------------------------------- */
  /* Lecture                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Construit le filtre Prisma à partir des critères de recherche et du
   * périmètre de l'utilisateur connecté.
   *
   * Le périmètre est appliqué ici, et non dans le contrôleur : c'est la seule
   * façon de garantir qu'un expéditeur ne peut pas élargir sa visibilité via
   * un paramètre de requête.
   */
  private buildWhere(params: ColisFilterParams): Prisma.PackageWhereInput {
    const where: Prisma.PackageWhereInput = { deletedAt: null };
    const and: Prisma.PackageWhereInput[] = [];

    if (params.scope?.shipperId) {
      and.push({ shipperId: params.scope.shipperId });
    }
    if (params.scope?.assignedDriverId) {
      and.push({ assignedDriverId: params.scope.assignedDriverId });
    }
    if (params.scope?.depositId) {
      and.push({ currentDepositId: params.scope.depositId });
    }

    if (params.search?.trim()) {
      const term = params.search.trim();
      and.push({
        OR: [
          { trackingNumber: { contains: term, mode: 'insensitive' } },
          { barcode: { contains: term, mode: 'insensitive' } },
          { shipperReference: { contains: term, mode: 'insensitive' } },
          { contentSummary: { contains: term, mode: 'insensitive' } },
          { customer: { fullName: { contains: term, mode: 'insensitive' } } },
          { customer: { primaryPhone: { contains: term } } },
        ],
      });
    }

    if (params.status && params.status !== 'ALL') {
      // Un filtre de statut arrive d'un paramètre de requête : le laisser
      // passer tel quel fait échouer Prisma sur une valeur absente de
      // l'énumération, et la recherche entière répond 500. Un filtre inconnu
      // doit ne rien retourner, pas casser la page. Le faux identifiant est
      // un UUID valide : `id` est une colonne UUID, et une chaîne libre y
      // provoquerait à son tour l'erreur qu'on cherche ici à éviter.
      if (isPackageStatus(params.status)) {
        and.push({ status: params.status as unknown as PrismaPackageStatus });
      } else {
        and.push({ id: '00000000-0000-0000-0000-000000000000' });
      }
    }
    if (params.type && params.type !== 'ALL') {
      and.push({ packageType: params.type as PackageType });
    }
    if (params.city && params.city !== 'ALL') {
      and.push({ customerAddress: { governorate: params.city } });
    }
    if (params.zone && params.zone !== 'ALL') {
      // Identifiant non UUID : aucun résultat plutôt qu'une erreur SQL.
      and.push(
        /^[0-9a-f-]{36}$/i.test(params.zone)
          ? { customerAddress: { zoneId: params.zone } }
          : { id: '00000000-0000-0000-0000-000000000000' }
      );
    }
    if (params.driver && params.driver !== 'ALL') {
      and.push({ assignedDriver: { driverCode: params.driver } });
    }
    // Ce filtre était lu par le contrôleur puis ignoré : la liste affichait
    // tous les colis en laissant croire qu'elle était filtrée. Un filtre
    // silencieusement inopérant est plus dangereux qu'un filtre absent.
    if (params.paymentStatus && params.paymentStatus !== 'ALL') {
      if (params.paymentStatus === 'TOUS') {
        and.push({ payment: { is: null } });
      } else if (Object.values(PaymentStatus).includes(params.paymentStatus as PaymentStatus)) {
        and.push({ payment: { is: { status: params.paymentStatus as PaymentStatus } } });
      } else {
        and.push({ id: '00000000-0000-0000-0000-000000000000' });
      }
    }
    if (params.date) {
      // Journée de Tunis, indépendante du fuseau du serveur (UTC en conteneur).
      const range = periode(params.date, params.date);
      if (range) and.push({ createdAt: range });
      else and.push({ id: '00000000-0000-0000-0000-000000000000' });
    }

    if (and.length > 0) where.AND = and;
    return where;
  }

  async findAll(params: ColisFilterParams = {}) {
    const where = this.buildWhere(params);
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 200) : 20;

    const [total, records] = await Promise.all([
      this.prisma.package.count({ where }),
      this.prisma.package.findMany({
        where,
        include: PACKAGE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      packages: records.map(toPackageDto),
      total,
      page,
      limit,
    };
  }

  /**
   * Recherche un colis par identifiant interne ou par numéro de suivi /
   * code-barres, en respectant le périmètre de l'utilisateur.
   */
  async findById(idOrTracking: string, scope?: ScopeFilter): Promise<PackageDto | null> {
    const record = await this.prisma.package.findFirst({
      where: {
        deletedAt: null,
        AND: [
          packageIdentifierWhere(idOrTracking),
          ...(scope?.shipperId ? [{ shipperId: scope.shipperId }] : []),
          ...(scope?.assignedDriverId ? [{ assignedDriverId: scope.assignedDriverId }] : []),
          ...(scope?.depositId
            ? [{ OR: [{ currentDepositId: scope.depositId }, { destinationDepositId: scope.depositId }] }]
            : []),
        ],
      },
      include: PACKAGE_INCLUDE,
    });

    return record ? toPackageDto(record) : null;
  }

  /**
   * Bons de livraison : l'étiquette A4 imprimée et collée sur chaque pièce.
   *
   * Tout ce que porte le bon vient de la base, dans le périmètre de
   * l'utilisateur : l'expéditeur (nom, téléphone, matricule fiscal, adresse),
   * le destinataire, l'agence de départ et celle qui livre, et le transporteur
   * (raison sociale et matricule fiscal de la société). Les identifiants
   * hors périmètre ou inconnus sont simplement absents du résultat.
   */
  async bonsLivraison(identifiers: string[], scope?: ScopeFilter): Promise<BonLivraisonDto[]> {
    const wanted = [...new Set(identifiers.map((v) => String(v).trim()).filter(Boolean))];
    if (wanted.length === 0) return [];
    const records = await this.prisma.package.findMany({
      where: {
        deletedAt: null,
        AND: [
          { OR: wanted.map((identifier) => packageIdentifierWhere(identifier)) },
          ...(scope?.shipperId ? [{ shipperId: scope.shipperId }] : []),
          ...(scope?.assignedDriverId ? [{ assignedDriverId: scope.assignedDriverId }] : []),
          ...(scope?.depositId
            ? [{ OR: [{ currentDepositId: scope.depositId }, { destinationDepositId: scope.depositId }] }]
            : []),
        ],
      },
      include: {
        shipper: true,
        customer: true,
        customerAddress: true,
        items: { orderBy: { createdAt: 'asc' } },
        originDeposit: { include: { company: true } },
        destinationDeposit: true,
      },
    });

    // Ordre de la demande : on imprime dans l'ordre où l'utilisateur a choisi.
    const rank = (r: { id: string; trackingNumber: string; barcode: string }) => {
      const i = wanted.findIndex((w) => w === r.id || w === r.trackingNumber || w === r.barcode);
      return i < 0 ? wanted.length : i;
    };
    records.sort((a, b) => rank(a) - rank(b));

    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    return records.map((r) => {
      const total = round3(Number(r.totalPrice));
      const pieceCount = Math.max(1, r.pieceCount);
      // Lignes détaillées seulement quand elles sont chiffrées et qu'elles
      // tombent juste sur le montant à encaisser ; sinon une seule ligne,
      // le contenu déclaré pour le montant total — le bon ne doit jamais
      // annoncer une somme différente de celle que le livreur encaisse.
      const priced = r.items.filter((it) => it.unitPrice !== null && !it.isReturned);
      const pricedSum = round3(priced.reduce((acc, it) => acc + it.quantity * Number(it.unitPrice), 0));
      const lines: BonLivraisonLigne[] =
        priced.length > 0 && priced.length === r.items.length && Math.abs(pricedSum - total) < 0.0005
          ? priced.map((it) => {
              const unit = round3(Number(it.unitPrice));
              const ttc = round3(unit * it.quantity);
              return { designation: it.description, quantity: it.quantity, unitPriceHT: unit, vatRate: 0, vatAmount: 0, totalTTC: ttc };
            })
          : [{ designation: r.contentSummary, quantity: 1, unitPriceHT: total, vatRate: 0, vatAmount: 0, totalTTC: total }];
      const company = r.originDeposit.company;
      return {
        packageId: r.id,
        number: r.trackingNumber,
        barcode: r.barcode,
        date: r.createdAt.toISOString(),
        sizeCategory: r.sizeCategory as unknown as BonLivraisonDto['sizeCategory'],
        sizeShort: PACKAGE_SIZE_SHORT_LABELS[r.sizeCategory as unknown as BonLivraisonDto['sizeCategory']] ?? r.sizeCategory,
        pieceCount,
        pieces: Array.from({ length: pieceCount }, (_, i) => ({
          index: i + 1,
          code: pieceCount > 1 ? pieceBarcode(r.barcode, i + 1) : r.barcode,
        })),
        originAgency: r.originDeposit.name,
        destinationAgency: r.destinationDeposit.name,
        governorate: r.customerAddress.governorate,
        delegation: r.customerAddress.delegation,
        shipper: {
          name: r.shipper.brandName ?? r.shipper.companyName,
          phone: r.shipper.phone,
          taxId: r.shipper.taxId ?? undefined,
          address: r.shipper.address,
          governorate: r.shipper.governorate,
        },
        recipient: {
          name: r.customer.fullName,
          phone: r.customer.primaryPhone,
          phoneSecondary: r.customer.secondaryPhone ?? undefined,
          address: r.customerAddress.streetAddress,
          governorate: r.customerAddress.governorate,
          delegation: r.customerAddress.delegation,
        },
        remark: r.shipperNotes?.trim() || BON_LIVRAISON_RIEN_A_SIGNALER,
        allowOpen: r.allowOpen,
        isFragile: r.isFragile,
        lines,
        total,
        carrier: { name: company.legalName, taxRegistration: company.taxRegistration ?? undefined },
      };
    });
  }

  /** Variante donnant accès à l'enregistrement complet (usage interne). */
  private async findRecord(idOrTracking: string): Promise<PackageWithRelations> {
    const record = await this.prisma.package.findFirst({
      where: { deletedAt: null, AND: [packageIdentifierWhere(idOrTracking)] },
      include: PACKAGE_INCLUDE,
    });
    if (!record) throw new BusinessRuleError('Colis introuvable.', 404);
    return record;
  }

  /* ---------------------------------------------------------------- */
  /* Écriture : utilitaires                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Applique un changement de statut en déléguant au service domaine.
   *
   * Cette méthode ne décide plus rien : elle ne fait que traduire l'événement
   * constaté par le module en commande de transition. La légalité, les
   * justifications exigées et l'écriture de la chronologie et de l'audit
   * appartiennent à `PackageWorkflowService`, seul auteur du statut.
   */
  private async applyStatusChange(
    packageId: string,
    to: PackageStatus,
    context: {
      actorName: string;
      role: RoleType;
      actorId?: string;
      driverId?: string;
      title: string;
      description?: string;
      reason?: string;
      locationName?: string;
      deliveredContent?: string;
      returnedContent?: string;
      collectedAmount?: number;
      returnedAmount?: number;
      runsheetNumber?: string;
      transferNumber?: string;
      note?: string;
      auditAction?: string;
      data?: Prisma.PackageUncheckedUpdateInput;
      /** Transaction de l'appelant : la notification est alors à sa charge, après validation. */
      client?: Prisma.TransactionClient;
    },
    options: { allowSameStatus?: boolean } = {}
  ): Promise<void> {
    const command: TransitionCommand = {
      packageId,
      to,
      actor: {
        id: context.actorId,
        fullName: context.actorName,
        role: context.role,
        driverId: context.driverId,
      },
      title: context.title,
      note: context.note ?? context.description,
      reason: context.reason,
      location: context.locationName,
      deliveredContent: context.deliveredContent,
      returnedContent: context.returnedContent,
      collectedAmount: context.collectedAmount,
      returnedAmount: context.returnedAmount,
      runsheetNumber: context.runsheetNumber,
      transferNumber: context.transferNumber,
      data: context.data,
      auditAction: context.auditAction,
      allowSameStatus: options.allowSameStatus,
      client: context.client,
    };
    await packageWorkflowService.transition(command);
    if (context.client) return;
    if (options.allowSameStatus !== true) {
      await this.notifyStatusChanged(packageId, to, context.actorName, context.actorId);
    }
  }

  /**
   * Notification « statut modifié », envoyée une fois l'écriture validée.
   *
   * Elle n'est jamais émise depuis l'intérieur d'une transaction : un échec de
   * diffusion ne doit pas annuler un geste métier, et un geste annulé ne doit
   * pas avoir été annoncé.
   */
  private async notifyStatusChanged(
    packageId: string,
    to: PackageStatus,
    actorName: string,
    actorId?: string
  ): Promise<void> {
    const fresh = await this.prisma.package.findUnique({
      where: { id: packageId },
      select: { trackingNumber: true },
    });
    if (!fresh) return;
    await notificationDispatcher.notify({
      event: NotificationEvent.DELIVERY_STATUS_CHANGED,
      title: 'Statut de livraison modifié',
      content: `${actorName} a porté le colis #${fresh.trackingNumber} au statut « ${packageStatusLabel(to)} ».`,
      relatedEntity: 'PACKAGE',
      relatedEntityId: packageId,
      packageId,
      actorUserId: actorId ?? null,
    });
  }

  /**
   * Livreur au titre duquel un événement de livraison est enregistré.
   *
   * Le livreur agit pour lui-même ; l'exploitation agit pour le livreur affecté
   * au colis. Un colis confié à personne ne peut pas être « livré » : l'argent
   * encaissé n'aurait aucun porteur.
   */
  private async assertTransitionPossible(packageId: string, to: PackageStatus): Promise<void> {
    const verdict = await packageWorkflowService.check(packageId, to);
    if (!verdict.allowed) throw new BusinessRuleError(verdict.reason ?? 'Transition interdite.', 409);
  }

  private fieldDriverId(record: { assignedDriverId: string | null }, user: DriverActor): string {
    const driverId = user.role === RoleType.LIVREUR ? user.driverId : record.assignedDriverId;
    if (!driverId) {
      throw new BusinessRuleError(
        "Ce colis n'est affecté à aucun livreur : affectez-le avant d'enregistrer un événement de livraison.",
        409
      );
    }
    return driverId;
  }

  /** Dépôt principal, utilisé comme origine et destination par défaut. */
  private async defaultDeposit(): Promise<{ id: string; name: string; governorate: string }> {
    const deposit =
      (await this.prisma.deposit.findFirst({ where: { isMainHub: true } })) ??
      (await this.prisma.deposit.findFirst());
    if (!deposit) {
      throw new BusinessRuleError(
        "Aucun dépôt configuré. Lancez « npm run prisma:seed » pour créer le référentiel.",
        503
      );
    }
    return deposit;
  }

  /**
   * Retrouve (ou crée) le client destinataire à partir des informations
   * transmises par l'expéditeur.
   *
   * Le modèle relationnel exige un client référencé : on réconcilie donc par
   * téléphone, qui est l'identifiant naturel chez un expéditeur.
   */
  private async resolveCustomer(tx: Prisma.TransactionClient, payload: Record<string, unknown>) {
    const name = String(payload.customerName ?? '').trim().slice(0, 150);
    const phone = String(payload.customerPhone ?? '').trim().slice(0, 30);
    if (!name || !phone) {
      throw new BusinessRuleError('Nom du destinataire et téléphone sont obligatoires.');
    }
    const governorate = String(payload.governorate ?? 'Ben Arous').trim().slice(0, 50) || 'Ben Arous';
    const delegation = String(payload.delegation ?? governorate).trim().slice(0, 100) || governorate;
    const locality = payload.locality ? String(payload.locality).trim().slice(0, 100) : null;
    const streetAddress =
      String(payload.address ?? '').trim().slice(0, 255) || 'Adresse de livraison';
    // Zone de l'adresse, créée à la volée si elle est nouvelle (voir zones.service).
    const zone = await zonesService.ensureZone(tx, governorate, delegation);
    const zoneId = zone?.id ?? null;

    // Un destinataire est reconnu par son téléphone ET son nom : deux
    // expéditeurs qui livrent le même numéro sous deux noms différents ne
    // s'écrasent plus mutuellement le nom affiché sur leurs colis.
    const existing = await tx.customer.findFirst({
      where: { primaryPhone: phone, fullName: { equals: name, mode: 'insensitive' } },
      include: { addresses: true },
    });

    if (existing) {
      // L'adresse saisie pour CE colis fait foi : une adresse identique est
      // réutilisée, sinon une nouvelle est créée. On ne livre jamais un colis
      // à l'ancienne adresse d'un client parce que son numéro est connu.
      const same = existing.addresses.find(
        (a) =>
          a.streetAddress.trim().toLowerCase() === streetAddress.toLowerCase() &&
          a.governorate.trim().toLowerCase() === governorate.toLowerCase() &&
          a.delegation.trim().toLowerCase() === delegation.toLowerCase() &&
          (a.locality ?? '').trim().toLowerCase() === (locality ?? '').toLowerCase()
      );
      if (same) {
        if (zoneId && same.zoneId !== zoneId) {
          await tx.customerAddress.update({ where: { id: same.id }, data: { zoneId } });
        }
        return { customerId: existing.id, addressId: same.id };
      }
      const address = await tx.customerAddress.create({
        data: { customerId: existing.id, zoneId, governorate, delegation, locality, streetAddress, isDefault: false },
      });
      return { customerId: existing.id, addressId: address.id };
    }

    const created = await tx.customer.create({
      data: {
        code: await nextCustomerCode(tx),
        fullName: name,
        primaryPhone: phone,
        phones: { create: { phoneNumber: phone, label: 'Personnel' } },
      },
    });
    const address = await tx.customerAddress.create({
      data: { customerId: created.id, zoneId, governorate, delegation, locality, streetAddress, isDefault: true },
    });

    return { customerId: created.id, addressId: address.id };
  }

  /* ---------------------------------------------------------------- */
  /* Création                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Création d'un colis par un expéditeur.
   *
   * Le colis démarre en `CREE` et l'événement de création est inscrit dans sa
   * chronologie. L'exploitation est notifiée : c'est le premier maillon du
   * flux métier « expéditeur → administration ».
   */
  async create(
    payload: Record<string, unknown>,
    user?: { id?: string; shipperId?: string; shipperName?: string; fullName?: string }
  ): Promise<PackageDto> {
    const shipperId = user?.shipperId;
    if (!shipperId) {
      throw new BusinessRuleError(
        "Impossible de créer un colis : aucun expéditeur n'est associé à votre compte.",
        403
      );
    }

    const shipper = await this.prisma.shipper.findUnique({
      where: { id: shipperId },
      include: { config: true },
    });
    if (!shipper || (shipper as { deletedAt?: Date | null }).deletedAt) {
      throw new BusinessRuleError('Expéditeur introuvable.', 404);
    }
    if (shipper.isActive === false) {
      throw new BusinessRuleError("Ce compte expéditeur est désactivé : aucun nouveau colis ne peut être créé.", 409);
    }

    const deposit = await this.defaultDeposit();

    // Le numéro de business est tiré d'une séquence en base : c'est elle, et non
    // une vérification a posteriori, qui garantit l'unicité sous concurrence.
    const trackingNumber = await generateBusinessNumber();
    // Le code-barres est une représentation *distincte* du numéro : il porte
    // une clé de contrôle, ce qui permet à un lecteur de dire « étiquette
    // illisible » au lieu de chercher un colis qui n'existe pas. Il ne peut
    // donc pas reprendre une valeur fournie par l'appelant : ce serait lui
    // laisser choisir une étiquette sans clé, illisible au premier scan.
    const barcode = barcodeFor(trackingNumber);

    const totalPrice = Number(payload.totalPrice ?? 0);
    const pieceCount = Number(payload.pieceCount ?? 1);

    const packageTypes = Object.values(PackageType) as string[];
    const sizes = Object.values(PackageSize) as string[];
    if (payload.packageType !== undefined && !packageTypes.includes(String(payload.packageType))) {
      throw new BusinessRuleError(`Type de colis inconnu : ${String(payload.packageType)}.`, 400);
    }
    if (payload.sizeCategory !== undefined && !sizes.includes(String(payload.sizeCategory))) {
      throw new BusinessRuleError(`Catégorie de taille inconnue : ${String(payload.sizeCategory)}.`, 400);
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const { customerId, addressId } = await this.resolveCustomer(tx, payload);
      // Routage : l'agence de l'expéditeur prend le colis en charge, l'agence
      // qui dessert l'adresse le livre (voir common/routing).
      const address = await tx.customerAddress.findUnique({
        where: { id: addressId },
        select: { governorate: true, delegation: true },
      });
      const originId = (await resolveShipperDepositId(tx, shipper.governorate)) ?? deposit.id;
      const destinationId =
        (await resolveDestinationDepositId(tx, address?.governorate, address?.delegation)) ?? deposit.id;
      return tx.package.create({
        data: {
          trackingNumber,
          barcode,
          shipperReference: payload.shipperReference ? String(payload.shipperReference) : null,
          shipperId,
          customerId,
          customerAddressId: addressId,
          originDepositId: originId,
          currentDepositId: originId,
          destinationDepositId: destinationId,
          packageType: ((payload.packageType as PackageType) ?? PackageType.NORMAL),
          sizeCategory: ((payload.sizeCategory as PackageSize) ?? PackageSize.MOYENNE),
          pieceCount: Number.isFinite(pieceCount) && pieceCount > 0 ? pieceCount : 1,
          contentSummary: String(payload.contentSummary ?? 'Colis sans description'),
          allowOpen: payload.allowOpen === true,
          isFragile: payload.isFragile === true,
          totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
          deliveryFee: shipper.config?.defaultDeliveryFee ?? 7,
          shipperNotes: payload.notes ? String(payload.notes) : null,
          items: {
            create: {
              description: String(payload.contentSummary ?? 'Colis sans description'),
              quantity: Number.isFinite(pieceCount) && pieceCount > 0 ? pieceCount : 1,
            },
          },
          statusHistory: {
            create: {
              status: PackageStatus.CREE,
              title: 'Colis créé par l\'expéditeur',
              description: `Colis enregistré par ${user?.shipperName ?? shipper.brandName ?? shipper.companyName}`,
              locationName: deposit.name,
              operatorName: user?.fullName ?? 'Expéditeur',
            },
          },
        },
        include: PACKAGE_INCLUDE,
      });
    });

    // L'exploitation prend connaissance du nouveau colis. L'expéditeur
    // n'est pas notifié de sa propre saisie ; le livreur n'existe pas encore.
    await notificationDispatcher.notify({
      event: NotificationEvent.NEW_COLIS_CREATED,
      title: 'Nouveau colis à traiter',
      content: `Le colis #${trackingNumber} de ${String(payload.customerName)} attend d'être pris en charge.`,
      relatedEntity: 'PACKAGE',
      relatedEntityId: record.id,
      packageId: record.id,
      actorUserId: user?.id ?? null,
    });

    return toPackageDto(record);
  }

  /* ---------------------------------------------------------------- */
  /* Modification                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Modification d'un colis.
   *
   * - expéditeur, colis encore sous son contrôle : modification libre ;
   * - expéditeur, colis engagé : modification restreinte, notification au
   *   chauffeur si un champ critique change, journal d'audit systématique ;
   * - statut verrouillé : refus, quel que soit l'acteur.
   */
  async update(
    idOrTracking: string,
    payload: Record<string, unknown>,
    user: { id?: string; fullName: string; role: RoleType; shipperId?: string }
  ): Promise<{
    package: PackageDto;
    driverNotified: boolean;
    notificationMessage?: string;
  }> {
    const record = await this.findRecord(idOrTracking);

    // À la création, les instructions arrivent sous `notes` ; les écrans
    // d'édition envoient le même nom. Sans cet alias, la remarque imprimée
    // sur le bon de livraison ne pouvait plus être corrigée.
    if (payload.notes !== undefined && payload.shipperNotes === undefined) {
      payload = { ...payload, shipperNotes: payload.notes };
    }

    // Périmètre : un expéditeur ne modifie que ses propres colis.
    if (user.shipperId && record.shipperId !== user.shipperId) {
      throw new BusinessRuleError(
        "Colis introuvable ou vous n'avez pas l'autorisation de le modifier.",
        404
      );
    }

    const isShipper = Boolean(user.shipperId) && user.role === RoleType.EXPEDITEUR;

    // Un colis dont le cycle est clôturé n'est plus modifiable.
    if (isLockedForEditing(record.status as PackageStatus)) {
      throw new BusinessRuleError(
        `Modification strictement interdite : ce colis est au statut « ${record.status} », son cycle opérationnel est clôturé.`,
        409
      );
    }

    // L'expéditeur ne peut plus intervenir une fois le colis engagé.
    if (isShipper && !isFullyEditableByShipper(record.status as PackageStatus)) {
      if (isRestrictedForShipper(record.status as PackageStatus)) {
        // Autorisé, mais encadré : les champs critiques sont signalés au
        // chauffeur et tracés.
        const restricted = await this.applyRestrictedEdit(record, payload, user);
        return restricted;
      }
      throw new BusinessRuleError(
        `Modification interdite : ce colis est au statut « ${record.status} ».`,
        409
      );
    }

    return this.applyEdit(record, payload, user);
  }

  /**
   * Applique une modification en distinguant les changements critiques
   * (montant, pièces, contenu) des modifications de confort.
   */
  private async applyEdit(
    record: PackageWithRelations,
    payload: Record<string, unknown>,
    user: { id?: string; fullName: string; role: RoleType; shipperId?: string }
  ): Promise<{ package: PackageDto; driverNotified: boolean; notificationMessage?: string }> {
    const before: Record<string, unknown> = {
      totalPrice: Number(record.totalPrice),
      pieceCount: record.pieceCount,
      contentSummary: record.contentSummary,
    };

    const data: Prisma.PackageUncheckedUpdateInput = {};
    const criticalChanges: string[] = [];

    // Le changement de montant et celui de pièces sont deux faits distincts, et
    // l'un ne remplace pas l'autre à l'affichage : « 65 DT au lieu de 58 » et
    // « 3 pièces au lieu de 2 » ne se lisent pas de la même façon, et n'appellent
    // pas la même réaction. Les suivre séparément permet surtout de n'avertir
    // que de ce qui change réellement la conduite du livreur.

    // Validation des saisies avant toute écriture : un montant illisible ou
    // négatif, un nombre de pièces non entier, une énumération inconnue sont
    // refusés plutôt que d'écrire NaN ou de laisser la base répondre.
    if (payload.totalPrice !== undefined) {
      const amount = Number(payload.totalPrice);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new BusinessRuleError('Le montant à encaisser doit être un nombre positif ou nul.', 400);
      }
    }
    if (payload.pieceCount !== undefined) {
      const pieces = Number(payload.pieceCount);
      if (!Number.isInteger(pieces) || pieces < 1) {
        throw new BusinessRuleError('Le nombre de pièces doit être un entier positif.', 400);
      }
    }
    if (payload.sizeCategory !== undefined && !(Object.values(PackageSize) as string[]).includes(String(payload.sizeCategory))) {
      throw new BusinessRuleError(`Catégorie de taille inconnue : ${String(payload.sizeCategory)}.`, 400);
    }
    if (payload.packageType !== undefined && !(Object.values(PackageType) as string[]).includes(String(payload.packageType))) {
      throw new BusinessRuleError(`Type de colis inconnu : ${String(payload.packageType)}.`, 400);
    }

    // Un changement de montant est le cas de référence : il change ce que le
    // livreur a à demander au client, donc ce qu'il doit savoir avant de
    // passer à la caisse.
    const amountChanged =
      payload.totalPrice !== undefined && Number(payload.totalPrice) !== Number(record.totalPrice);
    const quantityChanged =
      payload.pieceCount !== undefined && Number(payload.pieceCount) !== record.pieceCount;
    const contentChanged =
      payload.contentSummary !== undefined &&
      String(payload.contentSummary) !== record.contentSummary;

    // Une modification de confort — autoriser l'ouverture, corriger une note,
    // changer l'adresse — est signalée aussi, mais comme une modification
    // ordinaire : ce n'est pas une alerte, c'est une information.
    const addressChanged =
      payload.customerName !== undefined ||
      payload.customerPhone !== undefined ||
      payload.address !== undefined ||
      payload.governorate !== undefined ||
      payload.delegation !== undefined;
    const comfortChanged =
      payload.allowOpen !== undefined ||
      payload.isFragile !== undefined ||
      payload.sizeCategory !== undefined ||
      payload.packageType !== undefined ||
      payload.shipperNotes !== undefined ||
      addressChanged;

    if (amountChanged) {
      data.totalPrice = Number(payload.totalPrice);
      criticalChanges.push(FIELD_LABELS.totalPrice!);
    }
    if (quantityChanged) {
      // Les étiquettes de pièces sont déjà imprimées et comptées dans un
      // bordereau : changer le nombre de pièces en route fausserait l'acceptation.
      if (record.interDepotTransferId) {
        throw new BusinessRuleError(
          "Le colis est en route dans un inter-dépôt : son nombre de pièces ne peut pas changer avant son arrivée.",
          409
        );
      }
      data.pieceCount = Number(payload.pieceCount);
      criticalChanges.push(FIELD_LABELS.pieceCount!);
    }
    if (contentChanged) {
      data.contentSummary = String(payload.contentSummary);
      criticalChanges.push(FIELD_LABELS.contentSummary!);
    }
    if (payload.allowOpen !== undefined) data.allowOpen = payload.allowOpen === true;
    if (payload.isFragile !== undefined) data.isFragile = payload.isFragile === true;
    if (payload.sizeCategory !== undefined) data.sizeCategory = payload.sizeCategory as PackageSize;
    if (payload.packageType !== undefined) data.packageType = payload.packageType as PackageType;
    if (payload.shipperNotes !== undefined) {
      const note = payload.shipperNotes === null ? '' : String(payload.shipperNotes).trim();
      if (note.length > 500) throw new BusinessRuleError('Les instructions dépassent 500 caractères.', 400);
      data.shipperNotes = note || null;
    }

    // Les coordonnées du destinataire sont portées par le client et son adresse.
    const updated = await this.prisma.$transaction(async (tx) => {
      if (addressChanged) {
        const { customerId, addressId } = await this.resolveCustomer(tx, {
          customerName: payload.customerName ?? record.customer.fullName,
          customerPhone: payload.customerPhone ?? record.customer.primaryPhone,
          address: payload.address ?? record.customerAddress.streetAddress,
          governorate: payload.governorate ?? record.customerAddress.governorate,
          delegation: payload.delegation ?? record.customerAddress.delegation,
          locality: payload.locality ?? record.customerAddress.locality,
        });
        data.customerId = customerId;
        data.customerAddressId = addressId;
        // Nouvelle adresse, nouvelle agence de livraison — tant que le colis
        // n'a pas déjà pris la route.
        if (['CREE', 'RAMASSAGE_PROGRAMME', 'RAMASSE', 'RECU_DEPOT'].includes(record.status)) {
          const destinationId = await resolveDestinationDepositId(
            tx,
            String(payload.governorate ?? record.customerAddress.governorate),
            String(payload.delegation ?? record.customerAddress.delegation)
          );
          if (destinationId) data.destinationDepositId = destinationId;
        }
      }
      return tx.package.update({
        where: { id: record.id },
        data,
        include: PACKAGE_INCLUDE,
      });
    });

    // Journal d'audit : obligatoire dès qu'un champ critique change.
    if (criticalChanges.length > 0) {
      await auditService.record({
        entityType: 'PACKAGE',
        entityId: record.id,
        action: 'UPDATE_CRITICAL_FIELDS',
        reason: `Modification de : ${criticalChanges.join(', ')}`,
        previousValues: before,
        newValues: {
          totalPrice: Number(updated.totalPrice),
          pieceCount: updated.pieceCount,
          contentSummary: updated.contentSummary,
        },
        userId: user.id,
      });

      await this.prisma.packageTimeline.create({
        data: {
          packageId: record.id,
          status: updated.status,
          title: 'Modification par l\'expéditeur',
          description: `Champs modifiés : ${criticalChanges.join(', ')}`,
          locationName: packageLocation(updated),
          operatorName: user.fullName,
        },
      });
    }

    // Un fait changé, un événement. Le montant et le nombre de pièces sont
    // envoyés séparément — même dans le même appel, ce sont deux informations
    // que le livreur lit différemment — et le reste est regroupé sous
    // « colis modifié ».
    //
    // L'ordre est celui du modèle : le colis est à jour, l'audit est écrit, et
    // seulement ensuite on prévient. Une notification qui précéderait l'audit
    // pourrait annoncer une modification que personne ne retrouve ensuite.
    const tracking = record.trackingNumber;
    const author = user.fullName;

    if (amountChanged) {
      await notificationDispatcher.notify({
        event: NotificationEvent.AMOUNT_CHANGED,
        title: 'Montant modifié sur un colis',
        content:
          `${author} a porté le montant dû du colis #${tracking} de ` +
          `${Number(record.totalPrice).toFixed(3)} DT à ${Number(updated.totalPrice).toFixed(3)} DT. ` +
          'À vérifier avant la livraison.',
        relatedEntity: 'PACKAGE',
        relatedEntityId: record.id,
        packageId: record.id,
        actorUserId: user.id ?? null,
      });
    }

    if (quantityChanged) {
      await notificationDispatcher.notify({
        event: NotificationEvent.QUANTITY_CHANGED,
        title: 'Nombre de pièces modifié',
        content:
          `${author} a porté le nombre de pièces du colis #${tracking} de ` +
          `${record.pieceCount} à ${updated.pieceCount}.`,
        relatedEntity: 'PACKAGE',
        relatedEntityId: record.id,
        packageId: record.id,
        actorUserId: user.id ?? null,
      });
    }

    if (!amountChanged && !quantityChanged && (contentChanged || comfortChanged)) {
      const what = contentChanged
        ? `le contenu (${FIELD_LABELS.contentSummary})`
        : 'une information du colis';
      await notificationDispatcher.notify({
        event: NotificationEvent.COLIS_MODIFIED,
        title: 'Colis modifié',
        content: `${author} a modifié ${what} du colis #${tracking}.`,
        relatedEntity: 'PACKAGE',
        relatedEntityId: record.id,
        packageId: record.id,
        actorUserId: user.id ?? null,
      });
    }

    // `driverNotified` reste porte par le montant et le nombre de pièces : ce
    // sont les deux changements qui obligent le livreur à agir avant de
    // livrer, et la réponse renvoyée à l'écran doit le dire.
    const mustNotifyDriver =
      (amountChanged || quantityChanged) && Boolean(record.assignedDriver?.userId);

    return {
      package: toPackageDto(updated),
      driverNotified: mustNotifyDriver,
      notificationMessage: mustNotifyDriver
        ? `Modification transmise au chauffeur ${record.assignedDriver?.user.fullName ?? ''} pour le colis #${tracking}.`
        : undefined,
    };
  }

  /** Modification restreinte : colis engagé, l'expéditeur peut encore agir. */
  private async applyRestrictedEdit(
    record: PackageWithRelations,
    payload: Record<string, unknown>,
    user: { id?: string; fullName: string; role: RoleType; shipperId?: string }
  ) {
    return this.applyEdit(record, payload, user);
  }

  /* ---------------------------------------------------------------- */
  /* Annulation & suppression                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Annulation d'un colis.
   *
   * Règle métier : l'expéditeur peut annuler tant que le colis n'est ni reçu
   * au dépôt ni affecté à un livreur. Au-delà, l'annulation relève de
   * l'administration, qui peut le faire depuis le back-office.
   */
  async cancel(
    idOrTracking: string,
    reason: string,
    user: { id?: string; fullName: string; role: RoleType; shipperId?: string }
  ): Promise<PackageDto> {
    const record = await this.findRecord(idOrTracking);

    if (user.shipperId && record.shipperId !== user.shipperId) {
      throw new BusinessRuleError('Colis introuvable ou non autorisé.', 404);
    }

    const isShipper = user.role === RoleType.EXPEDITEUR;

    if (isShipper && !canShipperCancelOrDelete(record.status as PackageStatus)) {
      throw new BusinessRuleError(
        "Annulation impossible depuis le portail expéditeur : ce colis a déjà été reçu au dépôt ou affecté à un livreur. Contactez l'administration.",
        409
      );
    }

    if (record.status === PackageStatus.LIVRE) {
      throw new BusinessRuleError("Impossible d'annuler un colis déjà livré au destinataire.", 409);
    }

    const updated = await this.applyStatusChange(record.id, PackageStatus.ANNULE, {
      actorName: user.fullName,
      actorId: user.id,
      role: user.role,
      title: 'Colis annulé',
      // Une annulation sans motif n'apprend rien à l'exploitation : le colis
      // disparaît du parc sans qu'on sache s'il a été livré par erreur.
      reason: reason,
      description: reason || "Annulation demandée par l'expéditeur",
      locationName: packageLocation(record),
      auditAction: 'CANCEL',
      data: { internalNotes: reason || null },
    });

    void updated;
    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Suppression définitive d'un colis.
   *
   * Réservée au fournisseur tant que le colis est sous son contrôle ; sinon à
   * l'administration. La suppression est *douce* (`deletedAt`) afin de
   * préserver la traçabilité : la ligne et son historique restent en base.
   */
  async remove(
    idOrTracking: string,
    user: { id?: string; fullName: string; role: RoleType; shipperId?: string }
  ): Promise<void> {
    const record = await this.findRecord(idOrTracking);

    if (user.shipperId && record.shipperId !== user.shipperId) {
      throw new BusinessRuleError('Colis introuvable ou non autorisé.', 404);
    }

    const isShipper = user.role === RoleType.EXPEDITEUR;
    if (isShipper && !canShipperCancelOrDelete(record.status as PackageStatus)) {
      throw new BusinessRuleError(
        "Suppression impossible : ce colis a été reçu au dépôt ou affecté à un livreur. Utilisez l'annulation ou contactez l'administration.",
        409
      );
    }

    await this.prisma.package.update({
      where: { id: record.id },
      data: { deletedAt: new Date() },
    });

    await auditService.record({
      entityType: 'PACKAGE',
      entityId: record.id,
      action: 'SOFT_DELETE',
      reason: 'Suppression définitive demandée',
      previousValues: { status: record.status, trackingNumber: record.trackingNumber },
      userId: user.id,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Flux logistique                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Affectation d'un colis à un livreur.
   *
   * Le colis passe en `AFFECTE_RUNSHEET` s'il est au dépôt, sinon son statut
   * est conservé (cas d'un colis déjà en tournée). Le livreur est notifié :
   * c'est le maillon « administration → livreur » du flux métier.
   */
  async assignDriver(
    identifier: string,
    payload: { driverId?: string; driverCode?: string; driverName?: string; runsheetNumber?: string },
    user: { id?: string; fullName: string; role: RoleType }
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    const status = record.status as PackageStatus;

    if (isTerminalStatus(status) || NOT_REASSIGNABLE.includes(status)) {
      throw new BusinessRuleError(
        `Impossible d'affecter ce colis : il est au statut « ${packageStatusLabel(status)} ».`,
        409
      );
    }

    const driver = await this.resolveDriver(payload);
    const runsheetNumber = payload.runsheetNumber ? String(payload.runsheetNumber).trim() : '';
    const runsheet = runsheetNumber
      ? await this.prisma.runsheet.findUnique({ where: { runsheetNumber } })
      : null;

    if (runsheetNumber && !runsheet) {
      throw new BusinessRuleError(`Tournée ${runsheetNumber} introuvable.`, 404);
    }
    if (runsheet && runsheet.driverId !== driver.id) {
      throw new BusinessRuleError(
        `Le colis ne peut pas être rattaché à la tournée ${runsheet.runsheetNumber} : elle appartient à un autre livreur.`,
        409
      );
    }
    if (runsheet && runsheet.status !== 'EN_ATTENTE' && runsheet.status !== 'BROUILLON') {
      throw new BusinessRuleError(
        `La tournée ${runsheet.runsheetNumber} n'est plus modifiable (statut ${runsheet.status}).`,
        409
      );
    }

    // Un colis déjà chargé dans une tournée ouverte d'un autre livreur doit en
    // être retiré d'abord : sinon il figurerait dans la tournée de A en étant
    // affecté à B, et aucun des deux ne pourrait le livrer proprement.
    if (record.currentRunsheet && record.currentRunsheetId !== runsheet?.id) {
      const current = await this.prisma.runsheet.findUnique({
        where: { id: record.currentRunsheetId! },
        select: { runsheetNumber: true, status: true, driverId: true },
      });
      if (current && !['RETOUR_DEPOT', 'CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT', 'ANNULEE'].includes(current.status)) {
        if (current.driverId !== driver.id || runsheet) {
          throw new BusinessRuleError(
            `Le colis est dans la tournée ${current.runsheetNumber} : retirez-le de cette tournée avant de le réaffecter.`,
            409
          );
        }
      }
    }

    const location = packageLocation(record);
    await this.prisma.$transaction(async (tx) => {
      if (record.assignedDriverId !== driver.id) {
        await tx.package.update({ where: { id: record.id }, data: { assignedDriverId: driver.id } });
      }
      if (runsheet) {
        await runsheetsService.attachPackage(tx, runsheet, record.id, { id: user.id, fullName: user.fullName });
        return;
      }
      if (status !== PackageStatus.AFFECTE_RUNSHEET && canTransition(status, PackageStatus.AFFECTE_RUNSHEET)) {
        await this.applyStatusChange(record.id, PackageStatus.AFFECTE_RUNSHEET, {
          actorName: user.fullName,
          actorId: user.id,
          role: user.role,
          title: `Colis affecté à ${driver.user.fullName}`,
          description: 'Affecté sans tournée',
          locationName: location,
          auditAction: 'ASSIGN_DRIVER',
          data: { assignedDriverId: driver.id },
          client: tx,
        });
        return;
      }
      // Réaffectation sans changement de statut : un événement daté, tracé.
      await packageWorkflowService.annotate({
        packageId: record.id,
        actor: { id: user.id, fullName: user.fullName, role: user.role },
        title: `Colis réaffecté à ${driver.user.fullName}`,
        auditAction: 'ASSIGN_DRIVER',
        location,
        newValues: { assignedDriverId: driver.id, previousDriverId: record.assignedDriverId },
        client: tx,
      });
    });

    // Le livreur reçoit sa nouvelle affectation.
    await notificationDispatcher.notify({
      event: NotificationEvent.COLIS_ASSIGNED,
      title: 'Nouvelle livraison à effectuer',
      content: `${user.fullName} vous a affecté le colis #${record.trackingNumber}${runsheet ? ` sur la tournée ${runsheet.runsheetNumber}` : ''}.`,
      relatedEntity: 'PACKAGE',
      relatedEntityId: record.id,
      packageId: record.id,
      userIds: [driver.userId],
    });

    // Un colis qui rejoint une tournée est aussi une information pour celui qui
    // suit le flux des tournées.
    if (runsheet) {
      await notificationDispatcher
        .notify({
          event: NotificationEvent.RUNSHEET_ASSIGNED,
          title: 'Colis intégré à une tournée',
          content: `Le colis #${record.trackingNumber} a rejoint la tournée ${runsheet.runsheetNumber} de ${driver.user.fullName}.`,
          relatedEntity: 'RUNSHEET',
          relatedEntityId: runsheet.id,
          runsheetId: runsheet.id,
          userIds: [driver.userId],
        })
        .catch(() => undefined);
    }

    const fresh = await this.findRecord(record.id);
    // La transition a eu lieu dans la transaction, qui ne notifie pas : on
    // prévient l'exploitation et l'expéditeur maintenant qu'elle est validée.
    if ((fresh.status as PackageStatus) !== status) {
      await this.notifyStatusChanged(record.id, fresh.status as PackageStatus, user.fullName, user.id);
    }
    return toPackageDto(fresh);
  }

  /** Retrouve un livreur par identifiant interne ou par code métier. — Contrat canonique : Driver.id (UUID). */
  private async resolveDriver(payload: { driverId?: string; driverCode?: string }) {
    if (payload.driverId !== undefined && payload.driverId !== null && String(payload.driverId).trim() !== '') {
      const raw = String(payload.driverId).trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        throw new BusinessRuleError('Le champ « Chauffeur (driverId) » doit être un identifiant UUID valide.', 400);
      }
      const driver = await this.prisma.driver.findUnique({
        where: { id: raw },
        include: { user: true },
      });
      if (!driver) {
        throw new BusinessRuleError('Livreur introuvable. Vérifiez le chauffeur sélectionné.', 404);
      }
      if (!driver.isActive || driver.deletedAt) {
        throw new BusinessRuleError('Ce livreur est inactif ou supprimé.', 409);
      }
      return driver;
    }
    if (payload.driverCode !== undefined && payload.driverCode !== null && String(payload.driverCode).trim() !== '') {
      const code = String(payload.driverCode).trim();
      const driver = await this.prisma.driver.findUnique({
        where: { driverCode: code },
        include: { user: true },
      });
      if (!driver) {
        throw new BusinessRuleError('Livreur introuvable. Vérifiez le chauffeur sélectionné.', 404);
      }
      if (!driver.isActive || driver.deletedAt) {
        throw new BusinessRuleError('Ce livreur est désactivé.', 409);
      }
      return driver;
    }
    throw new BusinessRuleError('Le champ « Chauffeur (driverId) » est obligatoire.', 400);
  }

  /* ---------------------------------------------------------------- */
  /* Dernier kilomètre                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Le livreur démarre la tournée sur un colis.
   */
  async startDelivery(identifier: string, user: DriverActor): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);

    await this.applyStatusChange(record.id, PackageStatus.EN_COURS_LIVRAISON, {
      actorName: user.fullName,
      actorId: user.id,
      role: user.role,
      driverId: user.driverId,
      title: 'Livraison démarrée',
      description: 'Le livreur est en cours d\'acheminement',
      locationName: record.customerAddress.delegation,
      auditAction: 'DELIVERY_STARTED',
      data: { lastDeliveryAttemptAt: new Date() },
    });

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Livraison conforme : le montant est encaissé auprès du client.
   *
   * Tout ce qu'implique une livraison — statut, chronologie, audit, tentative,
   * articles, caisse du livreur et encaissement COD — est écrit dans UNE
   * transaction : soit tout est enregistré, soit rien. Les notifications
   * partent ensuite.
   */
  async markDelivered(
    identifier: string,
    payload: {
      collectedAmount?: number | string;
      driverNote?: string;
      callDurationSeconds?: number;
      paymentMethod?: string;
      transactionRef?: string;
    },
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);
    await this.assertTransitionPossible(record.id, PackageStatus.LIVRE);
    const driverId = this.fieldDriverId(record, user);

    const collected =
      payload.collectedAmount !== undefined
        ? toDecimal(payload.collectedAmount, 'montant encaissé')
        : new Prisma.Decimal(record.totalPrice);

    if (collected.isNegative()) {
      throw new BusinessRuleError('Le montant encaissé ne peut pas être négatif.');
    }

    // Les règles de la caisse sont vérifiées AVANT toute écriture.
    cashService.assertCollectable({
      method: payload.paymentMethod,
      amountExpected: new Prisma.Decimal(record.totalPrice),
      amountCollected: collected,
      transactionRef: payload.transactionRef,
    });

    const now = new Date();
    const notifyCash = await this.prisma.$transaction(async (tx) => {
      await this.applyStatusChange(record.id, PackageStatus.LIVRE, {
        actorName: user.fullName,
        actorId: user.id,
        role: user.role,
        driverId: user.driverId,
        title: 'Colis livré et paiement encaissé',
        locationName: `${record.customerAddress.delegation}, ${record.customerAddress.governorate}`,
        collectedAmount: Number(collected.toFixed(3)),
        auditAction: 'DELIVERY_DONE',
        data: {
          collectedAmount: collected,
          driverNotes: payload.driverNote ?? record.driverNotes,
          deliveredAt: now,
          lastDeliveryAttemptAt: now,
        },
        client: tx,
      });

      await this.recordAttempt(tx, record, driverId, 'REUSSIE', {
        comment: payload.driverNote,
        callDurationSeconds: payload.callDurationSeconds ?? 60,
      });

      await tx.packageItem.updateMany({
        where: { packageId: record.id },
        data: { isDelivered: true, isReturned: false },
      });
      // L'argent est dans les mains du livreur affecté, même quand
      // l'exploitation enregistre la livraison depuis le back-office.
      await tx.driver.update({
        where: { id: driverId },
        data: { currentBalance: { increment: collected } },
      });

      return cashService.recordCollection(
        {
          packageId: record.id,
          shipperId: record.shipperId,
          runsheetId: record.currentRunsheetId,
          driverId,
          driverUserId: user.id ?? null,
          amountExpected: new Prisma.Decimal(record.totalPrice),
          amountCollected: collected,
          deliveryFee: new Prisma.Decimal(record.deliveryFee),
          method: payload.paymentMethod,
          transactionRef: payload.transactionRef ?? null,
        },
        tx
      );
    });

    await this.notifyStatusChanged(record.id, PackageStatus.LIVRE, user.fullName, user.id);
    await notifyCash();

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Livraison partielle : une part est livrée et payée, le reste est repris.
   *
   * Les deux descriptions et les deux montants sont exigés, et leur bilan doit
   * se refermer sur le montant dû. Toutes les écritures sont atomiques.
   */
  async markPartialDelivery(
    identifier: string,
    payload: PartialDeliveryRequest,
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);
    await this.assertTransitionPossible(record.id, PackageStatus.LIVRAISON_PARTIELLE);
    const driverId = this.fieldDriverId(record, user);

    const deliveredPieces = Number(payload.deliveredPieces);
    if (!Number.isInteger(deliveredPieces) || deliveredPieces <= 0 || deliveredPieces >= record.pieceCount) {
      throw new BusinessRuleError(
        `Le nombre de pièces livrées doit être un entier compris entre 1 et ${Math.max(1, record.pieceCount - 1)}.`
      );
    }
    if (!Number.isFinite(Number(payload.collectedAmount))) {
      throw new BusinessRuleError('Le montant encaissé doit être un nombre.');
    }

    const collected = round3(Number(payload.collectedAmount));
    const due = Number(record.totalPrice);
    const returned =
      payload.returnedAmount !== undefined ? round3(Number(payload.returnedAmount)) : round3(due - collected);

    const deliveredDescription = payload.deliveredDescription?.trim() ?? '';
    const returnedDescription = payload.returnedDescription?.trim() ?? '';
    const returnedPieces = record.pieceCount - deliveredPieces;
    const collectedDecimal = new Prisma.Decimal(collected.toFixed(3));

    cashService.assertCollectable({
      method: payload.paymentMethod,
      amountExpected: new Prisma.Decimal(record.totalPrice),
      amountCollected: collectedDecimal,
      transactionRef: payload.transactionRef,
    });

    const now = new Date();
    const notifyCash = await this.prisma.$transaction(async (tx) => {
      await this.applyStatusChange(record.id, PackageStatus.LIVRAISON_PARTIELLE, {
        actorName: user.fullName,
        actorId: user.id,
        role: user.role,
        driverId: user.driverId,
        title: `Livraison partielle : ${deliveredPieces}/${record.pieceCount} pièces`,
        reason: payload.reason,
        locationName: `${record.customerAddress.delegation}, ${record.customerAddress.governorate}`,
        deliveredContent: deliveredDescription,
        returnedContent: returnedDescription,
        collectedAmount: collected,
        returnedAmount: returned,
        auditAction: 'DELIVERY_PARTIAL',
        data: {
          collectedAmount: collectedDecimal,
          driverNotes: payload.driverNote ?? payload.reason,
          deliveredAt: now,
          lastDeliveryAttemptAt: now,
        },
        client: tx,
      });

      await tx.partialDelivery.upsert({
        where: { packageId: record.id },
        create: {
          packageId: record.id,
          deliveredDescription,
          returnedDescription,
          deliveredPieces,
          returnedPieces,
          originalAmount: record.totalPrice,
          amountCollected: collected,
          amountReturned: returned,
          reason: payload.reason,
          validatedByDriverId: driverId,
        },
        update: {
          deliveredDescription,
          returnedDescription,
          deliveredPieces,
          returnedPieces,
          amountCollected: collected,
          amountReturned: returned,
          reason: payload.reason,
          validatedByDriverId: driverId,
          validatedAt: now,
        },
      });

      await tx.packageItem.updateMany({
        where: { packageId: record.id },
        data: { isDelivered: false, isReturned: false },
      });

      await this.recordAttempt(tx, record, driverId, 'LIVRAISON_PARTIELLE', { comment: payload.reason });

      // La part encaissée est dans les mains du livreur.
      await tx.driver.update({
        where: { id: driverId },
        data: { currentBalance: { increment: collectedDecimal } },
      });

      return cashService.recordCollection(
        {
          packageId: record.id,
          shipperId: record.shipperId,
          runsheetId: record.currentRunsheetId,
          driverId,
          driverUserId: user.id ?? null,
          amountExpected: new Prisma.Decimal(record.totalPrice),
          amountCollected: collectedDecimal,
          deliveryFee: new Prisma.Decimal(record.deliveryFee),
          method: payload.paymentMethod,
          transactionRef: payload.transactionRef ?? null,
        },
        tx
      );
    });

    await this.notifyStatusChanged(record.id, PackageStatus.LIVRAISON_PARTIELLE, user.fullName, user.id);
    await notifyCash();
    await notificationDispatcher.notify({
      event: NotificationEvent.PARTIAL_DELIVERY,
      title: 'Livraison partielle',
      content:
        `Le colis #${record.trackingNumber} a été livré à ${deliveredPieces}/${record.pieceCount} ` +
        `pièces, pour ${collected.toFixed(3)} DT encaissés sur ${due.toFixed(3)} DT. ` +
        `${returnedPieces} pièce(s) repart${returnedPieces > 1 ? 'ent' : ''} avec le livreur.`,
      relatedEntity: 'PACKAGE',
      relatedEntityId: record.id,
      packageId: record.id,
      actorUserId: user.id ?? null,
    });

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Échange : le client rend un article et repart avec un remplacement.
   *
   * Un échange a lieu au moment de la remise : le colis doit être en cours de
   * distribution (affecté, en livraison ou reporté). Sur un colis livré,
   * annulé ou encore au dépôt, il n'a pas de sens.
   */
  async markExchange(
    identifier: string,
    payload: ExchangeRequest,
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);
    const driverId = this.fieldDriverId(record, user);

    const exchangeable: PackageStatus[] = [
      PackageStatus.AFFECTE_RUNSHEET,
      PackageStatus.EN_COURS_LIVRAISON,
      PackageStatus.REPORTE,
    ];
    if (!exchangeable.includes(record.status as PackageStatus)) {
      throw new BusinessRuleError(
        `Échange impossible : le colis #${record.trackingNumber} est au statut « ${packageStatusLabel(record.status)} ». ` +
          "Un échange se fait lors de la remise d'un colis en cours de distribution.",
        409
      );
    }

    const financialDifference = Number(payload.financialDifference ?? 0);
    if (!Number.isFinite(financialDifference)) {
      throw new BusinessRuleError("La différence financière de l'échange doit être un nombre.", 400);
    }
    const returnedItemSummary = payload.returnedItemSummary?.trim() ?? '';
    const newBarcode = payload.newPackageBarcode?.trim() ?? '';
    const oldBarcode = payload.oldPackageBarcode?.trim() || newBarcode;

    const missing = [
      { value: returnedItemSummary, label: 'la description de l\'article repris' },
      { value: newBarcode, label: 'le code-barres de l\'article de remplacement' },
    ].filter((field) => !field.value);
    if (missing.length > 0) {
      throw new BusinessRuleError(
        `Échange refusé : il faut préciser ${missing.map((f) => f.label).join(' et ')}. ` +
          "Sans l'article repris et son remplaçant, la marchandise est perdue.",
        400
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.exchangeRecord.upsert({
        where: { packageId: record.id },
        create: {
          packageId: record.id,
          newPackageBarcode: newBarcode,
          oldPackageBarcode: oldBarcode,
          returnedItemSummary,
          financialDifference,
          driverId,
        },
        update: {
          newPackageBarcode: newBarcode,
          oldPackageBarcode: oldBarcode,
          returnedItemSummary,
          financialDifference,
          driverId,
        },
      });

      await packageWorkflowService.annotate({
        packageId: record.id,
        actor: {
          id: user.id,
          fullName: user.fullName,
          role: user.role,
          driverId: user.driverId,
        },
        title: 'Échange marchandise',
        auditAction: 'PACKAGE_EXCHANGE',
        reason: `Article repris : ${returnedItemSummary}`,
        note: payload.note,
        deliveredContent: newBarcode,
        returnedContent: returnedItemSummary,
        location: `${record.customerAddress.delegation}, ${record.customerAddress.governorate}`,
        newValues: {
          originalPackageId: record.id,
          oldPackageBarcode: oldBarcode,
          newPackageBarcode: newBarcode,
          returnedItemSummary,
          financialDifference,
          customerId: record.customerId,
          customerName: record.customer.fullName,
        },
        client: tx,
      });

      await this.recordAttempt(tx, record, driverId, 'REUSSIE', {
        comment: `Échange : ${returnedItemSummary}`,
      });
    });

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Report de la livraison à une date ultérieure.
   */
  async markPostponed(
    identifier: string,
    payload: PostponeRequest,
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);
    await this.assertTransitionPossible(record.id, PackageStatus.REPORTE);
    const driverId = this.fieldDriverId(record, user);

    const attempts = await this.prisma.deliveryAttempt.count({ where: { packageId: record.id } });
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      throw new BusinessRuleError(
        `Nombre maximal de tentatives atteint (${MAX_DELIVERY_ATTEMPTS}). Le colis doit être retourné au dépôt.`,
        409
      );
    }

    const rescheduled = parseOptionalDate(payload.rescheduledDate, 'date de report');
    const customerNote = payload.customerNote?.trim() || null;

    await this.prisma.$transaction(async (tx) => {
      await this.applyStatusChange(record.id, PackageStatus.REPORTE, {
        actorName: user.fullName,
        actorId: user.id,
        role: user.role,
        driverId: user.driverId,
        title: 'Livraison reportée',
        // Le motif distingue un client absent d'une adresse fausse.
        reason: payload.reason,
        // La note client est distincte de la note de tournée.
        note: [payload.driverNote, customerNote].filter(Boolean).join(' — ') || undefined,
        locationName: `${record.customerAddress.delegation}, ${record.customerAddress.governorate}`,
        auditAction: 'DELIVERY_POSTPONED',
        data: {
          scheduledDeliveryDate: rescheduled ?? record.scheduledDeliveryDate,
          driverNotes: payload.driverNote ?? payload.reason,
          lastDeliveryAttemptAt: new Date(),
        },
        client: tx,
      });

      await this.recordAttempt(tx, record, driverId, 'REPORTEE', {
        comment: payload.driverNote?.trim() || payload.reason,
        rescheduledFor: rescheduled,
        customerNote,
      });
    });

    await this.notifyStatusChanged(record.id, PackageStatus.REPORTE, user.fullName, user.id);
    // Un report change ce que l'expéditeur attend : il est prévenu avec la
    // nouvelle date.
    await notificationDispatcher.notify({
      event: NotificationEvent.DELIVERY_POSTPONED,
      title: 'Livraison reportée',
      content:
        `La livraison du colis #${record.trackingNumber} est reportée` +
        (rescheduled ? ` au ${rescheduled.toLocaleDateString('fr-TN', { timeZone: 'Africa/Tunis' })}` : '') +
        `. Motif : ${payload.reason}`,
      relatedEntity: 'PACKAGE',
      relatedEntityId: record.id,
      packageId: record.id,
      actorUserId: user.id ?? null,
    });

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Signale une tentative de livraison infructueuse.
   *
   * `definitive` sépare les deux conséquences : un défaut temporaire
   * (injoignable) ramène le colis en `REPORTE` pour une nouvelle tentative,
   * un défaut de fond (adresse fausse, refus de payer) le passe en
   * `ECHEC_LIVRAISON`, d'où il ne repartira qu'affecté ou retourné.
   */
  async markFailedAttempt(
    identifier: string,
    payload: {
      reasonCode: FailedDeliveryReason;
      comment?: string;
      callDurationSeconds?: number;
      rescheduledFor?: string;
      definitive?: boolean;
    },
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);

    if (!FAILED_DELIVERY_REASONS.includes(payload.reasonCode)) {
      throw new BusinessRuleError(
        `Motif d'échec inconnu : ${payload.reasonCode}. ` +
          `Motifs acceptés : ${FAILED_DELIVERY_REASONS.join(', ')}.`,
        400
      );
    }

    const attempts = await this.prisma.deliveryAttempt.count({ where: { packageId: record.id } });
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      throw new BusinessRuleError(
        `Nombre maximal de tentatives atteint (${MAX_DELIVERY_ATTEMPTS}). ` +
          'Le colis doit être retourné au dépôt.',
        409
      );
    }

    const definitive = payload.definitive ?? DEFENSIVE_REASONS.has(payload.reasonCode);
    if (definitive && attempts + 1 >= MAX_DELIVERY_ATTEMPTS) {
      throw new BusinessRuleError(
        `Dernière tentative autorisée (${MAX_DELIVERY_ATTEMPTS}) : déclarez plutôt un ` +
          'retour au dépôt, le colis ne peut plus être retenté.',
        409
      );
    }

    const rescheduled = parseOptionalDate(payload.rescheduledFor, 'date de nouvelle tentative');
    const target = definitive ? PackageStatus.ECHEC_LIVRAISON : PackageStatus.REPORTE;
    const location = `${record.customerAddress.delegation}, ${record.customerAddress.governorate}`;
    const reason = FAILED_DELIVERY_LABELS[payload.reasonCode];
    await this.assertTransitionPossible(record.id, target);
    const driverId = this.fieldDriverId(record, user);

    await this.prisma.$transaction(async (tx) => {
      await this.applyStatusChange(record.id, target, {
        actorName: user.fullName,
        actorId: user.id,
        role: user.role,
        driverId: user.driverId,
        title: definitive ? 'Livraison en échec' : 'Livraison non aboutie',
        reason,
        note: payload.comment,
        locationName: location,
        auditAction: 'DELIVERY_FAILED',
        data: {
          ...(rescheduled ? { scheduledDeliveryDate: rescheduled } : {}),
          driverNotes: payload.comment ?? reason,
          lastDeliveryAttemptAt: new Date(),
        },
        client: tx,
      });

      await this.recordAttempt(tx, record, driverId, payload.reasonCode, {
        comment: payload.comment,
        callDurationSeconds: payload.callDurationSeconds,
        rescheduledFor: rescheduled,
        reasonCode: payload.reasonCode,
      });
    });

    await this.notifyStatusChanged(record.id, target, user.fullName, user.id);

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Retour au dépôt après échec : le colis quitte la tournée.
   */
  async markReturn(
    identifier: string,
    payload: ReturnRequest,
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);
    await this.assertTransitionPossible(record.id, PackageStatus.RETOUR_DEPOT);
    const driverId = this.fieldDriverId(record, user);

    const deposit =
      (record.currentRunsheet
        ? await this.prisma.deposit.findUnique({ where: { id: record.currentRunsheet.depositId } })
        : null) ?? (await this.prisma.deposit.findFirst({ where: { isMainHub: true } }));

    // Un retour est en pratique total : par défaut la quantité est celle du
    // colis et l'argent qui remonte est celui que le livreur transporte déjà.
    const returnedQuantity = Number(payload.returnedQuantity ?? record.pieceCount);
    if (!Number.isInteger(returnedQuantity) || returnedQuantity <= 0 || returnedQuantity > record.pieceCount) {
      throw new BusinessRuleError(
        `La quantité reprise doit être comprise entre 1 et ${record.pieceCount} pièces.`,
        400
      );
    }
    const amount = Number(payload.amount ?? Number(record.collectedAmount));
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BusinessRuleError('Le montant ramené doit être un nombre positif ou nul.', 400);
    }
    const returnedItems = payload.returnedItems?.trim() ?? null;
    const returnDepositId = deposit?.id ?? record.currentDepositId ?? (await this.defaultDeposit()).id;

    await this.prisma.$transaction(async (tx) => {
      await this.applyStatusChange(record.id, PackageStatus.RETOUR_DEPOT, {
        actorName: user.fullName,
        actorId: user.id,
        role: user.role,
        driverId: user.driverId,
        title: 'Colis retourné au dépôt',
        reason: payload.reason,
        note: payload.driverNote,
        locationName: deposit?.name ?? packageLocation(record),
        returnedContent: returnedItems ?? undefined,
        returnedAmount: amount || undefined,
        auditAction: 'PACKAGE_RETURNED',
        data: {
          currentDepositId: returnDepositId,
          currentRunsheetId: null,
          driverNotes: payload.driverNote ?? payload.reason,
          lastDeliveryAttemptAt: new Date(),
        },
        client: tx,
      });

      await this.recordAttempt(tx, record, driverId, 'REFUSEE', { comment: payload.reason });

      // Rendre un colis après avoir pris l'argent, c'est rembourser. Un retour
      // sur un colis jamais encaissé n'a rien à rembourser.
      const existingPayment = await tx.payment.findUnique({
        where: { packageId: record.id },
        select: { id: true },
      });
      if (existingPayment && amount > 0) {
        await cashService.recordRefund(
          existingPayment.id,
          new Prisma.Decimal(amount.toFixed(3)),
          payload.reason,
          tx
        );
      }

      // `ReturnRecord` n'a pas de contrainte d'unicité sur `packageId`.
      const existingReturn = await tx.returnRecord.findFirst({
        where: { packageId: record.id },
        select: { id: true },
      });
      if (existingReturn) {
        await tx.returnRecord.update({
          where: { id: existingReturn.id },
          data: { reason: payload.reason, returnedItems, returnedQuantity, amount, driverId },
        });
      } else {
        await tx.returnRecord.create({
          data: {
            returnNumber: await nextReturnNumber(tx),
            packageId: record.id,
            returnDepositId,
            reason: payload.reason,
            returnedItems,
            returnedQuantity,
            amount,
            driverId,
          },
        });
      }
    });

    await this.notifyStatusChanged(record.id, PackageStatus.RETOUR_DEPOT, user.fullName, user.id);

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Écrit une tentative de livraison et incrémente le compteur du colis,
   * dans la transaction de l'appelant.
   */
  private async recordAttempt(
    tx: Prisma.TransactionClient,
    record: { id: string; currentRunsheetId: string | null },
    driverId: string,
    result: 'REUSSIE' | 'LIVRAISON_PARTIELLE' | 'REPORTEE' | FailedDeliveryReason,
    options: {
      comment?: string;
      callDurationSeconds?: number;
      rescheduledFor?: Date | null;
      reasonCode?: FailedDeliveryReason;
      /** Ce que le client a été dit, distinct de ce que note le livreur. */
      customerNote?: string | null;
    } = {}
  ): Promise<void> {
    const count = await tx.deliveryAttempt.count({ where: { packageId: record.id } });
    const callDuration = Number(options.callDurationSeconds ?? 0);

    await tx.deliveryAttempt.create({
      data: {
        packageId: record.id,
        driverId,
        runsheetId: record.currentRunsheetId ?? null,
        attemptNumber: count + 1,
        result,
        reasonCode: options.reasonCode ?? null,
        driverComment: options.comment?.slice(0, 500) ?? null,
        customerNote: options.customerNote?.slice(0, 500) ?? null,
        callDurationSeconds: Number.isFinite(callDuration) ? Math.max(0, Math.round(callDuration)) : 0,
        rescheduledFor: options.rescheduledFor ?? null,
      },
    });
    await tx.package.update({
      where: { id: record.id },
      data: {
        deliveryAttemptsCount: { increment: 1 },
        lastDeliveryAttemptAt: new Date(),
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Actions pour l'administration                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Restitue un colis à son expéditeur : dernier maillon du cycle de retour.
   */
  async markReturnedToShipper(
    identifier: string,
    user: { id?: string; fullName: string; role: RoleType }
  ): Promise<PackageDto> {
    if (user.role !== RoleType.ADMIN && user.role !== RoleType.GESTIONNAIRE) {
      throw new BusinessRuleError("La restitution à l'expéditeur est réservée à l'exploitation.", 403);
    }
    const record = await this.findRecord(identifier);

    await this.applyStatusChange(record.id, PackageStatus.RETOURNE_EXPEDITEUR, {
      actorName: user.fullName,
      actorId: user.id,
      role: user.role,
      title: 'Colis restitué à l\'expéditeur',
      description: 'Restitution définitive effectuée',
      locationName: packageLocation(record),
      auditAction: 'RESTORED_TO_SHIPPER',
      data: { assignedDriverId: null, currentRunsheetId: null },
    });

    await this.prisma.returnRecord.updateMany({
      where: { packageId: record.id, restoredToShipperAt: null },
      data: { restoredToShipperAt: new Date(), isPhysicalChecked: true },
    });

    // Un retour rendu à l'expéditeur est un fait financier autant
    // qu'un fait logistique : la caisse doit savoir qu'aucune recette n'est
    // attendue de ce colis, sans quoi elle le cherchera au rapprochement.
    await notificationDispatcher.notify({
      event: NotificationEvent.COLIS_RETURNED,
      title: 'Colis restitué à l\'expéditeur',
      content: `${user.fullName} a restitué le colis #${record.trackingNumber} à son expéditeur.`,
      relatedEntity: 'PACKAGE',
      relatedEntityId: record.id,
      packageId: record.id,
      actorUserId: user.id ?? null,
    });

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }
}

export const colisService = new ColisService();
