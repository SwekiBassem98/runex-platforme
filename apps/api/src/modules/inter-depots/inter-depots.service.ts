/**
 * Transferts inter-dépôts : le mouvement des charges entre sites.
 *
 * Un transfert déplace des colis d'un dépôt vers un autre. Trois invariants
 * portent tout le module :
 *
 * 1. **Rien ne se déplace silencieusement.** Chaque étape du cycle écrit un
 *    événement de suivi sur chacun des colis concernés. L'historique d'un colis
 *    doit pouvoir se lire seul et raconter le trajet complet — dépôt de départ,
 *    passage en inter-dépôt, dépôt d'arrivée, réception.
 *
 * 2. **Le dépôt suit le colis, pas l'inverse.** Un colis en transit n'est
 *    dans aucun dépôt : il a quitté le stock de l'origine sans être encore
 *    disponible à l'arrivée. Lui laisser un dépôt courant ferait croire qu'il
 *    est disponible.
 *
 * 3. **Les transitions sont validées par le modèle, pas par l'écran.** Le
 *    client peut appeler n'importe quelle route dans n'importe quel ordre ;
 *    c'est la table `INTER_DEPOT_TRANSITIONS` et la machine à états du colis
 *    qui décident. L'interface ne fait que refléter cette décision.
 *
 * Le cycle demandé est `CRE → PREPARE → EN_TRANSIT → RECU`, plus `ANNULE`.
 * `EN_TRANSIT` est directement atteignable depuis `CRE` : sur le terrain,
 * préparer et charger sont un seul geste, et imposer deux validations
 * successives n'ajouterait qu'un clic.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { notificationService } from '../../common/notifications/notification.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import type { PackageStatus as PrismaPackageStatus } from '@prisma/client';
import {
  InterDepotStatus,
  PackageStatus,
  RoleType,
  INTER_DEPOT_TRANSITIONS,
  INTER_DEPOT_STATUS_LABELS,
  canTransitionInterDepot,
  canTransition as canTransitionPackage,
  NotificationEvent,
} from '@logixpress/types';
import { notFound, badRequest, conflict, asUuid } from '../../common/errors/api-error';
import { packageWorkflowService } from '../colis/package-workflow.service';

/**
 * Pont entre l'énumération générée par Prisma et celle du package partagé.
 *
 * Les deux portent les mêmes valeurs mais sont des types distincts : sans
 * conversion explicite, le service ne peut pas passer un statut lu en base à
 * la machine à états. Même conversion que dans le module Colis.
 */
const toSharedStatus = (status: PrismaPackageStatus): PackageStatus =>
  status as unknown as PackageStatus;
const toPrismaStatus = (status: PackageStatus): PrismaPackageStatus =>
  status as unknown as PrismaPackageStatus;

export interface TransferPackageRef {
  id: string;
  trackingNumber: string;
  status: PackageStatus;
  pieceCount: number;
  customerName: string;
}

/** Une étape de la chronologie visuelle du mouvement. */
export interface MovementStep {
  key: string;
  label: string;
  status: InterDepotStatus;
  location: string;
  description: string;
  timestamp: string | null;
  /** L'étape est-elle atteinte à cet instant du cycle ? */
  reached: boolean;
}

