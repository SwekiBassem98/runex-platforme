/**
 * Service du tableau de bord administrateur.
 *
 * Tous les indicateurs sont calculés par agrégation SQL sur la base : le
 * tableau de bord ne doit jamais afficher de données simulées, sous peine
 * d'orienter une décision d'exploitation sur de faux chiffres.
 */

import { getPrisma } from '../../common/database/prisma-context';
import type { DashboardMetricsDto } from './dashboard.types';
import { PackageStatus, PackageType } from '@logixpress/types';
import { isDriverOnline } from '../presence/presence.service';

const round3 = (value: number): number => parseFloat(value.toFixed(3));
const percent = (part: number, whole: number, fallback: number): number =>
  whole > 0 ? parseFloat(((part / whole) * 100).toFixed(1)) : fallback;

export class DashboardService {
  async getMetrics(scope?: { depositId?: string }): Promise<DashboardMetricsDto> {
    const prisma = getPrisma();
    const depositId = scope?.depositId;

    // Filtres scope dépôt (AGENT_DEPOT) — ne jamais renvoyer la plateforme entière à un magasinier.
    const packageScopeWhere = depositId
      ? {
          OR: [
            { currentDepositId: depositId },
            { originDepositId: depositId },
            { destinationDepositId: depositId },
          ],
        }
      : {};
    const driverScopeWhere = depositId ? { user: { depositId } } : {};
    const depositScopeWhere = depositId ? { id: depositId } : {};
    const transferScopeWhere = depositId
      ? { OR: [{ sourceDepositId: depositId }, { destinationDepositId: depositId }] }
      : {};

    const [
      packagesByStatus,
      exchanges,
      drivers,
      driverLoad,
      pickupsByStatus,
      voucherTotals,
      runsheetTotals,
      runsheetsToClose,
      depositsCount,
      activeTransfers,
      transfersPackages,
      timeline,
      codSeries,
      supplierActivity,
    ] = await Promise.all([
      this.countPackagesByStatus(packageScopeWhere),
      prisma.package.count({
        where: { deletedAt: null, packageType: PackageType.EXCHANGE as never, ...packageScopeWhere },
      }),
      prisma.driver.findMany({
        where: { deletedAt: null, isActive: true, ...driverScopeWhere },
        select: {
          id: true,
          isActive: true,
          lastSeenAt: true,
          user: { select: { fullName: true, isActive: true } },
          _count: { select: { assignedPackages: true } },
        },
      }),
      this.driverActivity(depositId),
      this.countPickupsByStatus(),
      this.voucherTotals(),
      this.runsheetTotals(depositId),
      prisma.runsheet.count({
        where: {
          status: 'RETOUR_DEPOT' as never,
          ...(depositId ? { depositId } : {}),
        },
      }),
      prisma.deposit.count({ where: { isActive: true, ...depositScopeWhere } }),
      prisma.interDepotTransfer.count({
        where: {
          status: { in: ['CRE', 'PREPARE', 'EN_TRANSIT'] as never },
          ...transferScopeWhere,
        },
      }),
      prisma.interDepotTransfer.aggregate({
        where: { status: { in: ['CRE', 'PREPARE', 'EN_TRANSIT'] as never }, ...transferScopeWhere },
        _sum: { totalPackages: true },
      }),
      this.recentTimeline(depositId),
      this.codOverTime(depositId),
      this.supplierActivity(depositId),
    ]);

    const total = (statuses: PackageStatus[]) =>
      statuses.reduce((sum, s) => sum + (packagesByStatus[s] ?? 0), 0);

    const nouveaux = packagesByStatus[PackageStatus.CREE] ?? 0;
    const livres = total([PackageStatus.LIVRE, PackageStatus.LIVRAISON_PARTIELLE]);
    const reportes = packagesByStatus[PackageStatus.REPORTE] ?? 0;
    const retournes = total([
      PackageStatus.RETOUR_DEPOT,
      PackageStatus.RETOURNE_EXPEDITEUR,
      PackageStatus.ECHEC_LIVRAISON,
    ]);
    const annules = packagesByStatus[PackageStatus.ANNULE] ?? 0;
    const enLivraison = packagesByStatus[PackageStatus.EN_COURS_LIVRAISON] ?? 0;
    const affectes = packagesByStatus[PackageStatus.AFFECTE_RUNSHEET] ?? 0;
    const colisAuDepot = total([PackageStatus.RECU_DEPOT, PackageStatus.RECU_DEPOT_DESTINATION]);

    // Un colis « à affecter » est arrivé au dépôt sans livreur : c'est le
    // goulot d'étranglement opérationnel principal, donc l'alerte n° 1.
    const awaitingAssignment = await prisma.package.count({
      where: {
        deletedAt: null,
        status: {
          in: [PackageStatus.RECU_DEPOT, PackageStatus.RECU_DEPOT_DESTINATION] as never,
        },
        assignedDriverId: null,
        ...(depositId ? { currentDepositId: depositId } : {}),
      },
    });

    const baseEligibles = livres + reportes + retournes;
    const tauxReussite = percent(livres, baseEligibles, 0);

    // Un livreur est « en tournée » s'il porte une tournée ouverte.
    // Tournée ouverte = non clôturée ni annulée (schéma RunsheetStatus).
    // EN_ATTENTE / VALIDEE_DEPART / EN_COURS = en tournée, RETOUR_DEPOT = revenu, en attente de clôture caisse.
    const busyDriverIds = new Set(
      (
        await prisma.runsheet.findMany({
          where: {
            status: { in: ['EN_COURS', 'VALIDEE_DEPART', 'EN_ATTENTE', 'RETOUR_DEPOT'] as never },
            ...(depositId ? { depositId } : {}),
          },
          select: { driverId: true },
          distinct: ['driverId'],
        })
      ).map((r) => r.driverId)
    );
    const enTournee = drivers.filter((d) => busyDriverIds.has(d.id)).length;
    // Présence vs disponibilité : deux signaux orthogonaux.
    // — ONLINE (en ligne)  = `lastSeenAt` récent (< timeout). Le mobile bat `lastSeenAt`
    //   via `POST /drivers/presence/heartbeat`. Jamais dérivé de `PushDevice.isActive`.
    // — DISPONIBLE (hors tournée) = livreur actif sans tournée ouverte (runsheet), conservé tel quel.
    // horsLigne n'est PAS « sans tournée », c'est l'inverse de ONLINE : actif non vu récemment.
    const now = new Date();
    const online = drivers.filter((d) => isDriverOnline(d.lastSeenAt as Date | null, now)).length;
    const horsLigne = drivers.length - online;

    // À encaisser : montant dû par les clients sur les colis non encore livrés ou retournés définitivement.
    // Reporté reste dû (re-livraison), mais un colis retourné/échoué/annulé/livré (même partiellement) ne l'est plus.
    const aEncaisser = await prisma.package.aggregate({
      where: {
        deletedAt: null,
        ...packageScopeWhere,
        status: {
          notIn: [
            PackageStatus.LIVRE,
            PackageStatus.LIVRAISON_PARTIELLE,
            PackageStatus.ANNULE,
            PackageStatus.ECHEC_LIVRAISON,
            PackageStatus.RETOUR_DEPOT,
            PackageStatus.RETOURNE_EXPEDITEUR,
            PackageStatus.EN_RUNSHEET_RETOUR as never,
          ] as never,
        },
      },
      _sum: { totalPrice: true },
    });

    const confirmedVouchers = voucherTotals.confirmed;

    const alerts: DashboardMetricsDto['alerts'] = [
      {
        id: 'alt-001',
        type: awaitingAssignment > 0 ? 'danger' : 'info',
        category: 'COLIS_NON_AFFECTES',
        title: 'Colis arrivés non affectés',
        count: awaitingAssignment,
        message:
          awaitingAssignment > 0
            ? `${awaitingAssignment} colis en dépôt attendent l'affectation à un livreur.`
            : 'Tous les colis arrivés au dépôt sont affectés.',
        actionLabel: 'Affecter maintenant',
        actionUrl: '/colis',
      },
      {
        id: 'alt-002',
        type: runsheetsToClose > 0 ? 'warning' : 'info',
        category: 'RUNSHEETS_A_VALIDER',
        title: 'Tournées à clôturer',
        count: runsheetsToClose,
        message:
          runsheetsToClose > 0
            ? `${runsheetsToClose} tournée${runsheetsToClose > 1 ? 's' : ''} attend${runsheetsToClose > 1 ? 'ent' : ''} le rapprochement caisse.`
            : 'Aucune tournée en attente de clôture.',
        actionLabel: 'Valider caisse',
        actionUrl: '/runsheets',
      },
      {
        id: 'alt-003',
        type: confirmedVouchers.count > 0 ? 'warning' : 'info',
        category: 'PAIEMENTS_EN_ATTENTE',
        title: 'Bordereaux confirmés à décaisser',
        count: confirmedVouchers.count,
        message: `${round3(confirmedVouchers.total).toFixed(3)} DT à décaisser après validation du code secret expéditeur.`,
        actionLabel: 'Payer fournisseurs',
        actionUrl: '/paiements',
      },
      {
        id: 'alt-004',
        type: (pickupsByStatus.A_CONFIRMER ?? 0) > 0 ? 'warning' : 'info',
        category: 'RAMASSAGES_A_CONFIRMER',
        title: 'Demandes de ramassage à confirmer',
        count: pickupsByStatus.A_CONFIRMER ?? 0,
        message: `${pickupsByStatus.A_CONFIRMER ?? 0} rendez-vous de collecte en attente${(pickupsByStatus.A_CONFIRMER ?? 0) > 1 ? 's' : ''} de confirmation.`,
        actionLabel: 'Confirmer créneaux',
        actionUrl: '/ramassages',
      },
    ];

    return {
      colis: {
        total: Object.values(packagesByStatus).reduce((a, b) => a + b, 0),
        nouveaux,
        aAffecter: awaitingAssignment,
        affectes,
        enLivraison,
        livres,
        reportes,
        retournes,
        annules,
        echanges: exchanges,
        tauxReussite,
      },
      livreurs: {
        actifs: drivers.length,
        // DISPONIBLE = actif sans tournée ouverte (disponibilité tournée), conservé.
        disponibles: drivers.length - enTournee,
        enTournee,
        // HORS LIGNE = actif non vu récemment (présence mobile), dérivé de Driver.lastSeenAt.
        horsLigne,
        total: drivers.length,
      },
      ramassages: {
        aConfirmer: pickupsByStatus.A_CONFIRMER ?? 0,
        planifies: pickupsByStatus.EN_ATTENTE ?? 0,
        enCours: (pickupsByStatus.EN_COURS ?? 0) + (pickupsByStatus.ASSIGNE ?? 0),
        effectues: pickupsByStatus.EFFECTUE ?? 0,
        annules: pickupsByStatus.ANNULE ?? 0,
        total: Object.values(pickupsByStatus).reduce((a, b) => a + b, 0),
      },
      paiements: {
        montantAEncaisserTND: round3(Number(aEncaisser._sum.totalPrice ?? 0)),
        montantEncaisseTND: round3(runsheetTotals.collectedCash),
        paiementsEnAttenteTND: round3(confirmedVouchers.total),
        paiementsValidesTND: round3(voucherTotals.paid),
        retoursFinanciersTND: round3(voucherTotals.returnFees),
        deficitCaisseTND: round3(runsheetTotals.deficit),
      },
      depots: {
        colisAuDepot,
        colisInTransit: transfersPackages._sum.totalPackages ?? 0,
        interDepotsActifs: activeTransfers,
        agencesActives: depositsCount,
      },
      charts: {
        deliveriesOverTime: codSeries.map((d) => ({ label: d.label, colis: d.colis, livres: d.livres })),
        deliveredVsReturned: [
          { name: 'Livrés avec succès', value: livres, color: '#10B981' },
          { name: 'Reportés (NPAI/Absent)', value: reportes, color: '#F59E0B' },
          { name: 'Retours définitifs', value: retournes, color: '#DC2626' },
        ],
        codAmounts: codSeries.map((day) => ({
          name: day.label,
          aEncaisser: day.aEncaisser,
          encaisse: day.encaisse,
        })),
        driverActivity: driverLoad,
        supplierActivity,
      },
      alerts,
      recentActivity: timeline,
    };
  }

