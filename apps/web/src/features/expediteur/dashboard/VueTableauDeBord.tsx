'use client';

/**
 * Tableau de bord expéditeur.
 *
 * Le premier écran que voit un expéditeur, chaque jour. Il répond, dans
 * l'ordre, à : « que s'est-il passé aujourd'hui ? », « où en sont mes colis ? »,
 * « comment ça évolue ? », « où vont mes colis ? » et « où en est mon argent ? ».
 *
 * Les chiffres viennent de `GET /shipper/dashboard`, calculés en base sur les
 * seuls colis de l'expéditeur (jamais comptés sur une page tronquée). Les
 * listes (derniers colis, activité, bordereaux) restent celles du portail.
 * L'écran se rafraîchit seul toutes les minutes tant qu'il est visible.
 *
 * Animations : entrée des cartes, compteurs qui défilent, barres qui poussent.
 * Toutes s'effacent si le système demande moins de mouvement
 * (`prefers-reduced-motion`, classe `dash-anime`).
 *
 * ## Langue
 *
 * Intitulés du dictionnaire (`tdb.*`, `dashboard.*`), valeurs de domaine du
 * vocabulaire (statuts, gouvernorats). Les graphiques gardent l'axe du temps de
 * gauche à droite dans les deux langues, comme les chiffres.
 */

import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  MapPin,
  Package,
  PackagePlus,
  PlusCircle,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  Truck,
  Undo2,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { type NotificationDto, type PackageDto, type PaymentVoucherDto } from '@logixpress/types';
import { Card, EmptyState, ErrorBanner, Spinner } from '@logixpress/ui';
import { useAuth } from '@/lib/auth';
import {
  lireTableauDeBord,
  listerBordereaux,
  listerColis,
  notificationsApi,
  type TableauDeBordExpediteur,
} from '@/features/expediteur/lib/client';
import { useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n, type Cle } from '@/i18n';

type CleEtape = keyof TableauDeBordExpediteur['pipeline'];

/** Étapes du parcours : icône, couleur, et liste filtrée qu'ouvre un clic. */
const ETAPES: { cle: CleEtape; icone: LucideIcon; couleur: string; trait: string; href: string }[] = [
  { cle: 'preparation', icone: PackagePlus, couleur: '#64748b', trait: 'bg-slate-500', href: '/expediteur/colis?statut=CREE' },
  { cle: 'collecte', icone: Truck, couleur: '#0ea5e9', trait: 'bg-sky-500', href: '/expediteur/colis?statut=RAMASSE' },
  { cle: 'depot', icone: Warehouse, couleur: '#8b5cf6', trait: 'bg-violet-500', href: '/expediteur/colis?statut=RECU_DEPOT' },
  { cle: 'livraison', icone: Clock3, couleur: '#f59e0b', trait: 'bg-amber-500', href: '/expediteur/colis?statut=EN_COURS_LIVRAISON' },
  { cle: 'livre', icone: CheckCircle2, couleur: '#10b981', trait: 'bg-emerald-500', href: '/expediteur/colis?vue=livres' },
  { cle: 'retour', icone: Undo2, couleur: '#ef4444', trait: 'bg-red-500', href: '/expediteur/retours' },
];

const PERIODES = [7, 14, 30, 90] as const;
const RAFRAICHISSEMENT_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function mouvementReduit(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Valeur qui défile de l'ancienne à la nouvelle (≈ 0,9 s), sans à-coup. */
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
      const lisse = 1 - Math.pow(1 - p, 3);
      setValeur(depart + (cible - depart) * lisse);
      if (p < 1) image = requestAnimationFrame(pas);
    };
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [cible, duree]);
  return valeur;
}

function Compteur({ valeur, format }: { valeur: number; format?: (v: number) => string }) {
  const v = useCompteur(valeur);
  return <>{format ? format(v) : Math.round(v).toLocaleString('fr-TN')}</>;
}

/** Évolution en % par rapport à la période précédente (null : pas de base). */
function evolution(actuel: number, precedent: number): number | null {
  if (precedent === 0) return actuel === 0 ? 0 : null;
  return Math.round(((actuel - precedent) / precedent) * 100);
}

/** Délai d'apparition échelonné des cartes. */
const retard = (i: number) => ({ animationDelay: `${i * 70}ms` });

/* ------------------------------------------------------------------ */
/* Écran                                                               */
/* ------------------------------------------------------------------ */

