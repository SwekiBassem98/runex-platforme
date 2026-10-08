/**
 * Service des rendez-vous de ramassage.
 *
 * Un expéditeur demande la collecte de ses colis ; l'exploitation confirme le
 * créneau, affecte un livreur, puis la collecte est réalisée. Le ramassage
 * n'est pas un trajet de livraison : il ne rapporte pas de colis au client
 * final, il alimente le stock du dépôt de destination.
 *
 * Périmètre d'accès — un ramassage contient une adresse de collecte, un contact
 * et un volume annoncé : c'est une donnée commerciale d'un expéditeur. Le
 * livreur ne voit que ses propres rendez-vous, l'expéditeur que les siens, et
 * l'exploitation l'ensemble du parc. Le périmètre est déduit du jeton, jamais
 * d'un paramètre de requête.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { notificationService } from '../../common/notifications/notification.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import type { PickupAppointmentDto, PickupStatus, PickupPackageRef } from '@logixpress/types';
import { RoleType, NotificationType, NotificationEvent } from '@logixpress/types';
import { notFound, badRequest, conflict, forbidden, asUuid } from '../../common/errors/api-error';
import type { Prisma } from '@prisma/client';

const PICKUP_INCLUDE = {
  shipper: { select: { companyName: true } },
  assignedDriver: { include: { user: { select: { fullName: true } } } },
  packages: {
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      totalPrice: true,
      customer: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

/**
 * Cycle de vie d'un ramassage.
 *
 * La confirmation et l'affectation sont deux étapes distinctes : confirmer
 * garantit au fournisseur un créneau, affecter engage un livreur. Un ramassage
 * affecté puis affecté à nouveau doit être refusé, faute de quoi deux
 * livreurs se présenteraient chez le même expéditeur.
 *
 * `ANNULE` reste possible jusqu'à la clôture : un rendez-vous peut échouer sur
 * le terrain tant que la collecte n'a pas été enregistrée.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  A_CONFIRMER: ['EN_ATTENTE', 'ANNULE'],
  EN_ATTENTE: ['ASSIGNE', 'ANNULE'],
  ASSIGNE: ['EN_COURS', 'ANNULE'],
  EN_COURS: ['EFFECTUE', 'ANNULE'],
  EFFECTUE: [],
  ANNULE: [],
};

/** Rôles d'exploitation : ils interviennent sur l'ensemble du parc. */
const EXPLOITATION_ROLES: readonly string[] = [RoleType.ADMIN, RoleType.GESTIONNAIRE];

/** Identité de l'appelant, telle que portée par le jeton. */
export interface PickupActor {
  id?: string;
  fullName: string;
  role: RoleType;
  /** Identifiant `Driver` (et non `User`) pour un livreur. */
  driverId?: string;
  shipperId?: string;
}

function isExploitation(role: RoleType): boolean {
  return EXPLOITATION_ROLES.includes(role);
}

/**
 * Empêche un livreur de piloter un ramassage qui ne lui est pas affecté.
 *
 * Sans ce contrôle, n'importe quel livreur authentifié pouvait démarrer puis
 * clôturer la collecte d'un collègue : le rendez-vous se retrouvait soldé par
 * quelqu'un qui ne s'était jamais rendu chez l'expéditeur, et le livreur
 * titulaire était ensuite verrouillé sur un rendez-vous déjà terminé. Le rôle
 * de bureau, lui, intervient sur l'ensemble des rendez-vous.
 */
function assertDriverOwnsPickup(
  pickup: { assignedDriverId: string | null },
  actor: PickupActor
): void {
  if (actor.role !== RoleType.LIVREUR) return;
  if (!pickup.assignedDriverId || pickup.assignedDriverId !== actor.driverId) {
    throw forbidden("Ce ramassage n'est pas affecté à ce livreur.");
  }
}

/**
 * Empêche un expéditeur d'agir sur le rendez-vous d'un autre fournisseur.
 *
 * Même code que « absent » qu'« appartient à quelqu'un d'autre » : un
 * expéditeur ne doit pas pouvoir sonder l'existence des rendez-vous d'autrui.
 */
