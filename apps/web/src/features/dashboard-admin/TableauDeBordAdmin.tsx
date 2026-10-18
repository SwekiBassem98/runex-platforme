'use client';

/**
 * Tableau de bord de l'administration (poste de commandement).
 *
 * Il se lit de haut en bas et répond, dans l'ordre, à :
 *
 *   1. « Que se passe-t-il aujourd'hui ? »      → bandeau d'accueil ;
 *   2. « Qu'est-ce qui m'attend ? »             → à traiter maintenant ;
 *   3. « Comment va l'activité ? »              → 4 indicateurs + tendances ;
 *   4. « Où sont les colis en ce moment ? »     → parcours, étape par étape ;
 *   5. « Comment ça évolue ? »                  → courbe jour par jour, flotte ;
 *   6. « Qui fait le travail ? »                → classement livreurs / expéditeurs ;
 *   7. « Où est le stock, où est l'argent ? »   → agences, caisse ;
 *   8. « Qu'est-ce qui vient de se passer ? »   → ramassages, journal.
 *
 * Chaque chiffre mène à l'écran qui permet d'agir. La période (7, 14, 30 ou
 * 90 jours) s'applique aux indicateurs, à la courbe et aux classements ; les
 * stocks et le parcours sont toujours « maintenant ». L'écran se rafraîchit
 * seul toutes les minutes tant qu'il est visible.
 *
 * Les données viennent de `GET /dashboard?days=` (champ `vue`), agrégées en
 * base. Les animations s'effacent avec `prefers-reduced-motion` (`dash-anime`).
 */

import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Barcode,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Coins,
  Inbox,
  PackageCheck,
  Package,
  PackagePlus,
  RefreshCw,
  Repeat2,
  Route,
  ScanLine,
  Search,
  Shuffle,
  Store,
  TrendingDown,
  TrendingUp,
  Truck,
  Undo2,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { ErrorBanner } from '@logixpress/ui';
import { useAuth } from '@/lib/auth';
import { dashboardApi, type AdminOverviewDto, type DashboardDto, type EtapeAdmin } from '@/lib/api';

const PERIODES = [7, 14, 30, 90] as const;
const RAFRAICHISSEMENT_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function mouvementReduit(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Valeur qui défile de l'ancienne à la nouvelle, sans à-coup. */
function useCompteur(cible: number, duree = 900): number {
  const [valeur, setValeur] = React.useState(0);
  const precedente = React.useRef(0);
  React.useEffect(() => {
    const depart = precedente.current;
    precedente.current = cible;
    if (mouvementReduit() || depart === cible) {
      setValeur(cible);
      return;
    }
    let image = 0;
    const debut = performance.now();
    const pas = (maintenant: number) => {
      const p = Math.min(1, (maintenant - debut) / duree);
      setValeur(depart + (cible - depart) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [cible, duree]);
  return valeur;
}

const entier = (v: number) => Math.round(v).toLocaleString('fr-TN');

function Compteur({ valeur, format = entier }: { valeur: number; format?: (v: number) => string }) {
  return <>{format(useCompteur(valeur))}</>;
}

/** Montant lisible : « 1 234 DT » sans les millimes au-delà de 1 000 DT. */
function montantCourt(v: number): string {
  // Les trois décimales des documents (« 455,000 DT ») se lisent, d'un coup
  // d'œil, comme 455 mille : ici on ne garde que les millimes utiles.
  const max = Math.abs(v) >= 1000 ? 0 : 3;
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: max })}\u00a0DT`;
}

/** Évolution en % par rapport à la période précédente (null : pas de base). */
function evolution(actuel: number, precedent: number): number | null {
  if (precedent === 0) return actuel === 0 ? 0 : null;
  return Math.round(((actuel - precedent) / precedent) * 100);
}

function ilYa(iso: string | null, maintenant: number): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((maintenant - new Date(iso).getTime()) / 1000));
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.round(m / 60)} h`;
}

const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function initiales(nom: string): string {
  return nom
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase() ?? '')
    .join('');
}

/** Nom affiché sans le suffixe « (Livreur) » ajouté par certains comptes. */
const nomPropre = (nom: string) => nom.replace(/\s*\((livreur|Livreur)\)\s*$/, '').trim() || nom;

const retard = (i: number) => ({ animationDelay: `${i * 60}ms` });

const CARTE = 'bg-white border border-slate-200 rounded-2xl shadow-xs motion-safe:animate-dash-rise';

/* ------------------------------------------------------------------ */
/* Parcours des colis                                                  */
/* ------------------------------------------------------------------ */

const ETAPES: { cle: EtapeAdmin; libelle: string; aide: string; icone: LucideIcon; couleur: string; href: string }[] = [
  { cle: 'preparation', libelle: 'En préparation', aide: 'Créés, ramassage prévu', icone: PackagePlus, couleur: '#64748b', href: '/colis?statut=CREE' },
  { cle: 'collecte', libelle: 'Ramassés', aide: 'Chez le livreur, vers le dépôt', icone: Truck, couleur: '#0ea5e9', href: '/colis?statut=RAMASSE' },
  { cle: 'depot', libelle: 'Au dépôt', aide: 'Reçus, prêts à partir', icone: Warehouse, couleur: '#8b5cf6', href: '/colis?statut=RECU_DEPOT' },
  { cle: 'transit', libelle: 'Inter-dépôt', aide: 'Entre deux agences', icone: Shuffle, couleur: '#6366f1', href: '/inter-depots' },
  { cle: 'livraison', libelle: 'En livraison', aide: 'Dans une tournée', icone: Route, couleur: '#f59e0b', href: '/colis?statut=EN_COURS_LIVRAISON' },
  { cle: 'reporte', libelle: 'Reportés', aide: 'Nouvelle tentative prévue', icone: Clock3, couleur: '#f97316', href: '/colis?statut=REPORTE' },
  { cle: 'retour', libelle: 'En retour', aide: 'Échecs à rendre', icone: Undo2, couleur: '#ef4444', href: '/colis?statut=RETOUR_DEPOT' },
];

/* ------------------------------------------------------------------ */
/* Écran                                                               */
/* ------------------------------------------------------------------ */