export interface InterDepotDto {
  id: string;
  transferNumber: string;
  sourceDeposit: string;
  sourceDepositId: string;
  destinationDeposit: string;
  destinationDepositId: string;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  scheduledDate: string | null;
  sealNumber: string | null;
  status: InterDepotStatus;
  statusLabel: string;
  /** Nombre de colis du lot. */
  totalPackages: number;
  /** Somme des pièces transportées. */
  totalPieces: number;
  receivedPackages: number;
  /** Écart expédié/reçu. Nul tant que la réception n'a pas eu lieu. */
  discrepancy: number;
  /** La réception a-t-elle été faite en écart ? */
  hasDiscrepancy: boolean;
  notes: string | null;
  dispatchNotes: string | null;
  receptionNotes: string | null;
  packages: TransferPackageRef[];
  /** Chronologie du mouvement, prête à afficher telle quelle. */
  movement: MovementStep[];
  /** Transitions encore possibles depuis l'état courant. */
  allowedTransitions: InterDepotStatus[];
  createdAt: string;
  preparedAt: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

const TRANSFER_INCLUDE = {
  sourceDeposit: { select: { id: true, name: true, phone: true, city: true } },
  destinationDeposit: { select: { id: true, name: true, phone: true, city: true } },
  transporterDriver: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
  packages: {
    include: { customer: { select: { fullName: true } } },
    orderBy: { trackingNumber: 'asc' },
  },
} as const;

/**
 * Statuts depuis lesquels un colis peut quitter un dépôt vers un autre.
 *
 * La liste est volontairement courte. Un colis se transfère parce qu'il est
 * physiquement dans un dépôt et n'est engagé nulle part : `RECU_DEPOT` est le
 * cas normal, `RETOUR_DEPOT` le cas du rapatrié qui doit être réorienté. Tout
 * le reste est refusé, avec un motif nommé — voir `refusalReason`.
 */
const TRANSFERABLE_STATUSES: readonly PackageStatus[] = [
  PackageStatus.RECU_DEPOT,
  PackageStatus.RETOUR_DEPOT,
];

/**
 * Statut du colis après chaque étape du transfert.
 *
 * La table est la traduction directe du mouvement physique : le lot est
 * conditionné, il roule, il est pointé à l'arrivée. L'annulation, elle, ne
 * suit pas ce chemin : le colis n'a jamais quitté le dépôt, il y revient.
 */
const STATUS_ON_TRANSFER_STEP: Partial<Record<InterDepotStatus, PackageStatus>> = {
  [InterDepotStatus.CRE]: PackageStatus.EN_LOT_INTER_DEPOT,
  [InterDepotStatus.PREPARE]: PackageStatus.EN_LOT_INTER_DEPOT,
  [InterDepotStatus.EN_TRANSIT]: PackageStatus.EN_TRANSIT_INTER_DEPOT,
  [InterDepotStatus.RECU]: PackageStatus.RECU_DEPOT_DESTINATION,
};

/** Libellé d'un dépôt tel qu'il apparaît dans l'historique d'un colis. */
const depositLabel = (name: string): string => `Dépôt ${name}`;

/**
 * Motif de refus nommé, pour un colis non transférable.
 *
 * Un refus qui dit seulement « statut incompatible » oblige l'opérateur à
 * deviner. Chaque cas interdit est donc nommé : c'est ce message que
 * l'utilisateur voit, et il dit ce qu'il faut faire.
 */
function refusalReason(
  status: PackageStatus,
  ctx: { inTransfer: boolean; assignedDriver: boolean; atSource: boolean }
): string {
  if (ctx.inTransfer) return 'déjà rattaché à un transfert en cours';
  if (status === PackageStatus.ANNULE) return 'annulé';
  if (status === PackageStatus.LIVRE) return 'livré';
  if (status === PackageStatus.RETOURNE_EXPEDITEUR) return 'restitué à son expéditeur';
  if (status === PackageStatus.LIVRAISON_PARTIELLE) return 'en cours de restitution';
  if (
    status === PackageStatus.EN_COURS_LIVRAISON ||
    status === PackageStatus.AFFECTE_RUNSHEET ||
    status === PackageStatus.EN_RUNSHEET_RETOUR
  ) {
    return 'engagé dans une tournée de livraison';
  }
  if (status === PackageStatus.EN_LOT_INTER_DEPOT) return 'déjà conditionné dans un lot';
  if (status === PackageStatus.EN_TRANSIT_INTER_DEPOT) return 'déjà en route vers un autre dépôt';
  if (ctx.assignedDriver) return 'affecté à un livreur';
  if (!ctx.atSource) return 'présent dans un autre dépôt';
  if (
    status === PackageStatus.CREE ||
    status === PackageStatus.RAMASSAGE_PROGRAMME ||
    status === PackageStatus.RAMASSE
  ) {
    return 'pas encore réceptionné au dépôt';
  }
  if (status === PackageStatus.REPORTE || status === PackageStatus.ECHEC_LIVRAISON) {
    return 'dans le processus de livraison, pas disponible au dépôt';
  }
  return `dans un état incompatible (${status})`;
}

export class InterDepotsService {
  async findAll(filters?: {
    status?: string;
    sourceDepositId?: string;
    destinationDepositId?: string;
  }): Promise<InterDepotDto[]> {
    const prisma = getPrisma();

    const where: Record<string, unknown> = {};
    if (filters?.status && filters.status !== 'ALL') {
      where.status = filters.status as InterDepotStatus;
    }
    if (filters?.sourceDepositId) {
      const id = asUuid(filters.sourceDepositId);
      if (id) where.sourceDepositId = id;
    }
    if (filters?.destinationDepositId) {
      const id = asUuid(filters.destinationDepositId);
      if (id) where.destinationDepositId = id;
    }

    const records = await prisma.interDepotTransfer.findMany({
      where,
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return records.map((record) => this.toDto(record));
  }

  async findByNumber(identifier: string): Promise<InterDepotDto | null> {
    const prisma = getPrisma();
    const record = await prisma.interDepotTransfer.findFirst({
      where: this.lookupWhere(identifier),
      include: TRANSFER_INCLUDE,
    });
    return record ? this.toDto(record) : null;
  }

  /**
   * Ouvre un transfert.
   *
   * La charge est contrôlée à l'entrée : chaque colis doit être physiquement
   * au dépôt source, dans un état transférable, et libre de tout engagement.
   * Le lot est constitué immédiatement — le colis quitte le stock du dépôt source et
   * passe en `EN_LOT_INTER_DEPOT` — pour qu'un même colis ne puisse pas être
   * engagé dans deux transferts à la fois.
   */
  async create(payload: {
    sourceDepositId: string;
    destinationDepositId: string;
    transporterDriverId: string;
    scheduledDate?: string;
    sealNumber?: string;
    packageIds?: string[];
    notes?: string;
    dispatchNotes?: string;
  }): Promise<InterDepotDto> {
    const prisma = getPrisma();

    const sourceId = asUuid(payload.sourceDepositId);
    const destinationId = asUuid(payload.destinationDepositId);
    if (!sourceId || !destinationId) {
      throw badRequest('Dépôt source ou destination invalide.');
    }
    if (sourceId === destinationId) {
      throw badRequest('Un transfert ne peut pas avoir la même source et la même destination.');
    }
    if (!payload.packageIds?.length) {
      throw badRequest('Un transfert doit porter au moins un colis.');
    }
    if (!payload.transporterDriverId) {
      throw badRequest('Le conducteur du transfert est obligatoire.');
    }

    // Les identifiants sont validés avant d'atteindre PostgreSQL : sans ce
    // contrôle, une saisie maladroite provoke une erreur de type de colonne
    // et remonte en 500, indiscernable d'une panne.
    const packageIds = payload.packageIds.map((id) => asUuid(id));
    if (packageIds.some((id) => id === null)) {
      const invalid = payload.packageIds.filter((id) => asUuid(id) === null);
      throw badRequest(
        `${invalid.length} identifiant(s) de colis sont mal formés : ${invalid
          .slice(0, 3)
          .join(', ')}.`
      );
    }
    const validPackageIds = packageIds as string[];

    const [source, destination] = await Promise.all([
      prisma.deposit.findUnique({ where: { id: sourceId } }),
      prisma.deposit.findUnique({ where: { id: destinationId } }),
    ]);
    if (!source || !destination) throw notFound('Dépôt source ou destination introuvable.');

    // Un dépôt fermé ne participe à aucun mouvement, ni entrant ni sortant.
    if (source.status === 'FERME' || source.isActive === false) {
      throw conflict(`Le dépôt ${source.name} est fermé : il ne peut pas expédier.`);
    }
    if (destination.status === 'FERME' || destination.isActive === false) {
      throw conflict(`Le dépôt ${destination.name} est fermé : il ne peut pas recevoir.`);
    }
    if (destination.status === 'MAINTENANCE') {
      throw conflict(
        `Le dépôt ${destination.name} est en maintenance : il accepte les réceptions, ` +
          'mais pas de nouveau transfert. Les réceptions en cours restent possibles.'
      );
    }

    const driverId = asUuid(payload.transporterDriverId);
    if (!driverId) throw badRequest('Identifiant de conducteur invalide.');
    const driver = await prisma.driver.findFirst({
      where: { id: driverId, deletedAt: null },
      include: { user: { select: { fullName: true, phone: true } } },
    });
    if (!driver) throw notFound('Conducteur introuvable.');
    if (!driver.isActive) throw badRequest(`Le conducteur ${driver.user.fullName} est inactif.`);

    const scheduledDate = this.parseDate(payload.scheduledDate);

    const packages = await prisma.package.findMany({
      where: { id: { in: validPackageIds }, deletedAt: null },
      include: { customer: { select: { fullName: true } } },
    });

    // Un identifiant fourni mais introuvable n'est pas une absence : c'est une
    // erreur de saisie, et la différence compte pour l'appelant.
    const found = new Set(packages.map((p) => p.id));
    const missing = validPackageIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw notFound(`${missing.length} colis introuvable(s) ou supprimés.`);
    }

    this.assertTransferable(packages, source, destination.id);

    const totalPieces = packages.reduce((sum, p) => sum + (p.pieceCount || 1), 0);
    const number = await this.nextTransferNumber();
    const now = new Date();

    // La constitution du lot et le départ du colis du stock source forment un
    // seul fait : s'ils étaient deux transactions, un échec entre les deux
    // laisserait des colis « en lot » sans transfert correspondant.
    const transfer = await prisma.$transaction(async (tx) => {
      const created = await tx.interDepotTransfer.create({
        data: {
          transferNumber: number,
          sourceDepositId: source.id,
          destinationDepositId: destination.id,
          transporterDriverId: driver.id,
          scheduledDate,
          sealNumber: payload.sealNumber?.trim() || null,
          totalPackages: packages.length,
          totalPieces,
          status: InterDepotStatus.CRE,
          notes: payload.notes?.trim() || null,
          dispatchNotes: payload.dispatchNotes?.trim() || null,
        },
      });

      for (const pkg of packages) {
        // La constitution du lot est une transition comme les autres : elle
        // passe par le service domaine, qui refuse un colis dont l'historique
        // ne permettrait pas le conditionnement. La transaction en cours est
        // transmise pour que le lot reste atomique.
        await packageWorkflowService.transition({
          packageId: pkg.id,
          to: PackageStatus.EN_LOT_INTER_DEPOT,
          actor: { fullName: driver.user.fullName, role: RoleType.AGENT_DEPOT },
          title: 'Constitution du lot inter-dépôt',
          note:
            `Colis conditionné pour le transfert ${created.transferNumber} ` +
            `vers ${destination.name} (${totalPieces} pièces).`,
          location: depositLabel(source.name),
          transferNumber: created.transferNumber,
          auditAction: 'TRANSFER_LOT_CONSTITUTION',
          data: { currentDepositId: null, interDepotTransferId: created.id },
          client: tx,
        });
      }

      return created;
    });

    await auditService.record({
      entityType: 'TRANSFER',
      entityId: transfer.id,
      action: 'TRANSFERT_CREE',
      reason:
        `Transfert ${number} créé : ${source.name} → ${destination.name}, ` +
        `${packages.length} colis, ${totalPieces} pièces.`,
      newValues: { status: InterDepotStatus.CRE, totalPackages: packages.length, totalPieces },
    });

    return (await this.reload(transfer.id))!;
  }

  /**
   * Fait avancer le transfert d'une étape.
   *
   * Toutes les règles sont vérifiées ici, jamais supposer que l'appelant suit
   * le parcours affiché. La validation est explicite même quand la table de
   * transitions suffit : une règle de negócio qu'on ne voit pas dans la table
   * devient une règle qu'on ne voit nulle part.
   */
  async transition(
    identifier: string,
    to: InterDepotStatus,
    actor: { id?: string; fullName: string },
    extra: { receivedPackages?: number; receptionNotes?: string } = {}
  ): Promise<InterDepotDto> {
    const prisma = getPrisma();

    const record = await prisma.interDepotTransfer.findFirst({
      where: this.lookupWhere(identifier),
      include: TRANSFER_INCLUDE,
    });
    if (!record) throw notFound('Transfert introuvable.');

    // Garde explicite sur la double réception : c'est l'erreur la plus coûteuse
    // du module, puisqu'elle pousse à corriger un comptage déjà validé.
    if (to === InterDepotStatus.RECU && record.status === InterDepotStatus.RECU) {
      throw conflict(
        `Le transfert ${record.transferNumber} a déjà été réceptionné ` +
          `le ${record.receivedAt ? new Date(record.receivedAt).toLocaleDateString('fr-FR') : '—'}. ` +
          "Une réception ne se refait pas : passez par une correction d'écart."
      );
    }

    if (!canTransitionInterDepot(record.status as InterDepotStatus, to)) {
      const allowed = INTER_DEPOT_TRANSITIONS[record.status as InterDepotStatus] ?? [];
      throw conflict(
        `Transition impossible : ${INTER_DEPOT_STATUS_LABELS[record.status as InterDepotStatus]} ` +
          `→ ${INTER_DEPOT_STATUS_LABELS[to]}. ` +
          (allowed.length
            ? `Transitions possibles : ${allowed
                .map((s) => INTER_DEPOT_STATUS_LABELS[s])
                .join(', ')}.`
            : 'Ce transfert est terminé : il ne peut plus changer d\'état.')
      );
    }

    const now = new Date();
    let received = record.receivedPackages;
    let status = to;

    if (to === InterDepotStatus.RECU) {
      received = this.parseReceivedCount(extra.receivedPackages, record.totalPackages);
      // L'écart est un fait constaté, pas une appréciation : la réception est
      // toujours enregistrée, et c'est l'écart qui la signale. La refuser
      // laisserait la perte sans trace et le transfert bloqué.
      status = InterDepotStatus.RECU;
    }

    await this.applyTransfer(record.id, record, status, {
      actor,
      now,
      received,
      receptionNotes: extra.receptionNotes,
    });

    await auditService.record({
      entityType: 'TRANSFER',
      entityId: record.id,
      action: `TRANSFERT_${status}`,
      reason:
        `Transfert ${record.transferNumber} : ` +
        `${INTER_DEPOT_STATUS_LABELS[record.status as InterDepotStatus]} → ` +
        `${INTER_DEPOT_STATUS_LABELS[status]}.`,
      previousValues: { status: record.status },
      newValues: { status, receivedPackages: received },
      userId: actor.id,
    });

    return (await this.reload(record.id))!;
  }

  /** Réception au dépôt d'arrivée. */
  async receive(
    identifier: string,
    actor: { id?: string; fullName: string },
    extra: { receivedPackages?: number; receptionNotes?: string } = {}
  ): Promise<InterDepotDto> {
    return this.transition(identifier, InterDepotStatus.RECU, actor, extra);
  }

  /** Préparation du lot. */
  async prepare(identifier: string, actor: { id?: string; fullName: string }): Promise<InterDepotDto> {
    return this.transition(identifier, InterDepotStatus.PREPARE, actor);
  }

  /** Départ du véhicule. */
  async dispatch(identifier: string, actor: { id?: string; fullName: string }): Promise<InterDepotDto> {
    return this.transition(identifier, InterDepotStatus.EN_TRANSIT, actor);
  }

  /**
   * Annulation.
   *
   * Les colis du lot redeviennent disponibles au dépôt d'origine. C'est la
   * seule étape où un colis revient en arrière dans la machine à états, et ce
   * n'est pas un détour : un transfert annulé n'a jamais eu lieu.
   */
  async cancel(identifier: string, actor: { id?: string; fullName: string }): Promise<InterDepotDto> {
    const prisma = getPrisma();
    const record = await prisma.interDepotTransfer.findFirst({
      where: this.lookupWhere(identifier),
      include: TRANSFER_INCLUDE,
    });
    if (!record) throw notFound('Transfert introuvable.');

    // Un colis reçu au dépôt d'arrivée n'est plus récupérable : il est
    // physiquement ailleurs. L'annuler laisserait le stock et l'historique
    // dans deux états contraires.
    if (record.status === InterDepotStatus.RECU) {
      throw conflict(
        `Le transfert ${record.transferNumber} est réceptionné : les colis sont ` +
          `installés à ${record.destinationDeposit.name} et ne peuvent plus être annulés.`
      );
    }

    return this.transition(identifier, InterDepotStatus.ANNULE, actor);
  }

  // ------------------------------------------------------------------
  // Règles métier
  // ------------------------------------------------------------------

  /**
   * Vérifie qu'un lot peut quitter le dépôt source.
   *
   * Le contrôle est fait colis par colis et le refus est global et motivé :
   * dire « 3 colis sur 12 ne sont pas transférables » avec la raison est
   * exploitable, là où un rejet silencieux du premier colis ne l'est pas.
   */
  private assertTransferable(
    packages: {
      id: string;
      trackingNumber: string;
      status: PrismaPackageStatus;
      currentDepositId: string | null;
      interDepotTransferId: string | null;
      assignedDriverId: string | null;
    }[],
    source: { id: string; name: string },
    destinationId: string
  ): void {
    if (packages.length === 0) {
      throw badRequest('Aucun colis à transférer.');
    }

    const duplicates = packages.length - new Set(packages.map((p) => p.id)).size;
    if (duplicates > 0) {
      throw badRequest(`${duplicates} identifiant(s) de colis sont répétés dans la demande.`);
    }

    const rejected = packages.filter(
      (p) =>
        !TRANSFERABLE_STATUSES.includes(toSharedStatus(p.status)) ||
        p.interDepotTransferId !== null ||
        p.assignedDriverId !== null ||
        p.currentDepositId !== source.id
    );

    if (rejected.length > 0) {
      const detail = rejected
        .slice(0, 5)
        .map(
          (p) =>
            `${p.trackingNumber} (${refusalReason(toSharedStatus(p.status), {
              inTransfer: p.interDepotTransferId !== null,
              assignedDriver: p.assignedDriverId !== null,
              atSource: p.currentDepositId === source.id,
            })})`
        )
        .join(', ');

      throw conflict(
        `${rejected.length} colis ne peuvent pas quitter ${source.name} : ${detail}` +
          (rejected.length > 5 ? `, et ${rejected.length - 5} autre(s).` : '.') +
          ` Destination demandée : ${destinationId.slice(0, 8)}.`
      );
    }
  }

  /** Nombre de colis reçus, validé avant écriture. */
  private parseReceivedCount(value: number | undefined, total: number): number {
    if (value === undefined || value === null) return total;
    const received = Number(value);
    if (!Number.isInteger(received) || received < 0) {
      throw badRequest('Le nombre de colis reçus est invalide.');
    }
    if (received > total) {
      throw badRequest(
        `Impossible d'avoir reçu plus de colis qu'expédiés (${received} reçus pour ${total} expédiés).`
      );
    }
    return received;
  }

  private parseDate(value?: string): Date | null {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw badRequest('Date de transfert invalide : format attendu AAAA-MM-JJ.');
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw badRequest('Date de transfert invalide.');
    }
    return parsed;
  }