function assertShipperOwnsPickup(
  pickup: { shipperId: string },
  actor: PickupActor
): void {
  if (actor.role !== RoleType.EXPEDITEUR) return;
  if (pickup.shipperId !== actor.shipperId) {
    throw forbidden("Ce ramassage n'appartient pas à cet expéditeur.");
  }
}

type PickupRecord = Prisma.PickupAppointmentGetPayload<{ include: typeof PICKUP_INCLUDE }>;

/** UUID qui ne correspond à aucune ligne : « aucun résultat » sans erreur de type. */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';
const PICKUP_STATUSES: string[] = ['A_CONFIRMER', 'EN_ATTENTE', 'ASSIGNE', 'EN_COURS', 'EFFECTUE', 'ANNULE'];

export class RamassagesService {
  /**
   * Liste les rendez-vous visibles par l'appelant.
   *
   * Le périmètre est imposé ici, à partir du rôle et des identifiants du
   * jeton. Un expéditeur est restreint à ses propres demandes, un livreur à
   * celles qui lui sont affectées, l'exploitation à l'ensemble du parc.
   */
  async findAll(
    actor: PickupActor,
    filters?: { status?: string; date?: string }
  ): Promise<PickupAppointmentDto[]> {
    const prisma = getPrisma();
    const records = await prisma.pickupAppointment.findMany({
      where: {
        ...this.scopeFor(actor),
        ...(filters?.status && filters.status !== 'ALL'
          ? PICKUP_STATUSES.includes(filters.status)
            ? { status: filters.status as never }
            : { id: NO_MATCH_ID }
          : {}),
        ...(filters?.date ? { scheduledDate: this.parseScheduledDate(filters.date) } : {}),
      },
      include: PICKUP_INCLUDE,
      orderBy: [{ scheduledDate: 'desc' }, { timeSlotStartHour: 'asc' }],
      take: 300,
    });

    return records.map((record) => toDto(record));
  }

  /** Filtre de périmètre, dérivé du rôle — jamais d'un paramètre de requête. */
  private scopeFor(actor: PickupActor): Prisma.PickupAppointmentWhereInput {
    if (actor.role === RoleType.EXPEDITEUR) {
      // Un expéditeur authentifié possède toujours un shipperId ; à défaut on
      // ne renvoie rien plutôt que tout le parc.
      return actor.shipperId ? { shipperId: actor.shipperId } : { id: NO_MATCH_ID };
    }
    if (actor.role === RoleType.LIVREUR) {
      return actor.driverId ? { assignedDriverId: actor.driverId } : { id: NO_MATCH_ID };
    }
    return {};
  }

  /** Rendez-vous d'un livreur, tous st confondus, pour son écran de terrain. */
  async findForDriver(actor: PickupActor): Promise<PickupAppointmentDto[]> {
    const prisma = getPrisma();
    if (actor.role !== RoleType.LIVREUR) {
      throw forbidden('Cet écran est réservé aux livreurs.');
    }
    if (!actor.driverId) return [];

    const records = await prisma.pickupAppointment.findMany({
      where: { assignedDriverId: actor.driverId, status: { notIn: ['ANNULE', 'EFFECTUE'] } },
      include: PICKUP_INCLUDE,
      orderBy: [{ scheduledDate: 'asc' }, { timeSlotStartHour: 'asc' }],
    });
    return records.map((record) => toDto(record));
  }

  async findById(identifier: string, actor: PickupActor): Promise<PickupAppointmentDto | null> {
    const prisma = getPrisma();
    const record = await prisma.pickupAppointment.findUnique({
      where: { referenceNumber: identifier },
      include: PICKUP_INCLUDE,
    });
    if (!record) return null;
    // Même code pour « absent » et « appartient à quelqu'un d'autre ».
    if (!this.isVisibleTo(record, actor)) return null;
    return toDto(record);
  }

  private isVisibleTo(record: { shipperId: string; assignedDriverId: string | null }, actor: PickupActor): boolean {
    if (isExploitation(actor.role)) return true;
    if (actor.role === RoleType.EXPEDITEUR) return record.shipperId === actor.shipperId;
    if (actor.role === RoleType.LIVREUR) return record.assignedDriverId === actor.driverId;
    return false;
  }

