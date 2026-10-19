'use client';

/**
 * Finance — ce que la société doit à ses expéditeurs, et ce qu'elle retient.
 *
 * L'écran se lit de haut en bas :
 *
 *   1. quatre chiffres : à régler (pas encore en bordereau), bordereaux à
 *      payer, payé ce mois, retenu ce mois (livraison, retours, gestion,
 *      R.A.S.) ;
 *   2. la caisse COD : ce que les livreurs ont encaissé et que la caisse doit
 *      encore valider (sans validation, rien n'est payable) ;
 *   3. les expéditeurs, avec une **recherche** (raison sociale, nom
 *      commercial, code, téléphone) et des filtres ; chacun ouvre sa fiche :
 *      tarif, calcul du prochain paiement, historique des bordereaux.
 *
 * Chiffres : `GET /payments/finance/expediteurs` (agrégés en base).
 */

import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Banknote,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Coins,
  FileText,
  Printer,
  RefreshCw,
  Search,
  Store,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Drawer, ErrorBanner } from '@logixpress/ui';
import { PermissionCode, type PaymentSummaryDto } from '@logixpress/types';
import { useAuth } from '@/lib/auth';
import {
  cashApi,
  financeApi,
  paymentsApi,
  type FicheFinanceExpediteur,
  type FinanceExpediteurs,
  type LigneFinanceExpediteur,
} from '@/lib/api';
import { imprimerBordereau } from '@/lib/impression-documents';
import { ApercuTarif } from '@/features/expediteur-admin/TarifExpediteur';

/* ------------------------------------------------------------------ */
/* Mise en forme                                                       */
/* ------------------------------------------------------------------ */

