/**
 * Service des feuilles de tournée.
 *
 * Une tournée regroupe les colis confiés à un livreur pour une date donnée et
 * assure la réconciliation de sa caisse : montant attendu, espèces et chèques
 * réellement remis, écart éventuel. Les indicateurs ne sont jamais recopiés
 * depuis la tournée mais recalculés à partir de ses colis, afin qu'une
 * livraison saisie tardivement soit immédiatement répercutée.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { toPackageDto, PACKAGE_INCLUDE } from '../../common/database/mappers';
import type { RunsheetSummaryDto, PackageDto } from '@logixpress/types';
import { PackageStatus, RoleType, NotificationEvent } from '@logixpress/types';
import { notFound, badRequest, conflict, asUuid } from '../../common/errors/api-error';
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

export class RunsheetsService {
  /** Liste les tournées, avec le périmètre livreur lorsqu'il est fourni. */
  async findAll(filters?: {
    driverId?: string;
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
          ? { driverId: filters.driverId }
          : {}),
        ...(persistedStatus ? { status: persistedStatus } : {}),
        ...(filters?.date ? { tourDate: new Date(filters.date) } : {}),
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
    const deposit = payload.depositId
      ? await prisma.deposit.findUnique({ where: { id: payload.depositId } })
      : await prisma.deposit.findFirst({ where: { isMainHub: true } });

    if (!deposit) {
      throw badRequest('Dépôt introuvable : renseignez un dépôt de départ valide.');
    }

    const tourDate = payload.tourDate ? new Date(payload.tourDate) : new Date();
    const packages = payload.packageIds?.length
      ? await prisma.package.findMany({
          where: { id: { in: payload.packageIds }, deletedAt: null },
        })
      : [];

    const misfit = packages.filter(
      (p) => p.assignedDriverId && p.assignedDriverId !== driver.id
    );
    if (misfit.length > 0) {
      throw conflict(
        `${misfit.length} colis sont déjà affectés à un autre livreur et ne peuvent pas intégrer cette tournée.`
      );
    }

    const number = await this.nextRunsheetNumber();
    const totalPieces = packages.reduce((sum, p) => sum + (p.pieceCount ?? 1), 0);
    const expectedCash = packages
      .filter((p) => p.status !== PackageStatus.ANNULE)
      .reduce((sum, p) => sum + Number(p.totalPrice), 0);

    const created = await prisma.runsheet.create({
      data: {
        runsheetNumber: number,
        depositId: deposit.id,
        driverId: driver.id,
        tourDate,
        type: (payload.type as never) ?? 'DISTRIBUTION',
        status: 'EN_ATTENTE',
        totalPackages: packages.length,
        totalPieces,
        pendingCount: packages.length,
        expectedCash,
        notes: payload.notes ?? null,
        runsheetItems: packages.length
          ? {
              create: packages.map((p, index) => ({
                packageId: p.id,
                orderIndex: index + 1,
              })),
            }
          : undefined,
        // Le rattachement à la tournée se fait aussi sur le colis : c'est ce
        // champ que consulte l'écran de livraison du livreur.
        packages: packages.length
          ? { connect: packages.map((p) => ({ id: p.id })) }
          : undefined,
      },
      include: RUNSHEET_INCLUDE,
    });

    return this.toDto(created);
  }

  /** Ajoute un colis à une tournée encore ouverte. */
  async addPackage(
    runsheetId: string,
    packageIdentifier: string,
    user: { id?: string; fullName: string }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);
    this.assertOpen(runsheet.status, 'ajouter un colis');

    const pkg = await prisma.package.findFirst({
      where: UUID_PATTERN.test(packageIdentifier)
        ? { OR: [{ id: packageIdentifier }, { trackingNumber: packageIdentifier }] }
        : { trackingNumber: packageIdentifier },
    });
    if (!pkg) throw notFound('Colis introuvable.');

    if (pkg.currentRunsheetId === runsheet.id) {
      throw conflict(`Le colis #${pkg.trackingNumber} figure déjà dans cette tournée.`);
    }
    if (pkg.assignedDriverId && pkg.assignedDriverId !== runsheet.driverId) {
      throw conflict(`Le colis #${pkg.trackingNumber} est affecté à un autre livreur.`);
    }

    await prisma.$transaction([
      prisma.runsheetItem.create({
        data: { runsheetId: runsheet.id, packageId: pkg.id },
      }),
      prisma.runsheet.update({
        where: { id: runsheet.id },
        data: {
          totalPackages: { increment: 1 },
          totalPieces: { increment: pkg.pieceCount ?? 1 },
          pendingCount: { increment: 1 },
        },
      }),
      prisma.package.update({
        where: { id: pkg.id },
        data: { currentRunsheetId: runsheet.id },
      }),
    ]);

    await auditService.record({
      entityType: 'RUNSHEET',
      entityId: runsheet.id,
      action: 'PACKAGE_ADDED',
      userId: user.id,
      reason: `Colis #${pkg.trackingNumber} ajouté à la tournée ${runsheet.runsheetNumber}.`,
    });

    // Le livreur de la tournée doit apprendre qu'elle s'est allongée. Le poste
    // de commandement suit le volume par un autre chemin ; ce qui compte ici,
    // c'est que le conductor sache qu'il a un arrêt supplémentaire.
    await notificationDispatcher.notify({
      event: NotificationEvent.RUNSHEET_ASSIGNED,
      title: 'Colis ajouté à votre tournée',
      content: `Le colis #${pkg.trackingNumber} a été ajouté à la tournée ${runsheet.runsheetNumber}.`,
      relatedEntity: 'RUNSHEET',
      relatedEntityId: runsheet.id,
      runsheetId: runsheet.id,
      actorUserId: user.id ?? null,
    });

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /** Retire un colis d'une tournée, uniquement avant son départ. */
  async removePackage(
    runsheetId: string,
    packageIdentifier: string
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);
    this.assertOpen(runsheet.status, 'retirer un colis');

    const item = runsheet.runsheetItems.find((i) => {
      const identifier = i.package.trackingNumber;
      return i.packageId === packageIdentifier || identifier === packageIdentifier;
    });
    if (!item) {
      throw notFound("Ce colis ne figure pas dans la tournée.");
    }
    if (item.isHandled) {
      throw conflict('Ce colis a déjà été traité : il ne peut plus être retiré de la tournée.');
    }

    await prisma.$transaction([
      prisma.runsheetItem.delete({ where: { id: item.id } }),
      prisma.runsheet.update({
        where: { id: runsheet.id },
        data: {
          totalPackages: { decrement: 1 },
          totalPieces: { decrement: item.package.pieceCount ?? 1 },
          pendingCount: { decrement: 1 },
        },
      }),
      prisma.package.update({
        where: { id: item.packageId },
        data: { currentRunsheetId: null },
      }),
    ]);

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /**
   * Fait évoluer le statut d'une tournée.
   *
   * Le départ (EN_COURS) déclenche la bascule des colis encore en attente
   * vers « en cours de livraison » : sans cela, l'écran du livreur ne verrait
   * rien bouger au moment où il démarre.
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
    if (runsheet.status === target) {
      throw conflict(`La tournée est déjà au statut ${newStatus}.`);
    }
    if (isTerminalRunsheetStatus(runsheet.status)) {
      throw conflict(
        `La tournée ${runsheet.runsheetNumber} est clôturée (${runsheet.status}) et ne peut plus changer de statut.`
      );
    }

    if (target === 'EN_COURS') {
      await this.startPackages(runsheet, user);
    }

    await prisma.runsheet.update({
      where: { id: runsheet.id },
      data: {
        status: target,
        ...(target === 'EN_COURS' ? { departureTime: new Date() } : {}),
        ...(target === 'RETOUR_DEPOT' ? { closureTime: new Date() } : {}),
      },
    });

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /**
   * Clôture de caisse : le livreur déclare les espèces et chèques remis.
   *
   * Le déficit est calculé, jamais saisi : `attendu − (espèces + chèques)`.
   */
  async closeRunsheet(
    runsheetId: string,
    payload: { collectedCash: number; collectedChecks?: number; notes?: string },
    user: { id?: string; fullName: string }
  ): Promise<RunsheetSummaryDto> {
    const prisma = getPrisma();
    const runsheet = await this.findRecord(runsheetId);

    if (isTerminalRunsheetStatus(runsheet.status)) {
      throw conflict(`La tournée ${runsheet.runsheetNumber} est déjà clôturée.`);
    }
    if (runsheet.status === 'EN_ATTENTE' || runsheet.status === 'BROUILLON') {
      throw conflict('Une tournée non partie ne peut pas être clôturée.');
    }

    const cash = Number(payload.collectedCash);
    const checks = Number(payload.collectedChecks ?? 0);
    if (!Number.isFinite(cash) || cash < 0) {
      throw badRequest('Le montant d\'espèces remises est invalide.');
    }

    const expected = Number(runsheet.expectedCash);
    const deficit = Math.max(0, expected - (cash + checks));

    await prisma.runsheet.update({
      where: { id: runsheet.id },
      data: {
        status: 'RETOUR_DEPOT',
        collectedCash: cash,
        collectedChecks: checks,
        deficitAmount: deficit,
        closureTime: new Date(),
        notes: payload.notes ?? runsheet.notes,
      },
    });

    await auditService.record({
      entityType: 'RUNSHEET',
      entityId: runsheet.id,
      action: 'CAISSE_DECLAREE',
      userId: user.id,
      reason:
        `Caisse déclarée pour ${runsheet.runsheetNumber} : ` +
        `${cash.toFixed(3)} DT espèces, ${checks.toFixed(3)} DT chèques, ` +
        `attendu ${expected.toFixed(3)} DT, écart ${deficit.toFixed(3)} DT.`,
      newValues: { collectedCash: cash, collectedChecks: checks, deficitAmount: deficit },
    });

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /**
   * Validation financière par la caisse.
   *
   * La clôture est « conforme » ou « à déficit » selon l'écart calculé à la
   * clôture : c'est cette distinction, et non une valeur saisie, qui
   * détermine le statut final.
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

    const deficit = Number(runsheet.deficitAmount);
    const status = deficit > 0 ? 'CLOTUREE_DEFICIT' : 'CLOTUREE_CONFORME';

    await prisma.runsheet.update({
      where: { id: runsheet.id },
      data: { status, notes: notes ?? runsheet.notes, closedByUserId: user.id ?? null },
    });

    await auditService.record({
      entityType: 'RUNSHEET',
      entityId: runsheet.id,
      action: 'CAISSE_VALIDEE',
      userId: user.id,
      reason:
        `Tournée ${runsheet.runsheetNumber} validée en ${status}.` +
        (deficit > 0 ? ` Déficit de ${deficit.toFixed(3)} DT à couvrir.` : ''),
      newValues: { status },
    });

    return (await this.findByNumber(runsheet.runsheetNumber))!;
  }

  /** Tournée ouverte d'un livreur, s'il en a une. */
  async getActiveRunsheetForDriver(driverId: string): Promise<RunsheetSummaryDto | null> {
    const prisma = getPrisma();
    // Un identifiant qui n'est pas un UUID désigne forcément aucun livreur.
    const uuid = asUuid(driverId);
    if (!uuid) return null;

    const record = await prisma.runsheet.findFirst({
      where: {
        driverId: uuid,
        status: { in: ['EN_ATTENTE', 'VALIDEE_DEPART', 'EN_COURS'] },
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
    const uuid = asUuid(payload.driverId);
    const driver = uuid
      ? await prisma.driver.findUnique({ where: { id: uuid } })
      : await prisma.driver.findFirst({
          where: { driverCode: payload.driverCode, isActive: true, deletedAt: null },
        });

    if (!driver) throw notFound('Livreur introuvable ou inactif.');
    return driver;
  }

  /**
   * Bascule les colis non traités en « en cours de livraison ».
   *
   * Le départ d'une tournée est une transition de masse, mais elle ne
   * dispense d'aucune règle : chaque colis passe par le service domaine. Deux
   * Bretons d'usage justifient ce choix.
   *
   * D'abord, la liste des colis réellement modifiés doit coïncider avec la
   * liste des événements écrits. Un `updateMany` filtré suivi d'un
   * `createMany` non filtré laisse une trace « départ en tournée » sur des
   * colis qui, eux, n'ont pas bougé : l'historique raconte alors une tournée
   * qui n'a pas eu lieu.
   *
   * Ensuite, le refus doit être global et motivé. On contrôle donc toutes les
   * transitions avant d'en écrire une seule, pour ne pas laisser une tournée
   * à moitié démarrée.
   */
  private async startPackages(
    runsheet: {
      id: string;
      runsheetNumber: string;
      driver: { user: { fullName: string } };
      runsheetItems: { packageId: string; isHandled: boolean; package: unknown }[];
    },
    user: { id?: string; fullName: string; role?: RoleType }
  ): Promise<void> {
    const prisma = getPrisma();
    const pending = runsheet.runsheetItems.filter((item) => !item.isHandled);
    if (pending.length === 0) return;

    const operatorName = user.fullName || runsheet.driver.user.fullName;
    const actor = {
      id: user.id,
      fullName: operatorName,
      role: user.role ?? RoleType.GESTIONNAIRE,
    };

    // Contrôle préalable : on refuse la tournée entière si un seul colis est
    // dans un état qui ne permet pas le départ.
    const refusals: string[] = [];
    for (const item of pending) {
      const verdict = await packageWorkflowService.check(item.packageId, PackageStatus.EN_COURS_LIVRAISON);
      if (!verdict.allowed) refusals.push(verdict.reason ?? `Colis ${item.packageId}.`);
    }
    if (refusals.length > 0) {
      throw conflict(
        `Départ impossible : ${refusals.length} colis de la tournée ${runsheet.runsheetNumber} ` +
          `ne peuvent pas passer en livraison. ${refusals.slice(0, 3).join(' ')}`
      );
    }

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
      });
    }

    await prisma.runsheetItem.updateMany({
      where: { runsheetId: runsheet.id, isHandled: false },
      data: { scannedAtDeparture: new Date() },
    });
  }

  /** Numéro de tournée incrémental, lisible et unique par jour. */
  private async nextRunsheetNumber(): Promise<string> {
    const prisma = getPrisma();
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(
      today.getDate()
    ).padStart(2, '0')}`;

    const last = await prisma.runsheet.findFirst({
      where: { runsheetNumber: { startsWith: `RUN-${stamp}` } },
      orderBy: { runsheetNumber: 'desc' },
      select: { runsheetNumber: true },
    });

    const sequence = last ? Number(last.runsheetNumber.split('-').pop() ?? '0') + 1 : 1;
    return `RUN-${stamp}-${String(sequence).padStart(4, '0')}`;
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