  // ------------------------------------------------------------------
  // Écritures
  // ------------------------------------------------------------------

  /**
   * Applique une étape : statut du transfert, statut et dépôt des colis,
   * événements de suivi, dans une seule transaction.
   *
   * Les trois écritures ne sont pas dissociables : un colis passé en
   * `EN_TRANSIT_INTER_DEPOT` sans événement de suivi produirait un historique
   * muet, et c'est précisément ce que l'historique doit empêcher.
   */
  private async applyTransfer(
    transferId: string,
    record: any,
    status: InterDepotStatus,
    ctx: {
      // L'identifiant de l'acteur est conservé pour l'exclure des
      // notifications : celui qui réceptionne n'a pas besoin d'être prévenu
      // qu'il a réceptionné.
      actor: { id?: string; fullName: string };
      now: Date;
      received: number;
      receptionNotes?: string;
    }
  ): Promise<void> {
    const prisma = getPrisma();
    const source = record.sourceDeposit as { name: string };
    const destination = record.destinationDeposit as { name: string };
    const packages = (record.packages ?? []) as { id: string; status: PackageStatus }[];

    const isCancel = status === InterDepotStatus.ANNULE;
    const targetStatus = isCancel ? PackageStatus.RECU_DEPOT : STATUS_ON_TRANSFER_STEP[status];
    const targetDepositId = isCancel ? record.sourceDepositId : status === InterDepotStatus.RECU ? record.destinationDepositId : null;

    // Sur annulation, le colis revient au dépôt d'origine : la transition
    // arrière est légitime et doit être validée comme telle.
    if (isCancel) {
      const invalid = packages.filter((p) => p.status !== PackageStatus.EN_LOT_INTER_DEPOT);
      if (invalid.length > 0) {
        throw conflict(
          `${invalid.length} colis ne sont plus dans le lot (statut inattendu) : ` +
            "l'annulation ne peut pas les replacer au dépôt d'origine."
        );
      }
    } else if (targetStatus) {
      // Une étape peut ne rien demander au colis : préparer le lot alors que
      // la constitution l'a déjà conditionné laisse le statut inchangé. Ce
      // n'est pas une transition avortée, c'est un état déjà atteint.
      const invalid = packages.filter(
        (p) =>
          p.status !== targetStatus && !canTransitionPackage(p.status as PackageStatus, targetStatus)
      );
      if (invalid.length > 0) {
        throw conflict(
          `${invalid.length} colis ne peuvent pas passer à l'état ` +
            `${targetStatus} depuis leur état actuel : l'historique du lot est incohérent.`
        );
      }
    }

    const { timeline, description } = this.stepNarrative(status, source, destination, record);

    await prisma.$transaction(async (tx) => {
      await tx.interDepotTransfer.update({
        where: { id: transferId },
        data: {
          status: status as never,
          ...(status === InterDepotStatus.PREPARE ? { preparedAt: ctx.now } : {}),
          ...(status === InterDepotStatus.EN_TRANSIT ? { shippedAt: ctx.now } : {}),
          ...(status === InterDepotStatus.RECU
            ? {
                receivedAt: ctx.now,
                receivedPackages: ctx.received,
                receptionNotes: ctx.receptionNotes?.trim() || null,
              }
            : {}),
          ...(isCancel ? { cancelledAt: ctx.now } : {}),
        },
      });

      for (const pkg of packages) {
        if (targetStatus) {
          // Le lot reste attaché au transfert tant qu'il n'est pas arrivé :
          // c'est ce lien qui empêche un colis d'être re-transféré par
          // erreur alors qu'il roule. L'arrivée le détache, comme
          // l'annulation : au-delà, le colis appartient au dépôt, plus au
          // transfert.
          const detaches = isCancel || status === InterDepotStatus.RECU;
          await packageWorkflowService.transition({
            packageId: pkg.id,
            to: toSharedStatus(targetStatus),
            actor: { fullName: ctx.actor.fullName, role: RoleType.AGENT_DEPOT },
            title: timeline.title,
            note: description,
            location: timeline.location,
            transferNumber: record.transferNumber,
            auditAction: `TRANSFER_STEP_${status}`,
            // Sur annulation le colis revient au dépôt d'origine : c'est la
            // seule transition arrière du cycle, et elle est légitime.
            allowSameStatus: !isCancel && targetStatus === pkg.status,
            data: {
              ...(targetDepositId !== null ? { currentDepositId: targetDepositId } : {}),
              ...(detaches ? { interDepotTransferId: null } : {}),
            },
            client: tx,
          });
        } else {
          // Aucune étape ne correspond à un statut de colis : on se contente
          // de tracer l'événement, sans prétendre à une transition.
          await tx.packageTimeline.create({
            data: {
              packageId: pkg.id,
              status: toPrismaStatus(toSharedStatus(pkg.status)),
              title: timeline.title,
              description,
              locationName: timeline.location,
              transferNumber: record.transferNumber,
              operatorName: ctx.actor.fullName,
            },
          });
        }
      }
    });

    if (status === InterDepotStatus.CRE) {
      await notificationService
        .notify({
          type: 'TRANSFERT_CREE',
          title: `Transfert ${record.transferNumber} créé`,
          content: `${record.totalPackages} colis à charger vers ${destination.name}.`,
          relatedEntity: 'TRANSFER',
          relatedEntityId: transferId,
        })
        .catch(() => undefined);
    }

    if (status === InterDepotStatus.RECU) {
      await notificationDispatcher
        .notify({
          event: NotificationEvent.INTER_DEPOT_RECEIVED,
          title: `Transfert ${record.transferNumber} réceptionné`,
          content:
            `${ctx.received} colis reçus à ${destination.name}` +
            (ctx.received < record.totalPackages
              ? ` — ${record.totalPackages - ctx.received} manquants.`
              : '.'),
          relatedEntity: 'INTER_DEPOT',
          relatedEntityId: transferId,
          transferId,
          actorUserId: ctx.actor.id,
        })
        .catch(() => undefined);
    }
  }

