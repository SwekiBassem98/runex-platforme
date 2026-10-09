'use client';

/**
 * Suivi d'un colis.
 *
 * C'est l'équivalent de la « Recherche rapide » de l'ancien portail : on donne
 * une référence, un code-barres, un nom ou un numéro, et on obtient
 * l'historique complet. La recherche s'appuie sur `GET /colis?search=`, dont
 * le prédicat tourne sur le périmètre du jeton : elle peut donc trouver n'importe
 * quel colis de l'entreprise, et rien d'autre.
 *
 * `GET /colis` ne distingue pas une recherche exacte d'une recherche par
 * fragment. L'écran ne prétend donc pas avoir trouvé « le » colis : il affiche
 * les correspondances et laisse le choix quand elles sont plusieurs.
 *
 * ## Langue
 *
 * Tous les mots affichés viennent du dictionnaire, les statuts du vocabulaire
 * lié à la langue courante. Le terme saisi par l'utilisateur, les numéros de
 * suivi et de code-barres restent des données : ils sont rendus en `dir="ltr"`
 * pour rester lisibles dans une phrase arabe.
 */

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, PackageSearch, Search } from 'lucide-react';
import type { PackageDto } from '@logixpress/types';
import { Card, EmptyState, Spinner, useDifferee } from '@logixpress/ui';
import { listerColis } from '@/features/expediteur/lib/client';
import { useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n } from '@/i18n';

export function VueSuivi() {
  const { t, formatDateTime, formatTND, traduireServeur } = useI18n();
  const voc = useVocabulaire();
  const params = useSearchParams();
  const initial = params.get('q') ?? '';

  const [terme, setTerme] = React.useState(initial);
  const [recherche, setRecherche] = React.useState(initial);
  const [resultats, setResultats] = React.useState<PackageDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [chargement, setChargement] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [cherche, setCherche] = React.useState(false);

  const rechercheAppliquee = useDifferee(recherche.trim(), 400);

  React.useEffect(() => {
    if (rechercheAppliquee.length < 2) {
      setResultats([]);
      setTotal(0);
      setCherche(false);
      return;
    }

    let annule = false;
    setChargement(true);
    setErreur(null);

    listerColis({ search: rechercheAppliquee, limit: 25 })
      .then((reponse) => {
        if (annule) return;
        setResultats(reponse.colis);
        setTotal(reponse.total);
        setCherche(true);
      })
      .catch((err: unknown) => {
        if (annule) return;
        setResultats([]);
        setTotal(0);
        setErreur(err instanceof Error ? err.message : t('suivi.erreur'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    return () => {
      annule = true;
    };
  }, [rechercheAppliquee, t]);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('suivi.titre')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('suivi.sous-titre')}</p>
      </div>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRecherche(terme.trim());
          }}
          className="flex flex-col sm:flex-row gap-2"
          role="search"
        >
          <div className="relative flex-1">
            {/* La loupe suit le début de la ligne de saisie, quel que soit le
                sens de lecture. */}
            <Search
              className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={terme}
              onChange={(e) => setTerme(e.target.value)}
              placeholder={t('suivi.termeAide')}
              aria-label={t('suivi.terme')}
              className="w-full ps-9 pe-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
            />
          </div>
          <button
            type="submit"
            disabled={chargement}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-md text-sm font-semibold transition cursor-pointer shrink-0"
          >
            {chargement && <Spinner size="sm" className="text-white" />}
            {t('suivi.bouton')}
          </button>
        </form>
        <p className="text-[11px] text-slate-400 mt-2">{t('suivi.aidePortee')}</p>
      </Card>

      {erreur && (
        <p className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {erreur}
        </p>
      )}

      {!cherche && !chargement && (
        <EmptyState
          icon={<PackageSearch className="w-8 h-8" aria-hidden="true" />}
          title={t('suivi.videTitre')}
          description={t('suivi.videDescription')}
        />
      )}

      {cherche && !chargement && resultats.length === 0 && (
        <EmptyState
          icon={<PackageSearch className="w-8 h-8" aria-hidden="true" />}
          title={t('suivi.aucunResultat')}
          description={t('suivi.aucunResultatDetail', { terme: rechercheAppliquee })}
          action={
            <Link
              href="/expediteur/colis"
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition"
            >
              {t('suivi.parcourir')}
            </Link>
          }
        />
      )}

      {chargement && (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Spinner />
        </div>
      )}

      {!chargement && resultats.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            {t('suivi.correspondances', { n: total })} —{' '}
            {t('colis.liste.tri.recent')}
          </p>

          {resultats.map((colis) => {
            const badge = voc.statutColis(colis.status);
            const evenements = colis.trackingTimeline ?? [];
            return (
              <Card key={colis.id}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    {/* Numéro de suivi et code-barres : des identifiants, ils se
                        lisent de gauche à droite même au milieu d'un texte arabe. */}
                    <p className="font-mono text-sm font-bold text-red-600" dir="ltr">
                      {colis.trackingNumber}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {colis.customerName} · {voc.gouvernorat(colis.governorate)}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                      <span dir="ltr">{colis.barcode}</span> · {formatTND(colis.totalPrice)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                  >
                    {badge.label}
                  </span>
                </div>

                {/*
                  * La chronologie est déjà dans la réponse de la liste : aller
                  * chercher un second appel par colis n'apporterait rien et
                  * multiplierait les requêtes par le nombre de résultats.
                  */}
                {evenements.length > 0 && (
                  <ol className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                    {evenements.slice(0, 3).map((evenement, index) => (
                      <li key={`${evenement.timestamp}-${index}`} className="flex items-baseline gap-2 text-xs">
                        <span className="font-medium text-slate-800 shrink-0">
                          {evenement.label ? traduireServeur(evenement.label) : voc.statutColis(evenement.status).label}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500 font-mono text-[11px]">
                          {formatDateTime(evenement.timestamp)}
                        </span>
                      </li>
                    ))}
                    {evenements.length > 3 && (
                      <li className="text-[11px] text-slate-400">
                        {t('suivi.autresEvenements', { n: evenements.length - 3 })}
                      </li>
                    )}
                  </ol>
                )}

                <Link
                  href={`/expediteur/colis/${colis.id}`}
                  className="inline-flex items-center gap-1 mt-3 text-xs font-semibold text-red-600 hover:text-red-700"
                >
                  {t('commun.ouvrirFiche')}
                  {/* En arabe, la flèche suit le sens de lecture du texte. */}
                  <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}