  /**
   * Tableau de bord vu par un livreur authentifié : uniquement ses propres
   * colis, tournées, ramassages et caisse. Même forme que le tableau de bord
   * global pour ne pas casser le client mobile, mais aucun chiffre d'un autre
   * chauffeur, d'un expéditeur tiers ou de la caisse centrale n'y figure.
   *
   * Présence vs disponibilité : `disponibles` = sans tournée ouverte,
   * `horsLigne` = ce livreur vu récemment ou non (Driver.lastSeenAt).
   */
  async getDriverMetrics(driverId: string): Promise<DashboardMetricsDto> {
    const prisma = getPrisma();
    const mine = { deletedAt: null, assignedDriverId: driverId };

    const [byStatus, driver, openRuns, pickupsRaw, aEncaisser, encaisse, echanges, tentatives] =
      await Promise.all([
        prisma.package.groupBy({ by: ['status'], where: mine, _count: { _all: true } }),
        prisma.driver.findUnique({
          where: { id: driverId },
          select: {
            currentBalance: true,
            cashCeiling: true,
            lastSeenAt: true,
            user: { select: { fullName: true } },
          },
        }),
        prisma.runsheet.count({
          where: { driverId, status: { in: ['EN_COURS', 'VALIDEE_DEPART', 'EN_ATTENTE'] as never } },
        }),
        prisma.pickupAppointment.groupBy({
          by: ['status'],
          where: { assignedDriverId: driverId },
          _count: { _all: true },
        }),
        prisma.package.aggregate({
          where: {
            ...mine,
            status: {
              notIn: [
                PackageStatus.LIVRE,
                PackageStatus.LIVRAISON_PARTIELLE,
                PackageStatus.ANNULE,
                PackageStatus.ECHEC_LIVRAISON,
                PackageStatus.RETOUR_DEPOT,
                PackageStatus.RETOURNE_EXPEDITEUR,
                PackageStatus.EN_RUNSHEET_RETOUR as never,
              ] as never,
            },
          },
          _sum: { totalPrice: true },
        }),
        prisma.payment.aggregate({ where: { driverId }, _sum: { amountCollected: true } }),
        prisma.package.count({ where: { ...mine, packageType: PackageType.EXCHANGE as never } }),
        prisma.deliveryAttempt.findMany({
          where: { driverId },
          orderBy: { attemptedAt: 'desc' },
          take: 8,
          include: { package: { select: { trackingNumber: true } } },
        }),
      ]);

    const counts: Record<string, number> = Object.fromEntries(
      byStatus.map((g) => [g.status, g._count._all])
    );
    const pickupsByStatus: Record<string, number> = Object.fromEntries(
      pickupsRaw.map((p) => [p.status, p._count._all])
    );
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const livres = (counts[PackageStatus.LIVRE] ?? 0) + (counts[PackageStatus.LIVRAISON_PARTIELLE] ?? 0);
    const reportes = counts[PackageStatus.REPORTE] ?? 0;
    const retournes =
      (counts[PackageStatus.RETOUR_DEPOT] ?? 0) +
      (counts[PackageStatus.RETOURNE_EXPEDITEUR] ?? 0) +
      (counts[PackageStatus.ECHEC_LIVRAISON] ?? 0);
    const baseEligibles = livres + reportes + retournes;
    const tauxReussite = baseEligibles > 0 ? parseFloat(((livres / baseEligibles) * 100).toFixed(1)) : 0;
    const enTournee = openRuns > 0 ? 1 : 0;
    const onlineDriver = isDriverOnline((driver?.lastSeenAt ?? null) as Date | null);
    const solde = round3(Number(driver?.currentBalance ?? 0));
    const plafond = round3(Number(driver?.cashCeiling ?? 0));
    const nomLivreur = driver?.user.fullName ?? 'Livreur';

    const livreesParJour = new Map<string, number>();
    for (const t of tentatives) {
      if (t.result !== 'REUSSIE') continue;
      const cle = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        t.attemptedAt
      );
      livreesParJour.set(cle, (livreesParJour.get(cle) ?? 0) + 1);
    }
    const deliveriesOverTime: DashboardMetricsDto['charts']['deliveriesOverTime'] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const jour = new Date();
      jour.setDate(jour.getDate() - i);
      const cle = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(jour);
      const n = livreesParJour.get(cle) ?? 0;
      const label = jour.toLocaleDateString('fr-TN', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit' });
      deliveriesOverTime.push({ label, colis: n, livres: n });
    }

