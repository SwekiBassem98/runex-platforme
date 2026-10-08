/**
 * Service des feuilles de tournée.
 *
 * Une tournée regroupe les colis confiés à un livreur pour une date donnée et
 * assure la réconciliation de sa caisse : montant attendu, espèces et chèques
 * réellement remis, écart éventuel. Les indicateurs ne sont jamais recopiés
 * depuis la tournée mais recalculés à partir de ses colis, afin qu'une
 * livraison saisie tardivement soit immédiatement répercutée.
 */

import { codeMatchesPackage, packageCodeWhere } from '../../common/scan/package-code';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { nextRunsheetNumber, tunisDayStamp } from '../../common/database/numbering';
import { auditService } from '../../common/audit/audit.service';
import { toPackageDto, PACKAGE_INCLUDE } from '../../common/database/mappers';
import type { RunsheetSummaryDto, PackageDto } from '@logixpress/types';
import {
  PackageStatus,
  RoleType,
  NotificationEvent,
  PACKAGE_STATUS_LABELS,
  canTransition,
} from '@logixpress/types';
import { notFound, badRequest, conflict, forbidden, asUuid } from '../../common/errors/api-error';
import { packageWorkflowService } from '../colis/package-workflow.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import {
  toSharedRunsheetStatus,
  toPersistedRunsheetStatus,
  isTerminalRunsheetStatus,
} from './runsheet-status';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RUNSHEET_INCLUDE = {
  driver: { include: { user: { select: { fullName: true } } } },
  deposit: { select: { id: true, name: true } },
  runsheetItems: {
    include: { package: { include: PACKAGE_INCLUDE } },
    orderBy: { orderIndex: 'asc' },
  },
} as const;

/** Date de tournée `AAAA-MM-JJ` ; une valeur illisible est refusée (400). */
const RUNSHEET_TYPES = ['DISTRIBUTION', 'RAMASSAGE', 'RETOUR_EXPEDITEUR', 'TRANSFERT_DEPOT'];

/**
 * Cycle de vie d'une tournée via `POST /runsheets/:id/status`.
 * RETOUR_DEPOT et CLOTUREE_* s'obtiennent uniquement par `close` et `validate`.
 */
const RUNSHEET_STATUS_TRANSITIONS: Record<string, string[]> = {
  BROUILLON: ['EN_ATTENTE', 'ANNULEE'],
  EN_ATTENTE: ['BROUILLON', 'VALIDEE_DEPART', 'EN_COURS', 'ANNULEE'],
  VALIDEE_DEPART: ['EN_ATTENTE', 'EN_COURS', 'ANNULEE'],
  EN_COURS: [],
  RETOUR_DEPOT: [],
  CLOTUREE_CONFORME: [],
  CLOTUREE_DEFICIT: [],
  ANNULEE: [],
};

/** Colis qui partent en distribution au départ de la tournée. */
const DEPARTING_STATUSES: PackageStatus[] = [PackageStatus.AFFECTE_RUNSHEET, PackageStatus.REPORTE];
/** Colis encore « sur la route » : non traités à la clôture. */
const PENDING_ON_TOUR: PackageStatus[] = [
  PackageStatus.AFFECTE_RUNSHEET,
  PackageStatus.EN_COURS_LIVRAISON,
];
/** Statuts dont l'encaissement est entre les mains du livreur. */
const CASH_STATUSES: PackageStatus[] = [PackageStatus.LIVRE, PackageStatus.LIVRAISON_PARTIELLE];
/** Un colis ne quitte une tournée ouverte que s'il n'a pas encore été traité. */
const REMOVABLE_STATUSES: PackageStatus[] = [
  PackageStatus.AFFECTE_RUNSHEET,
  PackageStatus.REPORTE,
  PackageStatus.ECHEC_LIVRAISON,
  PackageStatus.RECU_DEPOT,
  PackageStatus.RECU_DEPOT_DESTINATION,
  PackageStatus.CREE,
];

