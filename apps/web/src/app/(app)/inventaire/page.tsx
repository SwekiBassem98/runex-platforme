'use client';

/**
 * INVENTAIRE — historique complet des colis.
 *
 * L'écran ne stocke que la page visible. Filtrage, pagination et tri se font
 * sur le serveur : l'historique compte des centaines de lignes et continuera
 * d'en compter dix mille. Tout télécharger pour n'en afficher que vingt ferait
 * ramer le navigateur — et donnerait l'impression que le filtre est approximatif
 * alors qu'il est exact.
 *
 * Les filtres vivent dans l'URL. Un lien d'inventaire se transmet alors avec
 * son contexte : « les colis de Tunis, non livrés, en février » est une URL,
 * pas une suite de manipulations à refaire.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BasculeFiches,
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
  Archive,
  Download,
  Filter,
  Loader2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  inventoryApi,
  downloadInventoryCsv,
  type InventoryFacets,
  type InventoryFilters,
  type InventoryRow,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PermissionCode } from '@logixpress/types';

type Filtres = InventoryFilters;

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

/** Ce qui distingue un filtre actif de la valeur affichée par défaut. */
function estActif(filtres: Filtres): boolean {
  return (Object.keys(FILTRE_VIDE) as (keyof Filtres)[]).some((key) => {
    const value = filtres[key];
    if (key === 'page' || key === 'limit') return false;
    return value !== undefined && value !== '' && value !== 'ALL';
  });
}

/*
 * Le montant et la date ne sont plus formatés ici.
 *
 * Les deux aides locales dupliquaient les formateurs du design system et en
 * divergeaient : `montant('1500')` produisait « 1 500, » — une virgule sans
 * décimale — et « 1 500 » pour une valeur entière, quand le formateur unique
 * donne « 1 500,000 ». Le même colis valait donc « 03/10/26 » en inventaire et
 * « 03/10/2026 » partout ailleurs.
 */

/** Libellé français des clés de filtre, pour l'énumération des filtres actifs. */
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
  createdTo: 'créé jusqu\'au',
};

/**
 * Libellé français des statuts de paiement et de retour.
 *
 * La colonne affichait le code d'énumération — `NON_REGLE`, `EN_BORDEREAU` —
 * à côté du statut du colis, déjà traduit. Deux rendus du même type de donnée
 * dans la même ligne.
 */
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
  RETOURNE_EXPEDITEUR: 'Retourné à l\'expéditeur',
};