  /**
   * Demande un créneau de collecte.
   *
   * Le créneau est contrôlé avant écriture : deux demandes qui se chevauchent
   * pour un même expéditeur enverraient deux livreurs au même endroit.
   */
  async create(
    actor: PickupActor,
    payload: {
      shipperId: string;
      scheduledDate: string;
      timeSlotStartHour: number;
      timeSlotEndHour: number;
      pickupAddress?: string;
      contactPerson: string;
      contactPhone: string;
      packageEstimate?: number;
      notes?: string;
    }
  ): Promise<PickupAppointmentDto> {
    const prisma = getPrisma();

    // Un expéditeur ne demande que pour lui ; l'exploitation saisit pour le
    // compte d'un fournisseur.
    if (actor.role === RoleType.EXPEDITEUR) {
      if (!actor.shipperId || actor.shipperId !== payload.shipperId) {
        throw forbidden("Un expéditeur ne peut demander un ramassage que pour lui-même.");
      }
    }
    if (!asUuid(payload.shipperId)) {
      throw badRequest("Identifiant d'expéditeur invalide.");
    }

    const scheduledDate = this.parseScheduledDate(payload.scheduledDate);
    this.assertSlotHours(payload.timeSlotStartHour, payload.timeSlotEndHour);
    this.assertNotInPast(scheduledDate);

    const shipper = await prisma.shipper.findUnique({
      where: { id: payload.shipperId },
      select: { address: true },
    });
    if (!shipper) throw notFound('Expéditeur introuvable.');

    const overlap = await prisma.pickupAppointment.findFirst({
      where: {
        shipperId: payload.shipperId,
        scheduledDate,
        status: { notIn: ['ANNULE'] as never },
        timeSlotStartHour: { lt: payload.timeSlotEndHour },
        timeSlotEndHour: { gt: payload.timeSlotStartHour },
      },
      select: { referenceNumber: true, timeSlotStartHour: true, timeSlotEndHour: true },
    });

    if (overlap) {
      throw conflict(
        `Un ramassage (${overlap.referenceNumber}) est déjà demandé pour ce créneau ` +
          `(${overlap.timeSlotStartHour}h–${overlap.timeSlotEndHour}h).`
      );
    }

    const created = await prisma.pickupAppointment.create({
      data: {
        referenceNumber: await this.nextReference(scheduledDate),
        shipperId: payload.shipperId,
        scheduledDate,
        timeSlotStartHour: payload.timeSlotStartHour,
        timeSlotEndHour: payload.timeSlotEndHour,
        pickupAddress: payload.pickupAddress ?? shipper.address,
        contactPerson: payload.contactPerson,
        contactPhone: payload.contactPhone,
        packageEstimate: this.sanitizeEstimate(payload.packageEstimate),
        status: 'A_CONFIRMER',
        notes: payload.notes ?? null,
      },
      include: PICKUP_INCLUDE,
    });

    await auditService.record({
      entityType: 'PICKUP',
      entityId: created.id,
      action: 'RAMASSAGE_DEMANDE',
      userId: actor.id,
      reason: `Demande de ramassage ${created.referenceNumber} pour le ${created.scheduledDate
        .toISOString()
        .slice(0, 10)}.`,
      newValues: { referenceNumber: created.referenceNumber, packageEstimate: created.packageEstimate },
    });

    await notificationService.notify({
      type: NotificationType.RAMASSAGE_DEMANDE,
      title: 'Nouvelle demande de ramassage',
      content:
        `${created.shipper.companyName} demande un enlèvement le ` +
        `${created.scheduledDate.toISOString().slice(0, 10)} ` +
        `(${created.timeSlotStartHour}h–${created.timeSlotEndHour}h), ` +
        `${created.packageEstimate} colis annoncés.`,
      relatedEntity: 'RAMASSAGE',
      relatedEntityId: created.id,
    });

    return toDto(created);
  }

