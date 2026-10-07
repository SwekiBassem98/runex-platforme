'use client';

/**
 * Tableau de bord expéditeur.
 *
 * Le principe : répondre à « qu'est-ce qu'il arrive à mes colis ? » avant toute
 * autre chose. Les compteurs sont lus sur le serveur — `GET /colis` avec un
 * filtre de statut et `meta.total` — jamais calculés sur une liste tronquée ni
 * écrits en dur.
 *
 * Chaque compteur est demandé séparément, en parallèle, avec `limit: 1`. C'est
 * sept requêtes minuscules plutôt qu'une liste de deux cents colis dont on
 * compterait les statuts : compter sur une page tronquée afficherait des
 * totaux faux avec l'air exact, ce qui est le pire des deux mondes.
 *
 * ## Langue
 *
 * Les intitulés viennent du dictionnaire, et les valeurs de domaine — statuts,
 * gouvernorats, statut de bordereau — du vocabulaire lié à la langue courante.
 * Les cartes d'étape ne portent plus qu'une clé, celle d'`ETAPES_COLIS` : le
 * libellé et son texte d'aide sont traduits au moment du rendu.
 */

import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  ClipboardList,
  Package,
  PlusCircle,
  RefreshCw,
  Search,
  Truck,
  Wallet,
} from 'lucide-react';
import {
  type NotificationDto,
  type PackageDto,
  type PaymentVoucherDto,
} from '@logixpress/types';
import {
  Card,
  EmptyState,
  ErrorBanner,
  MetricCard,
  Spinner,
} from '@logixpress/ui';
import { useAuth } from '@/lib/auth';
import {
  compterColis,
  listerBordereaux,
  listerColis,
  notificationsApi,
} from '@/features/expediteur/lib/client';
import {
  ETAPES_COLIS,
  STATUTS_RETOUR,
  useVocabulaire,
} from '@/features/expediteur/lib/libelles';
import { useI18n } from '@/i18n';

type Compteurs = Record<string, number | null>;