export function TableauDeBordAdmin() {
  const { user } = useAuth();
  const [jours, setJours] = React.useState<number>(14);
  const [donnees, setDonnees] = React.useState<DashboardDto | null>(null);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [majLe, setMajLe] = React.useState<string | null>(null);
  const [maintenant, setMaintenant] = React.useState(() => Date.now());

  const charger = React.useCallback(async (periode: number, discret = false) => {
    if (!discret) setChargement(true);
    try {
      setDonnees(await dashboardApi.get(periode));
      setErreur(null);
      setMajLe(new Date().toISOString());
    } catch (err) {
      if (!discret) setErreur(err instanceof Error ? err.message : 'Impossible de charger le tableau de bord.');
    } finally {
      setChargement(false);
    }
  }, []);

  React.useEffect(() => {
    void charger(jours);
  }, [charger, jours]);

  React.useEffect(() => {
    const minuteur = window.setInterval(() => {
      if (document.visibilityState === 'visible') void charger(jours, true);
      setMaintenant(Date.now());
    }, RAFRAICHISSEMENT_MS);
    const auRetour = () => {
      if (document.visibilityState === 'visible') void charger(jours, true);
    };
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      window.clearInterval(minuteur);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [charger, jours]);

  const v = donnees?.vue ?? null;
  const prenom = (user?.fullName ?? '').split(/\s+/)[0] || 'à vous';
  const heure = new Date(maintenant).getHours();
  const salut = heure < 12 ? 'Bonjour' : heure < 18 ? 'Bon après-midi' : 'Bonsoir';
  const dateDuJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(maintenant));

  return (
    <div className="dash-anime space-y-5 p-4 sm:p-6 pb-8" data-testid="tdb-admin">
      <Bandeau
        v={v}
        salut={salut}
        prenom={prenom}
        dateDuJour={dateDuJour}
        majLe={majLe}
        maintenant={maintenant}
        chargement={chargement}
        jours={jours}
        setJours={setJours}
        actualiser={() => void charger(jours)}
      />

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      <ATraiter donnees={donnees} />

      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3" aria-label="Indicateurs de la période">
        <TuileKpi
          index={1}
          icone={Package}
          teinte="from-slate-900 to-slate-600"
          libelle="Colis en cours"
          valeur={v?.active}
          aide={v ? `${montantCourt(v.money.codInProgress)} à encaisser chez les clients` : undefined}
          href="/colis"
          testid="kpi-en-cours"
        />
        <TuileKpi
          index={2}
          icone={PackageCheck}
          teinte="from-emerald-600 to-emerald-400"
          libelle={`Livrés · ${jours} jours`}
          valeur={v?.period.delivered}
          tendance={v ? evolution(v.period.delivered, v.previous.delivered) : undefined}
          aide={
            v
              ? v.period.avgDeliveryHours == null
                ? `${v.period.created} colis créés sur la période`
                : `Délai moyen ${dureeLisible(v.period.avgDeliveryHours)} · ${v.period.created} créés`
              : undefined
          }
          href="/colis?statut=LIVRE"
          testid="kpi-livres"
        />
        <TuileTaux index={3} v={v} />
        <TuileKpi
          index={4}
          icone={Wallet}
          teinte="from-red-600 to-rose-400"
          libelle={`Encaissé · ${jours} jours`}
          valeur={v?.period.collected}
          format={montantCourt}
          tendance={v ? evolution(v.period.collected, v.previous.collected) : undefined}
          aide={v ? `dont ${montantCourt(v.period.fees)} de frais de livraison` : undefined}
          href="/caisse"
          testid="kpi-encaisse"
        />
      </section>

      <Parcours v={v} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Activite v={v} jours={jours} chargement={chargement && !v} />
        <Flotte donnees={donnees} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ClassementLivreurs v={v} jours={jours} />
        <ClassementExpediteurs v={v} jours={jours} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Agences v={v} />
        <Argent donnees={donnees} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <Ramassages donnees={donnees} />
          <Raccourcis />
        </div>
        <Journal donnees={donnees} />
      </div>
    </div>
  );
}

