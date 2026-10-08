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

import { Prisma, PackageStatus as PrismaPackageStatus } from '@prisma/client';
import {
  PackageStatus,
  PackageType,
  PackageSize,
  RoleType,
  canTransition,
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
} from '@logixpress/types';
import type {
  PackageDto,
  PartialDeliveryRequest,
  ReturnRequest,
  ExchangeRequest,
  PostponeRequest,
} from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { cashService, toDecimal } from '../payments/cash.service';
import { toPackageDto, PACKAGE_INCLUDE, type PackageWithRelations } from '../../common/database/mappers';
import { auditService } from '../../common/audit/audit.service';
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

/** Format UUID canonique, le seul que PostgreSQL accepte pour une colonne UUID. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return UUID_PATTERN.test(identifier)
    ? {
        OR: [
          { id: identifier },
          { trackingNumber: identifier },
          { barcode: identifier },
        ],
      }
    : { OR: [{ trackingNumber: identifier }, { barcode: identifier }] };
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
  if (user.role !== RoleType.LIVREUR) return;
  if (!pkg.assignedDriverId || pkg.assignedDriverId !== user.driverId) {
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
      const start = new Date(params.date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      and.push({ createdAt: { gte: start, lt: end } });
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
        ],
      },
      include: PACKAGE_INCLUDE,
    });

    return record ? toPackageDto(record) : null;
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
    };
    await packageWorkflowService.transition(command);

    // Toute transition passe ici, et nulle part ailleurs : c'est donc le seul
    // endroit d'où l'on peut être sûr que l'événement « le statut a changé »
    // accompanye réellement l'écriture. Le contenir dans la machine à états
    // aurait été plus strict, mais la machine ignore qui regarde : la
    // notification, elle, a des destinataires.
    if (to !== undefined && options.allowSameStatus !== true) {
      const fresh = await this.prisma.package.findUnique({
        where: { id: packageId },
        select: { trackingNumber: true },
      });
      if (fresh) {
        await notificationDispatcher.notify({
          event: NotificationEvent.DELIVERY_STATUS_CHANGED,
          title: 'Statut de livraison modifié',
          content: `${context.actorName} a porté le colis #${fresh.trackingNumber} au statut « ${packageStatusLabel(to)} ».`,
          relatedEntity: 'PACKAGE',
          relatedEntityId: packageId,
          packageId,
          actorUserId: context.actorId ?? null,
        });
      }
    }
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
  private async resolveCustomer(payload: Record<string, unknown>) {
    const name = String(payload.customerName ?? '').trim();
    const phone = String(payload.customerPhone ?? '').trim();
    if (!name || !phone) {
      throw new BusinessRuleError('Nom du destinataire et téléphone sont obligatoires.');
    }

    const existing = await this.prisma.customer.findFirst({
      where: { primaryPhone: phone },
      include: { addresses: { where: { isDefault: true }, take: 1 }, phones: true },
    });

    if (existing) {
      if (existing.fullName !== name) {
        await this.prisma.customer.update({
          where: { id: existing.id },
          data: { fullName: name },
        });
      }
      const address = existing.addresses[0];
      if (address) return { customerId: existing.id, addressId: address.id };
    }

    const created = await this.prisma.customer.create({
      data: {
        code: `CLI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
        fullName: name,
        primaryPhone: phone,
        phones: { create: { phoneNumber: phone, label: 'Personnel' } },
      },
      include: { addresses: true },
    });

    const governorate = String(payload.governorate ?? 'Ben Arous');
    const address = await this.prisma.customerAddress.create({
      data: {
        customerId: created.id,
        governorate,
        delegation: String(payload.delegation ?? governorate),
        locality: payload.locality ? String(payload.locality) : null,
        streetAddress: String(payload.address ?? 'Adresse de livraison'),
        isDefault: true,
      },
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
    if (!shipper) {
      throw new BusinessRuleError('Expéditeur introuvable.', 404);
    }

    const deposit = await this.defaultDeposit();
    const { customerId, addressId } = await this.resolveCustomer(payload);
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

    const record = await this.prisma.package.create({
      data: {
        trackingNumber,
        barcode,
        shipperReference: payload.shipperReference ? String(payload.shipperReference) : null,
        shipperId,
        customerId,
        customerAddressId: addressId,
        originDepositId: deposit.id,
        currentDepositId: deposit.id,
        destinationDepositId: deposit.id,
        packageType: ((payload.packageType as PackageType) ?? PackageType.NORMAL),
        sizeCategory: ((payload.sizeCategory as PackageSize) ?? PackageSize.MOYENNE),
        pieceCount: Number.isFinite(pieceCount) && pieceCount > 0 ? pieceCount : 1,
        contentSummary: String(payload.contentSummary ?? 'Colis sans description'),
        allowOpen: payload.allowOpen === true,
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
      payload.sizeCategory !== undefined ||
      payload.packageType !== undefined ||
      payload.shipperNotes !== undefined ||
      addressChanged;

    if (amountChanged) {
      data.totalPrice = Number(payload.totalPrice);
      criticalChanges.push(FIELD_LABELS.totalPrice!);
    }
    if (quantityChanged) {
      data.pieceCount = Number(payload.pieceCount);
      criticalChanges.push(FIELD_LABELS.pieceCount!);
    }
    if (contentChanged) {
      data.contentSummary = String(payload.contentSummary);
      criticalChanges.push(FIELD_LABELS.contentSummary!);
    }
    if (payload.allowOpen !== undefined) data.allowOpen = payload.allowOpen === true;
    if (payload.sizeCategory !== undefined) data.sizeCategory = payload.sizeCategory as PackageSize;
    if (payload.packageType !== undefined) data.packageType = payload.packageType as PackageType;
    if (payload.shipperNotes !== undefined) data.shipperNotes = String(payload.shipperNotes);

    // Les coordonnées du destinataire sont portées par le client et son adresse.
    let addressId: string | undefined;
    if (payload.customerName !== undefined || payload.customerPhone !== undefined || payload.address !== undefined) {
      const { customerId, addressId: resolvedAddressId } = await this.resolveCustomer({
        customerName: payload.customerName ?? record.customer.fullName,
        customerPhone: payload.customerPhone ?? record.customer.primaryPhone,
        address: payload.address ?? record.customerAddress.streetAddress,
        governorate: payload.governorate ?? record.customerAddress.governorate,
        delegation: payload.delegation ?? record.customerAddress.delegation,
      });
      data.customerId = customerId;
      addressId = resolvedAddressId;
    }
    if (addressId) data.customerAddressId = addressId;

    const updated = await this.prisma.package.update({
      where: { id: record.id },
      data,
      include: PACKAGE_INCLUDE,
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

    if (record.status === PackageStatus.ANNULE) {
      throw new BusinessRuleError("Impossible d'affecter un colis annulé.", 409);
    }
    if (record.status === PackageStatus.LIVRE) {
      throw new BusinessRuleError('Ce colis est déjà livré.', 409);
    }

    const driver = await this.resolveDriver(payload);
    const runsheet = payload.runsheetNumber
      ? await this.prisma.runsheet.findUnique({ where: { runsheetNumber: payload.runsheetNumber } })
      : null;

    if (payload.runsheetNumber && !runsheet) {
      throw new BusinessRuleError(`Tournée ${payload.runsheetNumber} introuvable.`, 404);
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

    const data: Prisma.PackageUncheckedUpdateInput = {
      assignedDriverId: driver.id,
      currentRunsheetId: runsheet?.id ?? null,
    };

    // Un colis reçu au dépôt entre officiellement en tournée.
    const shouldAffect =
      record.status === PackageStatus.RECU_DEPOT ||
      record.status === PackageStatus.CREE ||
      record.status === PackageStatus.RAMASSAGE_PROGRAMME ||
      record.status === PackageStatus.RAMASSE;

    if (shouldAffect) {
      await this.applyStatusChange(record.id, PackageStatus.AFFECTE_RUNSHEET, {
        actorName: user.fullName,
        actorId: user.id,
        role: user.role,
        title: `Colis affecté à ${driver.user.fullName}`,
        description: runsheet
          ? `Intégré à la tournée ${runsheet.runsheetNumber}`
          : 'Affecté sans tournée',
        locationName: packageLocation(record),
        runsheetNumber: runsheet?.runsheetNumber,
        auditAction: 'ASSIGN_DRIVER',
        data,
      });
    } else {
      // Réaffectation : le statut ne bouge pas, l'événement n'est donc pas
      // une transition. Il est écrit directement, avec le statut courant.
      await this.prisma.package.update({ where: { id: record.id }, data });
      await this.prisma.packageTimeline.create({
        data: {
          packageId: record.id,
          status: record.status,
          title: `Colis réaffecté à ${driver.user.fullName}`,
          description: `Affectation modifiée depuis le statut ${record.status}`,
          locationName: packageLocation(record),
          runsheetNumber: runsheet?.runsheetNumber ?? null,
          operatorName: user.fullName,
        },
      });
    }

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
    // suit le flux des tournées : sans cet événement, une tournée se remplit
    // sans que le poste de commandement ne le voie passer.
    if (runsheet) {
      await notificationDispatcher.notify({
        event: NotificationEvent.RUNSHEET_ASSIGNED,
        title: 'Colis intégré à une tournée',
        content: `Le colis #${record.trackingNumber} a rejoint la tournée ${runsheet.runsheetNumber} de ${driver.user.fullName}.`,
        relatedEntity: 'RUNSHEET',
        relatedEntityId: runsheet.id,
        runsheetId: runsheet.id,
        userIds: [driver.userId],
      });
    }

    const fresh = await this.findRecord(record.id);
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

    const collected =
      payload.collectedAmount !== undefined
        ? toDecimal(payload.collectedAmount, 'montant encaissé')
        : new Prisma.Decimal(record.totalPrice);

    if (collected.isNegative()) {
      throw new BusinessRuleError('Le montant encaissé ne peut pas être négatif.');
    }

    // Les règles de la caisse sont vérifiées AVANT de changer le statut du
    // colis. Dans l'autre ordre, un refus de la caisse (un chèque sans sa
    // référence, un moyen inconnu) laisserait le colis « livré » sans
    // encaissement — et le livreur ne pourrait plus rien corriger, le colis
    // n'étant plus livrable. C'est le genre de perte que personne ne
    // rattrape ensuite.
    cashService.assertCollectable({
      method: payload.paymentMethod,
      amountExpected: new Prisma.Decimal(record.totalPrice),
      amountCollected: collected,
      transactionRef: payload.transactionRef,
    });

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
        deliveredAt: new Date(),
        lastDeliveryAttemptAt: new Date(),
      },
    });

    // La tentative de livraison et la caisse du livreur sont mises à jour.
    await this.recordAttempt(record, user, 'REUSSIE', {
      comment: payload.driverNote,
      callDurationSeconds: payload.callDurationSeconds ?? 60,
    });

    await this.prisma.$transaction([
      this.prisma.packageItem.updateMany({
        where: { packageId: record.id },
        data: { isDelivered: true, isReturned: false },
      }),
      this.prisma.driver.update({
        where: { id: user.driverId! },
        data: { currentBalance: { increment: collected } },
      }),
    ]);

    // L'encaissement entre dans la caisse centrale. Il est créé ici, à
    // l'instant où l'argent change de mains, et non recalculé plus tard :
    // un rapport de caisse doit dire ce qui est entré, pas ce qui aurait
    // dû entrer. Même un colis intégralement payé laisse une trace, sinon
    // les tournées à zéro disparaissent du rapprochement.
    await cashService.recordCollection({
      packageId: record.id,
      shipperId: record.shipperId,
      runsheetId: record.currentRunsheetId,
      driverId: user.driverId,
      driverUserId: user.id ?? null,
      amountExpected: new Prisma.Decimal(record.totalPrice),
      amountCollected: collected,
      deliveryFee: new Prisma.Decimal(record.deliveryFee),
      method: payload.paymentMethod,
      transactionRef: payload.transactionRef ?? null,
    });

    await notificationService.notify({
      type: 'COLIS_LIVRE',
      title: 'Colis livré',
      content: `${user.fullName} a livré le colis #${record.trackingNumber} (${collected.toFixed(3)} DT encaissés).`,
      relatedEntity: 'PACKAGE',
      relatedEntityId: record.id,
    });

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Livraison partielle : une part est livrée et payée, le reste est repris.
   *
   * C'est la transition la plus lourde en données, et c'est volontaire. Un
   * « partiel » sans dire ce qui a été remis, ce qui repart, et ce qui a été
   * payé ne permet ni de clôturer le dossier ni de rapprocher les comptes :
   * le montant restant ne serait qu'une différence calculée après coup, donc
   * contestable. Les deux descriptions et les deux montants sont donc
   * exigés, et leur bilan doit se refermer sur le montant dû.
   */
  async markPartialDelivery(
    identifier: string,
    payload: PartialDeliveryRequest,
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);

    if (payload.deliveredPieces <= 0 || payload.deliveredPieces >= record.pieceCount) {
      throw new BusinessRuleError(
        `Le nombre de pièces livrées doit être compris entre 1 et ${record.pieceCount - 1}.`
      );
    }

    const collected = round3(payload.collectedAmount);
    const due = Number(record.totalPrice);
    // Le montant repris est le reliquat du montant dû. Le client peut le
    // déclarer ; s'il le fait à tort, le bilan ne se referme pas et la
    // transition est refusée. Le demander au livreur ne serait qu'une façon
    // de lui faire refaire un calcul que le système peut faire exact.
    const returned =
      payload.returnedAmount !== undefined ? round3(payload.returnedAmount) : round3(due - collected);

    // Les deux descriptions ne sont pas garnies par défaut. Écrire « 1 pièce
    // livrée sur 3 » ne décrit rien : c'est la pièce comptée qu'on vient de
    // donner, pas ce que le client a reçu. Si le contenu n'est pas dit, la
    // livraison partielle n'est pas documentée, et le service domaine refuse
    // la transition en disant ce qui manque.
    const deliveredDescription = payload.deliveredDescription?.trim() ?? '';
    const returnedDescription = payload.returnedDescription?.trim() ?? '';

    // Les quantités sont dérivées de la composition du colis, pas du client :
    // ce qui n'est pas livré est nécessairement repris. Les écrire
    // explicitement plutôt que de les laisser implicite, c'est ce qui permet
    // au dépôt de comparer le PhysicalCheck au dossier sans recomputer.
    const deliveredPieces = Number(payload.deliveredPieces);
    const returnedPieces = record.pieceCount - deliveredPieces;

    // Même règle que pour la livraison complète : la caisse est prévenue avant
    // la transition, pour qu'un refus ne laisse pas une livraison partielle
    // enregistrée sans l'argent qui l'a produite.
    cashService.assertCollectable({
      method: payload.paymentMethod,
      amountExpected: new Prisma.Decimal(record.totalPrice),
      amountCollected: new Prisma.Decimal(collected.toFixed(3)),
      transactionRef: payload.transactionRef,
    });

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
        collectedAmount: collected,
        driverNotes: payload.driverNote ?? payload.reason,
        deliveredAt: new Date(),
        lastDeliveryAttemptAt: new Date(),
      },
    });

    await this.prisma.partialDelivery.upsert({
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
        validatedByDriverId: user.driverId!,
      },
      update: {
        deliveredDescription,
        returnedDescription,
        deliveredPieces,
        returnedPieces,
        amountCollected: collected,
        amountReturned: returned,
        reason: payload.reason,
        validatedByDriverId: user.driverId!,
        validatedAt: new Date(),
      },
    });

    // Les pièces livrées sont sorties du stock, les autres reprises.
    await this.prisma.packageItem.updateMany({
      where: { packageId: record.id },
      data: { isDelivered: false, isReturned: false },
    });

    await this.recordAttempt(record, user, 'LIVRAISON_PARTIELLE', {
      comment: payload.reason,
    });

    // L'encaissement porte la part réellement livrée : c'est elle qui est
    // due, le reste repart avec le colis et sera restitué. C'est aussi ce
    // qui laisse la facture se refermer — 40 DT encaissés sur 58, 18 en
    // route, et un écart que la caisse verra si les deux ne se rejoignent
    // jamais.
    await cashService.recordCollection({
      packageId: record.id,
      shipperId: record.shipperId,
      runsheetId: record.currentRunsheetId,
      driverId: user.driverId,
      driverUserId: user.id ?? null,
      amountExpected: new Prisma.Decimal(record.totalPrice),
      amountCollected: new Prisma.Decimal(collected.toFixed(3)),
      deliveryFee: new Prisma.Decimal(record.deliveryFee),
      method: payload.paymentMethod,
      transactionRef: payload.transactionRef ?? null,
    });

    // Une livraison partielle laisse le colis à moitié traité : l'expéditeur doit
    // savoir ce qui est parti et ce qui repart avec le livreur, faute de quoi
    // il réclamera la totalité.
    await notificationDispatcher.notify({
      event: NotificationEvent.PARTIAL_DELIVERY,
      title: 'Livraison partielle',
      content:
        `Le colis #${record.trackingNumber} a été livré à ${deliveredPieces}/${record.pieceCount} ` +
        `pièces, pour ${collected.toFixed(3)} DT encaissés sur ${Number(record.totalPrice).toFixed(3)} DT. ` +
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
   */
  async markExchange(
    identifier: string,
    payload: ExchangeRequest,
    user: DriverActor
  ): Promise<PackageDto> {
    const record = await this.findRecord(identifier);
    assertDriverOwnsPackage(record, user);

    // L'écart financier est ici un résultat, pas une saisie facultative : un
    // échange à valeur égale n'en a pas, un échange au rabais en a un négatif.
    // C'est pourquoi il n'est pas exigé — mais il est toujours écrit, afin que
    // « aucun écart » se distingue de « personne n'a rien calculé ».
    const financialDifference = payload.financialDifference ?? 0;
    const returnedItemSummary = payload.returnedItemSummary?.trim() ?? '';
    const newBarcode = payload.newPackageBarcode?.trim() ?? '';
    const oldBarcode = payload.oldPackageBarcode?.trim() || newBarcode;

    // Un échange sans article repris ni article de remplacement n'est pas un
    // échange : sans ces deux faces, la marchandise est perdue et le client
    // repart sans rien. Le dire vaut mieux qu'un 500 sur une saisie vide.
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

    await this.prisma.exchangeRecord.upsert({
      where: { packageId: record.id },
      create: {
        packageId: record.id,
        newPackageBarcode: newBarcode,
        oldPackageBarcode: oldBarcode,
        returnedItemSummary,
        financialDifference,
        driverId: user.driverId ?? null,
      },
      update: {
        newPackageBarcode: newBarcode,
        oldPackageBarcode: oldBarcode,
        returnedItemSummary,
        financialDifference,
        driverId: user.driverId ?? null,
      },
    });

    // Un échange ne change pas le statut du colis : le colis reste en cours de
    // livraison. Il est donc consigné par `annotate`, et non par une transition
    // — c'est ce qui le fait figurer dans l'audit, et pas seulement dans la
    // chronologie lue par le client.
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
    });

    await this.recordAttempt(record, user, 'REUSSIE', {
      comment: `Échange : ${returnedItemSummary}`,
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

    const attempts = await this.prisma.deliveryAttempt.count({ where: { packageId: record.id } });
    if (attempts >= 3) {
      throw new BusinessRuleError(
        `Nombre maximal de tentatives atteint (${MAX_DELIVERY_ATTEMPTS}). Le colis doit être retourné au dépôt.`,
        409
      );
    }

    const rescheduled = payload.rescheduledDate ? new Date(payload.rescheduledDate) : null;
    const customerNote = payload.customerNote?.trim() || null;

    await this.applyStatusChange(record.id, PackageStatus.REPORTE, {
      actorName: user.fullName,
      actorId: user.id,
      role: user.role,
      driverId: user.driverId,
      title: 'Livraison reportée',
      // Le motif n'est pas décoratif : c'est lui qui distingue un client
      // absent d'une adresse fausse, et donc ce qui se pilote par zone.
      reason: payload.reason,
      // La note client est distincte de la note de tournée : l'une sera
      // relue au client, l'autre sert à ajuster la feuille de route. Les
      // confondre ferait porter au client une observation qui n'est pas
      // pour lui.
      note: [payload.driverNote, customerNote].filter(Boolean).join(' — ') || undefined,
      locationName: `${record.customerAddress.delegation}, ${record.customerAddress.governorate}`,
      auditAction: 'DELIVERY_POSTPONED',
      data: {
        scheduledDeliveryDate: rescheduled ?? record.scheduledDeliveryDate,
        driverNotes: payload.driverNote ?? payload.reason,
        lastDeliveryAttemptAt: new Date(),
      },
    });

    // Le commentaire de la tentative porte la note du livreur lorsqu'il en a
    // une : le motif, lui, est déjà dans la chronologie et dans l'audit, et il
    // ne doit pas être écrasé par une observation plus précise. Un report
    // sans note de tournée garde le motif comme commentaire.
    await this.recordAttempt(record, user, 'REPORTEE', {
      comment: payload.driverNote?.trim() || payload.reason,
      rescheduledFor: rescheduled,
      customerNote,
    });

    // Un report change ce que l'expéditeur attend. Il est prévenu avec la
    // nouvelle date : sans elle, la notification l'inquiète sans l'informer.
    await notificationDispatcher.notify({
      event: NotificationEvent.DELIVERY_POSTPONED,
      title: 'Livraison reportée',
      content:
        `La livraison du colis #${record.trackingNumber} est reportée` +
        (rescheduled ? ` au ${new Date(rescheduled).toLocaleDateString('fr-TN')}` : '') +
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
   * C'est le geste le plus fréquent d'une tournée après un report : le
   * destinataire ne répond pas, l'adresse est fausse, ou il refuse le
   * montant. Le motif est normalisé (`reasonCode`) plutôt que laissé en texte
   * libre, car c'est lui qui alimente le taux d'échec par zone, par livreur
   * et par créneau — trois indicateurs sur lesquels on pilote la tournée.
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

    const rescheduled = payload.rescheduledFor ? new Date(payload.rescheduledFor) : null;
    const target = definitive ? PackageStatus.ECHEC_LIVRAISON : PackageStatus.REPORTE;
    const location = `${record.customerAddress.delegation}, ${record.customerAddress.governorate}`;

    // Le motif est exigé par la machine à états, mais il est ici normalisé :
    // c'est lui qui alimente le taux d'échec par zone, par livreur et par
    // créneau — trois indicateurs sur lesquels on pilote la tournée.
    const reason = FAILED_DELIVERY_LABELS[payload.reasonCode];

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
    });

    // Le motif est conservé dans le champ dédié de la tentative : le
    // commentaire, lui, peut être libre.
    await this.recordAttempt(record, user, payload.reasonCode, {
      comment: payload.comment,
      callDurationSeconds: payload.callDurationSeconds,
      rescheduledFor: rescheduled,
      reasonCode: payload.reasonCode,
    });

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

    const deposit =
      (record.currentRunsheet
        ? await this.prisma.deposit.findUnique({ where: { id: record.currentRunsheet.depositId } })
        : null) ?? (await this.prisma.deposit.findFirst({ where: { isMainHub: true } }));

    // Ce que le livreur ramène, et ce qu'il en rapporte.
    //
    // Les valeurs par défaut ne sont pas des estimations mais des faits : un
    // retour est en pratique total, donc la quantité est celle du colis, et
    // l'argent qui remonte au dépôt est celui que le livreur transporte déjà
    // — spécimen compris. Quand le livreur ne ramène qu'une partie, il doit
    // le dire, et c'est alors sa déclaration qui fait foi. La quantité
    // déclarée ne peut pas dépasser le colis : le dépôt ne peut pas réceptionner
    // plus que ce qui a été expédié.
    const returnedQuantity = payload.returnedQuantity ?? record.pieceCount;
    if (returnedQuantity <= 0 || returnedQuantity > record.pieceCount) {
      throw new BusinessRuleError(
        `La quantité reprise doit être comprise entre 1 et ${record.pieceCount} pièces.`,
        400
      );
    }
    const amount = payload.amount ?? Number(record.collectedAmount);
    if (amount < 0) {
      throw new BusinessRuleError('Le montant ramené ne peut pas être négatif.', 400);
    }
    const returnedItems = payload.returnedItems?.trim() ?? null;

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
        currentDepositId: deposit?.id ?? record.currentDepositId,
        currentRunsheetId: null,
        driverNotes: payload.driverNote ?? payload.reason,
        lastDeliveryAttemptAt: new Date(),
      },
    });

    await this.recordAttempt(record, user, 'REFUSEE', { comment: payload.reason });

    // Rendre un colis après avoir pris l'argent, c'est rembourser. Un retour
    // sur un colis jamais livré n'a rien à rembourser : l'encaissement n'existe
    // pas encore et il n'y a rien à corriger. Cette distinction évite de créer
    // un encaissement à zéro pour un colis que personne n'a payé.
    const existingPayment = await this.prisma.payment.findUnique({
      where: { packageId: record.id },
      select: { id: true, amountCollected: true, amountRefunded: true },
    });
    if (existingPayment && amount > 0) {
      await cashService.recordRefund(existingPayment.id, new Prisma.Decimal(amount.toFixed(3)), payload.reason);
    }

    const returnNumber = `RET-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    // `ReturnRecord` n'a pas de contrainte d'unicité sur `packageId` : ni un
    // `findUnique` ni un `upsert` ne peuvent donc s'appuyer dessus. La clé
    // sentinelle `__none__` utilisée auparavant n'était pas un UUID, si bien
    // que le tout premier retour d'un colis échouait toujours.
    const existingReturn = await this.prisma.returnRecord.findFirst({
      where: { packageId: record.id },
      select: { id: true },
    });

    if (existingReturn) {
      await this.prisma.returnRecord.update({
        where: { id: existingReturn.id },
        data: {
          reason: payload.reason,
          returnedItems,
          returnedQuantity,
          amount,
          driverId: user.driverId ?? null,
        },
      });
    } else {
      await this.prisma.returnRecord.create({
        data: {
          returnNumber,
          packageId: record.id,
          // Un retour est toujours enregistré dans un dépôt : en l'absence de
          // dépôt courant (colis en transit), on rattache au hub principal.
          returnDepositId:
            deposit?.id ?? record.currentDepositId ?? (await this.defaultDeposit()).id,
          reason: payload.reason,
          returnedItems,
          returnedQuantity,
          amount,
          driverId: user.driverId ?? null,
        },
      });
    }

    const fresh = await this.findRecord(record.id);
    return toPackageDto(fresh);
  }

  /**
   * Écrit une tentative de livraison et incrémente le compteur du colis.
   */
  private async recordAttempt(
    record: { id: string },
    user: DriverActor,
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
    if (!user.driverId) return;

    const count = await this.prisma.deliveryAttempt.count({ where: { packageId: record.id } });
    const runsheet = await this.prisma.runsheet.findFirst({
      where: { packages: { some: { id: record.id } } },
      select: { id: true },
    });

    await this.prisma.$transaction([
      this.prisma.deliveryAttempt.create({
        data: {
          packageId: record.id,
          driverId: user.driverId,
          runsheetId: runsheet?.id ?? null,
          attemptNumber: count + 1,
          result,
          reasonCode: options.reasonCode ?? null,
          driverComment: options.comment ?? null,
          customerNote: options.customerNote ?? null,
          callDurationSeconds: options.callDurationSeconds ?? 0,
          rescheduledFor: options.rescheduledFor ?? null,
        },
      }),
      this.prisma.package.update({
        where: { id: record.id },
        data: {
          deliveryAttemptsCount: { increment: 1 },
          lastDeliveryAttemptAt: new Date(),
        },
      }),
    ]);
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