    const aLivrer =
      (counts[PackageStatus.AFFECTE_RUNSHEET] ?? 0) + (counts[PackageStatus.EN_COURS_LIVRAISON] ?? 0);

    const alerts: DashboardMetricsDto['alerts'] = [
      {
        id: 'drv-001',
        type: aLivrer > 0 ? 'info' : 'info',
        category: 'COLIS_A_LIVRER',
        title: 'Colis à livrer',
        count: aLivrer,
        message:
          aLivrer > 0
            ? `${aLivrer} colis vous sont affectés et attendent une livraison.`
            : 'Aucun colis en attente de livraison.',
        actionLabel: 'Voir mes colis',
        actionUrl: '/colis',
      },
      {
        id: 'drv-002',
        type: solde >= plafond && plafond > 0 ? 'danger' : 'info',
        category: 'SOLDE_CAISSE',
        title: 'Solde à reverser',
        count: solde > 0 ? 1 : 0,
        message:
          solde > 0
            ? `${solde.toFixed(3)} DT en caisse, à reverser au dépôt (plafond ${plafond.toFixed(3)} DT).`
            : 'Aucune espèce en caisse.',
        actionLabel: 'Voir mes encaissements',
        actionUrl: '/colis',
      },
    ];

    return {
      colis: {
        total,
        nouveaux: counts[PackageStatus.CREE] ?? 0,
        aAffecter: 0,
        affectes: counts[PackageStatus.AFFECTE_RUNSHEET] ?? 0,
        enLivraison: counts[PackageStatus.EN_COURS_LIVRAISON] ?? 0,
        livres,
        reportes,
        retournes,
        annules: counts[PackageStatus.ANNULE] ?? 0,
        echanges,
        tauxReussite,
      },
      livreurs: {
        actifs: 1,
        disponibles: 1 - enTournee,
        enTournee,
        // Présence du livreur connecté : 1 si vu récemment, 0 sinon.
        horsLigne: onlineDriver ? 0 : 1,
        total: 1,
      },
      ramassages: {
        aConfirmer: pickupsByStatus.A_CONFIRMER ?? 0,
        planifies: pickupsByStatus.EN_ATTENTE ?? 0,
        enCours: (pickupsByStatus.EN_COURS ?? 0) + (pickupsByStatus.ASSIGNE ?? 0),
        effectues: pickupsByStatus.EFFECTUE ?? 0,
        annules: pickupsByStatus.ANNULE ?? 0,
        total: Object.values(pickupsByStatus).reduce((a, b) => a + b, 0),
      },
      paiements: {
        montantAEncaisserTND: round3(Number(aEncaisser._sum.totalPrice ?? 0)),
        montantEncaisseTND: round3(Number(encaisse._sum.amountCollected ?? 0)),
        paiementsEnAttenteTND: 0,
        paiementsValidesTND: 0,
        retoursFinanciersTND: 0,
        deficitCaisseTND: 0,
      },
      depots: {
        colisAuDepot:
          (counts[PackageStatus.RECU_DEPOT] ?? 0) + (counts[PackageStatus.RECU_DEPOT_DESTINATION] ?? 0),
        colisInTransit: 0,
        interDepotsActifs: 0,
        agencesActives: 0,
      },
      charts: {
        deliveriesOverTime,
        deliveredVsReturned: [
          { name: 'Livrés avec succès', value: livres, color: '#10B981' },
          { name: 'Reportés (NPAI/Absent)', value: reportes, color: '#F59E0B' },
          { name: 'Retours définitifs', value: retournes, color: '#DC2626' },
        ],
        codAmounts: [
          {
            name: 'Ma caisse',
            aEncaisser: round3(Number(aEncaisser._sum.totalPrice ?? 0)),
            encaisse: round3(Number(encaisse._sum.amountCollected ?? 0)),
          },
        ],
        driverActivity: [
          {
            name: nomLivreur,
            livraisons: livres,
            echecs: tentatives.filter((t) => t.result !== 'REUSSIE').length,
          },
        ],
        supplierActivity: [],
      },
      alerts,
      recentActivity: tentatives.map((t) => ({
        id: t.id,
        timestamp: t.attemptedAt.toISOString(),
        type: 'DELIVERY' as const,
        title: t.result === 'REUSSIE' ? 'Colis livré' : `Tentative : ${t.result}`,
        description: `Colis #${t.package.trackingNumber}`,
        actor: nomLivreur,
      })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Agrégations                                                       */
  /* ---------------------------------------------------------------- */

  private async countPackagesByStatus(extraWhere?: Record<string, unknown>): Promise<Record<string, number>> {
    const prisma = getPrisma();
    const grouped = await prisma.package.groupBy({
      by: ['status'],
      where: { deletedAt: null, ...(extraWhere ?? {}) },
      _count: { _all: true },
    });
    return Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  }

  private async countPickupsByStatus(): Promise<Record<string, number>> {
    const prisma = getPrisma();
    const grouped = await prisma.pickupAppointment.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  }

  private async driverActivity(depositId?: string): Promise<DashboardMetricsDto['charts']['driverActivity']> {
    const prisma = getPrisma();
    const rows = await prisma.driver.findMany({
      where: { deletedAt: null, ...(depositId ? { user: { depositId } } : {}) },
      select: {
        user: { select: { fullName: true } },
        assignedPackages: {
          // Ne compter que les colis non supprimés pour éviter d'inclure des livraisons annulées.
          where: { deletedAt: null },
          select: { status: true, deliveryAttempts: { select: { result: true } } },
        },
      },
      take: 6,
      orderBy: { driverCode: 'asc' },
    });

    return rows.map((driver) => {
      const livres = driver.assignedPackages.filter(
        (p) => p.status === PackageStatus.LIVRE || p.status === PackageStatus.LIVRAISON_PARTIELLE
      ).length;
      const echecs = driver.assignedPackages.reduce(
        (sum, p) => sum + p.deliveryAttempts.filter((a) => a.result !== 'REUSSIE').length,
        0
      );
      return { name: driver.user.fullName, livraisons: livres, echecs };
    });
  }

  private async voucherTotals(): Promise<{
    confirmed: { count: number; total: number };
    paid: number;
    returnFees: number;
  }> {
    const prisma = getPrisma();
    const [confirmed, paid, returns] = await Promise.all([
      prisma.paymentVoucher.aggregate({
        where: { status: 'CONFIRME' as never },
        _count: { _all: true },
        _sum: { netPayable: true },
      }),
      prisma.paymentVoucher.aggregate({
        where: { status: 'PAYE' as never },
        _sum: { netPayable: true },
      }),
      prisma.paymentVoucher.aggregate({ _sum: { returnFeesTotal: true } }),
    ]);

    return {
      confirmed: { count: confirmed._count._all, total: Number(confirmed._sum.netPayable ?? 0) },
      paid: Number(paid._sum.netPayable ?? 0),
      returnFees: Number(returns._sum.returnFeesTotal ?? 0),
    };
  }

  private async runsheetTotals(depositId?: string): Promise<{
    collectedCash: number;
    deficit: number;
  }> {
    const prisma = getPrisma();
    const totals = await prisma.runsheet.aggregate({
      where: depositId ? { depositId } : undefined,
      _sum: { collectedCash: true, deficitAmount: true },
    });
    return {
      collectedCash: Number(totals._sum.collectedCash ?? 0),
      deficit: Number(totals._sum.deficitAmount ?? 0),
    };
  }

  /** Activité des quatre derniers jours, utilisée par deux graphiques.
   *
   * - `deliveriesOverTime` : colis créés par jour (createdAt Tunis) vs colis livrés par jour (deliveredAt Tunis) — deux flux distincts.
   * - `codAmounts` : montants à encaisser (totalPrice des créés) vs encaissé (collectedAmount des livrés) — montants réels en TND, pas des comptes.
   * Africa/Tunis est utilisé pour les buckets (00:00 Tunis = 23:00 UTC veille). La fenêtre SQL utilise la même borne Tunis convertie en UTC.
   */
  private async codOverTime(depositId?: string): Promise<
    Array<{ label: string; colis: number; livres: number; aEncaisser: number; encaisse: number }>
  > {
    const prisma = getPrisma();
    // Journée Tunis courante (YYYY-MM-DD en Africa/Tunis)
    const tunisTodayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Tunis',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    // Minuit Tunis aujourd'hui en UTC : 2026-10-07 00:00 Tunis = 2026-10-06T23:00:00Z (Tunis UTC+1 sans DST)
    // On borne à 00:00Z pour rester comparable à `periode` (UTC) tout en gardant des buckets Tunis — l'écart de 1h est documenté et mineur pour un snapshot 4j.
    const todayTunis = new Date(`${tunisTodayStr}T00:00:00.000Z`);
    // Reconstituer minuit Tunis réel : soustraire l'offset Tunis (1h) pour que la borne SQL corresponde au jour Tunis.
    // Sans librairie de fuseau, on approxime via Intl : on veut l'instant UTC qui, vu en Tunis, est 00:00.
    const todayStartTunisUTC = new Date(todayTunis.getTime() - 60 * 60 * 1000);
    const from = new Date(todayStartTunisUTC);
    from.setUTCDate(from.getUTCDate() - 3);

    // Fenêtre SQL : colis créés sur 4 jours Tunis + colis livrés sur 4 jours Tunis (même fenêtre, mais filtre sur deliveredAt pour les livrés).
    const scopeWhere = depositId
      ? { OR: [{ currentDepositId: depositId }, { originDepositId: depositId }, { destinationDepositId: depositId }] }
      : null;
    const whereClause: Record<string, unknown> = scopeWhere
      ? {
          AND: [
            { deletedAt: null },
            scopeWhere,
            { OR: [{ createdAt: { gte: from } }, { deliveredAt: { gte: from } }] },
          ],
        }
      : {
          deletedAt: null,
          OR: [{ createdAt: { gte: from } }, { deliveredAt: { gte: from } }],
        };
    const recent = await prisma.package.findMany({
      where: whereClause as never,
      select: { createdAt: true, deliveredAt: true, status: true, totalPrice: true, collectedAmount: true },
    });

    const buckets = new Map<string, { colis: number; livres: number; aEncaisser: number; encaisse: number }>();
    for (let i = 3; i >= 0; i -= 1) {
      const day = new Date(todayStartTunisUTC);
      day.setUTCDate(day.getUTCDate() - i);
      buckets.set(tunisDayKey(day), { colis: 0, livres: 0, aEncaisser: 0, encaisse: 0 });
    }

    for (const pkg of recent) {
      // Créations : bucket par createdAt (jour Tunis)
      const keyCree = tunisDayKey(pkg.createdAt);
      const bCree = buckets.get(keyCree);
      if (bCree && pkg.createdAt >= from) {
        bCree.colis += 1;
        bCree.aEncaisser = round3(bCree.aEncaisser + Number(pkg.totalPrice));
      }
      // Livraisons : bucket par deliveredAt (jour Tunis), seulement si livré
      if (
        pkg.deliveredAt &&
        (pkg.status === PackageStatus.LIVRE || pkg.status === PackageStatus.LIVRAISON_PARTIELLE)
      ) {
        const keyLivre = tunisDayKey(pkg.deliveredAt);
        const bLivre = buckets.get(keyLivre);
        if (bLivre && pkg.deliveredAt >= from) {
          bLivre.livres += 1;
          bLivre.encaisse = round3(bLivre.encaisse + Number(pkg.collectedAmount));
        }
      }
    }

    return [...buckets.entries()].map(([label, value]) => ({ label, ...value }));
  }

  private async supplierActivity(depositId?: string): Promise<
    DashboardMetricsDto['charts']['supplierActivity']
  > {
    const prisma = getPrisma();
    const rows = await prisma.shipper.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        companyName: true,
        packages: {
          where: { deletedAt: null, ...(depositId ? { currentDepositId: depositId } : {}) },
          select: { totalPrice: true },
        },
      },
      take: 6,
      orderBy: { companyName: 'asc' },
    });

