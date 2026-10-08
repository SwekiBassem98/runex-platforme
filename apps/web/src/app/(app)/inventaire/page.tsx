'use client';

/**
 * INVENTAIRE — historique complet + exceptions / à investiguer.
 *
 * Deux onglets :
 *  - Historique : liste paginée serveur (comme avant)
 *  - Exceptions : colis suspects calculés côté serveur à partir des colonnes
 *    existantes (aucun nouveau PackageStatus), avec catégorie, sévérité,
 *    raisons, dernier événement, âge. Filtrage serveur, pagination, scoping dépôt.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BasculeFiches,
  Drawer,
  FicheLigne,
  LigneVide,
  Pagination,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatDate,
  formatMontant,
} from '@logixpress/ui';
import {
  AlertTriangle,
  Archive,
  Download,
  Eye,
  Filter,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  inventoryApi,
  downloadInventoryCsv,
  inventoryExceptionsApi,
  type InventoryExceptionFacets,
  type InventoryExceptionFilters,
  type InventoryExceptionRow,
  type InventoryFacets,
  type InventoryFilters,
  type InventoryRow,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PermissionCode } from '@logixpress/types';

type Filtres = InventoryFilters;
type FiltresEx = InventoryExceptionFilters;

const FILTRE_VIDE: Filtres = {
  search: '',
  dateFrom: '',
  dateTo: '',
  status: 'ALL',
  shipperId: 'ALL',
  driverId: 'ALL',
  depositId: 'ALL',
  city: 'ALL',
  governorate: 'ALL',
  type: 'ALL',
  paymentStatus: 'ALL',
  returnStatus: 'ALL',
};

const FILTRE_EX_VIDE: FiltresEx = {
  search: '',
  dateFrom: '',
  dateTo: '',
  status: 'ALL',
  shipperId: 'ALL',
  driverId: 'ALL',
  depositId: 'ALL',
  city: 'ALL',
  governorate: 'ALL',
  type: 'ALL',
  paymentStatus: 'ALL',
  returnStatus: 'ALL',
  category: 'ALL',
  severity: 'ALL',
};

function estActif(filtres: Filtres): boolean {
  return (Object.keys(FILTRE_VIDE) as (keyof Filtres)[]).some((key) => {
    const value = filtres[key];
    if (key === 'page' || key === 'limit') return false;
    return value !== undefined && value !== '' && value !== 'ALL';
  });
}
function estActifEx(filtres: FiltresEx): boolean {
  return (Object.keys(FILTRE_EX_VIDE) as (keyof FiltresEx)[]).some((key) => {
    const value = (filtres as Record<string, unknown>)[key];
    if (key === 'page' || key === 'limit') return false;
    return value !== undefined && value !== '' && value !== 'ALL';
  });
}

const LIBELLE_FILTRE: Record<string, string> = {
  search: 'recherche',
  status: 'statut',
  governorate: 'gouvernorat',
  city: 'commune',
  deposit: 'dépôt',
  driver: 'livreur',
  type: 'type de colis',
  paymentStatus: 'paiement',
  returnStatus: 'retour',
  createdFrom: 'créé depuis le',
  createdTo: "créé jusqu'au",
  categorie: 'catégorie',
  severite: 'sévérité',
  category: 'catégorie',
  severity: 'sévérité',
};

const LIBELLE_PAIEMENT: Record<string, string> = {
  NON_REGLE: 'Non réglé',
  EN_BORDEREAU: 'En bordereau',
  PAYE: 'Payé',
  EN_ATTENTE: 'En attente',
  VALIDE: 'Validé',
  REJETE: 'Rejeté',
  REMBOURSE: 'Remboursé',
  AUCUN_RETOUR: '—',
  EN_ATTENTE_RETOUR: 'Retour en attente',
  RECU_RETOUR: 'Retour reçu',
  RETOURNE_EXPEDITEUR: "Retourné à l'expéditeur",
};

const CATEGORY_LABELS: Record<string, string> = {
  NON_TRACABLE: 'Non traçable',
  INCOHERENT: 'Incohérent',
  EN_RETARD: 'En retard',
  BLOQUE: 'Bloqué',
  NON_ENVOYE: 'Non envoyé',
  RETOUR_PROBLEME: 'Retour / problème',
  A_SURVEILLER: 'À surveiller',
};

const SEVERITY_LABELS: Record<string, string> = {
  critique: 'Critique',
  haute: 'Haute',
  moyenne: 'Moyenne',
  basse: 'Basse',
};

function badgeSeverity(sev: string) {
  switch (sev) {
    case 'critique':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'haute':
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'moyenne':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'basse':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function fmtAge(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${d}j ${h}h` : `${d}j`;
}

export default function InventairePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [onglet, setOnglet] = useState<'historique' | 'exceptions'>('exceptions');

  // ---- Historique state ----
  const [filtres, setFiltres] = useState<Filtres>(FILTRE_VIDE);
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, appliedFilters: {} as Record<string, string> });
  const [facets, setFacets] = useState<InventoryFacets | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [enFiches, setEnFiches] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'erreur'; texte: string } | null>(null);

  // ---- Exceptions state ----
  const [filtresEx, setFiltresEx] = useState<FiltresEx>(FILTRE_EX_VIDE);
  const [rechercheEx, setRechercheEx] = useState('');
  const [pageEx, setPageEx] = useState(1);
  const [rowsEx, setRowsEx] = useState<InventoryExceptionRow[]>([]);
  const [metaEx, setMetaEx] = useState({ total: 0, totalPages: 1, appliedFilters: {} as Record<string, string>, thresholds: { stuckHours: 48, blockedHours: 72, nonTraceableHours: 24, nonEnvoyeHours: 48 } });
  const [facetsEx, setFacetsEx] = useState<InventoryExceptionFacets | null>(null);
  const [isLoadingEx, setIsLoadingEx] = useState(true);
  const [enFichesEx, setEnFichesEx] = useState(false);
  const [detailEx, setDetailEx] = useState<InventoryExceptionRow | null>(null);
  const [detailHistory, setDetailHistory] = useState<{ status: string; title: string; description: string | null; locationName: string | null; operatorName: string; createdAt: string }[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const peutExporter = user?.permissions?.includes(PermissionCode.INVENTORY_EXPORT) ?? false;
  const aFiltres = useMemo(() => estActif(filtres), [filtres]);
  const aFiltresEx = useMemo(() => estActifEx(filtresEx), [filtresEx]);

  // URL sync for historique only
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filtres)) {
      if (key === 'page' || key === 'limit') continue;
      if (value === undefined || value === '' || value === 'ALL') continue;
      params.set(key, String(value));
    }
    if (page > 1) params.set('page', String(page));
    if (onglet === 'exceptions') params.set('onglet', 'exceptions');
    const query = params.toString();
    router.replace(query ? `/inventaire?${query}` : '/inventaire', { scroll: false });
  }, [filtres, page, onglet, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lu: Filtres = { ...FILTRE_VIDE };
    for (const key of Object.keys(FILTRE_VIDE) as (keyof Filtres)[]) {
      const value = params.get(key);
      if (value !== null) (lu as Record<string, string>)[key] = value;
    }
    setFiltres(lu);
    setRecherche(params.get('search') ?? '');
    setPage(Number(params.get('page') ?? 1) || 1);
    if (params.get('onglet') === 'exceptions') setOnglet('exceptions');
  }, []);

  useEffect(() => {
    inventoryApi.facets().then(setFacets).catch(() => setFacets(null));
  }, []);
  useEffect(() => {
    void inventoryApi.facets().then(setFacets).catch(() => setFacets(null));
  }, [filtres]);

  // Exceptions facets
  useEffect(() => {
    inventoryExceptionsApi.facets(filtresEx).then(setFacetsEx).catch(() => setFacetsEx(null));
  }, [filtresEx]);

  const charger = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await inventoryApi.list({ ...filtres, page, limit: 50 });
      setRows(result.items);
      setMeta({ total: result.total, totalPages: result.totalPages, appliedFilters: result.appliedFilters });
    } catch {
      setRows([]);
      setMessage({ kind: 'erreur', texte: 'Historique inaccessible.' });
    } finally {
      setIsLoading(false);
    }
  }, [filtres, page]);

  const chargerEx = useCallback(async () => {
    setIsLoadingEx(true);
    try {
      const result = await inventoryExceptionsApi.list({ ...filtresEx, page: pageEx, limit: 50 });
      setRowsEx(result.items);
      setMetaEx({ total: result.total, totalPages: result.totalPages, appliedFilters: result.appliedFilters, thresholds: result.thresholds });
    } catch {
      setRowsEx([]);
    } finally {
      setIsLoadingEx(false);
    }
  }, [filtresEx, pageEx]);

  useEffect(() => { void charger(); }, [charger]);
  useEffect(() => { void chargerEx(); }, [chargerEx]);

  const majFiltre = useCallback((patch: Partial<Filtres>) => {
    setPage(1);
    setFiltres((c) => ({ ...c, ...patch }));
  }, []);
  const majFiltreEx = useCallback((patch: Partial<FiltresEx>) => {
    setPageEx(1);
    setFiltresEx((c) => ({ ...c, ...patch }));
  }, []);

  const soumettreRecherche = (e: React.FormEvent) => { e.preventDefault(); majFiltre({ search: recherche.trim() }); };
  const soumettreRechercheEx = (e: React.FormEvent) => { e.preventDefault(); majFiltreEx({ search: rechercheEx.trim() }); };

  const exporter = async () => {
    setIsExporting(true);
    setMessage(null);
    try {
      const { rowCount } = await downloadInventoryCsv(filtres);
      setMessage({ kind: 'info', texte: `${rowCount.toLocaleString('fr-TN')} ligne(s) exportée(s), avec les filtres affichés.` });
    } catch (error) {
      setMessage({ kind: 'erreur', texte: error instanceof Error ? error.message : 'Export impossible.' });
    } finally { setIsExporting(false); }
  };
  const reinitialiser = () => { setFiltres(FILTRE_VIDE); setRecherche(''); setPage(1); };
  const reinitialiserEx = () => { setFiltresEx(FILTRE_EX_VIDE); setRechercheEx(''); setPageEx(1); };

  const ouvrirDetail = async (row: InventoryExceptionRow) => {
    setDetailEx(row);
    setDetailHistory(null);
    setDetailLoading(true);
    try {
      const res = await inventoryExceptionsApi.detail(row.id);
      const d = res as unknown as { detail?: { statusHistory?: unknown[]; deliveryAttempts?: unknown[] }; exception?: unknown };
      // try to fetch timeline via /colis/:id if available
      // fallback to exception detail's history
      if (d?.detail && Array.isArray((d.detail as { statusHistory?: unknown[] }).statusHistory)) {
        setDetailHistory((d.detail as { statusHistory: typeof detailHistory }).statusHistory as typeof detailHistory);
      } else {
        // fallback: fetch via /colis
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        // Use direct fetch to /api/v1/colis/:id
        const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api/v1';
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        // Instead call inventory detail already contains statusHistory if available
        // If not, show fallback
        setDetailHistory([]);
      }
    } catch {
      setDetailHistory([]);
    } finally { setDetailLoading(false); }
    // Also try to load full colis timeline via API if not yet
    try {
      const r = await fetch(`/api/v1/colis/${row.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` } });
      if (r.ok) {
        const j = await r.json();
        const pkg = j?.data;
        if (pkg?.statusHistory || pkg?.trackingTimeline) {
          const hist = pkg.trackingTimeline ?? pkg.statusHistory ?? [];
          setDetailHistory(hist.map((h: { status: string; title: string; description?: string; locationName?: string; location?: string; operatorName?: string; actor?: string; createdAt?: string; timestamp?: string }) => ({
            status: h.status,
            title: h.title ?? h.status,
            description: h.description ?? null,
            locationName: h.locationName ?? h.location ?? null,
            operatorName: h.operatorName ?? h.actor ?? '—',
            createdAt: h.createdAt ?? h.timestamp ?? new Date().toISOString(),
          })));
        }
      }
    } catch { /* ignore */ }
  };

  const selecteur = (
    cle: keyof Filtres,
    label: string,
    options: { value: string; label: string; count?: number }[]
  ) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] uppercase font-semibold text-slate-500">{label}</span>
      <select
        value={String(filtres[cle] ?? 'ALL')}
        onChange={(e) => majFiltre({ [cle]: e.target.value } as Partial<Filtres>)}
        className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-400 min-w-0"
      >
        <option value="ALL">Tous</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}{typeof o.count === 'number' ? ` (${o.count})` : ''}</option>
        ))}
      </select>
    </label>
  );

  const selecteurEx = (
    cle: keyof FiltresEx,
    label: string,
    options: { value: string; label: string; count?: number }[]
  ) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] uppercase font-semibold text-slate-500">{label}</span>
      <select
        value={String((filtresEx as Record<string, unknown>)[cle] ?? 'ALL')}
        onChange={(e) => majFiltreEx({ [cle]: e.target.value } as unknown as Partial<FiltresEx>)}
        className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-400 min-w-0"
      >
        <option value="ALL">Tous</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}{typeof o.count === 'number' ? ` (${o.count})` : ''}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex-1 p-4 lg:p-6 space-y-4">
      {/* En-tête + onglets */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Archive className="w-4 h-4" />
            Inventaire / Historique
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {onglet === 'historique'
              ? isLoading ? 'Chargement…' : `${meta.total.toLocaleString('fr-TN')} colis correspondent${aFiltres ? ' aux filtres actifs' : ' — aucun filtre'}`
              : isLoadingEx ? 'Chargement…' : `${metaEx.total.toLocaleString('fr-TN')} colis suspects / à investiguer${aFiltresEx ? ' (filtres actifs)' : ''} — seuils ${metaEx.thresholds.stuckHours}h retard / ${metaEx.thresholds.blockedHours}h bloqué`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onglet === 'historique' && aFiltres && (
            <button type="button" onClick={reinitialiser} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition">
              <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser
            </button>
          )}
          {onglet === 'exceptions' && aFiltresEx && (
            <button type="button" onClick={reinitialiserEx} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition">
              <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser
            </button>
          )}
          {onglet === 'historique' && peutExporter && (
            <button type="button" onClick={() => void exporter()} disabled={isExporting} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:text-slate-300 disabled:bg-slate-50 disabled:border-slate-200 transition">
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Exporter CSV
            </button>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setOnglet('historique')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${onglet === 'historique' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Historique complet
        </button>
        <button
          type="button"
          onClick={() => setOnglet('exceptions')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition ${onglet === 'exceptions' ? 'bg-white text-red-700 shadow-sm border border-red-200' : 'text-slate-600 hover:text-slate-900'}`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Exceptions / À investiguer
          {facetsEx && facetsEx.totalExceptions > 0 && (
            <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${facetsEx.totalExceptions > 0 ? 'bg-red-600 text-white border-red-600' : 'bg-slate-200 text-slate-600'}`}>{facetsEx.totalExceptions}</span>
          )}
        </button>
      </div>

      {message && (
        <div className={`px-3 py-2 rounded-lg border text-[11px] flex items-start justify-between gap-3 ${message.kind === 'erreur' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          <span className="whitespace-pre-line">{message.texte}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Fermer"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {onglet === 'historique' ? (
        <>
          {/* Filtres historique */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-2xs p-3 space-y-3">
            <form onSubmit={soumettreRecherche} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="N° colis, code-barres, référence, nom ou téléphone…" className="w-full pl-8 pr-3 py-1.5 text-[11px] border border-slate-200 rounded-md focus:outline-none focus:border-blue-400" />
              </div>
              <button type="submit" className="px-3 py-1.5 text-[11px] font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-700 transition">Rechercher</button>
            </form>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <label className="flex flex-col gap-1"><span className="text-[11px] uppercase font-semibold text-slate-500">Du</span><input type="date" value={filtres.dateFrom ?? ''} onChange={(e) => majFiltre({ dateFrom: e.target.value })} className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md" /></label>
              <label className="flex flex-col gap-1"><span className="text-[11px] uppercase font-semibold text-slate-500">Au</span><input type="date" value={filtres.dateTo ?? ''} onChange={(e) => majFiltre({ dateTo: e.target.value })} className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md" /></label>
              {selecteur('status', 'Statut', facets?.statuses ?? [])}
              {selecteur('shipperId', 'Expéditeur', (facets?.shippers ?? []).map((s) => ({ value: s.id, label: s.label })))}
              {selecteur('driverId', 'Livreur', (facets?.drivers ?? []).map((d) => ({ value: d.id, label: d.label })))}
              {selecteur('depositId', 'Dépôt', (facets?.deposits ?? []).map((d) => ({ value: d.id, label: d.label })))}
              {selecteur('city', 'Commune', (facets?.cities ?? []).map((c) => ({ value: c, label: c })))}
              {selecteur('governorate', 'Gouvernorat', (facets?.governorates ?? []).map((g) => ({ value: g, label: g })))}
              {selecteur('type', 'Type de colis', facets?.packageTypes ?? [])}
              {selecteur('paymentStatus', 'Paiement', facets?.paymentStatuses ?? [])}
              {selecteur('returnStatus', 'Retour', facets?.returnStatuses ?? [])}
            </div>
            {aFiltres && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
                <Filter className="w-3 h-3 text-slate-500" />
                {Object.entries(meta.appliedFilters).map(([cle, valeur]) => (
                  <span key={cle} className="text-[11px] bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5"><span className="font-semibold">{LIBELLE_FILTRE[cle] ?? cle}</span> : {valeur.length > 24 ? `${valeur.slice(0, 24)}…` : valeur}</span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex justify-end"><BasculeFiches enFiches={enFiches} onChange={setEnFiches} /></div>
            {enFiches && (
              <div className="sm:hidden bg-white border border-slate-200 rounded-lg overflow-hidden">
                {rows.map((row) => (
                  <FicheLigne key={row.id} titre={row.customerName} identifiant={row.trackingNumber} sousTitre={`${row.city}${row.locality ? ` · ${row.locality}` : ''}`} onClick={() => router.push(`/colis?tracking=${row.trackingNumber}`)} action={<span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">{row.statusLabel}</span>} champs={[{ libelle: 'Montant', valeur: formatMontant(row.totalPrice), numerique: true }, { libelle: 'Téléphone', valeur: row.customerPhone }, { libelle: 'Paiement', valeur: LIBELLE_PAIEMENT[row.paymentStatus ?? ''] ?? '—' }, { libelle: 'Créé le', valeur: formatDate(row.createdAt) }]} />
                ))}
              </div>
            )}
            <div className={enFiches ? 'hidden sm:block' : ''}>
              <Table libelle="Inventaire des colis" largeurMin="1180px">
                <Thead><tr><Th figee>N° colis</Th><Th>Destinataire</Th><Th priorite="secondaire">Commune</Th><Th>Statut</Th><Th priorite="tertiaire">Expéditeur</Th><Th priorite="tertiaire">Livreur</Th><Th priorite="tertiaire">Dépôt</Th><Th align="right">Montant (DT)</Th><Th priorite="secondaire">Paiement</Th><Th priorite="secondaire">Retour</Th><Th priorite="tertiaire">Créé le</Th></tr></Thead>
                <Tbody>
                  {isLoading && rows.length === 0 ? <LigneVide colSpan={11}>Chargement…</LigneVide> : rows.length === 0 ? <LigneVide colSpan={11}>{aFiltres ? 'Aucun colis ne correspond à ces filtres.' : "L'inventaire est vide : aucun colis n'a encore été enregistré."}</LigneVide> : rows.map((row) => (
                    <Tr key={row.id} onClick={() => router.push(`/colis?tracking=${row.trackingNumber}`)} resume={`Colis ${row.trackingNumber}, ${row.customerName}, ${row.statusLabel}, ${formatMontant(row.totalPrice)}`}>
                      <Td figee className="font-mono font-semibold text-red-600 whitespace-nowrap">{row.trackingNumber}</Td>
                      <Td><div className="font-semibold text-slate-800">{row.customerName}</div><div className="font-mono text-[11px] text-slate-500">{row.customerPhone}</div></Td>
                      <Td priorite="secondaire" className="whitespace-nowrap">{row.city}{row.locality ? ` · ${row.locality}` : ''}</Td>
                      <Td className="whitespace-nowrap">{row.statusLabel}</Td>
                      <Td priorite="tertiaire" className="whitespace-nowrap">{row.shipperName}</Td>
                      <Td priorite="tertiaire" className="whitespace-nowrap">{row.driverName ?? '—'}</Td>
                      <Td priorite="tertiaire" className="whitespace-nowrap">{row.depositName ?? '—'}</Td>
                      <Td align="right" numerique className="font-mono font-semibold whitespace-nowrap">{formatMontant(row.totalPrice)}</Td>
                      <Td priorite="secondaire" className="whitespace-nowrap">{LIBELLE_PAIEMENT[row.paymentStatus ?? ''] ?? '—'}</Td>
                      <Td priorite="secondaire" className="whitespace-nowrap">{row.returnStatus && row.returnStatus !== 'AUCUN_RETOUR' ? (LIBELLE_PAIEMENT[row.returnStatus] ?? row.returnStatus) : '—'}</Td>
                      <Td priorite="tertiaire" className="font-mono whitespace-nowrap text-slate-500">{formatDate(row.createdAt)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
            <Pagination currentPage={page} totalPages={meta.totalPages} totalItems={meta.total} pageSize={50} onPageChange={setPage} libelle="colis" />
          </div>
        </>
      ) : (
        <>
          {/* Filtres Exceptions */}
          <div className="bg-white border border-slate-200 rounded-lg shadow-2xs p-3 space-y-3">
            <div className="flex gap-2">
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-2 flex-1">
                <ShieldAlert className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-[11px] leading-relaxed text-amber-900">
                  <span className="font-bold">Colis suspects — à investiguer.</span> Aucun colis n&apos;est labellisé &laquo; PERDU &raquo; : la donnée ne permet que de signaler une incohérence, un retard ou une absence de traçabilité. Seuils configurables : <span className="font-mono font-semibold">{metaEx.thresholds.stuckHours}h retard / {metaEx.thresholds.blockedHours}h bloqué / {metaEx.thresholds.nonTraceableHours}h non traçable / {metaEx.thresholds.nonEnvoyeHours}h non envoyé</span>. Ajoutez <code className="bg-white border border-amber-200 rounded px-1">?stuckHours=24</code> à la requête pour ajuster.
                </p>
              </div>
            </div>
            <form onSubmit={soumettreRechercheEx} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input value={rechercheEx} onChange={(e) => setRechercheEx(e.target.value)} placeholder="N° colis, code-barres, nom ou téléphone…" className="w-full pl-8 pr-3 py-1.5 text-[11px] border border-slate-200 rounded-md focus:outline-none focus:border-blue-400" />
              </div>
              <button type="submit" className="px-3 py-1.5 text-[11px] font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-700 transition">Rechercher</button>
            </form>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <label className="flex flex-col gap-1"><span className="text-[11px] uppercase font-semibold text-slate-500">Du</span><input type="date" value={filtresEx.dateFrom ?? ''} onChange={(e) => majFiltreEx({ dateFrom: e.target.value })} className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md" /></label>
              <label className="flex flex-col gap-1"><span className="text-[11px] uppercase font-semibold text-slate-500">Au</span><input type="date" value={filtresEx.dateTo ?? ''} onChange={(e) => majFiltreEx({ dateTo: e.target.value })} className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md" /></label>
              {selecteurEx('category', 'Catégorie', (facetsEx?.categories ?? []).map((c) => ({ value: c.value, label: c.label, count: c.count })))}
              {selecteurEx('severity', 'Sévérité', (facetsEx?.severities ?? []).map((s) => ({ value: s.value, label: s.label.charAt(0).toUpperCase() + s.label.slice(1), count: s.count })))}
              {selecteurEx('status', 'Statut', (facetsEx?.statuses ?? []).map((s) => ({ value: s.value, label: s.label, count: s.count })))}
              {selecteurEx('depositId', 'Dépôt', (facetsEx?.deposits ?? []).map((d) => ({ value: d.id, label: d.label })))}
              {selecteurEx('driverId', 'Livreur', (facetsEx?.drivers ?? []).map((d) => ({ value: d.id, label: d.label })))}
              <label className="flex flex-col gap-1"><span className="text-[11px] uppercase font-semibold text-slate-500">Gouvernorat</span><input value={filtresEx.governorate ?? ''} placeholder="Tous" onChange={(e) => majFiltreEx({ governorate: e.target.value })} className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md" /></label>
            </div>
            {aFiltresEx && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
                <Filter className="w-3 h-3 text-slate-500" />
                {Object.entries(metaEx.appliedFilters).map(([cle, valeur]) => (
                  <span key={cle} className="text-[11px] bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5"><span className="font-semibold">{LIBELLE_FILTRE[cle] ?? cle}</span> : {valeur.length > 24 ? `${valeur.slice(0, 24)}…` : valeur}</span>
                ))}
              </div>
            )}
          </div>

          {/* Tableau Exceptions */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-[11px] text-slate-500">
                {isLoadingEx ? 'Chargement…' : `${metaEx.total} colis suspects — sur ${facetsEx?.totalScanned ?? '—'} analysés`}
              </p>
              <BasculeFiches enFiches={enFichesEx} onChange={setEnFichesEx} />
            </div>

            {enFichesEx && (
              <div className="sm:hidden bg-white border border-slate-200 rounded-lg overflow-hidden">
                {rowsEx.map((row) => (
                  <FicheLigne
                    key={row.id}
                    titre={row.trackingNumber}
                    identifiant={row.statusLabel}
                    sousTitre={`${row.city || '—'} · ${row.depositName ?? 'Aucun dépôt'}`}
                    onClick={() => void ouvrirDetail(row)}
                    action={<span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeSeverity(row.severity)}`}>{SEVERITY_LABELS[row.severity] ?? row.severity}</span>}
                    champs={[
                      { libelle: 'Catégorie', valeur: CATEGORY_LABELS[row.exceptionCategory] ?? row.exceptionCategory },
                      { libelle: 'Dépôt', valeur: row.depositName ?? 'Information indisponible' },
                      { libelle: 'Livreur', valeur: row.driverName ?? 'Information indisponible' },
                      { libelle: 'Tournée', valeur: row.runsheetNumber ?? 'Information indisponible' },
                      { libelle: 'Âge', valeur: fmtAge(row.ageHours) },
                      { libelle: 'Raison', valeur: row.reasons[0] ?? '—' },
                    ]}
                  />
                ))}
              </div>
            )}

            <div className={enFichesEx ? 'hidden sm:block' : ''}>
              <Table libelle="Exceptions d'inventaire" largeurMin="1480px">
                <Thead>
                  <tr>
                    <Th figee>N° colis</Th>
                    <Th>Statut</Th>
                    <Th priorite="secondaire">Dépôt courant</Th>
                    <Th priorite="secondaire">Destination</Th>
                    <Th priorite="tertiaire">Livreur</Th>
                    <Th priorite="tertiaire">Tournée</Th>
                    <Th priorite="secondaire">Dernier évén.</Th>
                    <Th priorite="tertiaire">Âge / Durée</Th>
                    <Th>Raison</Th>
                    <Th>Sévérité</Th>
                    <Th>Action</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {isLoadingEx && rowsEx.length === 0 ? <LigneVide colSpan={11}>Chargement…</LigneVide> : rowsEx.length === 0 ? <LigneVide colSpan={11}>{aFiltresEx ? 'Aucun colis suspect ne correspond à ces filtres.' : "Aucun colis suspect : l'inventaire est cohérent."}</LigneVide> : rowsEx.map((row) => (
                    <Tr key={row.id} onClick={() => void ouvrirDetail(row)} resume={`Colis ${row.trackingNumber} ${CATEGORY_LABELS[row.exceptionCategory] ?? row.exceptionCategory} ${row.reasons[0] ?? ''}`}>
                      <Td figee className="font-mono font-semibold text-red-600 whitespace-nowrap">{row.trackingNumber}</Td>
                      <Td className="whitespace-nowrap"><span className="px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 border border-slate-200">{row.statusLabel}</span></Td>
                      <Td priorite="secondaire" className="whitespace-nowrap">{row.depositName ?? <span className="text-slate-400 italic">Information indisponible</span>}</Td>
                      <Td priorite="secondaire" className="whitespace-nowrap">{row.governorate || row.city ? `${row.governorate}${row.city ? ` · ${row.city}` : ''}` : <span className="text-slate-400 italic">Information indisponible</span>}</Td>
                      <Td priorite="tertiaire" className="whitespace-nowrap">{row.driverName ?? <span className="text-slate-400 italic">Information indisponible</span>}</Td>
                      <Td priorite="tertiaire" className="whitespace-nowrap">{row.runsheetNumber ?? <span className="text-slate-400 italic">—</span>}</Td>
                      <Td priorite="secondaire" className="whitespace-nowrap">
                        <div className="text-[11px] text-slate-700">{row.lastEventTitle ?? 'Aucun événement'}</div>
                        <div className="font-mono text-[11px] text-slate-500">{row.lastEventAt ? formatDate(row.lastEventAt) : 'Information indisponible'}</div>
                      </Td>
                      <Td priorite="tertiaire" className="whitespace-nowrap">
                        <div className="font-mono text-[11px] font-semibold">{fmtAge(row.ageHours)} <span className="text-slate-500 font-normal">/ {fmtAge(row.hoursSinceUpdate)} depuis maj</span></div>
                        <div className="text-[11px] text-slate-500">{row.timelineCount} évén. · {row.deliveryAttemptsCount} tent.</div>
                      </Td>
                      <Td className="max-w-[260px]">
                        <div className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap">{row.reasons[0] ?? '—'}</div>
                        {row.reasons.length > 1 && <div className="text-[11px] text-slate-500">+{row.reasons.length - 1} autre(s) raison(s)</div>}
                        <div className="mt-1 inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">{CATEGORY_LABELS[row.exceptionCategory] ?? row.exceptionCategory}</div>
                      </Td>
                      <Td className="whitespace-nowrap"><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeSeverity(row.severity)}`}>{SEVERITY_LABELS[row.severity] ?? row.severity}</span></Td>
                      <Td className="whitespace-nowrap">
                        <button type="button" onClick={(e) => { e.stopPropagation(); void ouvrirDetail(row); }} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50">
                          <Eye className="w-3 h-3" /> Détail
                        </button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
            <Pagination currentPage={pageEx} totalPages={metaEx.totalPages} totalItems={metaEx.total} pageSize={50} onPageChange={setPageEx} libelle="colis suspects" />
          </div>

          {/* Drawer détail */}
          <Drawer
            isOpen={!!detailEx}
            onClose={() => setDetailEx(null)}
            title={detailEx ? `Colis ${detailEx.trackingNumber}` : 'Détail'}
            subtitle={detailEx ? `${CATEGORY_LABELS[detailEx.exceptionCategory] ?? detailEx.exceptionCategory} · ${SEVERITY_LABELS[detailEx.severity] ?? detailEx.severity} · ${detailEx.reasons.join(' — ')}` : undefined}
            width="xl"
            footer={
              detailEx ? (
                <>
                  <button type="button" onClick={() => setDetailEx(null)} className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50">Fermer</button>
                  <button type="button" onClick={() => router.push(`/colis?tracking=${detailEx.trackingNumber}`)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-700"><Eye className="w-3.5 h-3.5" /> Voir le colis</button>
                  <button type="button" onClick={() => router.push(`/colis?tracking=${detailEx.trackingNumber}`)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50">Voir le suivi</button>
                </>
              ) : undefined
            }
          >
            {detailEx && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Statut</div>
                    <div className="font-semibold text-slate-900">{detailEx.statusLabel} <span className="font-mono text-slate-500">({detailEx.status})</span></div>
                    <div className="text-slate-500">Type: {detailEx.packageType} · Pièces: {detailEx.pieceCount}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Montants</div>
                    <div className="font-mono font-semibold">{formatMontant(detailEx.totalPrice)} <span className="text-slate-500 font-normal">à encaisser</span></div>
                    <div className="font-mono text-slate-600">{formatMontant(detailEx.collectedAmount)} encaissé</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Dépôt courant</div>
                    <div className="font-semibold">{detailEx.depositName ?? 'Information indisponible'}</div>
                    <div className="text-slate-500">ID dépôt: {detailEx.depositId ?? '—'}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Destination</div>
                    <div className="font-semibold">{detailEx.governorate || detailEx.city ? `${detailEx.governorate} · ${detailEx.city}` : 'Information indisponible'}</div>
                    <div className="text-slate-500">{detailEx.locality ?? ''}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Livreur</div>
                    <div className="font-semibold">{detailEx.driverName ?? 'Information indisponible'}</div>
                    <div className="text-slate-500">{detailEx.driverId ?? '—'}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Tournée</div>
                    <div className="font-semibold">{detailEx.runsheetNumber ?? 'Information indisponible'}</div>
                    <div className="text-slate-500">{detailEx.runsheetStatus ?? ''} {detailEx.runsheetId ? `· ${detailEx.runsheetId.slice(0, 8)}…` : ''}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Âge / Traçabilité</div>
                    <div>Créé: {formatDate(detailEx.createdAt)} ({fmtAge(detailEx.ageHours)})</div>
                    <div>Màj: {formatDate(detailEx.updatedAt)} ({fmtAge(detailEx.hoursSinceUpdate)} depuis maj)</div>
                    <div>Dernier évén.: {detailEx.lastEventAt ? formatDate(detailEx.lastEventAt) : 'Information indisponible'} — {detailEx.lastEventTitle ?? '—'}</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1">
                    <div className="text-[11px] uppercase font-semibold text-slate-500">Sévérité</div>
                    <div><span className={`px-2 py-0.5 rounded text-xs font-bold border ${badgeSeverity(detailEx.severity)}`}>{SEVERITY_LABELS[detailEx.severity] ?? detailEx.severity}</span> <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-slate-100 border border-slate-200">{CATEGORY_LABELS[detailEx.exceptionCategory] ?? detailEx.exceptionCategory}</span></div>
                    <div className="text-slate-700 leading-relaxed">{detailEx.reasons.join(' — ')}</div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-900 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Raisons d&apos;alerte</h3>
                  <ul className="list-disc ps-5 space-y-1">
                    {detailEx.reasons.map((r, i) => <li key={i} className="text-xs leading-relaxed text-slate-700">{r}</li>)}
                  </ul>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-900 mb-2">Historique / Suivi</h3>
                  {detailLoading ? <div className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement…</div> : !detailHistory || detailHistory.length === 0 ? <div className="text-xs text-slate-500 italic bg-slate-50 border border-slate-200 rounded-md p-3">Information indisponible — aucun événement de suivi trouvé pour ce colis.</div> : (
                    <div className="space-y-2">
                      {detailHistory.map((h, idx) => (
                        <div key={idx} className="border border-slate-200 rounded-md p-2.5 bg-white">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900">{h.title}</span>
                            <span className="font-mono text-[11px] text-slate-500">{formatDate(h.createdAt)}</span>
                          </div>
                          {h.description && <div className="text-xs text-slate-600 mt-1">{h.description}</div>}
                          <div className="text-[11px] text-slate-500 mt-1">{h.locationName ? `Lieu: ${h.locationName} · ` : ''}Opérateur: {h.operatorName}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-md p-3">
                  <h4 className="text-xs font-bold text-slate-900 mb-1">Actions possibles</h4>
                  <p className="text-[11px] leading-relaxed text-slate-600">Ce module ne crée pas d&apos;action destructrice. Utilisez &laquo; Voir le colis &raquo; pour réaffecter, corriger une donnée ou déposer une note via les écrans existants. Ne marquez pas un colis &laquo; PERDU &raquo; : investiguez d&apos;abord.</p>
                </div>
              </div>
            )}
          </Drawer>
        </>
      )}
    </div>
  );
}