  /**
   * Fait avancer un ramassage.
   *
   * Les transitions suivent le cycle strict défini en tête de fichier : une
   * affectation ne peut pas précéder la confirmation, et une collecte ne peut
   * pas être déclarée effectuée sans être partie.
   */
  async transition(
    identifier: string,
    to: string,
    actor: PickupActor,
    extra: { driverId?: string } = {}
  ): Promise<PickupAppointmentDto> {
    const prisma = getPrisma();

    const record = await prisma.pickupAppointment.findUnique({
      where: { referenceNumber: identifier },
      include: PICKUP_INCLUDE,
    });
    if (!record) throw notFound('Ramassage introuvable.');

    assertDriverOwnsPickup(record, actor);
    assertShipperOwnsPickup(record, actor);

    const allowed = ALLOWED_TRANSITIONS[record.status] ?? [];
    if (!allowed.includes(to)) {
      throw conflict(
        `Transition impossible : ${record.status} → ${to}. ` +
          (allowed.length
            ? `Transitions possibles : ${allowed.join(', ')}.`
            : 'Ce ramassage est terminé.')
      );
    }

    if (to === 'ASSIGNE') {
      const driver = await this.assertAssignableDriver(extra.driverId);
      await prisma.pickupAppointment.update({
        where: { id: record.id },
        data: { status: 'ASSIGNE', assignedDriverId: driver.id },
      });
    } else {
      await prisma.pickupAppointment.update({
        where: { id: record.id },
        data: {
          status: to as never,
          ...(to === 'EN_ATTENTE' ? { confirmedAt: new Date() } : {}),
          ...(to === 'EFFECTUE' ? { completedAt: new Date() } : {}),
        },
      });
    }

    if (to === 'EFFECTUE') {
      // La quantité réellement collectée est un fait observé, pas une saisie :
      // on fige le décompte des colis réellement rattachés au rendez-vous. Un
      // écart avec l'estimation subsiste et se lit dans le DTO ; il ne doit
      // jamais être écrasé, c'est précisément l'information utile.
      const pickedCount = await prisma.package.count({ where: { pickupAppointmentId: record.id } });
      await prisma.pickupAppointment.update({
        where: { id: record.id },
        data: { actualPickedCount: pickedCount },
      });
    }

    if (to === 'ANNULE') {
      await this.releasePackages(record.id);
    }

    await auditService.record({
      entityType: 'PICKUP',
      entityId: record.id,
      action: `RAMASSAGE_${to}`,
      userId: actor.id,
      reason: `Ramassage ${record.referenceNumber} : ${record.status} → ${to}.`,
      previousValues: { status: record.status },
      newValues: { status: to },
    });

    await this.notifyTransition(record, to, actor);

    const updated = await prisma.pickupAppointment.findUniqueOrThrow({
      where: { id: record.id },
      include: PICKUP_INCLUDE,
    });
    return toDto(updated);
  }