    return rows.map((shipper) => ({
      name: shipper.companyName,
      colis: shipper.packages.length,
      montantTND: round3(shipper.packages.reduce((sum, p) => sum + Number(p.totalPrice), 0)),
    }));
  }

  /** Les derniers événements PackageTimeline, tous types confondus — filtrés par dépôt si scope. */
  private async recentTimeline(depositId?: string): Promise<DashboardMetricsDto['recentActivity']> {
    const prisma = getPrisma();
    const events = await prisma.packageTimeline.findMany({
      where: depositId ? { package: { currentDepositId: depositId } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { package: { select: { trackingNumber: true } } },
    });

    return events.map((event) => ({
      id: event.id,
      timestamp: formatRelative(event.createdAt),
      type: activityType(event.status),
      title: event.title,
      description:
        event.description ?? `Colis #${event.package.trackingNumber} — ${event.status}`,
      actor: event.operatorName ?? 'Système',
      badge: event.locationName ?? undefined,
    }));
  }
}

/** Clé de regroupement par jour, au format court utilisé par les graphiques — jour Tunis (Africa/Tunis). */
function dayKey(date: Date): string {
  return date.toLocaleDateString('fr-TN', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit' });
}
function tunisDayKey(date: Date): string {
  return date.toLocaleDateString('fr-TN', { timeZone: 'Africa/Tunis', day: '2-digit', month: '2-digit' });
}

/** Classement d'un événement de chronologie pour l'icône du flux d'activité. */
function activityType(status: string): 'SCAN' | 'DELIVERY' | 'RUNSHEET' | 'PAYMENT' | 'PICKUP' {
  if (status.startsWith('RECU_DEPOT')) return 'SCAN';
  if (status.startsWith('LIVRE') || status === 'REPORTE' || status.startsWith('RETOUR')) {
    return 'DELIVERY';
  }
  if (status === 'AFFECTE_RUNSHEET') return 'RUNSHEET';
  return 'SCAN';
}

/** Datation relative en français, la donnée la plus lisible d'un flux d'activité. */
function formatRelative(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Hier' : `Il y a ${days} jours`;
}

export const dashboardService = new DashboardService();