export default function InventairePage() {
  const router = useRouter();
  const { user } = useAuth();

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

  const peutExporter = user?.permissions?.includes(PermissionCode.INVENTORY_EXPORT) ?? false;
  const aFiltres = useMemo(() => estActif(filtres), [filtres]);

  // Le filtre est écrit dans l'URL à chaque changement, puis relu au montage :
  // l'écran se recharge depuis son propre lien.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filtres)) {
      if (key === 'page' || key === 'limit') continue;
      if (value === undefined || value === '' || value === 'ALL') continue;
      params.set(key, String(value));
    }
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    router.replace(query ? `/inventaire?${query}` : '/inventaire', { scroll: false });
  }, [filtres, page, router]);

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
  }, []);

  useEffect(() => {
    inventoryApi
      .facets()
      .then(setFacets)
      .catch(() => setFacets(null));
  }, []);

  // Les facettes sont rechargées après chaque filtre : sinon l'en-tête annonce
  // « 12 colis correspondent » pendant que les menus proposent encore
  // « Créé (1 240) », et l'utilisateur filtre sur une information périmée.
  useEffect(() => {
    void inventoryApi
      .facets()
      .then(setFacets)
      .catch(() => setFacets(null));
  }, [filtres]);

  const charger = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await inventoryApi.list({ ...filtres, page, limit: 50 });
      setRows(result.items);
      setMeta({
        total: result.total,
        totalPages: result.totalPages,
        appliedFilters: result.appliedFilters,
      });
    } catch {
      // Les lignes de la page précédente sont effacées : sans cela, un échec en
      // page 3 laissait la page 2 affichée sous l'indication « page 3 sur 200 ».
      setRows([]);
      setMessage({ kind: 'erreur', texte: 'Historique inaccessible.' });
    } finally {
      setIsLoading(false);
    }
  }, [filtres, page]);

  useEffect(() => {
    void charger();
  }, [charger]);

  /** Toute modification de filtre ramène à la page 1 : sinon on atterrit hors bornes. */
  const majFiltre = useCallback((patch: Partial<Filtres>) => {
    setPage(1);
    setFiltres((current) => ({ ...current, ...patch }));
  }, []);

  const soumettreRecherche = (event: React.FormEvent) => {
    event.preventDefault();
    majFiltre({ search: recherche.trim() });
  };

  const exporter = async () => {
    setIsExporting(true);
    setMessage(null);
    try {
      const { rowCount } = await downloadInventoryCsv(filtres);
      setMessage({
        kind: 'info',
        texte: `${rowCount.toLocaleString('fr-TN')} ligne(s) exportée(s), avec les filtres affichés.`,
      });
    } catch (error) {
      setMessage({
        kind: 'erreur',
        texte: error instanceof Error ? error.message : 'Export impossible.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const reinitialiser = () => {
    setFiltres(FILTRE_VIDE);
    setRecherche('');
    setPage(1);
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
        onChange={(event) => majFiltre({ [cle]: event.target.value } as Partial<Filtres>)}
        className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:border-blue-400 min-w-0"
      >
        <option value="ALL">Tous</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {typeof option.count === 'number' ? ` (${option.count})` : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex-1 p-4 lg:p-6 space-y-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Archive className="w-4 h-4" />
            Inventaire / Historique
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {isLoading ? 'Chargement…' : `${meta.total.toLocaleString('fr-TN')} colis correspondent`}
            {aFiltres ? ' aux filtres actifs' : ' — aucun filtre, tout l’historique'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {aFiltres && (
            <button
              type="button"
              onClick={reinitialiser}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Réinitialiser
            </button>
          )}
          {peutExporter && (
            <button
              type="button"
              onClick={() => void exporter()}
              disabled={isExporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:text-slate-300 disabled:bg-slate-50 disabled:border-slate-200 transition"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Exporter CSV
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`px-3 py-2 rounded-lg border text-[11px] flex items-start justify-between gap-3 ${
            message.kind === 'erreur'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <span className="whitespace-pre-line">{message.texte}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Fermer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Filtres */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs p-3 space-y-3">
        <form onSubmit={soumettreRecherche} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={recherche}
              onChange={(event) => setRecherche(event.target.value)}
              placeholder="N° colis, code-barres, référence, nom ou téléphone…"
              className="w-full pl-8 pr-3 py-1.5 text-[11px] border border-slate-200 rounded-md focus:outline-none focus:border-blue-400"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-[11px] font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-700 transition"
          >
            Rechercher
          </button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase font-semibold text-slate-500">Du</span>
            <input
              type="date"
              value={filtres.dateFrom ?? ''}
              onChange={(event) => majFiltre({ dateFrom: event.target.value })}
              className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase font-semibold text-slate-500">Au</span>
            <input
              type="date"
              value={filtres.dateTo ?? ''}
              onChange={(event) => majFiltre({ dateTo: event.target.value })}
              className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-md"
            />
          </label>
          {selecteur('status', 'Statut', facets?.statuses ?? [])}
          {selecteur(
            'shipperId',
            'Expéditeur',
            (facets?.shippers ?? []).map((s) => ({ value: s.id, label: s.label }))
          )}
          {selecteur(
            'driverId',
            'Livreur',
            (facets?.drivers ?? []).map((d) => ({ value: d.id, label: d.label }))
          )}
          {selecteur(
            'depositId',
            'Dépôt',
            (facets?.deposits ?? []).map((d) => ({ value: d.id, label: d.label }))
          )}
          {selecteur('city', 'Commune', (facets?.cities ?? []).map((c) => ({ value: c, label: c })))}
          {selecteur(
            'governorate',
            'Gouvernorat',
            (facets?.governorates ?? []).map((g) => ({ value: g, label: g }))
          )}
          {selecteur('type', 'Type de colis', facets?.packageTypes ?? [])}
          {selecteur('paymentStatus', 'Paiement', facets?.paymentStatuses ?? [])}
          {selecteur('returnStatus', 'Retour', facets?.returnStatuses ?? [])}
        </div>

        {aFiltres && (
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
            <Filter className="w-3 h-3 text-slate-500" />
            {Object.entries(meta.appliedFilters).map(([cle, valeur]) => (
              <span
                key={cle}
                className="text-[11px] bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5"
              >
                <span className="font-semibold">{LIBELLE_FILTRE[cle] ?? cle}</span> :{' '}
                {valeur.length > 24 ? `${valeur.slice(0, 24)}…` : valeur}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="space-y-3">
        <div className="flex justify-end">
          <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
        </div>

        {enFiches && (
          <div className="sm:hidden bg-white border border-slate-200 rounded-lg overflow-hidden">
            {rows.map((row) => (
              <FicheLigne
                key={row.id}
                titre={row.customerName}
                identifiant={row.trackingNumber}
                sousTitre={`${row.city}${row.locality ? ` · ${row.locality}` : ''}`}
                onClick={() => router.push(`/colis?tracking=${row.trackingNumber}`)}
                action={
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                    {row.statusLabel}
                  </span>
                }
                champs={[
                  { libelle: 'Montant', valeur: formatMontant(row.totalPrice), numerique: true },
                  { libelle: 'Téléphone', valeur: row.customerPhone },
                  { libelle: 'Paiement', valeur: LIBELLE_PAIEMENT[row.paymentStatus ?? ''] ?? '—' },
                  { libelle: 'Créé le', valeur: formatDate(row.createdAt) },
                ]}
              />
            ))}
          </div>
        )}

        <div className={enFiches ? 'hidden sm:block' : ''}>
        <Table libelle="Inventaire des colis" largeurMin="1180px">
          <Thead>
            <tr>
              <Th figee>N° colis</Th>
              <Th>Destinataire</Th>
              <Th priorite="secondaire">Commune</Th>
              <Th>Statut</Th>
              <Th priorite="tertiaire">Expéditeur</Th>
              <Th priorite="tertiaire">Livreur</Th>
              <Th priorite="tertiaire">Dépôt</Th>
              <Th align="right">Montant (DT)</Th>
              <Th priorite="secondaire">Paiement</Th>
              <Th priorite="secondaire">Retour</Th>
              <Th priorite="tertiaire">Créé le</Th>
            </tr>
          </Thead>
          <Tbody>
            {isLoading && rows.length === 0 ? (
              <LigneVide colSpan={11}>Chargement…</LigneVide>
            ) : rows.length === 0 ? (
              <LigneVide colSpan={11}>
                {aFiltres
                  ? 'Aucun colis ne correspond à ces filtres.'
                  : "L'inventaire est vide : aucun colis n'a encore été enregistré."}
              </LigneVide>
            ) : (
              rows.map((row) => (
                <Tr
                  key={row.id}
                  onClick={() => router.push(`/colis?tracking=${row.trackingNumber}`)}
                  resume={`Colis ${row.trackingNumber}, ${row.customerName}, ${row.statusLabel}, ${formatMontant(row.totalPrice)}`}
                >
                  <Td figee className="font-mono font-semibold text-red-600 whitespace-nowrap">
                    {row.trackingNumber}
                  </Td>
                  <Td>
                    <div className="font-semibold text-slate-800">{row.customerName}</div>
                    <div className="font-mono text-[11px] text-slate-500">{row.customerPhone}</div>
                  </Td>
                  <Td priorite="secondaire" className="whitespace-nowrap">
                    {row.city}
                    {row.locality ? ` · ${row.locality}` : ''}
                  </Td>
                  <Td className="whitespace-nowrap">{row.statusLabel}</Td>
                  <Td priorite="tertiaire" className="whitespace-nowrap">
                    {row.shipperName}
                  </Td>
                  <Td priorite="tertiaire" className="whitespace-nowrap">
                    {row.driverName ?? '—'}
                  </Td>
                  <Td priorite="tertiaire" className="whitespace-nowrap">
                    {row.depositName ?? '—'}
                  </Td>
                  <Td align="right" numerique className="font-mono font-semibold whitespace-nowrap">
                    {formatMontant(row.totalPrice)}
                  </Td>
                  <Td priorite="secondaire" className="whitespace-nowrap">
                    {LIBELLE_PAIEMENT[row.paymentStatus ?? ''] ?? '—'}
                  </Td>
                  <Td priorite="secondaire" className="whitespace-nowrap">
                    {row.returnStatus && row.returnStatus !== 'AUCUN_RETOUR'
                      ? (LIBELLE_PAIEMENT[row.returnStatus] ?? row.returnStatus)
                      : '—'}
                  </Td>
                  <Td priorite="tertiaire" className="font-mono whitespace-nowrap text-slate-500">
                    {formatDate(row.createdAt)}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
        </div>

        <Pagination
          currentPage={page}
          totalPages={meta.totalPages}
          totalItems={meta.total}
          pageSize={50}
          onPageChange={setPage}
          libelle="colis"
        />
      </div>
    </div>
  );
}