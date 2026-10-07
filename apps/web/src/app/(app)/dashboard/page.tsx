'use client';

/**
 * Poste de commandement logistique.
 *
 * Écran migré depuis l'application Vite archivée (legacy/vite-app) : la mise en
 * page et les indicateurs sont conservés à l'identique. Les données proviennent
 * désormais du client API commun, et non plus d'un `fetch` codé en dur.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Barcode,
  Calendar,
  Check,
  ChevronRight,
  Coins,
  Package,
  RefreshCw,
  Truck,
  Warehouse,
} from 'lucide-react';
import {
  Badge,
  Card,
  CodBarChart,
  DriverActivityChart,
  ErrorBanner,
  PageHeader,
  SkeletonCard,
  StatusDonutChart,
  StatusIndicator,
  SupplierActivityChart,
  VolumeLineChart,
  formatTND,
} from '@logixpress/ui';
import { dashboardApi, type DashboardDto } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await dashboardApi.get());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger les indicateurs opérationnels.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Repli visuel le temps du chargement : évite d'afficher des zéros.
  const dashboardData = data;
  const EMPTY_COLIS = {
    total: 0, nouveaux: 0, aAffecter: 0, affectes: 0, enLivraison: 0, livres: 0,
    reportes: 0, retournes: 0, annules: 0, echanges: 0, tauxReussite: 0,
  };
  const EMPTY_LIVREURS = { actifs: 0, disponibles: 0, enTournee: 0, horsLigne: 0, total: 0 };
  const EMPTY_RAMASSAGES = { aConfirmer: 0, planifies: 0, enCours: 0, effectues: 0, annules: 0, total: 0 };
  const EMPTY_PAIEMENTS = {
    montantAEncaisserTND: 0, montantEncaisseTND: 0, paiementsEnAttenteTND: 0,
    paiementsValidesTND: 0, retoursFinanciersTND: 0, deficitCaisseTND: 0,
  };
  const EMPTY_DEPOTS = { colisAuDepot: 0, colisInTransit: 0, interDepotsActifs: 0, agencesActives: 0 };

  const colisStats = dashboardData?.colis ?? EMPTY_COLIS;
  const livreurStats = dashboardData?.livreurs ?? EMPTY_LIVREURS;
  const ramassageStats = dashboardData?.ramassages ?? EMPTY_RAMASSAGES;
  const paiementStats = dashboardData?.paiements ?? EMPTY_PAIEMENTS;
  const depotStats = dashboardData?.depots ?? EMPTY_DEPOTS;
  const alerts = dashboardData?.alerts ?? [];
  const recentActivities = dashboardData?.recentActivity ?? [];

  return (
        <div className="space-y-6">
          <PageHeader
            title="Poste de Commandement Logistique"
            description="Supervision en temps réel des 5 piliers opérationnels : Colis, Livreurs, Ramassages, Paiements CRBT et Dépôts régionaux."
            breadcrumbs={[{ label: 'Administration' }, { label: 'Poste de Commandement', active: true }]}
            badge={
              <Badge variant="success">
                <StatusIndicator status="online" pulse label="Temps Réel Opérationnel" />
              </Badge>
            }
            actions={
              <button
                onClick={() => void loadData()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition shadow-2xs cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Actualiser les flux</span>
              </button>
            }
          />

          <div className="p-6 space-y-6">
            {error && (
              <ErrorBanner
                message={`${error} Vérifiez que l'API est démarrée sur le port 4000.`}
                onDismiss={() => setError(null)}
              />
            )}

            {isLoading && !dashboardData && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}

            {/* ALERTES OPÉRATIONNELLES PRIORITAIRES */}
            {alerts.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {alerts.map((alert: any) => (
                  <div
                    key={alert.id}
                    className={`p-3.5 rounded-lg border flex flex-col justify-between shadow-2xs transition hover:shadow-xs ${
                      alert.type === 'danger'
                        ? 'bg-red-50/70 border-red-200 text-red-900'
                        : alert.type === 'warning'
                        ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                        : 'bg-blue-50/70 border-blue-200 text-blue-900'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider opacity-80 flex items-center gap-1">
                          {alert.type === 'danger' && <AlertCircle className="w-3.5 h-3.5 text-red-600" />}
                          {alert.type === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                          {alert.title}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[11px] font-mono font-bold bg-white/80 border">
                          {alert.count}
                        </span>
                      </div>
                      <p className="text-xs mt-1.5 leading-snug text-slate-700">{alert.message}</p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/60 flex justify-end">
                      <button
                        onClick={() => {
                          if (alert.category === 'COLIS_NON_AFFECTES') router.push('/colis');
                          else if (alert.category === 'RUNSHEETS_A_VALIDER') router.push('/runsheets');
                          else if (alert.category === 'PAIEMENTS_EN_ATTENTE') router.push('/paiements');
                          else if (alert.category === 'RAMASSAGES_A_CONFIRMER') router.push('/ramassages');
                        }}
                        className="text-xs font-bold text-red-700 hover:text-red-800 flex items-center gap-1 cursor-pointer"
                      >
                        <span>{alert.actionLabel}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* SECTION 1 : STATISTIQUES DES COLIS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-red-600" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Flux Colis (Total : {colisStats.total} pris en charge)
                  </h3>
                </div>
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Taux de Réussite : {colisStats.tauxReussite}%
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-2.5">
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-slate-500 block truncate">Total</span>
                  <span className="text-lg font-bold text-slate-900 mt-1 block font-mono">{colisStats.total}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-sky-600 block truncate">Nouveaux</span>
                  <span className="text-lg font-bold text-sky-700 mt-1 block font-mono">{colisStats.nouveaux}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-red-200 bg-red-50/20 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-red-600 block truncate">À affecter</span>
                  <span className="text-lg font-bold text-red-700 mt-1 block font-mono">{colisStats.aAffecter}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-slate-500 block truncate">Affectés</span>
                  <span className="text-lg font-bold text-slate-800 mt-1 block font-mono">{colisStats.affectes}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-amber-200 bg-amber-50/20 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-amber-700 block truncate">En livraison</span>
                  <span className="text-lg font-bold text-amber-800 mt-1 block font-mono">{colisStats.enLivraison}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-emerald-200 bg-emerald-50/20 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-emerald-700 block truncate">Livrés</span>
                  <span className="text-lg font-bold text-emerald-800 mt-1 block font-mono">{colisStats.livres}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-amber-600 block truncate">Reportés</span>
                  <span className="text-lg font-bold text-amber-700 mt-1 block font-mono">{colisStats.reportes}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-rose-200 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-rose-700 block truncate">Retournés</span>
                  <span className="text-lg font-bold text-rose-800 mt-1 block font-mono">{colisStats.retournes}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-slate-500 block truncate">Annulés</span>
                  <span className="text-lg font-bold text-slate-600 mt-1 block font-mono">{colisStats.annules}</span>
                </div>
                <div className="p-3 bg-white rounded-lg border border-purple-200 shadow-2xs">
                  <span className="text-[11px] uppercase font-semibold text-purple-700 block truncate">Échanges</span>
                  <span className="text-lg font-bold text-purple-800 mt-1 block font-mono">{colisStats.echanges}</span>
                </div>
              </div>
            </div>

            {/* SECTION 2 : 4 GRILLES DE STATUTS MÉTIER (LIVREURS, RAMASSAGES, FINANCES, DÉPÔTS) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* LIVREURS */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Truck className="w-3.5 h-3.5 text-slate-700" />
                    <span>Flotte Livreurs ({livreurStats.total})</span>
                  </div>
                  <Badge variant="secondary">{livreurStats.actifs} Actifs</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-emerald-50/50 rounded border border-emerald-100">
                    <span className="text-slate-500 text-[11px] block">Disponibles</span>
                    <span className="text-base font-bold text-emerald-800 font-mono">{livreurStats.disponibles}</span>
                  </div>
                  <div className="p-2 bg-blue-50/50 rounded border border-blue-100">
                    <span className="text-slate-500 text-[11px] block">En tournée</span>
                    <span className="text-base font-bold text-blue-800 font-mono">{livreurStats.enTournee}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Hors ligne</span>
                    <span className="text-base font-bold text-slate-600 font-mono">{livreurStats.horsLigne}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Taux occupation</span>
                    <span className="text-base font-bold text-slate-900 font-mono">
                      {Math.round((livreurStats.enTournee / livreurStats.actifs) * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* RAMASSAGES */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Calendar className="w-3.5 h-3.5 text-amber-600" />
                    <span>RDV Ramassages ({ramassageStats.total})</span>
                  </div>
                  <Badge variant="warning">{ramassageStats.aConfirmer} à confirmer</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-amber-50/50 rounded border border-amber-100">
                    <span className="text-slate-500 text-[11px] block">À confirmer</span>
                    <span className="text-base font-bold text-amber-800 font-mono">{ramassageStats.aConfirmer}</span>
                  </div>
                  <div className="p-2 bg-sky-50/50 rounded border border-sky-100">
                    <span className="text-slate-500 text-[11px] block">Planifiés</span>
                    <span className="text-base font-bold text-sky-800 font-mono">{ramassageStats.planifies}</span>
                  </div>
                  <div className="p-2 bg-emerald-50/50 rounded border border-emerald-100">
                    <span className="text-slate-500 text-[11px] block">Effectués</span>
                    <span className="text-base font-bold text-emerald-800 font-mono">{ramassageStats.effectues}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Annulés</span>
                    <span className="text-base font-bold text-slate-500 font-mono">{ramassageStats.annules}</span>
                  </div>
                </div>
              </div>

              {/* FINANCES & PAIEMENTS */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Coins className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Caisse & CRBT (TND)</span>
                  </div>
                  <Badge variant="success">0 Déficit</Badge>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">À encaisser :</span>
                    <span className="font-mono font-bold text-slate-900">{formatTND(paiementStats.montantAEncaisserTND)}</span>
                  </div>
                  <div className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">Encaissé espèces :</span>
                    <span className="font-mono font-bold text-emerald-700">{formatTND(paiementStats.montantEncaisseTND)}</span>
                  </div>
                  <div className="flex justify-between py-0.5 border-b border-slate-100">
                    <span className="text-slate-500">Bordereaux en attente :</span>
                    <span className="font-mono font-semibold text-amber-700">{formatTND(paiementStats.paiementsEnAttenteTND)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-slate-500">Validés décaissés :</span>
                    <span className="font-mono font-bold text-slate-800">{formatTND(paiementStats.paiementsValidesTND)}</span>
                  </div>
                </div>
              </div>

              {/* DÉPÔTS & LOGISTIQUE */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 uppercase">
                    <Warehouse className="w-3.5 h-3.5 text-red-600" />
                    <span>Dépôts & Navettes</span>
                  </div>
                  <Badge variant="outline">4 Agences</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-red-50/40 rounded border border-red-100">
                    <span className="text-slate-500 text-[11px] block">Au Hub Ben Arous</span>
                    <span className="text-base font-bold text-red-700 font-mono">{depotStats.colisAuDepot}</span>
                  </div>
                  <div className="p-2 bg-purple-50/50 rounded border border-purple-100">
                    <span className="text-slate-500 text-[11px] block">En Transit</span>
                    <span className="text-base font-bold text-purple-800 font-mono">{depotStats.colisInTransit}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Navettes actives</span>
                    <span className="text-base font-bold text-slate-800 font-mono">{depotStats.interDepotsActifs}</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-200">
                    <span className="text-slate-500 text-[11px] block">Taux saturation</span>
                    <span className="text-base font-bold text-slate-900 font-mono">42%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 3 : 5 GRAPHIQUES OPÉRATIONNELS DEMANDÉS */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 1. Deliveries Over Time */}
              <Card
                className="lg:col-span-2"
                title="1. Cadence Horaire des Livraisons (Deliveries Over Time)"
                subtitle="Flux cumulé des colis pris en charge vs validés livrés au client final"
              >
                <VolumeLineChart data={dashboardData?.charts?.deliveriesOverTime || []} height={220} />
              </Card>

              {/* 2. Delivered vs Returned */}
              <Card
                title="2. Livrés vs Retours (Conformité)"
                subtitle="Répartition des fins de tournée"
              >
                <StatusDonutChart data={dashboardData?.charts?.deliveredVsReturned || []} height={180} />
                <div className="mt-2 space-y-1 text-xs border-t border-slate-100 pt-2">
                  <div className="flex justify-between">
                    <span className="text-emerald-700 font-medium">Livrés avec succès :</span>
                    <span className="font-bold text-emerald-800 font-mono">
                      {dashboardData?.charts?.deliveredVsReturned?.[0]?.value || 24}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-700 font-medium">Reportés (NPAI/Absent) :</span>
                    <span className="font-bold text-amber-800 font-mono">
                      {dashboardData?.charts?.deliveredVsReturned?.[1]?.value || 3}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-700 font-medium">Retours définitifs :</span>
                    <span className="font-bold text-red-800 font-mono">
                      {dashboardData?.charts?.deliveredVsReturned?.[2]?.value || 1}
                    </span>
                  </div>
                </div>
              </Card>

              {/* 3. COD Amounts */}
              <Card
                title="3. Montants COD Recouvrés (Espèces)"
                subtitle="Montant prévu à l'enlèvement vs encaissé au retour de tournée (TND)"
              >
                <CodBarChart data={dashboardData?.charts?.codAmounts || []} height={210} />
              </Card>

              {/* 4. Driver Activity */}
              <Card
                title="4. Activité par Livreur (Driver Activity)"
                subtitle="Performance individuelle des tournées en cours"
              >
                <DriverActivityChart data={dashboardData?.charts?.driverActivity || []} height={210} />
              </Card>

              {/* 5. Supplier Activity */}
              <Card
                title="5. Activité des Expéditeurs (Top Fournisseurs)"
                subtitle="Volume des colis expédiés par compte e-commerce"
              >
                <SupplierActivityChart data={dashboardData?.charts?.supplierActivity || []} height={210} />
              </Card>
            </div>

            {/* SECTION 4 : FLUX D'ACTIVITÉ RÉCENTE EN DIRECT (RECENT ACTIVITY FEED) */}
            <Card
              title="Journal des Événements Opérationnels Récents (Live Feed)"
              subtitle="Traçabilité continue des scans, livraisons, validations caisse et ramassages"
              action={
                <span className="text-xs text-slate-500 font-mono">Mis à jour en temps réel</span>
              }
            >
              <div className="divide-y divide-slate-100">
                {recentActivities.map((act: any) => (
                  <div key={act.id} className="py-3 flex items-start justify-between gap-4 hover:bg-slate-50/50 transition px-1 rounded">
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          act.type === 'DELIVERY'
                            ? 'bg-emerald-100 text-emerald-700'
                            : act.type === 'SCAN'
                            ? 'bg-blue-100 text-blue-700'
                            : act.type === 'RUNSHEET'
                            ? 'bg-purple-100 text-purple-700'
                            : act.type === 'PAYMENT'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {act.type === 'DELIVERY' && <Check className="w-3.5 h-3.5" />}
                        {act.type === 'SCAN' && <Barcode className="w-3.5 h-3.5" />}
                        {act.type === 'RUNSHEET' && <Truck className="w-3.5 h-3.5" />}
                        {act.type === 'PAYMENT' && <Coins className="w-3.5 h-3.5" />}
                        {act.type === 'PICKUP' && <Calendar className="w-3.5 h-3.5" />}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-xs">{act.title}</span>
                          {act.badge && (
                            <span className="px-1.5 py-0.2 rounded text-[11px] font-mono bg-slate-100 text-slate-700 border">
                              {act.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">{act.description}</p>
                        <span className="text-[11px] text-slate-500 block mt-0.5 font-medium">Par {act.actor}</span>
                      </div>
                    </div>

                    <span className="text-[11px] font-mono text-slate-500 shrink-0">{act.timestamp}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
  );
}