  /**
   * Rattache des colis à un ramassage, ou les en détache.
   *
   * C'est la seule source de vérité de la quantité collectée : le client ne
   * déclare pas un nombre, il rattache des colis. `actualPickedCount` est
   * recalculé à partir de la relation, y compris pendant la collecte, pour que
   * l'écran du livreur reflète l'avancement réel.
   */
  async syncPackages(
    identifier: string,
    actor: PickupActor,
    payload: { attach?: string[]; detach?: string[] }
  ): Promise<PickupAppointmentDto> {
    const prisma = getPrisma();

    const record = await prisma.pickupAppointment.findUnique({
      where: { referenceNumber: identifier },
      include: PICKUP_INCLUDE,
    });
    if (!record) throw notFound('Ramassage introuvable.');

    assertDriverOwnsPickup(record, actor);
    assertShipperOwnsPickup(record, actor);

    if (record.status === 'EFFECTUE' || record.status === 'ANNULE') {
      throw conflict(
        `Ce ramassage est ${record.status === 'EFFECTUE' ? 'clôturé' : 'annulé'} : ` +
          'les colis rattachés ne peuvent plus être modifiés.'
      );
    }

    const attach = (payload.attach ?? []).filter((id) => asUuid(id));
    const detach = (payload.detach ?? []).filter((id) => asUuid(id));

    for (const rawId of payload.attach ?? []) {
      if (!asUuid(rawId)) throw badRequest(`Identifiant de colis invalide : ${rawId}.`);
    }

    if (attach.length > 0) {
      const candidates = await prisma.package.findMany({
        where: { id: { in: attach } },
        select: { id: true, trackingNumber: true, shipperId: true, pickupAppointmentId: true, deletedAt: true },
      });

      if (candidates.length !== attach.length) {
        throw notFound('Un ou plusieurs colis à rattacher sont introuvables.');
      }

      const missing = candidates.filter((pkg) => pkg.deletedAt !== null);
      if (missing.length > 0) {
        throw badRequest(
          `Colis supprimé, non rattachable : ${missing.map((p) => p.trackingNumber).join(', ')}.`
        );
      }

      const foreign = candidates.filter((pkg) => pkg.shipperId !== record.shipperId);
      if (foreign.length > 0) {
        throw badRequest(
          `Ces colis n'appartiennent pas à l'expéditeur du ramassage : ` +
            `${foreign.map((p) => p.trackingNumber).join(', ')}.`
        );
      }

      // Rattacher deux fois le même colis est sans effet, pas une erreur : on
      // l'ignore pour que le scanner puisse rejouer un code-barres.
      const alreadyHere = candidates.filter((pkg) => pkg.pickupAppointmentId === record.id);
      const elsewhere = candidates.filter(
        (pkg) => pkg.pickupAppointmentId && pkg.pickupAppointmentId !== record.id
      );

      if (elsewhere.length > 0) {
        throw conflict(
          `Ces colis sont déjà rattachés à un autre ramassage : ` +
            `${elsewhere.map((p) => p.trackingNumber).join(', ')}.`
        );
      }

      const toAttach = candidates
        .filter((pkg) => pkg.pickupAppointmentId === null)
        .map((pkg) => pkg.id);

      if (toAttach.length > 0) {
        await prisma.package.updateMany({
          where: { id: { in: toAttach } },
          data: { pickupAppointmentId: record.id },
        });

        for (const pkg of candidates.filter((p) => p.pickupAppointmentId === null)) {
          await auditService.record({
            entityType: 'PACKAGE',
            entityId: pkg.id,
            action: 'COLIS_RAMASSE',
            userId: actor.id,
            reason: `Colis rattaché au ramassage ${record.referenceNumber}.`,
            newValues: { pickupAppointmentId: record.id, referenceNumber: record.referenceNumber },
          });
        }
      }

      if (alreadyHere.length > 0) {
        // Rattachement idempotent : on ne le signale pas comme une erreur.
        await prisma.pickupAppointment.update({ where: { id: record.id }, data: {} });
      }
    }

    if (detach.length > 0) {
      await prisma.package.updateMany({
        where: { id: { in: detach }, pickupAppointmentId: record.id },
        data: { pickupAppointmentId: null },
      });
    }

    const pickedCount = await prisma.package.count({ where: { pickupAppointmentId: record.id } });
    const updated = await prisma.pickupAppointment.update({
      where: { id: record.id },
      data: { actualPickedCount: pickedCount },
      include: PICKUP_INCLUDE,
    });

    await auditService.record({
      entityType: 'PICKUP',
      entityId: record.id,
      action: 'RAMASSAGE_COLIS',
      userId: actor.id,
      reason:
        `Colis rattachés au ramassage ${record.referenceNumber} : ` +
        `${attach.length} ajouté(s), ${detach.length} retiré(s), ${pickedCount} au total.`,
      newValues: { actualPickedCount: pickedCount },
    });

    return toDto(updated);
  }

  /** Confirmation d'un créneau demandé par un expéditeur. */
  async confirm(identifier: string, actor: PickupActor): Promise<PickupAppointmentDto> {
    return this.transition(identifier, 'EN_ATTENTE', actor);
  }