/** Jour calendaire de Tunis, `AAAA-MM-JJ`. */
function tunisIsoDay(now = new Date()): string {
  const stamp = tunisDayStamp(now);
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

function parseTourDate(raw: string): Date {
  const value = String(raw).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw badRequest('Date de tournée invalide (format AAAA-MM-JJ).');
  return date;
}

export class RunsheetsService {
  /** Liste les tournées, avec le périmètre livreur lorsqu'il est fourni. */
  async findAll(filters?: {
    driverId?: string;
    depositId?: string;
    status?: string;
    date?: string;
  }): Promise<RunsheetSummaryDto[]> {
    const prisma = getPrisma();
    const persistedStatus = filters?.status
      ? toPersistedRunsheetStatus(filters.status)
      : undefined;

    // Un filtre de statut inconnu ne doit pas tout retourner : on ne filtre
    // que si la valeur a pu être traduite, sinon la liste vide est le bon
    // signal (le client demande une tournée dans un état inexistant).
    if (filters?.status && !persistedStatus) return [];

    const records = await prisma.runsheet.findMany({
      where: {
        ...(filters?.driverId && filters.driverId !== 'ALL'
          ? { driverId: asUuid(filters.driverId) ?? '00000000-0000-0000-0000-000000000000' }
          : {}),
        ...(filters?.depositId ? { depositId: filters.depositId } : {}),
        ...(persistedStatus ? { status: persistedStatus } : {}),
        ...(filters?.date ? { tourDate: parseTourDate(filters.date) } : {}),
      },
      include: RUNSHEET_INCLUDE,
      orderBy: { tourDate: 'desc' },
      take: 200,
    });

    return records.map((record) => this.toDto(record));
  }

  /** Retrouve une tournée par UUID ou par numéro (RUN-…). */
  async findByNumber(identifier: string): Promise<RunsheetSummaryDto | null> {
    const prisma = getPrisma();
    const record = await prisma.runsheet.findFirst({
      where: UUID_PATTERN.test(identifier)
        ? { OR: [{ id: identifier }, { runsheetNumber: identifier }] }
        : { runsheetNumber: identifier },
      include: RUNSHEET_INCLUDE,
    });

    return record ? this.toDto(record) : null;
  }

  /**
   * Crée une tournée et y rattache les colis.
   *
   * Les colis doivent être au dépôt et sans livreur : une tournée regroupe un
   * même livreur et un même jour, faute de quoi la caisse ne serait pas
   * rapprochable.
   */
  async create(payload: {
    driverId?: string;
    driverCode?: string;
    depositId?: string;
    tourDate?: string;
    type?: string;
    notes?: string;
    packageIds?: string[];
  }): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const driver = await this.resolveDriver(payload);

    const depositUuid = payload.depositId ? asUuid(String(payload.depositId)) : null;
    if (payload.depositId && !depositUuid) {
      throw badRequest('Identifiant de dépôt invalide (UUID attendu).');
    }
    const deposit = depositUuid
      ? await prisma.deposit.findUnique({ where: { id: depositUuid } })
      : await prisma.deposit.findFirst({ where: { isMainHub: true } });
    if (!deposit) {
      throw badRequest('Dépôt introuvable : renseignez un dépôt de départ valide.');
    }
    if (!deposit.isActive) throw conflict('Ce dépôt est inactif.');

    const type = payload.type ? String(payload.type).trim().toUpperCase() : 'DISTRIBUTION';
    if (!RUNSHEET_TYPES.includes(type)) throw badRequest(`Type de tournée invalide : ${payload.type}.`);
    const tourDate = payload.tourDate ? parseTourDate(payload.tourDate) : new Date(`${tunisIsoDay()}T00:00:00.000Z`);
    const notes = payload.notes === undefined || payload.notes === null ? null : String(payload.notes);
    if (notes && notes.length > 500) throw badRequest('Les notes ne peuvent dépasser 500 caractères.');

    const packageIds = Array.isArray(payload.packageIds) ? [...new Set(payload.packageIds.map(String))] : [];

    const created = await prisma.$transaction(async (tx) => {
      const runsheet = await tx.runsheet.create({
        data: {
          runsheetNumber: await nextRunsheetNumber(tx, tunisDayStamp()),
          depositId: deposit.id,
          driverId: driver.id,
          tourDate,
          type: type as never,
          status: 'EN_ATTENTE',
          notes,
        },
        include: { driver: { include: { user: { select: { fullName: true } } } } },
      });
      for (const identifier of packageIds) {
        await this.attachPackage(tx, runsheet, identifier, { fullName: 'Exploitation' });
      }
      return runsheet;
    });

    return (await this.findByNumber(created.runsheetNumber))!;
  }

  /**
   * Met à jour une tournée (driver, date, zone/notes, dépôt).
   *
   * Règles d'éditabilité basées sur le statut opérationnel :
   *  - BROUILLON / EN_ATTENTE : éditable (driver/date/notes/dépôt).
   *    Si la tournée contient déjà des colis, le changement de livreur ou de
   *    dépôt est refusé (409) pour éviter l'incohérence colis↔tournée.
   *  - VALIDEE_DEPART / EN_COURS / RETOUR_DEPOT / CLOTUREE_* / ANNULEE : non
   *    éditable pour driver/date/dépôt. Seules les notes (zone) peuvent être
   *    corrigées en EN_ATTENTE ; au-delà, toute modification est refusée.
   *  Le statut lui-même ne peut être changé que par `updateStatus`/`close`/`validate`.
   */
  async update(
    identifier: string,
    payload: { driverId?: string; tourDate?: string; notes?: string; depositId?: string; type?: string },
    actor: { id?: string; fullName: string; depositId?: string | null },
    scope?: { depositId?: string }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(identifier);

    // Sécurité : périmètre dépôt
    if (scope?.depositId && runsheet.depositId !== scope.depositId) {
      throw forbidden("Vous n'avez pas accès à cette tournée (périmètre dépôt).");
    }
    if (actor.depositId && runsheet.depositId !== actor.depositId) {
      // Les utilisateurs rattachés à un dépôt ne peuvent modifier qu'au sein de leur dépôt,
      // sauf ADMIN/GESTIONNAIRE sans périmètre (scope vide) — ce cas est déjà géré par scope.
      // On vérifie seulement si l'appelant a un dépôt et n'est pas ADMIN (le scope ADMIN est vide).
      // Pour éviter un blocage excessif, on se base sur le scope plutôt que l'actor.
    }

    const persisted = runsheet.status as string;
    const editableStatuses = ['BROUILLON', 'EN_ATTENTE'];
    if (!editableStatuses.includes(persisted)) {
      throw conflict(
        `La tournée ${runsheet.runsheetNumber} n'est plus modifiable (statut ${persisted}). Seules les tournées en attente peuvent être modifiées.`
      );
    }

    const hasPackages = runsheet.runsheetItems.length > 0 || runsheet.totalPackages > 0;

    const data: Record<string, unknown> = {};

    // Driver
    if (payload.driverId !== undefined) {
      const trimmed = String(payload.driverId).trim();
      if (!trimmed) throw badRequest('Le champ « Chauffeur (driverId) » est obligatoire.');
      if (hasPackages) {
        throw conflict(
          'Impossible de changer le livreur : la tournée contient déjà des colis. Retirez les colis ou créez une nouvelle tournée.'
        );
      }
      const driver = await this.resolveDriver({ driverId: trimmed });
      data.driverId = driver.id;
    }

    // tourDate
    if (payload.tourDate !== undefined) {
      const raw = String(payload.tourDate).trim();
      if (!raw) throw badRequest('Le champ « Date de tournée (tourDate) » est obligatoire.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw badRequest('Le champ « Date de tournée » doit être au format AAAA-MM-JJ.');
      }
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw badRequest('Date de tournée invalide.');
      data.tourDate = parsed;
    }

    // notes / zone
    if (payload.notes !== undefined) {
      const n = payload.notes === null ? null : String(payload.notes);
      if (n !== null && n.length > 500) throw badRequest('La zone/notes ne peut dépasser 500 caractères.');
      data.notes = n;
    }

    // depositId
    if (payload.depositId !== undefined) {
      const raw = String(payload.depositId).trim();
      if (!raw) throw badRequest('Dépôt invalide.');
      const uuid = asUuid(raw);
      if (!uuid) throw badRequest('Identifiant de dépôt invalide (UUID attendu).');
      const deposit = await prisma.deposit.findUnique({ where: { id: uuid } });
      if (!deposit) throw notFound('Dépôt introuvable.');
      if (!deposit.isActive) throw conflict('Ce dépôt est inactif.');
      if (hasPackages) {
        throw conflict(
          'Impossible de changer le dépôt : la tournée contient déjà des colis.'
        );
      }
      data.depositId = deposit.id;
    }

    // type (optionnel, uniquement en attente)
    if (payload.type !== undefined) {
      const allowedTypes = ['DISTRIBUTION', 'RAMASSAGE', 'RETOUR_EXPEDITEUR', 'TRANSFERT_DEPOT'];
      const t = String(payload.type).trim().toUpperCase();
      if (t && !allowedTypes.includes(t)) throw badRequest(`Type de tournée invalide : ${payload.type}.`);
      if (t) data.type = t as never;
    }

    if (Object.keys(data).length === 0) {
      throw badRequest('Aucune donnée à mettre à jour.');
    }

    const updated = await prisma.runsheet.update({
      where: { id: runsheet.id },
      data,
      include: RUNSHEET_INCLUDE,
    });

    await auditService.record({
      entityType: 'RUNSHEET',
      entityId: runsheet.id,
      action: 'UPDATE',
      userId: actor.id,
      reason: `Tournée ${runsheet.runsheetNumber} modifiée : ${Object.keys(data).join(', ')}.`,
      previousValues: {
        driverId: runsheet.driverId,
        tourDate: runsheet.tourDate,
        depositId: runsheet.depositId,
        notes: runsheet.notes,
      },
      newValues: data as any,
    });

    return this.toDto(updated);
  }

  /**
   * Supprime une tournée.
   *
   * Règle métier : seule une tournée vide et en attente peut être supprimée.
   *  - BROUILLON / EN_ATTENTE && totalPackages==0 && runsheetItems==0 => suppression dure.
   *  - Si contient des colis => 409 "contient des colis".
   *  - Si statut EN_COURS / VALIDEE_DEPART / RETOUR_DEPOT / CLOTUREE_* / ANNULEE => 409 avec explication.
   *  Si la suppression est refusée, l'appelant doit utiliser l'annulation (statut ANNULEE) via updateStatus.
   */
  async remove(
    identifier: string,
    actor: { id?: string; fullName: string },
    scope?: { depositId?: string }
  ): Promise<void> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(identifier);

    if (scope?.depositId && runsheet.depositId !== scope.depositId) {
      throw forbidden("Vous n'avez pas accès à cette tournée (périmètre dépôt).");
    }

    const status = runsheet.status as string;
    const deletableStatuses = ['BROUILLON', 'EN_ATTENTE'];
    if (!deletableStatuses.includes(status)) {
      if (status === 'ANNULEE') throw conflict(`La tournée ${runsheet.runsheetNumber} est déjà annulée et ne peut pas être supprimée.`);
      if (['CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT'].includes(status)) throw conflict(`La tournée ${runsheet.runsheetNumber} est clôturée et ne peut pas être supprimée.`);
      if (status === 'RETOUR_DEPOT') throw conflict(`La tournée ${runsheet.runsheetNumber} est revenue au dépôt et ne peut pas être supprimée — utilisez la validation caisse.`);
      if (['EN_COURS', 'VALIDEE_DEPART'].includes(status)) throw conflict(`La tournée ${runsheet.runsheetNumber} est active (statut ${status}) et ne peut pas être supprimée.`);
      throw conflict(`La tournée ${runsheet.runsheetNumber} (statut ${status}) n'est pas supprimable.`);
    }

    const hasPackages = runsheet.runsheetItems.length > 0 || runsheet.totalPackages > 0 || runsheet.pendingCount > 0;
    if (hasPackages) {
      throw conflict(
        `La tournée ${runsheet.runsheetNumber} contient ${runsheet.totalPackages} colis et ne peut pas être supprimée. Retirez les colis ou annulez la tournée.`
      );
    }

    // Activité financière ? Si la tournée a déjà des encaissements, elle n'est pas vide.
    const expected = Number(runsheet.expectedCash);
    const collected = Number(runsheet.collectedCash) + Number(runsheet.collectedChecks);
    if (expected !== 0 || collected !== 0 || Number(runsheet.deficitAmount) !== 0) {
      throw conflict(`La tournée ${runsheet.runsheetNumber} a une activité financière et ne peut pas être supprimée.`);
    }

    // Vérifier qu'aucun colis n'a été traité (isHandled)
    const handled = runsheet.runsheetItems.some((i: any) => i.isHandled);
    if (handled) {
      throw conflict(`La tournée ${runsheet.runsheetNumber} contient des colis déjà traités et ne peut pas être supprimée.`);
    }

    // Hard delete en transaction : détacher les colis (au cas où) puis supprimer
    await prisma.$transaction(async (tx) => {
      await tx.package.updateMany({
        where: { currentRunsheetId: runsheet.id },
        data: { currentRunsheetId: null },
      });
      await tx.runsheetItem.deleteMany({ where: { runsheetId: runsheet.id } });
      await tx.runsheet.delete({ where: { id: runsheet.id } });
    });

    await auditService.record({
      entityType: 'RUNSHEET',
      entityId: runsheet.id,
      action: 'DELETE',
      userId: actor.id,
      reason: `Tournée ${runsheet.runsheetNumber} supprimée par ${actor.fullName}.`,
      previousValues: { runsheetNumber: runsheet.runsheetNumber, status, driverId: runsheet.driverId },
    });
  }

  async addPackage(
    runsheetId: string,
    packageIdentifier: string,
    user: { id?: string; fullName: string }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);
    this.assertOpen(runsheet.status, 'ajouter un colis');

    const attached = await prisma.$transaction((tx) =>
      this.attachPackage(tx, runsheet, packageIdentifier, user)
    );

    await notificationDispatcher.notify({
      event: NotificationEvent.RUNSHEET_ASSIGNED,
      title: 'Colis ajouté à votre tournée',
      content: `Le colis #${attached.trackingNumber} a été ajouté à la tournée ${runsheet.runsheetNumber}.`,
      relatedEntity: 'RUNSHEET',
      relatedEntityId: runsheet.id,
      runsheetId: runsheet.id,
      actorUserId: user.id ?? null,
    });

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /**
   * Rattache un colis à une tournée ouverte, dans la transaction fournie.
   *
   * Règles :
   *  - le colis existe, n'est pas supprimé, et son statut permet de partir en
   *    distribution (AFFECTE_RUNSHEET ou une transition légale vers ce statut) ;
   *  - il n'est pas déjà dans une autre tournée ouverte ;
   *  - il n'est pas affecté à un autre livreur.
   *
   * Effets, tous atomiques : ligne de tournée, compteurs et montant attendu de
   * la tournée, affectation du colis au livreur de la tournée et passage en
   * AFFECTE_RUNSHEET (chronologie + audit par la machine à états).
   */
  async attachPackage(
    tx: Prisma.TransactionClient,
    runsheet: { id: string; runsheetNumber: string; driverId: string; status: string },
    packageIdentifier: string,
    user: { id?: string; fullName: string }
  ): Promise<{ id: string; trackingNumber: string }> {
    const identifier = String(packageIdentifier ?? '').trim();
    if (!identifier) throw badRequest('Identifiant du colis requis.');

    // Verrou de la tournée : deux ajouts simultanés ne se marchent pas dessus.
    await tx.$queryRaw`SELECT id::text FROM "Runsheet" WHERE id = ${runsheet.id}::uuid FOR UPDATE`;

    const pkg = await tx.package.findFirst({
      where: {
        deletedAt: null,
        ...packageCodeWhere(identifier),
      },
      include: { currentRunsheet: { select: { id: true, runsheetNumber: true, status: true } } },
    });
    if (!pkg) throw notFound(`Colis ${identifier} introuvable.`);

    if (pkg.currentRunsheetId === runsheet.id) {
      throw conflict(`Le colis #${pkg.trackingNumber} figure déjà dans cette tournée.`);
    }
    if (pkg.currentRunsheet && !isTerminalRunsheetStatus(pkg.currentRunsheet.status)) {
      throw conflict(
        `Le colis #${pkg.trackingNumber} est déjà dans la tournée ${pkg.currentRunsheet.runsheetNumber}. ` +
          "Retirez-le d'abord de cette tournée."
      );
    }
    if (pkg.assignedDriverId && pkg.assignedDriverId !== runsheet.driverId) {
      throw conflict(`Le colis #${pkg.trackingNumber} est affecté à un autre livreur.`);
    }

    const status = pkg.status as unknown as PackageStatus;
    const alreadyAssigned = status === PackageStatus.AFFECTE_RUNSHEET;
    if (!alreadyAssigned && !canTransition(status, PackageStatus.AFFECTE_RUNSHEET)) {
      throw conflict(
        `Le colis #${pkg.trackingNumber} ne peut pas partir en tournée depuis le statut « ${PACKAGE_STATUS_LABELS[status] ?? status} ».`
      );
    }

    const itemCount = await tx.runsheetItem.count({ where: { runsheetId: runsheet.id } });
    await tx.runsheetItem.create({
      data: { runsheetId: runsheet.id, packageId: pkg.id, orderIndex: itemCount + 1 },
    });
    await tx.runsheet.update({
      where: { id: runsheet.id },
      data: {
        totalPackages: { increment: 1 },
        totalPieces: { increment: pkg.pieceCount ?? 1 },
        pendingCount: { increment: 1 },
        expectedCash: { increment: pkg.status === 'ANNULE' ? 0 : pkg.totalPrice },
      },
    });

    const data = { assignedDriverId: runsheet.driverId, currentRunsheetId: runsheet.id };
    if (alreadyAssigned) {
      await tx.package.update({ where: { id: pkg.id }, data });
      await packageWorkflowService.annotate({
        packageId: pkg.id,
        actor: { id: user.id, fullName: user.fullName, role: RoleType.GESTIONNAIRE },
        title: `Intégré à la tournée ${runsheet.runsheetNumber}`,
        auditAction: 'RUNSHEET_PACKAGE_ADDED',
        runsheetNumber: runsheet.runsheetNumber,
        newValues: { runsheetId: runsheet.id },
        client: tx,
      });
    } else {
      await packageWorkflowService.transition({
        packageId: pkg.id,
        to: PackageStatus.AFFECTE_RUNSHEET,
        actor: { id: user.id, fullName: user.fullName, role: RoleType.GESTIONNAIRE },
        title: `Intégré à la tournée ${runsheet.runsheetNumber}`,
        runsheetNumber: runsheet.runsheetNumber,
        auditAction: 'RUNSHEET_PACKAGE_ADDED',
        data,
        client: tx,
      });
    }

    await auditService.record(
      {
        entityType: 'RUNSHEET',
        entityId: runsheet.id,
        action: 'PACKAGE_ADDED',
        userId: user.id ?? null,
        reason: `Colis #${pkg.trackingNumber} ajouté à la tournée ${runsheet.runsheetNumber}.`,
      },
      tx
    );

    return { id: pkg.id, trackingNumber: pkg.trackingNumber };
  }

  async removePackage(
    runsheetId: string,
    packageIdentifier: string,
    user: { id?: string; fullName: string } = { fullName: 'Exploitation' }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);
    this.assertOpen(runsheet.status, 'retirer un colis');

    const item = runsheet.runsheetItems.find((i) => {
      const p = i.package;
      return codeMatchesPackage(packageIdentifier, { id: i.packageId, trackingNumber: p.trackingNumber, barcode: p.barcode });
    });
    if (!item) {
      throw notFound('Ce colis ne figure pas dans la tournée.');
    }
    const status = item.package.status as unknown as PackageStatus;
    if (item.isHandled || !REMOVABLE_STATUSES.includes(status)) {
      throw conflict(
        `Le colis #${item.package.trackingNumber} a déjà été traité (statut « ${PACKAGE_STATUS_LABELS[status] ?? status} ») : ` +
          'il ne peut plus être retiré de la tournée.'
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.runsheetItem.delete({ where: { id: item.id } });
      await tx.runsheet.update({
        where: { id: runsheet.id },
        data: {
          totalPackages: { decrement: 1 },
          totalPieces: { decrement: item.package.pieceCount ?? 1 },
          pendingCount: { decrement: 1 },
          expectedCash: { decrement: item.package.totalPrice },
        },
      });
      // Le colis reste affecté au livreur (« affecté sans tournée ») : il peut
      // être réaffecté ou intégré à une autre tournée.
      await tx.package.update({
        where: { id: item.packageId },
        data: { currentRunsheetId: null },
      });
      await auditService.record(
        {
          entityType: 'RUNSHEET',
          entityId: runsheet.id,
          action: 'PACKAGE_REMOVED',
          userId: user.id ?? null,
          reason: `Colis #${item.package.trackingNumber} retiré de la tournée ${runsheet.runsheetNumber}.`,
        },
        tx
      );
    });

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /**
   * Changement de statut d'une tournée (préparation, départ, annulation).
   *
   * Le retour au dépôt et la clôture ne passent PAS par ici : ils exigent la
   * déclaration de caisse (`close`) puis sa validation (`validate`). Sans cette
   * règle, une tournée pouvait être « clôturée conforme » sans un dinar déclaré.
   */
  async updateStatus(
    runsheetId: string,
    newStatus: string,
    user: { id?: string; fullName: string; driverId?: string; role?: RoleType }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);
    const target = toPersistedRunsheetStatus(newStatus);
    if (!target) {
      throw badRequest(`Statut de tournée inconnu : ${newStatus}.`);
    }
    if (target === 'RETOUR_DEPOT' || target === 'CLOTUREE_CONFORME' || target === 'CLOTUREE_DEFICIT') {
      throw conflict(
        'Le retour au dépôt se déclare avec la clôture de caisse, puis la caisse valide la tournée.'
      );
    }
    if (runsheet.status === target) {
      throw conflict(`La tournée est déjà au statut ${newStatus}.`);
    }
    const allowed = RUNSHEET_STATUS_TRANSITIONS[runsheet.status] ?? [];
    if (!allowed.includes(target)) {
      throw conflict(
        `Transition de tournée impossible : ${runsheet.status} → ${target}.` +
          (allowed.length ? ` Possibles : ${allowed.join(', ')}.` : ' La tournée ne peut plus changer de statut ici.')
      );
    }

    if (target === 'EN_COURS') {
      await this.depart(runsheet, user);
    } else if (target === 'ANNULEE') {
      await prisma.$transaction(async (tx) => {
        // Les colis quittent la tournée annulée ; ils restent affectés au livreur.
        await tx.package.updateMany({
          where: { currentRunsheetId: runsheet.id },
          data: { currentRunsheetId: null },
        });
        await tx.runsheet.update({ where: { id: runsheet.id }, data: { status: 'ANNULEE' } });
        await auditService.record(
          {
            entityType: 'RUNSHEET',
            entityId: runsheet.id,
            action: 'RUNSHEET_ANNULEE',
            userId: user.id ?? null,
            reason: `Tournée ${runsheet.runsheetNumber} annulée par ${user.fullName}.`,
            previousValues: { status: runsheet.status },
            newValues: { status: 'ANNULEE' },
          },
          tx
        );
      });
    } else {
      await prisma.runsheet.update({ where: { id: runsheet.id }, data: { status: target } });
      await auditService.record({
        entityType: 'RUNSHEET',
        entityId: runsheet.id,
        action: 'RUNSHEET_STATUT',
        userId: user.id ?? null,
        reason: `Tournée ${runsheet.runsheetNumber} : ${runsheet.status} → ${target}.`,
        previousValues: { status: runsheet.status },
        newValues: { status: target },
      });
    }

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /**
   * Déclaration de caisse au retour du livreur : la tournée passe en
   * RETOUR_DEPOT.
   *
   * Le montant attendu est recalculé à cet instant à partir de ce qui a été
   * réellement encaissé sur les colis de la tournée (livrés ou partiellement
   * livrés) : un colis retourné ne crée pas de faux déficit. Calcul en Decimal.
   */
  async closeRunsheet(
    runsheetId: string,
    payload: { collectedCash: number; collectedChecks?: number; notes?: string },
    user: { id?: string; fullName: string }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);
    if (runsheet.status !== 'EN_COURS' && runsheet.status !== 'VALIDEE_DEPART') {
      throw conflict(
        runsheet.status === 'EN_ATTENTE' || runsheet.status === 'BROUILLON'
          ? 'Une tournée non partie ne peut pas être clôturée.'
          : `La tournée ${runsheet.runsheetNumber} est déjà clôturée.`
      );
    }

    const cash = new Prisma.Decimal(String(payload.collectedCash));
    const checks = new Prisma.Decimal(String(payload.collectedChecks ?? 0));
    if (!cash.isFinite() || cash.isNegative() || !checks.isFinite() || checks.isNegative()) {
      throw badRequest("Les montants déclarés doivent être des nombres positifs.");
    }
    const notes = payload.notes === undefined || payload.notes === null ? runsheet.notes : String(payload.notes);
    if (notes && notes.length > 500) throw badRequest('Les notes ne peuvent dépasser 500 caractères.');

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const items = await tx.runsheetItem.findMany({
        where: { runsheetId: runsheet.id },
        include: { package: { select: { status: true, collectedAmount: true } } },
      });
      let expected = new Prisma.Decimal(0);
      for (const item of items) {
        const status = item.package.status as unknown as PackageStatus;
        const handled = !PENDING_ON_TOUR.includes(status);
        const collected = CASH_STATUSES.includes(status) ? item.package.collectedAmount : new Prisma.Decimal(0);
        expected = expected.plus(collected);
        await tx.runsheetItem.update({
          where: { id: item.id },
          data: {
            isHandled: handled,
            statusAtClose: item.package.status,
            collectedAmount: collected,
            scannedAtReturn: now,
          },
        });
      }
      const declared = cash.plus(checks);
      const deficit = expected.greaterThan(declared) ? expected.minus(declared) : new Prisma.Decimal(0);

      const result = await tx.runsheet.updateMany({
        where: { id: runsheet.id, status: runsheet.status },
        data: {
          status: 'RETOUR_DEPOT',
          expectedCash: expected,
          collectedCash: cash,
          collectedChecks: checks,
          deficitAmount: deficit,
          closureTime: now,
          notes,
        },
      });
      if (result.count !== 1) throw conflict('La tournée vient d’être modifiée. Rechargez-la.');

      await auditService.record(
        {
          entityType: 'RUNSHEET',
          entityId: runsheet.id,
          action: 'CAISSE_DECLAREE',
          userId: user.id ?? null,
          reason:
            `Caisse déclarée pour ${runsheet.runsheetNumber} : ` +
            `${cash.toFixed(3)} DT espèces, ${checks.toFixed(3)} DT chèques, ` +
            `attendu ${expected.toFixed(3)} DT, écart ${deficit.toFixed(3)} DT.`,
          newValues: {
            collectedCash: cash.toFixed(3),
            collectedChecks: checks.toFixed(3),
            expectedCash: expected.toFixed(3),
            deficitAmount: deficit.toFixed(3),
          },
        },
        tx
      );
      return result;
    });
    void updated;

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /**
   * Validation par la caisse : la tournée est clôturée, conforme ou en
   * déficit, et l'argent remis sort du solde du livreur.
   */
  async validateRunsheet(
    runsheetId: string,
    notes: string | undefined,
    user: { id?: string; fullName: string }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);
    if (runsheet.status !== 'RETOUR_DEPOT') {
      throw conflict(
        'Seule une tournée revenue au dépôt et en attente de validation peut être validée par la caisse.'
      );
    }
    if (notes !== undefined && notes !== null && String(notes).length > 500) {
      throw badRequest('Les notes ne peuvent dépasser 500 caractères.');
    }

    const deficit = new Prisma.Decimal(runsheet.deficitAmount);
    const status = deficit.greaterThan(0) ? 'CLOTUREE_DEFICIT' : 'CLOTUREE_CONFORME';
    const handedOver = new Prisma.Decimal(runsheet.collectedCash).plus(runsheet.collectedChecks);

    await prisma.$transaction(async (tx) => {
      const result = await tx.runsheet.updateMany({
        where: { id: runsheet.id, status: 'RETOUR_DEPOT' },
        data: { status, notes: notes ?? runsheet.notes, closedByUserId: user.id ?? null },
      });
      if (result.count !== 1) throw conflict('La tournée vient d’être validée par un autre poste.');

      // L'argent remis à la caisse n'est plus dans les mains du livreur.
      const driver = await tx.driver.findUnique({
        where: { id: runsheet.driverId },
        select: { currentBalance: true },
      });
      if (driver) {
        const balance = new Prisma.Decimal(driver.currentBalance);
        const next = balance.greaterThan(handedOver) ? balance.minus(handedOver) : new Prisma.Decimal(0);
        await tx.driver.update({ where: { id: runsheet.driverId }, data: { currentBalance: next } });
      }

      await auditService.record(
        {
          entityType: 'RUNSHEET',
          entityId: runsheet.id,
          action: 'CAISSE_VALIDEE',
          userId: user.id ?? null,
          reason:
            `Tournée ${runsheet.runsheetNumber} validée en ${status}.` +
            (deficit.greaterThan(0) ? ` Déficit de ${deficit.toFixed(3)} DT à couvrir.` : ''),
          newValues: { status, handedOver: handedOver.toFixed(3) },
        },
        tx
      );
    });

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /** Tournée ouverte d'un livreur, s'il en a une. */
  async getActiveRunsheetForDriver(
    driverId: string,
    scope?: { depositId?: string }
  ): Promise<RunsheetSummaryDto | null> {
    const prisma = getPrisma();
    // Un identifiant qui n'est pas un UUID désigne forcément aucun livreur.
    const uuid = asUuid(driverId);
    if (!uuid) return null;

    const record = await prisma.runsheet.findFirst({
      where: {
        driverId: uuid,
        status: { in: ['EN_ATTENTE', 'VALIDEE_DEPART', 'EN_COURS'] },
        // Un agent de dépôt ne lit que les tournées de son dépôt.
        ...(scope?.depositId ? { depositId: scope.depositId } : {}),
      },
      include: RUNSHEET_INCLUDE,
      orderBy: { tourDate: 'desc' },
    });

    return record ? this.toDto(record) : null;
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  private async findRecord(identifier: string) {
    const prisma = getPrisma();
    const record = await prisma.runsheet.findFirst({
      where: UUID_PATTERN.test(identifier)
        ? { OR: [{ id: identifier }, { runsheetNumber: identifier }] }
        : { runsheetNumber: identifier },
      include: RUNSHEET_INCLUDE,
    });
    if (!record) throw notFound('Tournée introuvable.');
    return record;
  }

  private assertOpen(status: string, action: string): void {
    if (status === 'BROUILLON' || status === 'EN_ATTENTE') return;
    throw conflict(
      `Impossible de ${action} un colis : la tournée n'est plus modifiable (statut ${status}).`
    );
  }

  private async resolveDriver(payload: { driverId?: string; driverCode?: string }) {
    const prisma = getPrisma();
    // Contrat canonique : Driver.id (UUID). Un driverId fourni mais non-UUID est mal formé, pas une absence.
    if (payload.driverId !== undefined && payload.driverId !== null && String(payload.driverId).trim() !== '') {
      const uuid = asUuid(payload.driverId);
      if (!uuid) {
        throw badRequest('Le champ « Chauffeur (driverId) » doit être un identifiant UUID valide.');
      }
      const driver = await prisma.driver.findUnique({ where: { id: uuid } });
      if (!driver) throw notFound('Livreur introuvable. Aucun livreur ne porte cet identifiant.');
      if (!driver.isActive || driver.deletedAt) throw conflict('Ce livreur est inactif ou supprimé.');
      return driver;
    }
    // Repli historique : matricule driverCode, uniquement si driverId absent.
    if (payload.driverCode !== undefined && payload.driverCode !== null && String(payload.driverCode).trim() !== '') {
      const code = String(payload.driverCode).trim();
      const driver = await prisma.driver.findFirst({
        where: { driverCode: code, isActive: true, deletedAt: null },
      });
      if (!driver) throw notFound('Livreur introuvable ou inactif.');
      return driver;
    }
    throw badRequest('Le champ « Chauffeur (driverId) » est obligatoire.');
  }

  /**
   * Départ de la tournée : tous les colis en attente passent en
   * EN_COURS_LIVRAISON et la tournée en EN_COURS, dans une seule transaction.
   * Si un seul colis ne peut pas partir, rien ne bouge.
   */
  private async depart(
    runsheet: {
      id: string;
      runsheetNumber: string;
      status: string;
      driver: { user: { fullName: string } };
      runsheetItems: { packageId: string; isHandled: boolean; package: { status: unknown; trackingNumber: string } }[];
    },
    user: { id?: string; fullName: string; role?: RoleType }
  ): Promise<void> {
    const prisma = getPrisma();
    const pending = runsheet.runsheetItems.filter(
      (item) => !item.isHandled && DEPARTING_STATUSES.includes(item.package.status as PackageStatus)
    );
    if (runsheet.runsheetItems.length === 0) {
      throw conflict(`La tournée ${runsheet.runsheetNumber} est vide : ajoutez des colis avant le départ.`);
    }
    const blocked = runsheet.runsheetItems.filter(
      (item) =>
        !item.isHandled &&
        !DEPARTING_STATUSES.includes(item.package.status as PackageStatus) &&
        (item.package.status as PackageStatus) !== PackageStatus.EN_COURS_LIVRAISON
    );
    if (pending.length === 0 && blocked.length === 0) {
      throw conflict(`La tournée ${runsheet.runsheetNumber} n'a aucun colis à distribuer.`);
    }

    const actor = {
      id: user.id,
      fullName: user.fullName || runsheet.driver.user.fullName,
      role: user.role ?? RoleType.GESTIONNAIRE,
    };
    const now = new Date();

    await prisma.$transaction(
      async (tx) => {
        for (const item of pending) {
          await packageWorkflowService.transition({
            packageId: item.packageId,
            to: PackageStatus.EN_COURS_LIVRAISON,
            actor,
            title: 'Départ en tournée',
            note: `Tournée ${runsheet.runsheetNumber}`,
            location: 'En tournée',
            runsheetNumber: runsheet.runsheetNumber,
            auditAction: 'RUNSHEET_DEPARTURE',
            client: tx,
          });
        }
        await tx.runsheetItem.updateMany({
          where: { runsheetId: runsheet.id, isHandled: false },
          data: { scannedAtDeparture: now },
        });
        const result = await tx.runsheet.updateMany({
          where: { id: runsheet.id, status: runsheet.status as never },
          data: { status: 'EN_COURS', departureTime: now },
        });
        if (result.count !== 1) throw conflict('La tournée vient d’être modifiée. Rechargez-la.');
        await auditService.record(
          {
            entityType: 'RUNSHEET',
            entityId: runsheet.id,
            action: 'RUNSHEET_DEPART',
            userId: user.id ?? null,
            reason: `Départ de la tournée ${runsheet.runsheetNumber} (${pending.length} colis).`,
            previousValues: { status: runsheet.status },
            newValues: { status: 'EN_COURS' },
          },
          tx
        );
      },
      { timeout: 30_000 }
    );
  }

  /**
   * Projette un enregistrement Prisma vers le DTO partagé.
   *
   * Les compteurs sont recalculés depuis les colis plutôt que repris de la
   * colonne : une livraison saisie après la création de la tournée doit se
   * répercuter immédiatement, sinon le suivi affiché à l'écran est faux.
   */
  private toDto(record: any): RunsheetSummaryDto {
    const items = record.runsheetItems as {
      isHandled: boolean;
      collectedAmount: unknown;
      package: any;
    }[];

    const packages = items.map((i) => toPackageDto(i.package));
    const delivered = packages.filter(
      (p) => p.status === PackageStatus.LIVRE || p.status === PackageStatus.LIVRAISON_PARTIELLE
    );
    const postponed = packages.filter((p) => p.status === PackageStatus.REPORTE);
    const returned = packages.filter(
      (p) => p.status === PackageStatus.RETOUR_DEPOT || p.status === PackageStatus.RETOURNE_EXPEDITEUR
    );
    const failed = packages.filter((p) => p.status === PackageStatus.ECHEC_LIVRAISON);
    const settled = delivered.length + postponed.length + returned.length + failed.length;

    return {
      id: record.id,
      runsheetNumber: record.runsheetNumber,
      driverId: record.driverId,
      driverName: record.driver.user.fullName,
      depositId: record.depositId,
      depositName: record.deposit.name,
      status: toSharedRunsheetStatus(record.status),
      tourDate: record.tourDate.toISOString().slice(0, 10),
      totalPackages: packages.length || record.totalPackages,
      totalPieces: packages.reduce((sum, p) => sum + (p.pieceCount ?? 1), 0) || record.totalPieces,
      pendingCount: Math.max(0, packages.length - settled),
      deliveredCount: delivered.length || record.deliveredCount,
      postponedCount: postponed.length || record.postponedCount,
      returnedCount: returned.length || record.returnedCount,
      expectedCash: Number(record.expectedCash),
      collectedCash: Number(record.collectedCash),
      collectedChecks: Number(record.collectedChecks),
      deficitAmount: Number(record.deficitAmount),
      failedCount: failed.length,
      notes: record.notes ?? undefined,
      packages,
      validatedAt: record.closedByUserId ? record.updatedAt.toISOString() : undefined,
      closedAt: record.closureTime?.toISOString(),
      createdAt: record.createdAt.toISOString(),
    } as RunsheetSummaryDto;
  }
}

export const runsheetsService = new RunsheetsService();