  /** Titre, lieu et description de l'événement de suivi pour une étape. */
  private stepNarrative(
    status: InterDepotStatus,
    source: { name: string },
    destination: { name: string },
    record: { totalPackages: number; totalPieces: number; receivedPackages?: number; sealNumber: string | null }
  ): { timeline: { title: string; location: string }; description: string } {
    switch (status) {
      case InterDepotStatus.PREPARE:
        return {
          timeline: { title: 'Lot préparé', location: depositLabel(source.name) },
          description:
            `Lot de ${record.totalPackages} colis conditionné et prêt à charger` +
            (record.sealNumber ? ` (plomb ${record.sealNumber})` : '') +
            '.',
        };
      case InterDepotStatus.EN_TRANSIT:
        return {
          timeline: { title: 'Départ inter-dépôt', location: 'Inter-dépôt' },
          description: `En route vers ${depositLabel(destination.name)}.`,
        };
      case InterDepotStatus.RECU:
        return {
          timeline: { title: 'Réceptionné', location: depositLabel(destination.name) },
          description:
            `Réceptionné à ${depositLabel(destination.name)}` +
            (record.receivedPackages !== undefined && record.receivedPackages < record.totalPackages
              ? ` — ${record.totalPackages - record.receivedPackages} colis manquants.`
              : '.'),
        };
      case InterDepotStatus.ANNULE:
        return {
          timeline: { title: 'Transfert annulé', location: depositLabel(source.name) },
          description: `Transfert annulé : colis replacés à ${depositLabel(source.name)}.`,
        };
      default:
        return {
          timeline: { title: 'Constitution du lot', location: depositLabel(source.name) },
          description: `Colis conditionné à ${depositLabel(source.name)}.`,
        };
    }
  }