  /* ---------------------------------------------------------------- */
  /* Garde-fous                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Vérifie qu'un livreur existe et peut être affecté.
   *
   * `asUuid` ne contrôle que le format : sans ce contrôle, un UUID bien formé
   * mais inexistant atteignait la clé étrangère et remontait en 500, transformant
   * une faute de saisie en panne serveur.
   */
  private async assertAssignableDriver(driverId?: string): Promise<{ id: string }> {
    const prisma = getPrisma();
    if (!asUuid(driverId)) {
      throw badRequest('Un livreur doit être désigné pour affecter ce ramassage.');
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId! },
      select: { id: true, isActive: true },
    });
    if (!driver) throw notFound('Livreur introuvable.');
    if (!driver.isActive) throw badRequest("Ce livreur est inactif et ne peut pas être affecté.");
    return driver;
  }

  /**
   * Rend au cycle normal les colis d'un ramassage annulé.
   *
   * Ils repartent en `CREE` et perdent leur lien : les laisser rattachés à un
   * rendez-vous annulé les rendrait invisibles d'un ramassage clos tout en
   * les faisant figurer dans un autre, et aucun écran ne les montrerait alors.
   */
  private async releasePackages(pickupId: string): Promise<void> {
    const prisma = getPrisma();
    await prisma.package.updateMany({
      where: { pickupAppointmentId: pickupId, status: 'CREE' },
      data: { pickupAppointmentId: null },
    });
  }

  private parseScheduledDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw badRequest(`Date de ramassage invalide : ${value}.`);
    }
    return date;
  }

  /** Une collecte ne peut pas être programmée dans le passé. */
  private assertNotInPast(scheduledDate: Date): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (scheduledDate.getTime() < today.getTime()) {
      throw badRequest('Un ramassage ne peut pas être programmé à une date passée.');
    }
  }

  private assertSlotHours(start: number, end: number): void {
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw badRequest('Les heures de créneau doivent être des entiers.');
    }
    if (start < 0 || end > 24) {
      throw badRequest('Les heures de créneau doivent être comprises entre 0 et 24.');
    }
    if (end <= start) {
      throw badRequest("L'heure de fin doit être postérieure à l'heure de début.");
    }
  }

  private sanitizeEstimate(estimate?: number): number {
    if (estimate === undefined) return 1;
    if (!Number.isInteger(estimate) || estimate < 1) {
      throw badRequest("L'estimation du nombre de colis doit être un entier positif.");
    }
    return estimate;
  }

  /* ---------------------------------------------------------------- */
  /* Notifications                                                     */
  /* ---------------------------------------------------------------- */

  private async notifyTransition(
    record: PickupRecord,
    to: string,
    actor: PickupActor
  ): Promise<void> {
    const when = `${record.scheduledDate.toISOString().slice(0, 10)} ` +
      `(${record.timeSlotStartHour}h–${record.timeSlotEndHour}h)`;

    // Destinataires : le livreur concerné, les shipper users de l'expéditeur,
    // et l'exploitation par défaut (aucun userIds ⇒ rôles d'exploitation).
    const shipperUsers = await this.shipperUserIds(record.shipperId);
    const driverUserId = record.assignedDriver
      ? [record.assignedDriver.userId]
      : [];

    if (to === 'EN_ATTENTE') {
      await notificationService.notify({
        type: NotificationType.RAMASSAGE_CONFIRME,
        title: 'Créneau de ramassage confirmé',
        content: `Votre collecte du ${when} est confirmée.`,
        relatedEntity: 'RAMASSAGE',
        relatedEntityId: record.id,
        userIds: shipperUsers,
      });
      return;
    }

    if (to === 'ASSIGNE') {
      await this.reloadDriverName(record.id);
      await notificationDispatcher.notify({
        event: NotificationEvent.RAMASSAGE_ASSIGNED,
        title: 'Ramassage à collecter',
        content: `Le ramassage ${record.referenceNumber} (${when}) vous est affecté.`,
        relatedEntity: 'RAMASSAGE',
        relatedEntityId: record.id,
        pickupAppointmentId: record.id,
        userIds: driverUserId,
      });
      return;
    }

    if (to === 'EFFECTUE') {
      const picked = await this.pickedCount(record.id);
      const detail =
        picked === record.packageEstimate
          ? `${picked} colis collectés, conformément à l'estimation.`
          : `${picked} colis collectés alors que ${record.packageEstimate} étaient annoncés : ` +
            `écart de ${record.packageEstimate - picked}.`;
      await notificationService.notify({
        type: NotificationType.RAMASSAGE_TERMINE,
        title: 'Ramassage effectué',
        content: `Collecte du ${when} terminée. ${detail}`,
        relatedEntity: 'RAMASSAGE',
        relatedEntityId: record.id,
        userIds: [...shipperUsers],
      });
      return;
    }

    if (to === 'ANNULE') {
      await notificationService.notify({
        type: NotificationType.RAMASSAGE_ANNULE,
        title: 'Ramassage annulé',
        content: `Le ramassage ${record.referenceNumber} du ${when} est annulé.`,
        relatedEntity: 'RAMASSAGE',
        relatedEntityId: record.id,
        userIds: [...shipperUsers, ...driverUserId],
      });
    }
  }

  private async pickedCount(pickupId: string): Promise<number> {
    const prisma = getPrisma();
    return prisma.package.count({ where: { pickupAppointmentId: pickupId } });
  }

  private async shipperUserIds(shipperId: string): Promise<string[]> {
    const prisma = getPrisma();
    const rows = await prisma.shipperUser.findMany({
      where: { shipperId, user: { isActive: true, deletedAt: null } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  private async reloadDriverName(pickupId: string): Promise<string | null> {
    const prisma = getPrisma();
    const updated = await prisma.pickupAppointment.findUniqueOrThrow({
      where: { id: pickupId },
      include: PICKUP_INCLUDE,
    });
    return updated.assignedDriver?.user.fullName ?? null;
  }

  /** Référence lisible et unique par jour : RDV-AAAAMMJJ-0001. */
  private async nextReference(date: Date): Promise<string> {
    const prisma = getPrisma();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate()
    ).padStart(2, '0')}`;

    const last = await prisma.pickupAppointment.findFirst({
      where: { referenceNumber: { startsWith: `RDV-${stamp}` } },
      orderBy: { referenceNumber: 'desc' },
      select: { referenceNumber: true },
    });

    const sequence = last ? Number(last.referenceNumber.split('-').pop() ?? '0') + 1 : 1;
    return `RDV-${stamp}-${String(sequence).padStart(4, '0')}`;
  }
}

function toDto(record: PickupRecord): PickupAppointmentDto {
  const packages: PickupPackageRef[] = record.packages.map((pkg) => ({
    id: pkg.id,
    trackingNumber: pkg.trackingNumber,
    status: pkg.status as PickupPackageRef['status'],
    customerName: pkg.customer.fullName,
    totalPrice: Number(pkg.totalPrice),
  }));

  // La quantité collectée est lue depuis la relation, jamais depuis la colonne
  // mémorisée : les deux peuvent divergir si un colis est rattaché ou détaché
  // par un autre chemin, et c'est le nombre de liens qui fait foi. La colonne
  // reste écrite pour permettre d'indexer et d'agréger en base.
  const actualPickedCount = packages.length;

  return {
    id: record.id,
    referenceNumber: record.referenceNumber,
    shipperId: record.shipperId,
    shipperName: record.shipper.companyName,
    scheduledDate: record.scheduledDate.toISOString().slice(0, 10),
    timeSlotStartHour: record.timeSlotStartHour,
    timeSlotEndHour: record.timeSlotEndHour,
    pickupAddress: record.pickupAddress,
    contactPerson: record.contactPerson,
    contactPhone: record.contactPhone,
    packageEstimate: record.packageEstimate,
    actualPickedCount,
    // L'écart est un fait : il se lit tel quel, sans être corrigé.
    quantityDiscrepancy: record.packageEstimate - actualPickedCount,
    packages,
    status: record.status as PickupStatus,
    assignedDriverId: record.assignedDriverId ?? undefined,
    assignedDriverName: record.assignedDriver?.user.fullName,
    notes: record.notes ?? undefined,
    createdAt: record.createdAt.toISOString(),
    confirmedAt: record.confirmedAt?.toISOString(),
    completedAt: record.completedAt?.toISOString(),
  };
}

export const ramassagesService = new RamassagesService();
export { ALLOWED_TRANSITIONS as RAMASSAGE_TRANSITIONS };