export function VueTableauDeBord() {
  const { t, formatDelai, formatTND, traduireServeur, locale } = useI18n();
  const voc = useVocabulaire();
  const { user } = useAuth();

  const [jours, setJours] = React.useState<number>(14);
  const [donnees, setDonnees] = React.useState<TableauDeBordExpediteur | null>(null);
  const [recents, setRecents] = React.useState<PackageDto[]>([]);
  const [bordereaux, setBordereaux] = React.useState<PaymentVoucherDto[]>([]);
  const [notifications, setNotifications] = React.useState<NotificationDto[]>([]);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [majLe, setMajLe] = React.useState<string | null>(null);
  const [, forcerRendu] = React.useReducer((x: number) => x + 1, 0);

  const charger = React.useCallback(
    async (periode: number, discret = false) => {
      if (!discret) setChargement(true);
      try {
        const [tdbR, recentsR, bordereauxR, notifsR] = await Promise.allSettled([
          lireTableauDeBord(periode),
          listerColis({ limit: 6 }),
          listerBordereaux(),
          notificationsApi.list({ limit: 6 }),
        ]);
        if (tdbR.status === 'fulfilled') {
          setDonnees(tdbR.value);
          setErreur(null);
        } else if (!discret) {
          setErreur(t('tdb.erreur'));
        }
        if (recentsR.status === 'fulfilled') setRecents(recentsR.value.colis);
        if (bordereauxR.status === 'fulfilled') setBordereaux(bordereauxR.value);
        if (notifsR.status === 'fulfilled') setNotifications(notifsR.value.items);
        setMajLe(new Date().toISOString());
      } finally {
        setChargement(false);
      }
    },
    // `t` change avec la langue : les données n'ont pas à être relues pour autant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  React.useEffect(() => {
    void charger(jours);
  }, [charger, jours]);

  // Rafraîchissement discret, seulement quand l'onglet est visible ; et la
  // mention « mis à jour il y a … » avance toute seule.
  React.useEffect(() => {
    const minuteur = window.setInterval(() => {
      if (document.visibilityState === 'visible') void charger(jours, true);
      forcerRendu();
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

  const nom = user?.shipperName ?? user?.fullName ?? t('dashboard.votreEntreprise');
  const heure = new Date().getHours();
  const salut = t(heure < 12 ? 'tdb.salut.matin' : heure < 18 ? 'tdb.salut.apresMidi' : 'tdb.salut.soir');

  const bordereauxEnAttente = bordereaux.filter((b) => b.status !== 'PAYE' && b.status !== 'ANNULE');
  const netEnAttente = bordereauxEnAttente.reduce((s, b) => s + Number(b.netPayable ?? 0), 0);
  const netRegle = bordereaux.filter((b) => b.status === 'PAYE').reduce((s, b) => s + Number(b.netPayable ?? 0), 0);

  const d = donnees;
  const formatDuree = (h: number | null) =>
    h == null ? '—' : h < 48 ? t('tdb.heures', { n: Math.max(1, Math.round(h)) }) : t('tdb.jours', { n: Math.round(h / 24) });

  return (
    <div className="dash-anime space-y-5 pb-4">
      {/* ============================================================ */}
      {/* Bandeau d'accueil                                            */}
      {/* ============================================================ */}
      <section
        className="relative overflow-hidden rounded-2xl bg-slate-900 text-white shadow-lg motion-safe:animate-dash-rise"
        aria-labelledby="tdb-salut"
      >
        {/* Halos décoratifs qui dérivent lentement */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -end-16 w-72 h-72 rounded-full bg-red-600/40 blur-3xl motion-safe:animate-dash-drift" />
          <div
            className="absolute -bottom-28 start-1/3 w-80 h-80 rounded-full bg-rose-500/20 blur-3xl motion-safe:animate-dash-drift"
            style={{ animationDelay: '-7s' }}
          />
          <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:18px_18px]" />
        </div>

        <div className="relative p-5 sm:p-7 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-white/70">
                <span className="relative flex w-2 h-2">
                  <span className="absolute inset-0 rounded-full bg-emerald-400 motion-safe:animate-dash-pulse" />
                  <span className="relative w-2 h-2 rounded-full bg-emerald-400" />
                </span>
                {t('tdb.enDirect')}
                {majLe && <span className="normal-case tracking-normal font-normal text-white/50">· {t('tdb.majIlYa', { delai: formatDelai(majLe) })}</span>}
              </p>
              <h1 id="tdb-salut" className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {t('tdb.salutNom', { salut, nom })}
              </h1>
              <p className="text-sm text-white/75 max-w-xl leading-relaxed" data-testid="tdb-resume">
                {d
                  ? d.today.created + d.today.delivered + d.today.outForDelivery === 0
                    ? t('tdb.resumeVide')
                    : t('tdb.resumeJour', {
                        crees: d.today.created,
                        livres: d.today.delivered,
                        route: d.today.outForDelivery,
                      })
                  : t('dashboard.sous-titre')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                href="/expediteur/colis/nouveau"
                className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold shadow-lg shadow-red-900/40 transition hover:-translate-y-0.5"
              >
                <PlusCircle className="w-4 h-4 transition-transform group-hover:rotate-90" aria-hidden="true" />
                {t('coque.nouveauColis')}
              </Link>
              <Link
                href="/expediteur/ramassages"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-sm font-semibold transition hover:-translate-y-0.5"
              >
                <Truck className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
                {t('tdb.action.ramassage')}
              </Link>
              <button
                type="button"
                onClick={() => void charger(jours)}
                aria-label={t('tdb.actualiser')}
                title={t('tdb.actualiser')}
                className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 transition cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${chargement ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            {/* Recherche rapide : mène au suivi, cloisonné par le jeton. */}
            <form action="/expediteur/suivi" role="search" className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-white/50 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                <input
                  type="search"
                  name="q"
                  placeholder={t('dashboard.rechercherAide')}
                  aria-label={t('dashboard.rechercher')}
                  className="w-full ps-9 pe-3 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder:text-white/45 focus:outline-none focus:bg-white/15 focus:border-white/40"
                />
              </div>
              <button type="submit" className="px-4 py-2.5 rounded-xl bg-white text-slate-900 text-sm font-semibold hover:bg-slate-100 transition cursor-pointer">
                {t('tdb.action.suivre')}
              </button>
            </form>
            <Link
              href="/expediteur/ramassages"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white/80 hover:bg-white/10 transition"
              data-testid="tdb-ramassage"
            >
              <CalendarClock className="w-4 h-4 text-amber-300" aria-hidden="true" />
              {d?.nextPickup
                ? t('tdb.prochainRamassage', {
                    date: new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(
                      new Date(`${d.nextPickup.scheduledDate}T12:00:00`)
                    ),
                    debut: d.nextPickup.startHour,
                    fin: d.nextPickup.endHour,
                  })
                : t('tdb.aucunRamassage')}
            </Link>
          </div>
        </div>
      </section>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      {/* ============================================================ */}
      {/* Indicateurs clés                                             */}
      {/* ============================================================ */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3" aria-label={t('dashboard.etatColis')}>
        <TuileKpi
          index={1}
          icone={Package}
          teinte="from-slate-900 to-slate-700"
          libelle={t('tdb.kpi.enCours')}
          valeur={d?.totals.active}
          aide={t('tdb.kpi.enCoursAide')}
          href="/expediteur/colis"
        />
        <TuileKpi
          index={2}
          icone={CheckCircle2}
          teinte="from-emerald-600 to-emerald-400"
          libelle={t('tdb.kpi.livres', { n: jours })}
          valeur={d?.period.delivered}
          tendance={d ? evolution(d.period.delivered, d.previous.delivered) : undefined}
          aide={d ? t('tdb.delaiMoyen', { duree: formatDuree(d.period.avgDeliveryHours) }) : undefined}
          href="/expediteur/colis?vue=livres"
        />
        <TuileTaux index={3} donnees={d} />
        <TuileKpi
          index={4}
          icone={Wallet}
          teinte="from-red-600 to-rose-400"
          libelle={t('tdb.kpi.encaisse', { n: jours })}
          valeur={d?.period.collected}
          format={(v) => formatTND(v)}
          aide={d ? t('tdb.kpi.encaisseAide', { frais: formatTND(d.period.fees) }) : undefined}
          href="/expediteur/bordereaux"
        />
      </section>

      {/* ============================================================ */}
      {/* Parcours des colis                                           */}
      {/* ============================================================ */}
      <Parcours donnees={d} />

      {/* ============================================================ */}
      {/* Activité + répartition                                       */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section
          className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs motion-safe:animate-dash-rise"
          style={retard(6)}
          aria-labelledby="tdb-activite"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 id="tdb-activite" className="text-sm font-bold text-slate-900">
                {t('tdb.activite.titre')}
              </h2>
              {d && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {t('tdb.activite.resume', { crees: d.period.created, livres: d.period.delivered })}
                  {(() => {
                    const e = evolution(d.period.created, d.previous.created);
                    return e === null || e === 0 ? null : (
                      <span className={`ms-1.5 font-semibold ${e > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ({e > 0 ? '+' : ''}
                        {e} %)
                      </span>
                    );
                  })()}
                </p>
              )}
            </div>
            <div role="radiogroup" aria-label={t('tdb.periodeChoix')} className="inline-flex p-0.5 rounded-lg bg-slate-100 border border-slate-200">
              {PERIODES.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={jours === p}
                  onClick={() => setJours(p)}
                  data-testid={`tdb-periode-${p}`}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                    jours === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t('tdb.periode', { n: p })}
                </button>
              ))}
            </div>
          </div>
          <GraphiqueActivite jours={d?.daily ?? []} locale={locale} chargement={chargement && !d} />
        </section>

        <Repartition donnees={d} />
      </div>

      {/* ============================================================ */}
      {/* Destinations + argent                                        */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Destinations donnees={d} />

        <section
          className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 motion-safe:animate-dash-rise"
          style={retard(9)}
          aria-labelledby="tdb-argent"
        >
          <h2 id="tdb-argent" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-red-500" aria-hidden="true" />
            {t('tdb.argent.titre')}
          </h2>
          <LigneArgent
            libelle={t('tdb.argent.cod')}
            montant={d?.money.codInProgress}
            aide={d ? t('tdb.argent.codAide', { n: d.money.codInProgressCount }) : undefined}
            accent="bg-amber-500"
          />
          <LigneArgent
            libelle={t('tdb.argent.bordereaux')}
            montant={netEnAttente}
            aide={t('dashboard.bordereauxEnAttente', { n: bordereauxEnAttente.length })}
            accent="bg-sky-500"
          />
          <LigneArgent libelle={t('tdb.argent.regle')} montant={netRegle} accent="bg-emerald-500" />
          <Link
            href="/expediteur/bordereaux"
            className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-semibold"
          >
            {t('dashboard.derniersBordereaux')}
            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </section>
      </div>

      {/* ============================================================ */}
      {/* Derniers colis + activité récente                            */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-2">
              <Package className="w-4 h-4 text-red-500" aria-hidden="true" />
              {t('dashboard.derniersColis')}
            </span>
          }
          action={
            <Link href="/expediteur/colis" className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium">
              {t('commun.voirTout')}
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          }
        >
          {chargement && recents.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Spinner />
            </div>
          ) : recents.length === 0 ? (
            <EmptyState
              icon={<Package className="w-8 h-8" aria-hidden="true" />}
              title={t('dashboard.aucunColisTitre')}
              description={t('dashboard.aidePremierColis')}
              action={
                <Link
                  href="/expediteur/colis/nouveau"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition"
                >
                  {t('coque.nouveauColis')}
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100 -mx-5 -mb-5">
              {recents.map((colis) => {
                const badge = voc.statutColis(colis.status);
                return (
                  <li key={colis.id}>
                    <Link
                      href={`/expediteur/colis/${colis.id}`}
                      className="group flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition"
                    >
                      <span className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0 transition group-hover:scale-110">
                        <Package className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold text-slate-900 truncate">
                          <span dir="ltr">{colis.trackingNumber}</span>
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {colis.customerName} · {colis.zoneName ?? colis.delegation ?? ''}
                          {colis.zoneName || colis.delegation ? ', ' : ''}
                          {voc.gouvernorat(colis.governorate)}
                        </p>
                      </div>
                      <div className="text-end shrink-0 space-y-1">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                          {badge.label}
                        </span>
                        <p className="font-mono text-[11px] text-slate-500">{formatTND(colis.totalPrice)}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-slate-400" aria-hidden="true" />
              {t('dashboard.activiteRecente')}
            </span>
          }
          action={
            <Link href="/expediteur/activites" className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium">
              {t('commun.voirTout')}
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          }
        >
          {notifications.length === 0 ? (
            <EmptyState
              icon={<Bell className="w-8 h-8" aria-hidden="true" />}
              title={t('dashboard.aucunEvenement')}
              description={t('dashboard.aideEvenements')}
            />
          ) : (
            <ol className="relative space-y-4 before:absolute before:top-1 before:bottom-1 before:start-[5px] before:w-px before:bg-slate-200">
              {notifications.map((n) => (
                <li key={n.id} className="relative flex gap-3">
                  <span
                    className={`relative mt-1 w-[11px] h-[11px] rounded-full ring-4 ring-white shrink-0 ${n.isRead ? 'bg-slate-300' : 'bg-red-500'}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 leading-snug">{traduireServeur(n.title)}</p>
                    <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">{traduireServeur(n.content)}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDelai(n.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* Derniers bordereaux */}
      {bordereaux.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-slate-400" aria-hidden="true" />
              {t('dashboard.derniersBordereaux')}
            </span>
          }
          action={
            <Link href="/expediteur/bordereaux" className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium">
              {t('commun.voirTout')}
              <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
            </Link>
          }
        >
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {bordereaux.slice(0, 4).map((b) => (
              <li key={b.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/60">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-bold text-amber-700">{b.voucherNumber}</p>
                  <p className="text-[11px] text-slate-500">
                    {t('bordereaux.recap.livres')} : {b.deliveredCount} · {t('bordereaux.recap.rendus')} : {b.returnedCount}
                  </p>
                </div>
                <div className="text-end shrink-0">
                  <p className="font-mono text-xs font-bold text-slate-900">{formatTND(b.netPayable)}</p>
                  <p className="text-[10px] text-slate-500">{voc.bordereau(b.status)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tuiles d'indicateurs                                                */
/* ------------------------------------------------------------------ */

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
}) {
  const { t } = useI18n();
  return (
    <Link
      href={href}
      className="group relative overflow-hidden bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 transition motion-safe:animate-dash-rise"
      style={retard(index)}
    >
      <div className={`absolute -top-10 -end-10 w-28 h-28 rounded-full bg-gradient-to-br ${teinte} opacity-[0.08] transition-transform duration-500 group-hover:scale-125`} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[11px] sm:text-xs font-semibold text-slate-500 leading-tight">{libelle}</p>
        <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${teinte} text-white flex items-center justify-center shadow-sm shrink-0`}>
          <Icone className="w-4 h-4" aria-hidden="true" />
        </span>
      </div>
      <p className="relative mt-2 text-xl sm:text-2xl font-extrabold text-slate-900 tabular-nums" dir="ltr">
        {valeur === undefined ? <span className="inline-block w-14 h-7 rounded bg-slate-100 animate-pulse" /> : <Compteur valeur={valeur} format={format} />}
      </p>
      {tendance !== undefined && (
        <p
          className={`relative mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${
            tendance === null ? 'text-sky-600' : tendance > 0 ? 'text-emerald-600' : tendance < 0 ? 'text-red-600' : 'text-slate-500'
          }`}
        >
          {tendance !== null && tendance > 0 && <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />}
          {tendance !== null && tendance < 0 && <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />}
          {tendance === null
            ? t('tdb.tendance.nouveau')
            : tendance === 0
              ? t('tdb.tendance.stable')
              : tendance > 0
                ? t('tdb.tendance.hausse', { p: tendance })
                : t('tdb.tendance.baisse', { p: Math.abs(tendance) })}
        </p>
      )}
      {aide && <p className="relative mt-1 text-[11px] text-slate-400 leading-snug">{aide}</p>}
    </Link>
  );
}

/** Taux de réussite : jauge circulaire. */
function TuileTaux({ index, donnees }: { index: number; donnees: TableauDeBordExpediteur | null }) {
  const { t } = useI18n();
  const taux = donnees?.period.successRate ?? null;
  const anime = useCompteur(taux ?? 0);
  const r = 26;
  const c = 2 * Math.PI * r;
  const couleur = taux === null ? '#cbd5e1' : taux >= 85 ? '#10b981' : taux >= 65 ? '#f59e0b' : '#ef4444';
  const total = (donnees?.period.delivered ?? 0) + (donnees?.period.failed ?? 0);
  return (
    <Link
      href="/expediteur/colis?vue=livres"
      className="group bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 transition motion-safe:animate-dash-rise flex items-center gap-3"
      style={retard(index)}
      data-testid="tdb-taux"
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
        <p className="text-[11px] sm:text-xs font-semibold text-slate-500 leading-tight">{t('tdb.kpi.tauxReussite')}</p>
        <p className="text-xl sm:text-2xl font-extrabold text-slate-900 tabular-nums" dir="ltr">
          {donnees === null ? <span className="inline-block w-12 h-7 rounded bg-slate-100 animate-pulse" /> : taux === null ? '—' : `${Math.round(anime)} %`}
        </p>
        <p className="text-[11px] text-slate-400 leading-snug">
          {taux === null ? t('tdb.kpi.tauxVide') : t('tdb.kpi.tauxAide', { livres: donnees?.period.delivered ?? 0, total })}
        </p>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Parcours                                                            */
/* ------------------------------------------------------------------ */

function Parcours({ donnees }: { donnees: TableauDeBordExpediteur | null }) {
  const { t } = useI18n();
  const max = Math.max(1, ...ETAPES.map((e) => donnees?.pipeline[e.cle] ?? 0));
  return (
    <section
      className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs motion-safe:animate-dash-rise"
      style={retard(5)}
      aria-labelledby="tdb-parcours"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 id="tdb-parcours" className="text-sm font-bold text-slate-900">
          {t('tdb.parcours.titre')}
        </h2>
        <p className="text-[11px] text-slate-500">{t('tdb.parcours.aide')}</p>
      </div>
      <ol className="relative grid grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3">
        {/* Fil qui relie les étapes (écrans larges) */}
        <div aria-hidden="true" className="hidden md:block absolute top-6 inset-x-[8%] h-0.5 bg-gradient-to-r from-slate-200 via-amber-200 to-emerald-200" />
        {ETAPES.map((e, i) => {
          const n = donnees?.pipeline[e.cle] ?? 0;
          const Icone = e.icone;
          return (
            <li key={e.cle} className="relative">
              <Link
                href={e.href}
                className="group flex flex-col items-center text-center gap-1.5 p-2 rounded-xl hover:bg-slate-50 transition"
                data-testid={`tdb-etape-${e.cle}`}
              >
                <span
                  className="relative w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-md transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-0.5"
                  style={{ backgroundColor: e.couleur }}
                >
                  <Icone className="w-5 h-5 rtl:-scale-x-100" aria-hidden="true" />
                  {n > 0 && e.cle === 'livraison' && (
                    <span className="absolute -top-1 -end-1 w-3 h-3 rounded-full bg-amber-300 ring-2 ring-white motion-safe:animate-dash-pulse" aria-hidden="true" />
                  )}
                </span>
                <span className="text-lg font-extrabold text-slate-900 tabular-nums" dir="ltr">
                  {donnees ? <Compteur valeur={n} /> : '—'}
                </span>
                <span className="text-[11px] font-semibold text-slate-600 leading-tight">{t(`tdb.etape.${e.cle}` as Cle)}</span>
                <span className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                  <span
                    className={`block h-full rounded-full ${e.trait} transition-[width] duration-700 ease-out`}
                    style={{ width: `${donnees ? Math.max(n > 0 ? 6 : 0, (n / max) * 100) : 0}%`, transitionDelay: `${i * 80}ms` }}
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
/* Graphique d'activité                                                */
/* ------------------------------------------------------------------ */

function GraphiqueActivite({
  jours,
  locale,
  chargement,
}: {
  jours: TableauDeBordExpediteur['daily'];
  locale: string;
  chargement: boolean;
}) {
  const { t } = useI18n();
  const [survol, setSurvol] = React.useState<number | null>(null);
  const [pret, setPret] = React.useState(false);
  React.useEffect(() => {
    setPret(false);
    const id = requestAnimationFrame(() => setPret(true));
    return () => cancelAnimationFrame(id);
  }, [jours.length]);

  if (chargement) {
    return <div className="h-56 rounded-xl bg-slate-50 animate-pulse" />;
  }
  const total = jours.reduce((s, j) => s + j.created + j.delivered, 0);
  if (jours.length === 0 || total === 0) {
    return (
      <div className="h-56 flex flex-col items-center justify-center gap-2 text-slate-400 rounded-xl bg-slate-50 border border-dashed border-slate-200">
        <Package className="w-7 h-7" aria-hidden="true" />
        <p className="text-xs">{t('tdb.activite.vide')}</p>
      </div>
    );
  }

  const L = 640;
  const H = 220;
  const marge = { haut: 12, bas: 26, gauche: 28, droite: 8 };
  const largeur = L - marge.gauche - marge.droite;
  const hauteur = H - marge.haut - marge.bas;
  const max = Math.max(1, ...jours.map((j) => Math.max(j.created, j.delivered)));
  const pasY = max <= 4 ? 1 : Math.ceil(max / 4);
  const plafond = pasY * Math.ceil(max / pasY);
  const colonne = largeur / jours.length;
  const barre = Math.max(2, Math.min(22, colonne * 0.55));
  const x = (i: number) => marge.gauche + colonne * i + colonne / 2;
  const y = (v: number) => marge.haut + hauteur - (v / plafond) * hauteur;
  const etiquette = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const etiquetteLongue = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const date = (s: string) => new Date(`${s}T12:00:00`);
  const chaque = Math.ceil(jours.length / 7);
  const ligne = jours.map((j, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(j.delivered).toFixed(1)}`).join(' ');
  const aire = `${ligne} L${x(jours.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const j = survol !== null ? jours[survol] : null;

  return (
    <div className="relative" dir="ltr">
      <div className="flex items-center gap-4 mb-2 text-[11px] text-slate-500" dir="auto">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-800" /> {t('tdb.activite.crees')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 rounded bg-emerald-500" /> {t('tdb.activite.livres')}
        </span>
      </div>
      <svg viewBox={`0 0 ${L} ${H}`} className="w-full h-56 select-none" role="img" aria-label={t('tdb.activite.titre')} onMouseLeave={() => setSurvol(null)}>
        <defs>
          <linearGradient id="tdb-aire" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grille */}
        {Array.from({ length: plafond / pasY + 1 }, (_, k) => k * pasY).map((v) => (
          <g key={v}>
            <line x1={marge.gauche} x2={L - marge.droite} y1={y(v)} y2={y(v)} stroke="#f1f5f9" />
            <text x={marge.gauche - 6} y={y(v) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {v}
            </text>
          </g>
        ))}
        {/* Barres : colis créés */}
        {jours.map((jour, i) => {
          const h = (jour.created / plafond) * hauteur;
          return (
            <rect
              key={jour.date}
              x={x(i) - barre / 2}
              y={pret ? y(jour.created) : y(0)}
              width={barre}
              height={pret ? h : 0}
              rx={Math.min(4, barre / 3)}
              className={`transition-all duration-700 ease-out ${survol === i ? 'fill-red-600' : 'fill-slate-800'}`}
              style={{ transitionDelay: `${Math.min(i * 18, 500)}ms` }}
            />
          );
        })}
        {/* Aire et courbe : colis livrés */}
        <path d={aire} fill="url(#tdb-aire)" className={`transition-opacity duration-700 ${pret ? 'opacity-100' : 'opacity-0'}`} />
        <path
          d={ligne}
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
        {jours.map((jour, i) =>
          jour.delivered > 0 || survol === i ? (
            <circle key={`p${jour.date}`} cx={x(i)} cy={y(jour.delivered)} r={survol === i ? 4.5 : 2.5} fill="#fff" stroke="#10b981" strokeWidth="2" />
          ) : null
        )}
        {/* Axe des dates */}
        {jours.map((jour, i) =>
          i % chaque === 0 || i === jours.length - 1 ? (
            <text key={`t${jour.date}`} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {etiquette.format(date(jour.date))}
            </text>
          ) : null
        )}
        {/* Zones de survol (souris, toucher, clavier) */}
        {jours.map((jour, i) => (
          <rect
            key={`h${jour.date}`}
            x={marge.gauche + colonne * i}
            y={marge.haut}
            width={colonne}
            height={hauteur}
            fill={survol === i ? 'rgba(15,23,42,0.04)' : 'transparent'}
            onMouseEnter={() => setSurvol(i)}
            onTouchStart={() => setSurvol(i)}
            onFocus={() => setSurvol(i)}
            onBlur={() => setSurvol(null)}
            tabIndex={0}
            aria-label={`${etiquetteLongue.format(date(jour.date))} : ${jour.created} ${t('tdb.activite.crees')}, ${jour.delivered} ${t('tdb.activite.livres')}`}
          />
        ))}
      </svg>
      {j && survol !== null && (
        <div
          className="pointer-events-none absolute top-6 z-10 -translate-x-1/2 rounded-lg bg-slate-900 text-white px-3 py-2 shadow-lg text-[11px] whitespace-nowrap"
          style={{ left: `${Math.min(88, Math.max(12, (x(survol) / L) * 100))}%` }}
          dir="auto"
        >
          <p className="font-semibold">{etiquetteLongue.format(date(j.date))}</p>
          <p className="text-white/80">
            {t('tdb.activite.crees')} : <b>{j.created}</b> · {t('tdb.activite.livres')} : <b className="text-emerald-300">{j.delivered}</b>
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Répartition (anneau)                                                */
/* ------------------------------------------------------------------ */

function Repartition({ donnees }: { donnees: TableauDeBordExpediteur | null }) {
  const { t } = useI18n();
  const [actif, setActif] = React.useState<CleEtape | null>(null);
  const segments = ETAPES.map((e) => ({ ...e, n: donnees?.pipeline[e.cle] ?? 0 }));
  const total = segments.reduce((s, e) => s + e.n, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let cumul = 0;
  const courant = actif ? segments.find((s) => s.cle === actif) : null;
  return (
    <section
      className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs motion-safe:animate-dash-rise"
      style={retard(7)}
      aria-labelledby="tdb-repartition"
    >
      <h2 id="tdb-repartition" className="text-sm font-bold text-slate-900 mb-3">
        {t('tdb.repartition.titre')}
      </h2>
      <div className="flex flex-col sm:flex-row lg:flex-col items-center gap-4">
        <div className="relative w-40 h-40 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="12" />
            {total > 0 &&
              segments.map((s) => {
                if (s.n === 0) return null;
                const part = (s.n / total) * c;
                const decalage = -cumul;
                cumul += part;
                return (
                  <circle
                    key={s.cle}
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    stroke={s.couleur}
                    strokeWidth={actif === s.cle ? 15 : 12}
                    strokeDasharray={`${Math.max(0, part - 0.8)} ${c}`}
                    strokeDashoffset={decalage}
                    className="transition-all duration-300 cursor-pointer"
                    style={{ opacity: actif && actif !== s.cle ? 0.35 : 1 }}
                    onMouseEnter={() => setActif(s.cle)}
                    onMouseLeave={() => setActif(null)}
                  />
                );
              })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums" dir="ltr">
              {donnees ? <Compteur valeur={courant ? courant.n : total} /> : '—'}
            </span>
            <span className="text-[10px] text-slate-500 max-w-[80px] leading-tight">
              {courant ? t(`tdb.etape.${courant.cle}` as Cle) : t('tdb.repartition.total')}
            </span>
          </div>
        </div>
        <ul className="w-full grid grid-cols-2 gap-1.5">
          {segments.map((s) => (
            <li key={s.cle}>
              <Link
                href={s.href}
                onMouseEnter={() => setActif(s.cle)}
                onMouseLeave={() => setActif(null)}
                onFocus={() => setActif(s.cle)}
                onBlur={() => setActif(null)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] transition ${actif === s.cle ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.couleur }} />
                <span className="flex-1 truncate text-slate-600">{t(`tdb.etape.${s.cle}` as Cle)}</span>
                <span className="font-bold text-slate-900 tabular-nums">{total ? Math.round((s.n / total) * 100) : 0}%</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Destinations                                                        */
/* ------------------------------------------------------------------ */

function Destinations({ donnees }: { donnees: TableauDeBordExpediteur | null }) {
  const { t } = useI18n();
  const voc = useVocabulaire();
  const zones = donnees?.zones ?? [];
  const max = Math.max(1, ...zones.map((z) => z.total));
  return (
    <section
      className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs motion-safe:animate-dash-rise"
      style={retard(8)}
      aria-labelledby="tdb-zones"
    >
      <div className="mb-3">
        <h2 id="tdb-zones" className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-red-500" aria-hidden="true" />
          {t('tdb.zones.titre')}
        </h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{t('tdb.zones.aide')}</p>
      </div>
      {donnees === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-slate-50 animate-pulse" />
          ))}
        </div>
      ) : zones.length === 0 ? (
        <p className="text-xs text-slate-400 py-6 text-center">{t('tdb.zones.vide')}</p>
      ) : (
        <ul className="space-y-2.5" data-testid="tdb-zones">
          {zones.map((z, i) => (
            <li key={`${z.zoneId ?? z.name}-${i}`}>
              <Link
                href={`/expediteur/colis?ville=${encodeURIComponent(z.governorate)}`}
                className="group block p-2 -m-2 rounded-xl hover:bg-slate-50 transition"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-slate-800 truncate">
                    {z.name}
                    {z.name !== z.governorate && <span className="font-normal text-slate-400"> · {voc.gouvernorat(z.governorate)}</span>}
                  </p>
                  <p className="text-xs font-bold text-slate-900 tabular-nums shrink-0">{z.total}</p>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden flex" aria-hidden="true">
                  <span
                    className="h-full bg-emerald-500 transition-[width] duration-700 ease-out"
                    style={{ width: `${(z.delivered / max) * 100}%`, transitionDelay: `${i * 90}ms` }}
                  />
                  <span
                    className="h-full bg-amber-400 transition-[width] duration-700 ease-out"
                    style={{ width: `${(z.active / max) * 100}%`, transitionDelay: `${i * 90 + 120}ms` }}
                  />
                  <span
                    className="h-full bg-slate-300 transition-[width] duration-700 ease-out"
                    style={{ width: `${(Math.max(0, z.total - z.delivered - z.active) / max) * 100}%`, transitionDelay: `${i * 90 + 200}ms` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">{t('tdb.zones.detail', { livres: z.delivered, actifs: z.active })}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LigneArgent({
  libelle,
  montant,
  aide,
  accent,
}: {
  libelle: string;
  montant: number | undefined;
  aide?: string;
  accent: string;
}) {
  const { formatTND } = useI18n();
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
      <span className={`mt-1 w-1.5 h-8 rounded-full ${accent} shrink-0`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-slate-500">{libelle}</p>
        <p className="text-base font-extrabold text-slate-900 tabular-nums" dir="ltr">
          {montant === undefined ? '—' : <Compteur valeur={montant} format={(v) => formatTND(v)} />}
        </p>
        {aide && <p className="text-[10px] text-slate-400">{aide}</p>}
      </div>
    </div>
  );
}
