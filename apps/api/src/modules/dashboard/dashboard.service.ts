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

const round3 = (value: number): number => parseFloat(value.toFixed(3));
const percent = (part: number, whole: number, fallback: number): number =>
  whole > 0 ? parseFloat(((part / whole) * 100).toFixed(1)) : fallback;

export class DashboardService {
  async getMetrics(): Promise<DashboardMetricsDto> {
    const prisma = getPrisma();

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
      this.countPackagesByStatus(),
      prisma.package.count({ where: { deletedAt: null, packageType: PackageType.EXCHANGE as never } }),
      prisma.driver.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true,
          isActive: true,
          user: { select: { fullName: true, isActive: true } },
          _count: { select: { assignedPackages: true } },
        },
      }),
      this.driverActivity(),
      this.countPickupsByStatus(),
      this.voucherTotals(),
      this.runsheetTotals(),
      prisma.runsheet.count({
        where: { status: { in: ['RETOUR_DEPOT', 'EN_COURS'] as never } },
      }),
      prisma.deposit.count({ where: { isActive: true } }),
      prisma.interDepotTransfer.count({
        // Un transfert en cours est un lot qui n'est pas encore arrivé : créé,
        // préparé, ou en route. Les statuts sont ceux du module inter-dépôts.
        where: {
          status: { in: ['CRE', 'PREPARE', 'EN_TRANSIT'] as never },
        },
      }),
      prisma.interDepotTransfer.aggregate({ _sum: { totalPackages: true } }),
      this.recentTimeline(),
      this.codOverTime(),
      this.supplierActivity(),
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
      },
    });

    const baseEligibles = livres + reportes + retournes;
    const tauxReussite = percent(livres, baseEligibles, 0);

    // Un livreur est « en tournée » s'il porte une tournée ouverte.
    const busyDriverIds = new Set(
      (
        await prisma.runsheet.findMany({
          where: { status: { in: ['EN_COURS', 'VALIDEE_DEPART', 'EN_ATTENTE'] as never } },
          select: { driverId: true },
          distinct: ['driverId'],
        })
      ).map((r) => r.driverId)
    );
    const enTournee = drivers.filter((d) => busyDriverIds.has(d.id)).length;
    const horsLigne = drivers.length - enTournee;

    // À encaisser : montant dû par les clients sur les colis non encore livrés.
    const aEncaisser = await prisma.package.aggregate({
      where: {
        deletedAt: null,
        status: {
          notIn: [PackageStatus.LIVRE, PackageStatus.ANNULE, PackageStatus.ECHEC_LIVRAISON] as never,
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
        disponibles: horsLigne,
        enTournee,
        // Le suivi de présence n'existe pas encore dans le modèle : aucun
        // indicateur ne permet de distinguer un livreur injoignable d'un
        // livreur simplement sans tournée. La valeur reste donc à zéro
        // plutôt qu'un chiffre inventé.
        horsLigne: 0,
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
        deliveriesOverTime: codSeries,
        deliveredVsReturned: [
          { name: 'Livrés avec succès', value: livres, color: '#10B981' },
          { name: 'Reportés (NPAI/Absent)', value: reportes, color: '#F59E0B' },
          { name: 'Retours définitifs', value: retournes, color: '#DC2626' },
        ],
        codAmounts: codSeries.map((day) => ({
          name: day.label,
          aEncaisser: day.colis,
          encaisse: day.livres,
        })),
        driverActivity: driverLoad,
        supplierActivity,
      },
      alerts,
      recentActivity: timeline,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Agrégations                                                       */
  /* ---------------------------------------------------------------- */

  private async countPackagesByStatus(): Promise<Record<string, number>> {
    const prisma = getPrisma();
    const grouped = await prisma.package.groupBy({
      by: ['status'],
      where: { deletedAt: null },
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

  private async driverActivity(): Promise<DashboardMetricsDto['charts']['driverActivity']> {
    const prisma = getPrisma();
    const rows = await prisma.driver.findMany({
      where: { deletedAt: null },
      select: {
        user: { select: { fullName: true } },
        assignedPackages: {
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

  private async runsheetTotals(): Promise<{
    collectedCash: number;
    deficit: number;
  }> {
    const prisma = getPrisma();
    const totals = await prisma.runsheet.aggregate({
      _sum: { collectedCash: true, deficitAmount: true },
    });
    return {
      collectedCash: Number(totals._sum.collectedCash ?? 0),
      deficit: Number(totals._sum.deficitAmount ?? 0),
    };
  }

  /** Activité des quatre derniers jours, utilisée par deux graphiques. */
  private async codOverTime(): Promise<
    DashboardMetricsDto['charts']['deliveriesOverTime']
  > {
    const prisma = getPrisma();
    // La fenêtre de la requête et celle des colonnes sont deux bornes distinctes :
    // `from` sert au filtre SQL, `today` ancre les quatre colonnes. Les confondre
    // décale les buckets de trois jours en arrière — le graphique s'arrêtait alors
    // à l'avant-veille et ignorait silencieusement tout ce qui avait été créé
    // depuis, puisque ces lignes tombaient dans un seau inexistant.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setDate(today.getDate() - 3);

    const recent = await prisma.package.findMany({
      where: { deletedAt: null, createdAt: { gte: from } },
      select: { createdAt: true, status: true, totalPrice: true, collectedAmount: true },
    });

    const buckets = new Map<string, { colis: number; livres: number }>();
    for (let i = 3; i >= 0; i -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      buckets.set(dayKey(day), { colis: 0, livres: 0 });
    }

    for (const pkg of recent) {
      const bucket = buckets.get(dayKey(pkg.createdAt));
      if (!bucket) continue;
      bucket.colis += 1;
      if (pkg.status === PackageStatus.LIVRE || pkg.status === PackageStatus.LIVRAISON_PARTIELLE) {
        bucket.livres += 1;
      }
    }

    return [...buckets.entries()].map(([label, value]) => ({ label, ...value }));
  }

  private async supplierActivity(): Promise<
    DashboardMetricsDto['charts']['supplierActivity']
  > {
    const prisma = getPrisma();
    const rows = await prisma.shipper.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        companyName: true,
        _count: { select: { packages: true } },
        packages: {
          where: { deletedAt: null },
          select: { totalPrice: true },
        },
      },
      take: 6,
      orderBy: { companyName: 'asc' },
    });

    return rows.map((shipper) => ({
      name: shipper.companyName,
      colis: shipper._count.packages,
      montantTND: round3(shipper.packages.reduce((sum, p) => sum + Number(p.totalPrice), 0)),
    }));
  }

  /** Les derniers événements PackageTimeline, tous types confondus. */
  private async recentTimeline(): Promise<DashboardMetricsDto['recentActivity']> {
    const prisma = getPrisma();
    const events = await prisma.packageTimeline.findMany({
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

/** Clé de regroupement par jour, au format court utilisé par les graphiques. */
function dayKey(date: Date): string {
  return date.toLocaleDateString('fr-TN', { day: '2-digit', month: '2-digit' });
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