export function VueTableauDeBord() {
  const { t, formatDelai, formatTND } = useI18n();
  const voc = useVocabulaire();
  const { user } = useAuth();

  const [compteurs, setCompteurs] = React.useState<Compteurs>({});
  const [total, setTotal] = React.useState<number | null>(null);
  const [recents, setRecents] = React.useState<PackageDto[]>([]);
  const [bordereaux, setBordereaux] = React.useState<PaymentVoucherDto[]>([]);
  const [notifications, setNotifications] = React.useState<NotificationDto[]>([]);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [terme, setTerme] = React.useState('');

  const charger = React.useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      /*
       * Chaque compteur est une requête distincte, et toutes partent ensemble.
       * `allSettled` évite qu'une seule réponse manquante vide le tableau de
       * bord entier : une carte à « — » signale une information absente, ce qui
       * n'est pas la même chose qu'une panne.
       */
      const [totalR, etapesR, retourR, recentsR, bordereauxR, notifsR] = await Promise.allSettled([
        compterColis({}),
        Promise.all(ETAPES_COLIS.map((e) => compterColis({ status: e.statuts[0] }))),
        Promise.all(STATUTS_RETOUR.map((statut) => compterColis({ status: statut }))),
        listerColis({ limit: 6 }),
        listerBordereaux(),
        notificationsApi.list({ limit: 6 }),
      ]);

      if (totalR.status === 'fulfilled') setTotal(totalR.value);
      else setTotal(null);

      if (etapesR.status === 'fulfilled') {
        const parCle: Compteurs = {};
        ETAPES_COLIS.forEach((e, i) => {
          parCle[e.cle] = etapesR.value[i];
        });
        setCompteurs(parCle);
      }

      // Un colis qui revient est compté une fois, quel que soit le stade.
      if (retourR.status === 'fulfilled') {
        setCompteurs((c) => ({
          ...c,
          retour: retourR.value.reduce((somme, v) => somme + v, 0),
        }));
      }

      if (recentsR.status === 'fulfilled') setRecents(recentsR.value.colis);
      if (bordereauxR.status === 'fulfilled') setBordereaux(bordereauxR.value);
      if (notifsR.status === 'fulfilled') setNotifications(notifsR.value.items);

      if (totalR.status === 'rejected' && recentsR.status === 'rejected') {
        setErreur(
          recentsR.reason instanceof Error
            ? recentsR.reason.message
            : t('colis.liste.erreur')
        );
      }
    } finally {
      setChargement(false);
    }
  }, []);

  React.useEffect(() => {
    void charger();
  }, [charger]);

  const nom = user?.shipperName ?? user?.fullName ?? t('dashboard.votreEntreprise');

  /* --- Montants réellement connus ------------------------------------- */
  /*
   * « Non encaissé » se calcule sur ce que le serveur renvoie : le montant
   * attendu moins ce que le livreur a déjà constaté. Aucune de ces deux
   * colonnes n'est inventée — `collectedAmount` vient de la même fiche que le
   * statut, lus au même instant.
   *
   * Cette somme porte sur les colis affichés, pas sur tout le parc : le
   * serveur ne permet pas d'agréger les montants. Le libellé le dit, pour que
   * le chiffre ne soit pas lu comme un solde de trésorerie.
   */
  const aEncaisser = recents.reduce((somme, c) => somme + Number(c.totalPrice ?? 0), 0);
  const encaisse = recents.reduce((somme, c) => somme + Number(c.collectedAmount ?? 0), 0);

  const bordereauxEnAttente = bordereaux.filter((b) => b.status !== 'PAYE' && b.status !== 'ANNULE');
  const netAPercevoir = bordereaux
    .filter((b) => b.status === 'PAYE')
    .reduce((somme, b) => somme + Number(b.netPayable ?? 0), 0);
  const netEnAttente = bordereauxEnAttente.reduce((somme, b) => somme + Number(b.netPayable ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Bandeau d'accueil et actions */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">{t('dashboard.bonjour', { nom })}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('dashboard.sous-titre')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void charger()}
            aria-label={t('notifications.actualiser')}
            className="p-2 bg-white border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${chargement ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <Link
            href="/expediteur/colis/nouveau"
            className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-semibold shadow-xs transition"
          >
            <PlusCircle className="w-4 h-4" aria-hidden="true" />
            {t('coque.nouveauColis')}
          </Link>
        </div>
      </div>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      {/* Recherche rapide */}
      {/*
        * C'est l'équivalent de la « Recherche rapide » de l'ancien portail :
        * une référence, un code-barres, un nom ou un numéro. Elle mène à la
        * page de suivi, qui interroge `GET /colis?search=` — donc le périmètre
        * reste celui du jeton, et la recherche ne peut pas déborder sur un
        * autre expéditeur.
        */}
      <Card>
        <form
          action="/expediteur/suivi"
          className="flex flex-col sm:flex-row gap-2"
          role="search"
        >
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              name="q"
              defaultValue={terme}
              placeholder={t('dashboard.rechercherAide')}
              aria-label={t('dashboard.rechercher')}
              className="w-full ps-9 pe-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-sm font-semibold transition cursor-pointer shrink-0"
          >
            {t('suivi.bouton')}
          </button>
        </form>
      </Card>

      {/* Compteurs de colis */}
      <section aria-labelledby="titre-etat" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="titre-etat" className="text-sm font-bold text-slate-900">
            {t('dashboard.etatColis')}
          </h2>
          {total !== null && (
            <span className="text-xs text-slate-500">
              {t('colis.liste.compte', { n: total })}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {ETAPES_COLIS.map((e) => (
            <Link
              key={e.cle}
              href={`/expediteur/colis?vue=${e.statuts[0]}`}
              className="group"
            >
              <Card className="h-full hover:border-red-300 transition">
                <MetricCard
                  title={voc.etape(e.cle)}
                  value={compteurs[e.cle] ?? '—'}
                  description={voc.etape(`${e.cle}.aide`)}
                />
              </Card>
            </Link>
          ))}

          <Link href="/expediteur/retours" className="group">
            <Card className="h-full hover:border-red-300 transition">
              <MetricCard
                title={t('colis.liste.categorie.retours')}
                value={compteurs.retour ?? '—'}
                description={t('retours.sous-titre.revenus')}
              />
            </Card>
          </Link>
        </div>
      </section>

      {/* Montants */}
      <section aria-labelledby="titre-montants">
        <h2 id="titre-montants" className="text-sm font-bold text-slate-900 mb-3">
          {t('dashboard.montantsEncaisser')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <MetricCard
              title={t('dashboard.aEncaisser')}
              value={formatTND(Math.max(aEncaisser - encaisse, 0))}
              description={t('dashboard.porteeCompteurs', { n: recents.length })}
              icon={<Wallet className="w-5 h-5 text-slate-400" aria-hidden="true" />}
            />
          </Card>
          <Card>
            <MetricCard
              title={t('dashboard.dejaEncaisse')}
              value={formatTND(encaisse)}
              description={t('dashboard.aideMontants')}
              icon={<Truck className="w-5 h-5 text-emerald-500" aria-hidden="true" />}
            />
          </Card>
          <Card>
            <MetricCard
              title={t('dashboard.bordereauxARegler')}
              value={formatTND(netEnAttente)}
              description={t('dashboard.bordereauxEnAttente', { n: bordereauxEnAttente.length })}
              icon={<ClipboardList className="w-5 h-5 text-amber-500" aria-hidden="true" />}
            />
          </Card>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          {t('dashboard.dejaRegle', { montant: formatTND(netAPercevoir) })}
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Derniers colis */}
        <Card
          className="lg:col-span-2"
          title={
            <span className="flex items-center gap-2">
              <Package className="w-4 h-4 text-red-500" aria-hidden="true" />
              {t('dashboard.derniersColis')}
            </span>
          }
          action={
            <Link
              href="/expediteur/colis"
              className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
            >
              {t('commun.voirTout')}
              {/* En arabe, la flèche doit suivre le sens de lecture du texte
                  qu'elle annonce : elle se retourne avec la page. */}
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
                      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold text-red-600 truncate">
                          <span dir="ltr">{colis.trackingNumber}</span>
                        </p>
                        <p className="text-xs text-slate-600 truncate">
                          {colis.customerName} · {voc.gouvernorat(colis.governorate)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {badge.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Activité récente */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-slate-400" aria-hidden="true" />
              {t('dashboard.activiteRecente')}
            </span>
          }
          action={
            <Link
              href="/expediteur/activites"
              className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
            >
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
            <ul className="space-y-3">
              {notifications.map((n) => (
                <li key={n.id} className="flex gap-2.5">
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                      n.isRead ? 'bg-slate-200' : 'bg-red-500'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 leading-snug">{n.title}</p>
                    <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">{n.content}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatDelai(n.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Bordereaux */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-slate-400" aria-hidden="true" />
            {t('dashboard.derniersBordereaux')}
          </span>
        }
        action={
          <Link
            href="/expediteur/profil#bordereaux"
            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
          >
            {t('commun.voirTout')}
            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        }
      >
        {bordereaux.length === 0 ? (
          <EmptyState
            title={t('dashboard.aucunBordereau')}
            description={t('dashboard.aideBordereaux')}
          />
        ) : (
          <ul className="divide-y divide-slate-100 -mx-5 -mb-5">
            {bordereaux.slice(0, 4).map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-bold text-amber-700">{b.voucherNumber}</p>
                  <p className="text-[11px] text-slate-500">
                    {t('bordereaux.recap.livres')} : {b.deliveredCount} ·{' '}
                    {t('bordereaux.recap.rendus')} : {b.returnedCount}
                  </p>
                </div>
                <div className="text-end shrink-0">
                  <p className="font-mono text-xs font-bold text-slate-900">
                    {formatTND(b.netPayable)}
                  </p>
                  <p className="text-[10px] text-slate-500">{voc.bordereau(b.status)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[11px] text-slate-400">{t('dashboard.aideCompteurs')}</p>
    </div>
  );
}