  /**
   * Criteres de recherche d'un transfert.
   *
   * Un transfert est identifié par son numéro (`ID-AAAAMMJJ-0000`) ou par son
   * UUID. La clause sur `id` n'est ajoutée que si la valeur est réellement un
   * UUID : la passer telle quelle ferait échouer PostgreSQL sur le type de la
   * colonne, et l'erreur remonterait en 500 au lieu d'un 404.
   */
  private lookupWhere(identifier: string): Record<string, unknown> {
    const id = asUuid(identifier);
    return id
      ? { OR: [{ transferNumber: identifier }, { id }] }
      : { transferNumber: identifier };
  }

  private async reload(id: string): Promise<InterDepotDto | null> {
    const prisma = getPrisma();
    const record = await prisma.interDepotTransfer.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE,
    });
    return record ? this.toDto(record) : null;
  }

  /** Numéro lisible : ID-AAAAMMJJ-0000, séquence quotidienne. */
  private async nextTransferNumber(): Promise<string> {
    const prisma = getPrisma();
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;

    const last = await prisma.interDepotTransfer.findFirst({
      where: { transferNumber: { contains: stamp } },
      orderBy: { transferNumber: 'desc' },
      select: { transferNumber: true },
    });

    const sequence = last ? Number(last.transferNumber.split('-').pop() ?? '0') + 1 : 1;
    return `ID-${stamp}-${String(sequence).padStart(4, '0')}`;
  }

  // ------------------------------------------------------------------
  // Restitution
  // ------------------------------------------------------------------

  private toDto(record: any): InterDepotDto {
    const status = record.status as InterDepotStatus;
    const source = record.sourceDeposit as { id: string; name: string; phone: string; city: string };
    const destination = record.destinationDeposit as {
      id: string;
      name: string;
      phone: string;
      city: string;
    };
    const driver = record.transporterDriver as
      | { id: string; user: { fullName: string; phone: string } }
      | null;
    const packages = (record.packages ?? []) as {
      id: string;
      trackingNumber: string;
      status: PackageStatus;
      pieceCount: number;
      customer: { fullName: string };
    }[];

    const received = record.receivedPackages as number;
    const discrepancy = record.receivedAt ? record.totalPackages - received : 0;

    return {
      id: record.id,
      transferNumber: record.transferNumber,
      sourceDeposit: source.name,
      sourceDepositId: source.id,
      destinationDeposit: destination.name,
      destinationDepositId: destination.id,
      driverId: driver?.id ?? null,
      driverName: driver?.user.fullName ?? null,
      driverPhone: driver?.user.phone ?? null,
      scheduledDate: record.scheduledDate
        ? new Date(record.scheduledDate as Date).toISOString().slice(0, 10)
        : null,
      sealNumber: record.sealNumber ?? null,
      status,
      statusLabel: INTER_DEPOT_STATUS_LABELS[status] ?? status,
      totalPackages: record.totalPackages,
      totalPieces: record.totalPieces,
      receivedPackages: received,
      discrepancy,
      hasDiscrepancy: discrepancy > 0,
      notes: record.notes ?? null,
      dispatchNotes: record.dispatchNotes ?? null,
      receptionNotes: record.receptionNotes ?? null,
      packages: packages.map((p) => ({
        id: p.id,
        trackingNumber: p.trackingNumber,
        status: p.status,
        pieceCount: p.pieceCount,
        customerName: p.customer?.fullName ?? '',
      })),
      movement: this.buildMovement(record, status, source, destination),
      allowedTransitions: [...(INTER_DEPOT_TRANSITIONS[status] ?? [])],
      createdAt: record.createdAt.toISOString(),
      preparedAt: record.preparedAt ? record.preparedAt.toISOString() : null,
      shippedAt: record.shippedAt ? record.shippedAt.toISOString() : null,
      receivedAt: record.receivedAt ? record.receivedAt.toISOString() : null,
      cancelledAt: record.cancelledAt ? record.cancelledAt.toISOString() : null,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  /**
   * Chronologie de mouvement, de la création à l'arrivée.
   *
   * Les étapes non atteintes portent `timestamp: null` : l'interface peut ainsi
   * dessiner la trajectoire complète d'un coup, en distinguant visuellement ce
   * qui est fait de ce qui reste à faire, sans reconstruire l'avancement.
   */
  private buildMovement(
    record: any,
    status: InterDepotStatus,
    source: { name: string },
    destination: { name: string }
  ): MovementStep[] {
    const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null);
    const order: InterDepotStatus[] = [
      InterDepotStatus.CRE,
      InterDepotStatus.PREPARE,
      InterDepotStatus.EN_TRANSIT,
      InterDepotStatus.RECU,
    ];
    const stamps: Partial<Record<InterDepotStatus, string | null>> = {
      [InterDepotStatus.CRE]: iso(record.createdAt),
      [InterDepotStatus.PREPARE]: iso(record.preparedAt),
      [InterDepotStatus.EN_TRANSIT]: iso(record.shippedAt),
      [InterDepotStatus.RECU]: iso(record.receivedAt),
    };

    const steps: MovementStep[] = order.map((step) => {
      const timestamp = stamps[step] ?? null;
      // `reached` suit l'horodatage réel, pas la position dans le cycle :
      // `EN_TRANSIT` est directement atteignable depuis `CRE`, et un transfert
      // parti sans être préparé ne doit pas afficher « Préparé » comme accompli.
      const reached = timestamp !== null;
      return {
        key: step,
        label: INTER_DEPOT_STATUS_LABELS[step],
        status: step,
        location:
          step === InterDepotStatus.EN_TRANSIT
            ? 'Inter-dépôt'
            : step === InterDepotStatus.RECU
              ? depositLabel(destination.name)
              : depositLabel(source.name),
        description: this.movementDescription(
          step,
          source.name,
          destination.name,
          record,
          reached
        ),
        timestamp,
        reached,
      };
    });

    if (status === InterDepotStatus.ANNULE) {
      // Un transfert annulé n'a pas parcouru la trajectoire : le montrer
      // éviterait de laisser croire que la charge est arrivée.
      return steps.map((step) => ({
        ...step,
        reached: false,
        timestamp: step.key === InterDepotStatus.CRE ? iso(record.createdAt) : null,
      }));
    }

    return steps;
  }

  private movementDescription(
    step: InterDepotStatus,
    sourceName: string,
    destinationName: string,
    record: any,
    reached: boolean
  ): string {
    switch (step) {
      case InterDepotStatus.CRE:
        return `Lot créé à ${depositLabel(sourceName)} : ${record.totalPackages} colis, ${record.totalPieces} pièces.`;
      case InterDepotStatus.PREPARE:
        return !reached
          ? 'En attente de préparation du lot.'
          : record.sealNumber
            ? `Lot conditionné et plommé (${record.sealNumber}).`
            : 'Lot conditionné et prêt à charger.';
      case InterDepotStatus.EN_TRANSIT:
        return reached
          ? `Véhicule en route vers ${depositLabel(destinationName)}.`
          : 'Véhicule non encore parti.';
      case InterDepotStatus.RECU:
        return reached
          ? `${record.receivedPackages} colis réceptionnés à ${depositLabel(destinationName)}.`
          : `En attente de réception à ${depositLabel(destinationName)}.`;
      default:
        return '';
    }
  }
}

export const interDepotsService = new InterDepotsService();