const dt = (n: number | string | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

/** Montant court pour les gros chiffres : « 1 376 DT », « 12,5 DT ». */
const dtCourt = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 3 })} DT`;
};

const date = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—';

const moisCourt = (cle: string) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(`${cle}-15T12:00:00`));

const initiales = (nom: string) =>
  nom
    .split(/\s+/)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? '')
    .join('');

const CARTE = 'bg-white border border-slate-200 rounded-2xl shadow-xs';

type Filtre = 'tous' | 'aPayer' | 'aRegler' | 'aJour';

const FILTRES: { cle: Filtre; libelle: string }[] = [
  { cle: 'tous', libelle: 'Tous' },
  { cle: 'aPayer', libelle: 'Bordereau à payer' },
  { cle: 'aRegler', libelle: 'À régler' },
  { cle: 'aJour', libelle: 'À jour' },
];

function correspond(l: LigneFinanceExpediteur, f: Filtre): boolean {
  if (f === 'aPayer') return l.aPayer.count > 0;
  if (f === 'aRegler') return !!l.aRegler;
  if (f === 'aJour') return l.aPayer.count === 0 && !l.aRegler;
  return true;
}

const STATUT_BORDEREAU: Record<string, { libelle: string; classe: string }> = {
  CONFIRME: { libelle: 'À payer', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
  EN_ATTENTE: { libelle: 'En attente', classe: 'bg-amber-50 text-amber-800 border-amber-200' },
  PAYE: { libelle: 'Payé', classe: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  ANNULE: { libelle: 'Annulé', classe: 'bg-slate-50 text-slate-500 border-slate-200' },
};

/* ------------------------------------------------------------------ */
/* Écran                                                               */
/* ------------------------------------------------------------------ */

export function TableauFinance() {
  const { user } = useAuth();
  const peutRegler = user?.permissions?.includes(PermissionCode.PAYMENT_VALIDATE) ?? false;
  const [donnees, setDonnees] = React.useState<FinanceExpediteurs | null>(null);
  const [caisse, setCaisse] = React.useState<PaymentSummaryDto | null>(null);
  const [recherche, setRecherche] = React.useState('');
  const [rechercheAppliquee, setRechercheAppliquee] = React.useState('');
  const [filtre, setFiltre] = React.useState<Filtre>('tous');
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [ouvert, setOuvert] = React.useState<string | null>(null);

  // La recherche part 300 ms après la dernière frappe.
  React.useEffect(() => {
    const id = window.setTimeout(() => setRechercheAppliquee(recherche.trim()), 300);
    return () => window.clearTimeout(id);
  }, [recherche]);

  const charger = React.useCallback(async () => {
    setChargement(true);
    try {
      const [f, c] = await Promise.all([financeApi.expediteurs(rechercheAppliquee), cashApi.summary().catch(() => null)]);
      setDonnees(f);
      setCaisse(c);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [rechercheAppliquee]);

  React.useEffect(() => {
    void charger();
  }, [charger]);

  const lignes = (donnees?.items ?? []).filter((l) => correspond(l, filtre));
  const t = donnees?.totals;
  const retenu = t ? t.withheldThisMonth.delivery + t.withheldThisMonth.returns + t.withheldThisMonth.management + t.withheldThisMonth.ras : 0;
  const compte = (f: Filtre) => (donnees?.items ?? []).filter((l) => correspond(l, f)).length;

  return (
    <div className="dash-anime p-4 sm:p-6 space-y-5" data-testid="finance">
      {/* En-tête */}
      <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-red-600">Finance</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Paiements des expéditeurs</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Ce que la société doit à chaque expéditeur, ce qu’elle retient (livraison, retours, gestion, R.A.S.) et ce qui a déjà été payé.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/paiements/bordereaux" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition">
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            Bordereaux
          </Link>
          <Link href="/paiements" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
            <Coins className="w-3.5 h-3.5" aria-hidden="true" />
            Encaissements
          </Link>
          <button
            type="button"
            onClick={() => void charger()}
            aria-label="Actualiser"
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${chargement ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </header>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      {/* Quatre chiffres */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" aria-label="Synthèse">
        <Tuile
          icone={Clock3}
          teinte="bg-amber-500"
          libelle="À régler"
          valeur={t ? dtCourt(t.toSettle) : undefined}
          aide={t ? `${t.toSettleCount} expéditeur${t.toSettleCount > 1 ? 's' : ''} · colis livrés et retours hors bordereau` : undefined}
          testid="kpi-a-regler"
          onClick={() => setFiltre('aRegler')}
        />
        <Tuile
          icone={Banknote}
          teinte="bg-red-600"
          libelle="Bordereaux à payer"
          valeur={t ? dtCourt(t.toPay) : undefined}
          aide={t ? `${t.toPayCount} bordereau${t.toPayCount > 1 ? 'x' : ''} confirmé${t.toPayCount > 1 ? 's' : ''}, en attente du code` : undefined}
          testid="kpi-a-payer"
          onClick={() => setFiltre('aPayer')}
        />
        <Tuile
          icone={CalendarCheck}
          teinte="bg-emerald-600"
          libelle="Payé ce mois"
          valeur={t ? dtCourt(t.paidThisMonth) : undefined}
          aide={t ? `${t.paidThisMonthCount} paiement${t.paidThisMonthCount > 1 ? 's' : ''}` : undefined}
          testid="kpi-paye"
        />
        <TuileRetenues t={t} total={retenu} />
      </section>

      {/* Caisse COD */}
      {caisse && <BandeauCaisse caisse={caisse} />}

      {/* Expéditeurs */}
      <section className={`${CARTE} overflow-hidden`} aria-labelledby="titre-expediteurs">
        <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 id="titre-expediteurs" className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Store className="w-4 h-4 text-red-600" aria-hidden="true" />
                Expéditeurs
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {t ? `${t.shippers} expéditeur${t.shippers > 1 ? 's' : ''} — ceux qui attendent un paiement en premier.` : 'Chargement…'}
              </p>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher un expéditeur (nom, code, téléphone)"
                aria-label="Rechercher un expéditeur"
                data-testid="recherche-expediteur"
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:bg-white focus:border-slate-400"
              />
              {recherche && (
                <button
                  type="button"
                  onClick={() => setRecherche('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          <div role="radiogroup" aria-label="Filtrer" className="flex flex-wrap gap-1.5">
            {FILTRES.map((f) => (
              <button
                key={f.cle}
                type="button"
                role="radio"
                aria-checked={filtre === f.cle}
                onClick={() => setFiltre(f.cle)}
                data-testid={`filtre-${f.cle}`}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition cursor-pointer ${
                  filtre === f.cle ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                {f.libelle}
                {donnees && <span className={`ml-1.5 tabular-nums ${filtre === f.cle ? 'text-white/70' : 'text-slate-400'}`}>{compte(f.cle)}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* En-têtes de colonnes (écran large) */}
        <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_24px] gap-4 px-5 py-2 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <span>Expéditeur</span>
          <span>Tarif livraison (légère · normale · lourde · volum.)</span>
          <span className="text-right">À régler</span>
          <span className="text-right">À payer</span>
          <span className="text-right">Déjà payé</span>
          <span />
        </div>

        {chargement && !donnees ? (
          <div className="p-5 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-slate-50 animate-pulse" />
            ))}
          </div>
        ) : lignes.length === 0 ? (
          <div className="py-12 text-center" data-testid="aucun-expediteur">
            <Store className="w-8 h-8 text-slate-300 mx-auto" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-700 mt-2">
              {rechercheAppliquee ? `Aucun expéditeur ne correspond à « ${rechercheAppliquee} ».` : 'Aucun expéditeur dans cette catégorie.'}
            </p>
            {(rechercheAppliquee || filtre !== 'tous') && (
              <button
                type="button"
                onClick={() => {
                  setRecherche('');
                  setFiltre('tous');
                }}
                className="mt-2 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
              >
                Voir tous les expéditeurs
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="liste-expediteurs">
            {lignes.map((l) => (
              <LigneExpediteur key={l.id} l={l} onOuvrir={() => setOuvert(l.id)} />
            ))}
          </ul>
        )}
      </section>

      <FicheExpediteur id={ouvert} onClose={() => setOuvert(null)} peutRegler={peutRegler} onChange={() => void charger()} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tuiles                                                              */
/* ------------------------------------------------------------------ */

function Tuile({
  icone: Icone,
  teinte,
  libelle,
  valeur,
  aide,
  testid,
  onClick,
}: {
  icone: LucideIcon;
  teinte: string;
  libelle: string;
  valeur: string | undefined;
  aide?: string;
  testid: string;
  onClick?: () => void;
}) {
  const contenu = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">{libelle}</p>
        <span className={`w-9 h-9 rounded-xl ${teinte} text-white flex items-center justify-center shrink-0 shadow-sm`}>
          <Icone className="w-4 h-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-extrabold text-slate-900 tabular-nums">
        {valeur ?? <span className="inline-block w-24 h-7 rounded bg-slate-100 animate-pulse" />}
      </p>
      {aide && <p className="mt-1 text-[11px] text-slate-400 leading-snug">{aide}</p>}
    </>
  );
  const classe = `${CARTE} p-4 text-left motion-safe:animate-dash-rise`;
  return onClick ? (
    <button type="button" onClick={onClick} data-testid={testid} className={`${classe} hover:shadow-md hover:-translate-y-0.5 transition cursor-pointer`}>
      {contenu}
    </button>
  ) : (
    <div data-testid={testid} className={classe}>
      {contenu}
    </div>
  );
}

const PARTS_RETENUES = [
  { cle: 'delivery', libelle: 'Livraison', couleur: '#0ea5e9' },
  { cle: 'returns', libelle: 'Retours', couleur: '#f97316' },
  { cle: 'management', libelle: 'Gestion', couleur: '#8b5cf6' },
  { cle: 'ras', libelle: 'R.A.S.', couleur: '#64748b' },
] as const;

function TuileRetenues({ t, total }: { t: FinanceExpediteurs['totals'] | undefined; total: number }) {
  return (
    <div className={`${CARTE} p-4 motion-safe:animate-dash-rise`} data-testid="kpi-retenu">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">Retenu ce mois</p>
        <span className="w-9 h-9 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0 shadow-sm">
          <Wallet className="w-4 h-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-1 text-2xl font-extrabold text-slate-900 tabular-nums">
        {t ? dtCourt(total) : <span className="inline-block w-24 h-7 rounded bg-slate-100 animate-pulse" />}
      </p>
      {t && (
        <>
          <div className="mt-2 flex h-2 rounded-full bg-slate-100 overflow-hidden gap-[2px]" aria-hidden="true">
            {total > 0 &&
              PARTS_RETENUES.map((p) =>
                t.withheldThisMonth[p.cle] > 0 ? (
                  <span key={p.cle} style={{ width: `${(t.withheldThisMonth[p.cle] / total) * 100}%`, backgroundColor: p.couleur }} />
                ) : null
              )}
          </div>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
            {PARTS_RETENUES.map((p) => (
              <li key={p.cle} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.couleur }} />
                {p.libelle}
                <span className="ml-auto font-mono text-slate-700">{dtCourt(t.withheldThisMonth[p.cle])}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BandeauCaisse({ caisse }: { caisse: PaymentSummaryDto }) {
  const enAttente = Number(caisse.pending ?? 0);
  const ecart = Number(caisse.discrepancy ?? 0);
  return (
    <section className={`${CARTE} p-4 flex flex-col md:flex-row md:items-center gap-4`} aria-label="Caisse COD" data-testid="bandeau-caisse">
      <div className="flex items-center gap-3 md:w-64 shrink-0">
        <span className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
          <Coins className="w-5 h-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">Caisse COD</p>
          <p className="text-[11px] text-slate-500 leading-snug">Un colis n’est payable à l’expéditeur qu’après validation de son encaissement.</p>
        </div>
      </div>
      <dl className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <dt className="text-[11px] text-slate-500">Encaissé par les livreurs</dt>
          <dd className="text-base font-bold text-slate-900 tabular-nums">{dtCourt(caisse.totalCollected)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Validé par la caisse</dt>
          <dd className="text-base font-bold text-emerald-700 tabular-nums">{dtCourt(caisse.validated)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">À valider</dt>
          <dd className={`text-base font-bold tabular-nums ${enAttente > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
            {dtCourt(enAttente)} <span className="text-[11px] font-normal text-slate-400">({caisse.pendingCount})</span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Écarts</dt>
          <dd className={`text-base font-bold tabular-nums ${ecart > 0 ? 'text-red-700' : 'text-slate-900'}`}>
            {dtCourt(ecart)} <span className="text-[11px] font-normal text-slate-400">({caisse.discrepancyCount})</span>
          </dd>
        </div>
      </dl>
      {caisse.pendingCount > 0 && (
        <Link
          href="/paiements?status=EN_ATTENTE"
          className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition"
        >
          Valider les encaissements
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ligne expéditeur                                                    */
/* ------------------------------------------------------------------ */

function Montant({ valeur, aide, ton = 'neutre', vide = '—' }: { valeur: number; aide?: string; ton?: 'neutre' | 'ambre' | 'rouge' | 'vert'; vide?: string }) {
  const couleur = { neutre: 'text-slate-900', ambre: 'text-amber-700', rouge: 'text-red-700', vert: 'text-emerald-700' }[ton];
  return (
    <span className="block text-right">
      <span className={`block text-sm font-bold tabular-nums ${valeur ? couleur : 'text-slate-300'}`}>{valeur ? dtCourt(valeur) : vide}</span>
      {aide && <span className="block text-[10px] text-slate-400">{aide}</span>}
    </span>
  );
}

function LigneExpediteur({ l, onOuvrir }: { l: LigneFinanceExpediteur; onOuvrir: () => void }) {
  const t = l.tarif;
  return (
    <li>
      <button
        type="button"
        onClick={onOuvrir}
        data-testid={`ligne-${l.code}`}
        className="group w-full text-left px-4 sm:px-5 py-3 hover:bg-slate-50 transition cursor-pointer grid grid-cols-2 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_24px] gap-x-4 gap-y-2 items-center"
      >
        <span className="col-span-2 lg:col-span-1 flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-red-50 text-red-600 text-[11px] font-bold flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
            {initiales(l.name)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900 truncate">{l.name}</span>
              {!l.isActive && <span className="px-1.5 py-px rounded bg-slate-100 text-slate-500 text-[10px]">inactif</span>}
            </span>
            <span className="block text-[11px] text-slate-500 truncate">
              <span className="font-mono">{l.code}</span> · {l.governorate} · {l.phone}
            </span>
          </span>
        </span>
        <span className="col-span-2 lg:col-span-1 flex flex-wrap items-center gap-1 text-[11px]">
          {(['LEGERE', 'MOYENNE', 'LOURDE', 'VOLUMINEUSE'] as const).map((taille) => (
            <span key={taille} className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono" title={taille}>
              {t.livraison[taille].toLocaleString('fr-FR', { maximumFractionDigits: 3 })}
            </span>
          ))}
          <span className="text-slate-400">DT</span>
          {(t.gestion > 0 || t.rasActive || t.retour > 0) && (
            <span className="w-full text-[10px] text-slate-400">
              retour {t.retour.toLocaleString('fr-FR')} DT · gestion {t.gestion.toLocaleString('fr-FR')} DT{t.rasActive ? ` · R.A.S. ${t.tauxRas} %` : ''}
            </span>
          )}
        </span>
        <span className="lg:contents grid grid-cols-3 col-span-2 gap-2">
          <span>
            <span className="lg:hidden block text-[10px] text-slate-400 text-right">À régler</span>
            <Montant valeur={l.aRegler?.net ?? 0} ton="ambre" aide={l.aRegler ? `${l.aRegler.livres} livré${l.aRegler.livres > 1 ? 's' : ''} · ${l.aRegler.retournes} retour${l.aRegler.retournes > 1 ? 's' : ''}` : undefined} />
          </span>
          <span>
            <span className="lg:hidden block text-[10px] text-slate-400 text-right">À payer</span>
            <Montant valeur={l.aPayer.net} ton="rouge" aide={l.aPayer.count ? `${l.aPayer.count} bordereau${l.aPayer.count > 1 ? 'x' : ''}` : undefined} />
          </span>
          <span>
            <span className="lg:hidden block text-[10px] text-slate-400 text-right">Déjà payé</span>
            <Montant valeur={l.paye.net} ton="vert" aide={l.paye.lastPaidAt ? `dernier le ${date(l.paye.lastPaidAt)}` : undefined} />
          </span>
        </span>
        <ArrowRight className="hidden lg:block w-4 h-4 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-0.5 transition" aria-hidden="true" />
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Fiche expéditeur                                                    */
/* ------------------------------------------------------------------ */

function LigneCalcul({ libelle, valeur, signe = '−', fort = false, couleur }: { libelle: string; valeur: number; signe?: string; fort?: boolean; couleur?: string }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${fort ? 'border-t border-slate-200 mt-1 pt-2.5' : ''}`}>
      <span className={`flex items-center gap-2 text-xs ${fort ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
        {couleur && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: couleur }} />}
        {libelle}
      </span>
      <span className={`font-mono tabular-nums ${fort ? 'text-base font-extrabold text-emerald-700' : 'text-xs text-slate-800'}`}>
        {signe && !fort ? `${signe} ` : ''}
        {dt(valeur)}
      </span>
    </div>
  );
}

function FicheExpediteur({
  id,
  onClose,
  peutRegler,
  onChange,
}: {
  id: string | null;
  onClose: () => void;
  peutRegler: boolean;
  onChange: () => void;
}) {
  const [fiche, setFiche] = React.useState<FicheFinanceExpediteur | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [occupe, setOccupe] = React.useState(false);

  const charger = React.useCallback(async (cible: string) => {
    setErreur(null);
    try {
      setFiche(await financeApi.expediteur(cible));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Fiche indisponible.');
    }
  }, []);

  React.useEffect(() => {
    setFiche(null);
    setMessage(null);
    if (id) void charger(id);
  }, [id, charger]);

  const creer = async () => {
    if (!fiche) return;
    setOccupe(true);
    setErreur(null);
    try {
      const reponse = await paymentsApi.creer({ shipperId: fiche.id });
      const v = reponse.data;
      setMessage(
        v
          ? `Bordereau ${v.voucherNumber} créé : ${dt(v.netPayable)} à payer. L’expéditeur voit le code de retrait dans son espace.`
          : 'Bordereau créé.'
      );
      await charger(fiche.id);
      onChange();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Création impossible.');
    } finally {
      setOccupe(false);
    }
  };

  const imprimer = async (voucherId: string) => {
    try {
      imprimerBordereau(await paymentsApi.detail(voucherId));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Impression impossible.');
    }
  };

  const r = fiche?.aRegler;
  const maxMois = Math.max(1, ...(fiche?.monthly ?? []).map((m) => m.paid + m.withheld));

  return (
    <Drawer isOpen={id !== null} onClose={onClose} title={fiche?.name ?? 'Expéditeur'} subtitle={fiche ? `${fiche.code} · ${fiche.governorate} · ${fiche.phone}` : undefined} width="xl">
      {!fiche ? (
        erreur ? (
          <ErrorBanner message={erreur} />
        ) : (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-slate-50 animate-pulse" />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-5" data-testid="fiche-finance">
          {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}
          {message && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-start gap-2" role="status">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              {message}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">À régler</p>
              <p className="text-lg font-extrabold text-amber-900 tabular-nums">{dtCourt(r?.net ?? 0)}</p>
            </div>
            <div className="rounded-xl bg-red-50 border border-red-200 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700">À payer</p>
              <p className="text-lg font-extrabold text-red-900 tabular-nums">{dtCourt(fiche.aPayer.net)}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Déjà payé</p>
              <p className="text-lg font-extrabold text-emerald-900 tabular-nums">{dtCourt(fiche.paye.net)}</p>
            </div>
          </div>

          <section>
            <h3 className="text-sm font-bold text-slate-900 mb-2">Tarif</h3>
            <ApercuTarif tarif={fiche.tarif} />
          </section>

          <section className="rounded-2xl border border-slate-200 p-4" data-testid="calcul-paiement">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Prochain paiement</h3>
                <p className="text-[11px] text-slate-500">
                  {r
                    ? `${r.livres} colis livré${r.livres > 1 ? 's' : ''} (encaissement validé) et ${r.retournes} retour${r.retournes > 1 ? 's' : ''}, pas encore dans un bordereau.`
                    : 'Rien à régler : aucun colis livré et validé hors bordereau.'}
                </p>
              </div>
            </div>
            {r && (
              <>
                <LigneCalcul libelle="Encaissé chez les clients" valeur={r.encaisse} signe="" couleur="#10b981" />
                <LigneCalcul libelle={`Frais de livraison (${r.livres} colis)`} valeur={r.fraisLivraison} couleur="#0ea5e9" />
                <LigneCalcul libelle={`Frais de retour (${r.retournes} × ${dt(fiche.tarif.retour)})`} valeur={r.fraisRetour} couleur="#f97316" />
                {r.fraisGestion > 0 && <LigneCalcul libelle="Frais de gestion (par paiement)" valeur={r.fraisGestion} couleur="#8b5cf6" />}
                {fiche.tarif.rasActive && <LigneCalcul libelle={`R.A.S. ${fiche.tarif.tauxRas} % du net`} valeur={r.ras} couleur="#64748b" />}
                <LigneCalcul libelle="Net à payer" valeur={r.net} fort />
                {peutRegler && (
                  <button
                    type="button"
                    onClick={() => void creer()}
                    disabled={occupe}
                    data-testid="fiche-creer-bordereau"
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition cursor-pointer"
                  >
                    <FileText className="w-4 h-4" aria-hidden="true" />
                    {occupe ? 'Création…' : 'Créer le bordereau de paiement'}
                  </button>
                )}
              </>
            )}
            {fiche.aPayer.count > 0 && (
              <Link
                href="/paiements/bordereaux"
                className="mt-3 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800 hover:bg-red-100 transition"
              >
                {fiche.aPayer.count} bordereau{fiche.aPayer.count > 1 ? 'x' : ''} à payer ({dt(fiche.aPayer.net)}) — payer avec le code de retrait
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            )}
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900 mb-2">Paiements des 6 derniers mois</h3>
            <div className="flex items-end gap-2" role="img" aria-label="Montants payés et retenus par mois">
              {fiche.monthly.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1 group" title={`${moisCourt(m.month)} : payé ${dt(m.paid)}, retenu ${dt(m.withheld)}`}>
                  <div className="w-full h-20 flex flex-col justify-end gap-[2px]">
                    {m.withheld > 0 && (
                      <span className="block w-full rounded-t-md bg-slate-300 group-hover:bg-slate-400 transition" style={{ height: `${Math.max(2, (m.withheld / maxMois) * 80)}px` }} />
                    )}
                    {m.paid > 0 ? (
                      <span className={`block w-full ${m.withheld > 0 ? '' : 'rounded-t-md'} bg-emerald-500 group-hover:bg-emerald-600 transition`} style={{ height: `${Math.max(2, (m.paid / maxMois) * 80)}px` }} />
                    ) : (
                      <span className="block w-full h-[2px] bg-slate-200" />
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-600">{m.paid > 0 ? dtCourt(m.paid) : ''}</span>
                  <span className="text-[10px] text-slate-500 capitalize">{moisCourt(m.month)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-4 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> Payé
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-300" /> Retenu
              </span>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-900 mb-2">Bordereaux</h3>
            {fiche.vouchers.length === 0 ? (
              <p className="text-xs text-slate-400">Aucun bordereau pour l’instant.</p>
            ) : (
              <ul className="space-y-2" data-testid="fiche-bordereaux">
                {fiche.vouchers.map((v) => {
                  const st = STATUT_BORDEREAU[v.status] ?? { libelle: v.status, classe: 'bg-slate-50 text-slate-600 border-slate-200' };
                  const retenue = v.deliveryFees + v.returnFees + v.managementFees + v.ras;
                  return (
                    <li key={v.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs font-bold text-slate-900">{v.voucherNumber}</span>
                          <span className={`px-1.5 py-px rounded-full border text-[10px] font-semibold ${st.classe}`}>{st.libelle}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-sm font-bold text-slate-900">{dt(v.net)}</span>
                          <button
                            type="button"
                            onClick={() => void imprimer(v.id)}
                            aria-label={`Imprimer le bordereau ${v.voucherNumber}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {date(v.createdAt)} · {v.deliveredCount} livré{v.deliveredCount > 1 ? 's' : ''} · {v.returnedCount} retour{v.returnedCount > 1 ? 's' : ''} · encaissé {dt(v.gross)} · retenu {dt(retenue)}
                        {v.paidAt ? ` · payé le ${date(v.paidAt)}` : ''}
                      </p>
                      {retenue > 0 && (
                        <div className="mt-1.5 flex h-1.5 rounded-full bg-slate-100 overflow-hidden gap-[2px]" aria-hidden="true">
                          {[
                            [v.deliveryFees, '#0ea5e9'],
                            [v.returnFees, '#f97316'],
                            [v.managementFees, '#8b5cf6'],
                            [v.ras, '#64748b'],
                          ].map(([val, c], i) =>
                            Number(val) > 0 ? <span key={i} style={{ width: `${(Number(val) / retenue) * 100}%`, backgroundColor: String(c) }} /> : null
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Link href={`/colis?expediteur=${encodeURIComponent(fiche.id)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700">
            Voir les colis de cet expéditeur
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </Drawer>
  );
}