function dureeLisible(h: number): string {
  if (h < 1) return 'moins d’une heure';
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} jours`;
}

/* ------------------------------------------------------------------ */
/* Bandeau d'accueil                                                   */
/* ------------------------------------------------------------------ */

function Bandeau({
  v,
  salut,
  prenom,
  dateDuJour,
  majLe,
  maintenant,
  chargement,
  jours,
  setJours,
  actualiser,
}: {
  v: AdminOverviewDto | null;
  salut: string;
  prenom: string;
  dateDuJour: string;
  majLe: string | null;
  maintenant: number;
  chargement: boolean;
  jours: number;
  setJours: (j: number) => void;
  actualiser: () => void;
}) {
  const resume = !v
    ? 'Chargement de l’activité du jour…'
    : v.today.created + v.today.delivered + v.today.outForDelivery === 0
      ? 'Aucune activité pour l’instant aujourd’hui.'
      : `Aujourd’hui : ${v.today.created} colis créé${v.today.created > 1 ? 's' : ''}, ${v.today.delivered} livré${v.today.delivered > 1 ? 's' : ''} et ${v.today.outForDelivery} en route chez les clients.`;

  const puces: { libelle: string; valeur: React.ReactNode; icone: LucideIcon; href: string; teinte: string }[] = [
    { libelle: 'Créés aujourd’hui', valeur: v ? <Compteur valeur={v.today.created} /> : '—', icone: PackagePlus, href: '/colis', teinte: 'text-sky-300' },
    { libelle: 'Livrés aujourd’hui', valeur: v ? <Compteur valeur={v.today.delivered} /> : '—', icone: CheckCircle2, href: '/colis?statut=LIVRE', teinte: 'text-emerald-300' },
    { libelle: 'En route', valeur: v ? <Compteur valeur={v.today.outForDelivery} /> : '—', icone: Truck, href: '/runsheets', teinte: 'text-amber-300' },
    {
      libelle: 'Ramassages du jour',
      valeur: v ? `${v.today.pickupsDone} / ${v.today.pickups}` : '—',
      icone: CalendarClock,
      href: '/ramassages',
      teinte: 'text-rose-300',
    },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl bg-slate-900 text-white shadow-lg motion-safe:animate-dash-rise" aria-labelledby="tdb-salut">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-red-600/40 blur-3xl motion-safe:animate-dash-drift" />
        <div className="absolute -bottom-28 left-1/3 w-80 h-80 rounded-full bg-rose-500/20 blur-3xl motion-safe:animate-dash-drift" style={{ animationDelay: '-7s' }} />
        <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:18px_18px]" />
      </div>

      <div className="relative p-5 sm:p-7 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="inline-flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/70">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-400 motion-safe:animate-dash-pulse" />
                <span className="relative w-2 h-2 rounded-full bg-emerald-400" />
              </span>
              En direct · <span className="normal-case tracking-normal">{dateDuJour}</span>
              {majLe && <span className="normal-case tracking-normal font-normal text-white/50">· mis à jour {ilYa(majLe, maintenant)}</span>}
            </p>
            <h1 id="tdb-salut" className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {salut}, {prenom}
            </h1>
            <p className="text-sm text-white/75 max-w-xl leading-relaxed" data-testid="tdb-resume">
              {resume}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              href="/magasin"
              className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold shadow-lg shadow-red-900/40 transition hover:-translate-y-0.5"
            >
              <ScanLine className="w-4 h-4" aria-hidden="true" />
              Acceptation magasin
            </Link>
            <Link
              href="/runsheets"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-sm font-semibold transition hover:-translate-y-0.5"
            >
              <Route className="w-4 h-4" aria-hidden="true" />
              Tournées
            </Link>
            <button
              type="button"
              onClick={actualiser}
              aria-label="Actualiser"
              title="Actualiser"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${chargement ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        <ul className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {puces.map((p) => {
            const Icone = p.icone;
            return (
              <li key={p.libelle}>
                <Link
                  href={p.href}
                  className="group flex items-center gap-3 p-3 rounded-xl bg-white/[0.06] border border-white/10 hover:bg-white/[0.12] hover:border-white/25 transition"
                >
                  <span className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0 transition-transform group-hover:scale-110">
                    <Icone className={`w-4 h-4 ${p.teinte}`} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-lg font-extrabold tabular-nums leading-none">{p.valeur}</span>
                    <span className="block text-[11px] text-white/60 mt-1 leading-tight">{p.libelle}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <form action="/colis" role="search" className="flex-1 max-w-xl flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-white/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                name="tracking"
                placeholder="N° de suivi, téléphone ou nom du client"
                aria-label="Rechercher un colis"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder:text-white/45 focus:outline-none focus:bg-white/15 focus:border-white/40"
              />
            </div>
            <button type="submit" className="px-4 py-2.5 rounded-xl bg-white text-slate-900 text-sm font-semibold hover:bg-slate-100 transition cursor-pointer">
              Chercher
            </button>
          </form>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60">Période</span>
            <div role="radiogroup" aria-label="Période des indicateurs" className="inline-flex p-0.5 rounded-lg bg-white/10 border border-white/15">
              {PERIODES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={jours === p}
                  onClick={() => setJours(p)}
                  data-testid={`tdb-periode-${p}`}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    jours === p ? 'bg-white text-slate-900 shadow-sm' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {p} j
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* À traiter maintenant                                                */
/* ------------------------------------------------------------------ */

const ACTIONS: Record<string, { href: string; icone: LucideIcon; titre: string; vide: string }> = {
  COLIS_NON_AFFECTES: { href: '/colis?statut=RECU_DEPOT', icone: Inbox, titre: 'Colis à affecter', vide: 'Tous les colis du dépôt ont un livreur' },
  RUNSHEETS_A_VALIDER: { href: '/runsheets', icone: Route, titre: 'Tournées à clôturer', vide: 'Aucune tournée en attente de caisse' },
  PAIEMENTS_EN_ATTENTE: { href: '/paiements', icone: Banknote, titre: 'Bordereaux à payer', vide: 'Aucun expéditeur à payer' },
  RAMASSAGES_A_CONFIRMER: { href: '/ramassages', icone: CalendarClock, titre: 'Ramassages à confirmer', vide: 'Toutes les demandes sont confirmées' },
};

function ATraiter({ donnees }: { donnees: DashboardDto | null }) {
  const alertes = (donnees?.alerts ?? []).filter((a) => a.category && ACTIONS[a.category]);
  const enAttente = alertes.filter((a) => a.count > 0).length;
  return (
    <section aria-labelledby="tdb-a-traiter" className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="tdb-a-traiter" className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />
          À traiter maintenant
        </h2>
        {donnees && (
          <p className="text-[11px] text-slate-500" data-testid="tdb-a-traiter-resume">
            {enAttente === 0 ? 'Rien en attente — tout est à jour.' : `${enAttente} sujet${enAttente > 1 ? 's' : ''} demande${enAttente > 1 ? 'nt' : ''} votre attention`}
          </p>
        )}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {!donnees
          ? [0, 1, 2, 3].map((i) => <li key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />)
          : alertes.map((a, i) => {
              const act = ACTIONS[a.category as string];
              const Icone = act.icone;
              const actif = a.count > 0;
              const danger = a.type === 'danger' && actif;
              return (
                <li key={a.id}>
                  <Link
                    href={act.href}
                    data-testid={`tdb-action-${a.category}`}
                    className={`group relative flex items-start gap-3 h-full p-4 rounded-2xl border transition hover:-translate-y-0.5 hover:shadow-md motion-safe:animate-dash-rise ${
                      !actif
                        ? 'bg-white border-slate-200'
                        : danger
                          ? 'bg-red-50 border-red-200'
                          : 'bg-amber-50 border-amber-200'
                    }`}
                    style={retard(i)}
                  >
                    <span
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${
                        !actif ? 'bg-emerald-50 text-emerald-600' : danger ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
                      }`}
                    >
                      {actif ? <Icone className="w-5 h-5" aria-hidden="true" /> : <CheckCircle2 className="w-5 h-5" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`text-2xl font-extrabold tabular-nums ${!actif ? 'text-slate-300' : danger ? 'text-red-700' : 'text-amber-700'}`}>
                          {a.count}
                        </span>
                        <span className="text-xs font-semibold text-slate-800">{act.titre}</span>
                      </span>
                      <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">{actif ? a.message : act.vide}</span>
                      {actif && (
                        <span className={`mt-2 inline-flex items-center gap-1 text-[11px] font-bold ${danger ? 'text-red-700' : 'text-amber-800'}`}>
                          {a.actionLabel}
                          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Indicateurs                                                         */
/* ------------------------------------------------------------------ */

function Tendance({ valeur, unite = '%' }: { valeur: number | null; unite?: string }) {
  if (valeur === null) return <span className="text-sky-600">Nouveau sur la période</span>;
  if (valeur === 0) return <span className="text-slate-500">Stable vs période précédente</span>;
  const hausse = valeur > 0;
  const Icone = hausse ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${hausse ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icone className="w-3.5 h-3.5" aria-hidden="true" />
      {hausse ? '+' : '−'}
      {Math.abs(valeur)}
      {unite} vs période précédente
    </span>
  );
}

function TuileKpi({
  index,
  icone: Icone,
  teinte,
  libelle,
  valeur,
  format,
  tendance,
  aide,
  href,
  testid,
}: {
  index: number;
  icone: LucideIcon;
  teinte: string;
  libelle: string;
  valeur: number | undefined;
  format?: (v: number) => string;
  tendance?: number | null;
  aide?: string;
  href: string;
  testid: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testid}
      className="group relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 transition motion-safe:animate-dash-rise"
      style={retard(index)}
    >
      <div className={`absolute -top-10 -right-10 w-28 h-28 rounded-full bg-gradient-to-br ${teinte} opacity-[0.08] transition-transform duration-500 group-hover:scale-125`} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[11px] sm:text-xs font-semibold text-slate-500 leading-tight">{libelle}</p>
        <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${teinte} text-white flex items-center justify-center shadow-sm shrink-0`}>
          <Icone className="w-4 h-4" aria-hidden="true" />
        </span>
      </div>
      <p className="relative mt-2 text-xl sm:text-2xl font-extrabold text-slate-900 tabular-nums">
        {valeur === undefined ? <span className="inline-block w-16 h-7 rounded bg-slate-100 animate-pulse" /> : <Compteur valeur={valeur} format={format} />}
      </p>
      {tendance !== undefined && (
        <p className="relative mt-1 text-[11px] font-semibold">
          <Tendance valeur={tendance} />
        </p>
      )}
      {aide && <p className="relative mt-1 text-[11px] text-slate-400 leading-snug">{aide}</p>}
    </Link>
  );
}

function TuileTaux({ index, v }: { index: number; v: AdminOverviewDto | null }) {
  const taux = v?.period.successRate ?? null;
  const anime = useCompteur(taux ?? 0);
  const r = 26;
  const c = 2 * Math.PI * r;
  const couleur = taux === null ? '#cbd5e1' : taux >= 85 ? '#10b981' : taux >= 65 ? '#f59e0b' : '#ef4444';
  const ecart = v && taux !== null && v.previous.successRate !== null ? Math.round(taux - v.previous.successRate) : null;
  return (
    <Link
      href="/colis?statut=LIVRE"
      data-testid="kpi-taux"
      className="group bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 transition motion-safe:animate-dash-rise flex items-center gap-3"
      style={retard(index)}
    >
      <svg viewBox="0 0 64 64" className="w-16 h-16 shrink-0 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#f1f5f9" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={couleur}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.min(100, anime)) / 100}
        />
      </svg>
      <div className="min-w-0">
        <p className="text-[11px] sm:text-xs font-semibold text-slate-500 leading-tight">Taux de réussite</p>
        <p className="text-xl sm:text-2xl font-extrabold text-slate-900 tabular-nums">
          {v === null ? <span className="inline-block w-12 h-7 rounded bg-slate-100 animate-pulse" /> : taux === null ? '—' : `${Math.round(anime)} %`}
        </p>
        <p className="text-[11px] font-semibold">
          {v === null ? null : taux === null ? (
            <span className="text-slate-400">Aucun colis terminé sur la période</span>
          ) : ecart === null ? (
            <span className="text-slate-500">
              {v.period.delivered} livrés sur {v.period.delivered + v.period.failed}
            </span>
          ) : (
            <Tendance valeur={ecart} unite=" pts" />
          )}
        </p>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Parcours                                                            */
/* ------------------------------------------------------------------ */

function Parcours({ v }: { v: AdminOverviewDto | null }) {
  const valeurs = ETAPES.map((e) => v?.pipeline[e.cle] ?? 0);
  const total = valeurs.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...valeurs);
  return (
    <section className={`${CARTE} p-4 sm:p-5`} style={retard(5)} aria-labelledby="tdb-parcours">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h2 id="tdb-parcours" className="text-sm font-bold text-slate-900">
            Où sont les colis en ce moment
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {v ? `${total} colis en cours, de la création au retour. Cliquez sur une étape pour voir la liste.` : 'Chargement…'}
          </p>
        </div>
      </div>
      <ol className="relative grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
        <div aria-hidden="true" className="hidden lg:block absolute top-6 inset-x-[6%] h-0.5 bg-gradient-to-r from-slate-200 via-amber-200 to-red-200" />
        {ETAPES.map((e, i) => {
          const nb = valeurs[i];
          const Icone = e.icone;
          return (
            <li key={e.cle} className="relative">
              <Link
                href={e.href}
                title={e.aide}
                data-testid={`tdb-etape-${e.cle}`}
                className="group flex flex-col items-center text-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition"
              >
                <span
                  className={`relative w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-0.5 ${
                    nb === 0 ? 'opacity-40' : ''
                  }`}
                  style={{ backgroundColor: e.couleur }}
                >
                  <Icone className="w-5 h-5" aria-hidden="true" />
                  {nb > 0 && e.cle === 'livraison' && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-300 ring-2 ring-white motion-safe:animate-dash-pulse" aria-hidden="true" />
                  )}
                </span>
                <span className="text-lg font-extrabold text-slate-900 tabular-nums">{v ? <Compteur valeur={nb} /> : '—'}</span>
                <span className="text-[11px] font-semibold text-slate-700 leading-tight">{e.libelle}</span>
                <span className="text-[10px] text-slate-400 leading-tight hidden sm:block">{e.aide}</span>
                <span className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                  <span
                    className="block h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{
                      width: `${v ? Math.max(nb > 0 ? 6 : 0, (nb / max) * 100) : 0}%`,
                      backgroundColor: e.couleur,
                      transitionDelay: `${i * 70}ms`,
                    }}
                  />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Activité jour par jour                                              */
/* ------------------------------------------------------------------ */

type Mesure = 'volumes' | 'argent';

function Activite({ v, jours, chargement }: { v: AdminOverviewDto | null; jours: number; chargement: boolean }) {
  const [mesure, setMesure] = React.useState<Mesure>('volumes');
  const serie = v?.daily ?? [];
  const e = v ? evolution(v.period.created, v.previous.created) : null;
  return (
    <section className={`lg:col-span-2 ${CARTE} p-4 sm:p-5`} style={retard(6)} aria-labelledby="tdb-activite">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 id="tdb-activite" className="text-sm font-bold text-slate-900">
            Activité des {jours} derniers jours
          </h2>
          {v && (
            <p className="text-xs text-slate-500 mt-0.5">
              {mesure === 'volumes'
                ? `${v.period.created} colis créés, ${v.period.delivered} livrés`
                : `${montantCourt(v.period.collected)} encaissés à la livraison`}
              {mesure === 'volumes' && e !== null && e !== 0 && (
                <span className={`ml-1.5 font-semibold ${e > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  ({e > 0 ? '+' : ''}
                  {e} % de créations)
                </span>
              )}
            </p>
          )}
        </div>
        <div role="radiogroup" aria-label="Mesure affichée" className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200">
          {(
            [
              ['volumes', 'Colis'],
              ['argent', 'Encaissé'],
            ] as const
          ).map(([cle, libelle]) => (
            <button
              key={cle}
              type="button"
              role="radio"
              aria-checked={mesure === cle}
              onClick={() => setMesure(cle)}
              data-testid={`tdb-mesure-${cle}`}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                mesure === cle ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {libelle}
            </button>
          ))}
        </div>
      </div>
      <GraphiqueActivite serie={serie} mesure={mesure} chargement={chargement} />
    </section>
  );
}

function GraphiqueActivite({
  serie,
  mesure,
  chargement,
}: {
  serie: AdminOverviewDto['daily'];
  mesure: Mesure;
  chargement: boolean;
}) {
  const [survol, setSurvol] = React.useState<number | null>(null);
  const [pret, setPret] = React.useState(false);
  React.useEffect(() => {
    setPret(false);
    const id = requestAnimationFrame(() => setPret(true));
    return () => cancelAnimationFrame(id);
  }, [serie.length, mesure]);

  if (chargement) return <div className="h-60 rounded-xl bg-slate-50 animate-pulse" />;

  const vide =
    mesure === 'volumes'
      ? serie.every((j) => j.created + j.delivered + j.failed === 0)
      : serie.every((j) => j.collected === 0);
  if (serie.length === 0 || vide) {
    return (
      <div className="h-60 flex flex-col items-center justify-center gap-2 text-slate-400 rounded-xl bg-slate-50 border border-dashed border-slate-200">
        <Package className="w-7 h-7" aria-hidden="true" />
        <p className="text-xs">{mesure === 'volumes' ? 'Aucun colis sur cette période.' : 'Aucun encaissement sur cette période.'}</p>
      </div>
    );
  }

  const L = 680;
  const H = 230;
  const m = { haut: 12, bas: 26, gauche: mesure === 'argent' ? 44 : 30, droite: 8 };
  const largeur = L - m.gauche - m.droite;
  const hauteur = H - m.haut - m.bas;
  const valeurMax =
    mesure === 'volumes'
      ? Math.max(1, ...serie.map((j) => Math.max(j.created, j.delivered, j.failed)))
      : Math.max(1, ...serie.map((j) => j.collected));
  const brut = valeurMax / 4;
  const puissance = Math.pow(10, Math.floor(Math.log10(Math.max(1, brut))));
  const pasY = mesure === 'volumes' && valeurMax <= 4 ? 1 : Math.ceil(brut / puissance) * puissance;
  const plafond = pasY * Math.ceil(valeurMax / pasY);
  const colonne = largeur / serie.length;
  const barre = Math.max(2, Math.min(24, colonne * 0.55));
  const x = (i: number) => m.gauche + colonne * i + colonne / 2;
  const y = (val: number) => m.haut + hauteur - (val / plafond) * hauteur;
  const court = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  const long = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const date = (s: string) => new Date(`${s}T12:00:00`);
  const chaque = Math.ceil(serie.length / 8);
  const chemin = (cle: 'delivered' | 'failed') =>
    serie.map((j, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(j[cle]).toFixed(1)}`).join(' ');
  const ligneLivres = chemin('delivered');
  const aire = `${ligneLivres} L${x(serie.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const j = survol !== null ? serie[survol] : null;
  const etiquetteAxe = (val: number) => (mesure === 'argent' ? (val >= 1000 ? `${Math.round(val / 100) / 10}k` : String(val)) : String(val));

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-4 mb-2 text-[11px] text-slate-500">
        {mesure === 'volumes' ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-800" /> Colis créés
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-emerald-500" /> Livrés
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0 border-t-2 border-dashed border-red-500" /> Tentatives échouées
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" /> Encaissé à la livraison (DT)
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${L} ${H}`}
        className="w-full h-60 select-none"
        role="img"
        aria-label={mesure === 'volumes' ? 'Colis créés, livrés et tentatives échouées par jour' : 'Montant encaissé par jour'}
        onMouseLeave={() => setSurvol(null)}
      >
        <defs>
          <linearGradient id="tdb-admin-aire" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: plafond / pasY + 1 }, (_, k) => k * pasY).map((val) => (
          <g key={val}>
            <line x1={m.gauche} x2={L - m.droite} y1={y(val)} y2={y(val)} stroke="#f1f5f9" />
            <text x={m.gauche - 6} y={y(val) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {etiquetteAxe(val)}
            </text>
          </g>
        ))}

        {serie.map((jour, i) => {
          const val = mesure === 'volumes' ? jour.created : jour.collected;
          return (
            <rect
              key={jour.date}
              x={x(i) - barre / 2}
              y={pret ? y(val) : y(0)}
              width={barre}
              height={pret ? (val / plafond) * hauteur : 0}
              rx={Math.min(4, barre / 3)}
              className={`transition-all duration-700 ease-out ${
                mesure === 'volumes' ? (survol === i ? 'fill-red-600' : 'fill-slate-800') : survol === i ? 'fill-emerald-500' : 'fill-emerald-600'
              }`}
              style={{ transitionDelay: `${Math.min(i * 16, 480)}ms` }}
            />
          );
        })}

        {mesure === 'volumes' && (
          <>
            <path d={aire} fill="url(#tdb-admin-aire)" className={`transition-opacity duration-700 ${pret ? 'opacity-100' : 'opacity-0'}`} />
            <path
              d={ligneLivres}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={pret ? 0 : 1}
              style={{ transition: 'stroke-dashoffset 1.1s ease-out' }}
            />
            <path
              d={chemin('failed')}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinejoin="round"
              className={`transition-opacity duration-700 ${pret ? 'opacity-100' : 'opacity-0'}`}
            />
            {serie.map((jour, i) =>
              jour.delivered > 0 || survol === i ? (
                <circle key={`l${jour.date}`} cx={x(i)} cy={y(jour.delivered)} r={survol === i ? 4.5 : 2.5} fill="#fff" stroke="#10b981" strokeWidth="2" />
              ) : null
            )}
            {survol !== null && (
              <circle cx={x(survol)} cy={y(serie[survol].failed)} r={4} fill="#fff" stroke="#ef4444" strokeWidth="2" />
            )}
          </>
        )}

        {serie.map((jour, i) =>
          i % chaque === 0 || i === serie.length - 1 ? (
            <text key={`t${jour.date}`} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {court.format(date(jour.date))}
            </text>
          ) : null
        )}

        {serie.map((jour, i) => (
          <rect
            key={`h${jour.date}`}
            x={m.gauche + colonne * i}
            y={m.haut}
            width={colonne}
            height={hauteur}
            fill={survol === i ? 'rgba(15,23,42,0.04)' : 'transparent'}
            onMouseEnter={() => setSurvol(i)}
            onTouchStart={() => setSurvol(i)}
            onFocus={() => setSurvol(i)}
            onBlur={() => setSurvol(null)}
            tabIndex={0}
            aria-label={`${long.format(date(jour.date))} : ${jour.created} créés, ${jour.delivered} livrés, ${jour.failed} tentatives échouées, ${montantCourt(jour.collected)} encaissés`}
          />
        ))}
      </svg>
      {j && survol !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 -translate-x-1/2 rounded-lg bg-slate-900 text-white px-3 py-2 shadow-lg text-[11px] whitespace-nowrap"
          style={{ left: `${Math.min(86, Math.max(14, (x(survol) / L) * 100))}%` }}
          data-testid="tdb-infobulle"
        >
          <p className="font-semibold">{majuscule(long.format(date(j.date)))}</p>
          <p className="text-white/80 mt-0.5">
            Créés <b className="text-white">{j.created}</b> · Livrés <b className="text-emerald-300">{j.delivered}</b> · Échecs{' '}
            <b className="text-red-300">{j.failed}</b>
          </p>
          <p className="text-white/80">
            Encaissé <b className="text-white">{montantCourt(j.collected)}</b>
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flotte                                                              */
/* ------------------------------------------------------------------ */

function BarreRepartie({ parts, libelle }: { parts: { n: number; couleur: string; libelle: string }[]; libelle: string }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 gap-[2px]" role="img" aria-label={`${libelle} : ${parts.map((p) => `${p.n} ${p.libelle}`).join(', ')}`}>
        {total > 0 &&
          parts.map((p) =>
            p.n > 0 ? (
              <span
                key={p.libelle}
                title={`${p.libelle} : ${p.n}`}
                className="h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full"
                style={{ width: `${(p.n / total) * 100}%`, backgroundColor: p.couleur }}
              />
            ) : null
          )}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-1.5">
        {parts.map((p) => (
          <li key={p.libelle} className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.couleur }} />
            <span className="truncate">{p.libelle}</span>
            <span className="ml-auto font-bold text-slate-900 tabular-nums">{p.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Flotte({ donnees }: { donnees: DashboardDto | null }) {
  const l = donnees?.livreurs;
  const occupation = l && l.actifs > 0 ? Math.round((l.enTournee / l.actifs) * 100) : 0;
  const anime = useCompteur(occupation);
  const enLigne = l ? Math.max(0, l.actifs - l.horsLigne) : 0;
  return (
    <section className={`${CARTE} p-4 sm:p-5 flex flex-col`} style={retard(7)} aria-labelledby="tdb-flotte">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <h2 id="tdb-flotte" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-red-500" aria-hidden="true" />
            Flotte des livreurs
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{l ? `${l.actifs} livreur${l.actifs > 1 ? 's' : ''} actif${l.actifs > 1 ? 's' : ''}` : 'Chargement…'}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-extrabold text-slate-900 tabular-nums">{l ? `${Math.round(anime)} %` : '—'}</p>
          <p className="text-[10px] text-slate-500">occupés en tournée</p>
        </div>
      </div>
      {l ? (
        <div className="space-y-5 flex-1">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Disponibilité</p>
            <BarreRepartie
              libelle="Disponibilité"
              parts={[
                { n: l.enTournee, couleur: '#f59e0b', libelle: 'En tournée' },
                { n: l.disponibles, couleur: '#10b981', libelle: 'Disponibles' },
              ]}
            />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Application mobile</p>
            <BarreRepartie
              libelle="Connexion"
              parts={[
                { n: enLigne, couleur: '#0ea5e9', libelle: 'En ligne' },
                { n: l.horsLigne, couleur: '#cbd5e1', libelle: 'Hors ligne' },
              ]}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-3">
          <div className="h-12 rounded-lg bg-slate-50 animate-pulse" />
          <div className="h-12 rounded-lg bg-slate-50 animate-pulse" />
        </div>
      )}
      <Link href="/admin/livreurs" className="mt-4 inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-semibold">
        Gérer les livreurs
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Classements                                                         */
/* ------------------------------------------------------------------ */

function EnTeteClassement({ id, icone: Icone, titre, aide, href, lien }: { id: string; icone: LucideIcon; titre: string; aide: string; href: string; lien: string }) {
  return (
    <div className="flex items-start justify-between gap-2 mb-3">
      <div>
        <h2 id={id} className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Icone className="w-4 h-4 text-red-500" aria-hidden="true" />
          {titre}
        </h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{aide}</p>
      </div>
      <Link href={href} className="shrink-0 inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-semibold">
        {lien}
        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function Rang({ n }: { n: number }) {
  const style = n === 1 ? 'bg-amber-400 text-amber-950' : n === 2 ? 'bg-slate-300 text-slate-800' : n === 3 ? 'bg-orange-300 text-orange-950' : 'bg-slate-100 text-slate-500';
  return <span className={`w-5 h-5 rounded-full text-[10px] font-extrabold flex items-center justify-center shrink-0 ${style}`}>{n}</span>;
}

function ListeChargement() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-12 rounded-xl bg-slate-50 animate-pulse" />
      ))}
    </div>
  );
}

function ClassementLivreurs({ v, jours }: { v: AdminOverviewDto | null; jours: number }) {
  const lignes = v?.topDrivers ?? [];
  const max = Math.max(1, ...lignes.map((d) => d.delivered + d.failed));
  return (
    <section className={`${CARTE} p-4 sm:p-5`} style={retard(8)} aria-labelledby="tdb-livreurs">
      <EnTeteClassement
        id="tdb-livreurs"
        icone={Truck}
        titre="Meilleurs livreurs"
        aide={`Classés par livraisons réussies sur ${jours} jours`}
        href="/admin/livreurs"
        lien="Tous"
      />
      {!v ? (
        <ListeChargement />
      ) : lignes.length === 0 ? (
        <p className="text-xs text-slate-400 py-8 text-center">Aucun livreur actif.</p>
      ) : (
        <ol className="space-y-1" data-testid="tdb-top-livreurs">
          {lignes.map((d, i) => {
            const total = d.delivered + d.failed;
            return (
              <li key={d.id}>
                <Link href={`/colis?livreur=${encodeURIComponent(d.code)}`} className="group flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-slate-50 transition">
                  <Rang n={i + 1} />
                  <span className="relative w-9 h-9 rounded-xl bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                    {initiales(d.name) || <UserRound className="w-4 h-4" aria-hidden="true" />}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white ${d.online ? 'bg-emerald-400' : 'bg-slate-300'}`}
                      title={d.online ? 'Application ouverte' : 'Hors ligne'}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900 truncate">{nomPropre(d.name)}</span>
                      {d.onRun && <span className="px-1.5 py-px rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold shrink-0">En tournée</span>}
                    </span>
                    <span className="mt-1 flex h-1.5 rounded-full bg-slate-100 overflow-hidden gap-[2px]" aria-hidden="true">
                      <span className="h-full bg-emerald-500 rounded-l-full transition-[width] duration-700" style={{ width: `${(d.delivered / max) * 100}%` }} />
                      <span className="h-full bg-red-400 rounded-r-full transition-[width] duration-700" style={{ width: `${(d.failed / max) * 100}%` }} />
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-1">
                      {d.code} · {d.delivered} livré{d.delivered > 1 ? 's' : ''}
                      {d.failed > 0 ? ` · ${d.failed} échec${d.failed > 1 ? 's' : ''}` : ''}
                      {d.cash > 0 ? ` · ${montantCourt(d.cash)} en main` : ''}
                    </span>
                  </span>
                  <span className="text-right shrink-0 w-12">
                    <span className={`block text-sm font-extrabold tabular-nums ${d.successRate === null ? 'text-slate-300' : d.successRate >= 85 ? 'text-emerald-600' : d.successRate >= 65 ? 'text-amber-600' : 'text-red-600'}`}>
                      {d.successRate === null ? '—' : `${Math.round(d.successRate)}%`}
                    </span>
                    <span className="block text-[10px] text-slate-400">{total ? 'réussite' : 'inactif'}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function ClassementExpediteurs({ v, jours }: { v: AdminOverviewDto | null; jours: number }) {
  const lignes = v?.topShippers ?? [];
  const max = Math.max(1, ...lignes.map((s) => s.created));
  return (
    <section className={`${CARTE} p-4 sm:p-5`} style={retard(9)} aria-labelledby="tdb-expediteurs">
      <EnTeteClassement
        id="tdb-expediteurs"
        icone={Store}
        titre="Expéditeurs les plus actifs"
        aide={`Classés par colis confiés sur ${jours} jours`}
        href="/admin/expediteurs"
        lien="Tous"
      />
      {!v ? (
        <ListeChargement />
      ) : lignes.length === 0 ? (
        <p className="text-xs text-slate-400 py-8 text-center">Aucun colis confié sur cette période.</p>
      ) : (
        <>
          <ol className="space-y-1" data-testid="tdb-top-expediteurs">
            {lignes.map((s, i) => {
              const autres = Math.max(0, s.created - s.delivered - s.returned);
              return (
                <li key={s.id}>
                  <Link href={`/colis?expediteur=${encodeURIComponent(s.id)}`} className="group flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-slate-50 transition">
                    <Rang n={i + 1} />
                    <span className="w-9 h-9 rounded-xl bg-red-50 text-red-600 text-[11px] font-bold flex items-center justify-center shrink-0 transition-transform group-hover:scale-105">
                      {initiales(s.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-slate-900 truncate">{s.name}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">{s.governorate}</span>
                      </span>
                      <span className="mt-1 flex h-1.5 rounded-full bg-slate-100 overflow-hidden gap-[2px]" aria-hidden="true" style={{ width: `${Math.max(8, (s.created / max) * 100)}%` }}>
                        <span className="h-full bg-emerald-500" style={{ width: `${(s.delivered / Math.max(1, s.created)) * 100}%` }} />
                        <span className="h-full bg-amber-400" style={{ width: `${(autres / Math.max(1, s.created)) * 100}%` }} />
                        <span className="h-full bg-red-400" style={{ width: `${(s.returned / Math.max(1, s.created)) * 100}%` }} />
                      </span>
                      <span className="block text-[10px] text-slate-500 mt-1">
                        {s.delivered} livré{s.delivered > 1 ? 's' : ''} · {autres} en cours · {s.returned} retour{s.returned > 1 ? 's' : ''}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-sm font-extrabold text-slate-900 tabular-nums">{s.created}</span>
                      <span className="block text-[10px] text-slate-400">{montantCourt(s.amount)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <ul className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
            <li className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Livrés
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> En cours
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400" /> Retours
            </li>
          </ul>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Agences                                                             */
/* ------------------------------------------------------------------ */

const COLONNES_AGENCE = [
  { cle: 'inStock', libelle: 'En stock', couleur: '#8b5cf6' },
  { cle: 'toAssign', libelle: 'Sans livreur', couleur: '#ef4444' },
  { cle: 'outForDelivery', libelle: 'En livraison', couleur: '#f59e0b' },
  { cle: 'returns', libelle: 'Retours', couleur: '#f97316' },
  { cle: 'incoming', libelle: 'Arrivent', couleur: '#6366f1' },
] as const;

function Agences({ v }: { v: AdminOverviewDto | null }) {
  const [toutes, setToutes] = React.useState(false);
  const agences = v?.agencies ?? [];
  const charge = (a: AdminOverviewDto['agencies'][number]) => a.inStock + a.outForDelivery + a.returns + a.incoming;
  const actives = agences.filter((a) => a.isMainHub || charge(a) > 0);
  const calmes = agences.length - actives.length;
  const affichees = toutes ? agences : actives;
  const max = Math.max(1, ...agences.map(charge));
  return (
    <section className={`lg:col-span-2 ${CARTE} p-4 sm:p-5`} style={retard(10)} aria-labelledby="tdb-agences">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h2 id="tdb-agences" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Warehouse className="w-4 h-4 text-red-500" aria-hidden="true" />
            Stock des agences
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Colis présents dans chaque agence en ce moment</p>
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
          {COLONNES_AGENCE.map((c) => (
            <li key={c.cle} className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.couleur }} /> {c.libelle}
            </li>
          ))}
        </ul>
      </div>
      {!v ? (
        <ListeChargement />
      ) : (
        <>
          <ul className="divide-y divide-slate-100" data-testid="tdb-agences">
            {affichees.map((a) => {
              const total = charge(a);
              return (
                <li key={a.id} className="py-2.5 group">
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${a.isMainHub ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      <Warehouse className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 w-36 sm:w-44 shrink-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{a.name}</p>
                      <p className="text-[10px] text-slate-400">{a.isMainHub ? 'Hub central' : a.governorate}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex h-2.5 rounded-full bg-slate-100 overflow-hidden gap-[2px]" style={{ width: `${Math.max(total > 0 ? 6 : 100, (total / max) * 100)}%` }}>
                        {total > 0 &&
                          COLONNES_AGENCE.filter((c) => c.cle !== 'toAssign').map((c) => {
                            const nb = a[c.cle];
                            return nb > 0 ? (
                              <span key={c.cle} title={`${c.libelle} : ${nb}`} className="h-full transition-[width] duration-700" style={{ width: `${(nb / total) * 100}%`, backgroundColor: c.couleur }} />
                            ) : null;
                          })}
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 truncate">
                        {total === 0
                          ? 'Aucun colis'
                          : COLONNES_AGENCE.filter((c) => a[c.cle] > 0)
                              .map((c) => `${a[c.cle]} ${a[c.cle] > 1 && c.cle === 'returns' ? 'retours' : c.cle === 'returns' ? 'retour' : c.libelle.toLowerCase()}`)
                              .join(' · ')}
                      </p>
                    </div>
                    {a.toAssign > 0 ? (
                      <Link
                        href="/colis?statut=RECU_DEPOT"
                        className="shrink-0 px-2 py-1 rounded-lg bg-red-50 text-red-700 text-[10px] font-bold hover:bg-red-100 transition"
                        title="Colis reçus sans livreur"
                      >
                        {a.toAssign} à affecter
                      </Link>
                    ) : (
                      <span className="shrink-0 text-sm font-extrabold text-slate-900 tabular-nums w-8 text-right">{total}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {calmes > 0 && (
            <button
              type="button"
              onClick={() => setToutes((t) => !t)}
              className="mt-2 text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              data-testid="tdb-agences-toutes"
            >
              {toutes ? 'Masquer les agences sans colis' : `+ ${calmes} agence${calmes > 1 ? 's' : ''} sans colis en ce moment`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Argent                                                              */
/* ------------------------------------------------------------------ */

function LigneArgent({
  icone: Icone,
  libelle,
  montant,
  aide,
  accent,
  href,
  alerte,
}: {
  icone: LucideIcon;
  libelle: string;
  montant: number | undefined;
  aide?: string;
  accent: string;
  href: string;
  alerte?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 p-3 rounded-xl border transition hover:-translate-y-0.5 hover:shadow-sm ${alerte ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100 hover:bg-white'}`}
    >
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
        <Icone className="w-4 h-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-slate-500">{libelle}</span>
        <span className={`block text-base font-extrabold tabular-nums ${alerte ? 'text-red-700' : 'text-slate-900'}`}>
          {montant === undefined ? '—' : <Compteur valeur={montant} format={montantCourt} />}
        </span>
        {aide && <span className="block text-[10px] text-slate-400 leading-snug">{aide}</span>}
      </span>
      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 transition shrink-0" aria-hidden="true" />
    </Link>
  );
}

function Argent({ donnees }: { donnees: DashboardDto | null }) {
  const v = donnees?.vue;
  const p = donnees?.paiements;
  return (
    <section className={`${CARTE} p-4 sm:p-5 space-y-2.5`} style={retard(11)} aria-labelledby="tdb-argent">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 id="tdb-argent" className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Coins className="w-4 h-4 text-red-500" aria-hidden="true" />
          Où est l’argent
        </h2>
        <Link href="/caisse" className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-semibold">
          Caisse
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
      <LigneArgent
        icone={Package}
        libelle="Chez les clients (à encaisser)"
        montant={v?.money.codInProgress}
        aide={v ? `${v.money.codInProgressCount} colis pas encore livrés` : undefined}
        accent="bg-amber-100 text-amber-700"
        href="/colis"
      />
      <LigneArgent
        icone={Truck}
        libelle="Chez les livreurs (à reverser)"
        montant={v?.money.cashWithDrivers}
        aide={v ? (v.money.driversWithCash === 0 ? 'Aucune espèce en circulation' : `${v.money.driversWithCash} livreur${v.money.driversWithCash > 1 ? 's' : ''} avec des espèces`) : undefined}
        accent="bg-sky-100 text-sky-700"
        href="/caisse"
      />
      <LigneArgent
        icone={Banknote}
        libelle="À payer aux expéditeurs"
        montant={p?.paiementsEnAttenteTND}
        aide="Bordereaux confirmés, en attente de paiement"
        accent="bg-violet-100 text-violet-700"
        href="/paiements"
      />
      {p && p.deficitCaisseTND > 0 && (
        <LigneArgent
          icone={AlertTriangle}
          libelle="Écart de caisse"
          montant={p.deficitCaisseTND}
          aide="Manque constaté à la clôture des tournées"
          accent="bg-red-600 text-white"
          href="/runsheets"
          alerte
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ramassages + journal                                                */
/* ------------------------------------------------------------------ */

function Ramassages({ donnees }: { donnees: DashboardDto | null }) {
  const r = donnees?.ramassages;
  const lignes = r
    ? [
        { libelle: 'À confirmer', n: r.aConfirmer, couleur: '#f59e0b' },
        { libelle: 'Planifiés', n: r.planifies, couleur: '#0ea5e9' },
        { libelle: 'En cours', n: r.enCours, couleur: '#8b5cf6' },
        { libelle: 'Effectués', n: r.effectues, couleur: '#10b981' },
        { libelle: 'Annulés', n: r.annules, couleur: '#cbd5e1' },
      ]
    : [];
  const max = Math.max(1, ...lignes.map((l) => l.n));
  return (
    <section className={`${CARTE} p-4 sm:p-5`} style={retard(12)} aria-labelledby="tdb-ramassages">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 id="tdb-ramassages" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-red-500" aria-hidden="true" />
            Ramassages
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{r ? `${r.total} rendez-vous au total` : 'Chargement…'}</p>
        </div>
        <Link href="/ramassages" className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-semibold">
          Organiser
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
      {!r ? (
        <ListeChargement />
      ) : (
        <ul className="space-y-2.5">
          {lignes.map((l, i) => (
            <li key={l.libelle} className="flex items-center gap-3 text-xs">
              <span className="w-20 text-slate-600 shrink-0">{l.libelle}</span>
              <span className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <span
                  className="block h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${(l.n / max) * 100}%`, backgroundColor: l.couleur, transitionDelay: `${i * 60}ms` }}
                />
              </span>
              <span className="w-6 text-right font-bold text-slate-900 tabular-nums">{l.n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const RACCOURCIS: { libelle: string; href: string; icone: LucideIcon }[] = [
  { libelle: 'Gestion des colis', href: '/colis', icone: Package },
  { libelle: 'Inter-dépôts', href: '/inter-depots', icone: Shuffle },
  { libelle: 'Retours expéditeur', href: '/retours-expediteur', icone: Undo2 },
  { libelle: 'Paiements', href: '/paiements', icone: Banknote },
  { libelle: 'Caisse', href: '/caisse', icone: Wallet },
  { libelle: 'Rapports', href: '/rapports', icone: TrendingUp },
];

function Raccourcis() {
  return (
    <section className={`${CARTE} p-4 sm:p-5`} style={retard(13)} aria-labelledby="tdb-raccourcis">
      <h2 id="tdb-raccourcis" className="text-sm font-bold text-slate-900 mb-3">
        Accès rapides
      </h2>
      <ul className="grid grid-cols-2 gap-2">
        {RACCOURCIS.map((r) => {
          const Icone = r.icone;
          return (
            <li key={r.href}>
              <Link
                href={r.href}
                className="group flex items-center gap-2 p-2.5 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-slate-200 hover:shadow-sm transition text-xs font-semibold text-slate-700"
              >
                <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-red-600 flex items-center justify-center shrink-0 transition-transform group-hover:scale-110">
                  <Icone className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
                <span className="truncate">{r.libelle}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const ICONES_JOURNAL: Record<string, { icone: LucideIcon; style: string }> = {
  DELIVERY: { icone: CheckCircle2, style: 'bg-emerald-100 text-emerald-700' },
  SCAN: { icone: Barcode, style: 'bg-sky-100 text-sky-700' },
  RUNSHEET: { icone: Route, style: 'bg-violet-100 text-violet-700' },
  PAYMENT: { icone: Coins, style: 'bg-amber-100 text-amber-700' },
  PICKUP: { icone: CalendarClock, style: 'bg-rose-100 text-rose-700' },
};

function Journal({ donnees }: { donnees: DashboardDto | null }) {
  const evenements = donnees?.recentActivity ?? [];
  return (
    <section className={`lg:col-span-2 ${CARTE} p-4 sm:p-5`} style={retard(13)} aria-labelledby="tdb-journal">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h2 id="tdb-journal" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Repeat2 className="w-4 h-4 text-red-500" aria-hidden="true" />
            Derniers mouvements
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Scans, livraisons et affectations, du plus récent au plus ancien</p>
        </div>
        <Link href="/audit" className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-semibold">
          Journal complet
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
      {!donnees ? (
        <ListeChargement />
      ) : evenements.length === 0 ? (
        <p className="text-xs text-slate-400 py-8 text-center">Aucun mouvement récent.</p>
      ) : (
        <ol className="relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-[17px] before:w-px before:bg-slate-200" data-testid="tdb-journal">
          {evenements.map((e) => {
            const style = ICONES_JOURNAL[e.type] ?? ICONES_JOURNAL.SCAN;
            const Icone = style.icone;
            const suivi = /#([\w-]{6,})/.exec(e.description)?.[1];
            const contenu = (
              <>
                <span className={`relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 ring-4 ring-white ${style.style}`}>
                  <Icone className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-xs font-semibold text-slate-900">{e.title}</span>
                    {e.badge && <span className="px-1.5 py-px rounded-md bg-slate-100 text-slate-600 text-[10px]">{e.badge}</span>}
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">{e.description}</span>
                  <span className="block text-[10px] text-slate-400">Par {e.actor}</span>
                </span>
                <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">{e.timestamp}</span>
              </>
            );
            return (
              <li key={e.id}>
                {suivi ? (
                  <Link href={`/colis?tracking=${encodeURIComponent(suivi)}`} className="flex items-start gap-3 p-1.5 rounded-xl hover:bg-slate-50 transition">
                    {contenu}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-1.5">{contenu}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
