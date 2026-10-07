'use client';

/**
 * Activités : ce qui s'est passé sur un colis.
 *
 * L'API n'a pas de journal global pour un expéditeur. `GET /audit` est un outil
 * d'exploitation, et `GET /colis/:id/audit` est le seul journal que l'expéditeur
 * peut lire. L'écran ne pretend donc pas être une frise temporelle de l'entreprise :
 * il demande d'abord quel colis on regarde, puis restitue son journal.
 *
 * Deux conséquences assumées :
 *
 * - le journal est borné à 50 entrées côté serveur, et l'écran le dit quand il
 *   atteint cette limite, plutôt que de laisser croire à un historique complet ;
 * - chaque entrée porte son auteur et son rôle. C'est l'information qui manque
 *   le plus souvent quand un client conteste une livraison, et l'API la fournit
 *   déjà formatée.
 *
 * ## Langue
 *
 * Seuls les intitulés sont traduits : le libellé d'action, l'auteur, le motif et
 * les valeurs d'avant/après viennent du serveur et sont affichés tels quels. Un
 * journal d'audit se lit par opposition avec l'état du colis, pas par rapport à
 * une langue : traduire sa moitié éditrice laisserait un journal qui ne parle
 * plus du même audit.
 */

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, ExternalLink, Search } from 'lucide-react';
import type { AuditEntry } from '@/lib/api';
import {
  Card,
  ChargementEnCours,
  EmptyState,
  ErrorBanner,
  Input,
  useDifferee,
} from '@logixpress/ui';
import { lireAuditColis, lireColis, listerColis } from '@/features/expediteur/lib/client';
import { useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n, type I18n } from '@/i18n';

/** Limite appliquée par l'API. Au-delà, l'historique n'est pas dans la réponse. */
const LIMITE_SERVEUR = 50;

export function VueActivites() {
  const { t, formatDateTime } = useI18n();
  const voc = useVocabulaire();
  const params = useSearchParams();

  const [colisId, setColisId] = React.useState(params.get('colis') ?? '');
  const [colisChoisi, setColisChoisi] = React.useState<{ id: string; suivi: string } | null>(null);
  const [terme, setTerme] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<
    Array<{ id: string; trackingNumber: string; customerName: string; governorate: string; status: string }>
  >([]);
  const [cherche, setCherche] = React.useState(false);

  const [entrees, setEntrees] = React.useState<AuditEntry[] | null>(null);
  const [chargement, setChargement] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const termeDiffere = useDifferee(terme.trim(), 350);
  /** Colis dont l'en-tête a déjà été résolu, pour ne pas le refaire à chaque effet. */
  const enTeteRef = React.useRef(new Set<string>());

  /*
   * Un colis déjà identifié dans l'URL est chargé sans nouvelle recherche.
   *
   * Le journal ne porte que des identifiants d'entité : sans lire la fiche, un
   * lien profond afficherait une liste d'événements sans jamais dire de quel
   * colis ils sont. D'où la seconde requête, faite seulement à l'arrivee par
   * lien — le cas courant, lui, choisit le colis et connaît déjà son numéro.
   */
  React.useEffect(() => {
    if (!colisId) return;
    let annule = false;
    setChargement(true);
    setErreur(null);

    lireAuditColis(colisId)
      .then((liste) => {
        if (annule) return;
        setEntrees(liste);
      })
      .catch((err: unknown) => {
        if (annule) return;
        setEntrees(null);
        setErreur(err instanceof Error ? err.message : t('activites.erreur'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    if (!enTeteRef.current.has(colisId)) {
      enTeteRef.current.add(colisId);
      lireColis(colisId)
        .then((colis) => {
          if (!annule) setColisChoisi({ id: colis.id, suivi: colis.trackingNumber });
        })
        .catch(() => {
          // Le journal reste affichable sans l'en-tête : l'échec de cette lecture
          // ne doit pas masquer le contenu déjà chargé.
        });
    }

    return () => {
      annule = true;
    };
  }, [colisId]);

  React.useEffect(() => {
    if (termeDiffere.length < 2) {
      setSuggestions([]);
      setCherche(false);
      return;
    }
    let annule = false;
    listerColis({ search: termeDiffere, limit: 8 })
      .then((reponse) => {
        if (annule) return;
        setSuggestions(reponse.colis);
        setCherche(true);
      })
      .catch(() => {
        if (!annule) setSuggestions([]);
      });
    return () => {
      annule = true;
    };
  }, [termeDiffere]);

  /*
   * Intitulé du journal sans le numéro : le numéro de suivi garde ainsi sa
   * propre direction d'écriture et son emphase, au lieu d'être noyé dans le
   * texte traduit.
   */
  const prefixeJournal = t('activites.journalDe', { suivi: '' });

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('activites.titre')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('activites.sous-titre')}</p>
      </div>

      <Card>
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-col sm:flex-row gap-2"
          role="search"
        >
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={terme}
              onChange={(e) => setTerme(e.target.value)}
              placeholder={t('activites.rechercherAide')}
              aria-label={t('activites.rechercher')}
              className="ps-9"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-sm font-semibold transition cursor-pointer shrink-0"
          >
            {t('activites.bouton')}
          </button>
        </form>

        {cherche && suggestions.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
            {suggestions.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setColisChoisi({ id: c.id, suivi: c.trackingNumber });
                    setColisId(c.id);
                    setSuggestions([]);
                    setTerme('');
                  }}
                  className="w-full text-start px-1 py-2 hover:bg-slate-50 transition cursor-pointer flex items-center justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs font-bold text-red-600 block">
                      <span dir="ltr">{c.trackingNumber}</span>
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {c.customerName} · {voc.gouvernorat(c.governorate)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                    {voc.statutColis(c.status).label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {cherche && suggestions.length === 0 && (
          <p className="text-[11px] text-slate-400 mt-2 border-t border-slate-100 pt-2">
            {t('activites.aucunColis', { terme: termeDiffere })}
          </p>
        )}
      </Card>

      {colisChoisi && (
        <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-md px-3 py-2">
          <p className="text-xs text-slate-600">
            {prefixeJournal}
            <span dir="ltr" className="font-mono font-bold text-red-600">
              {colisChoisi.suivi}
            </span>
          </p>
          <Link
            href={`/expediteur/colis/${colisChoisi.id}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700"
          >
            {t('activites.ouvrirFiche')}
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </Link>
        </div>
      )}

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      {chargement && <ChargementEnCours message={t('activites.chargement')} />}

      {!chargement && entrees === null && !erreur && (
        <EmptyState
          icon={<ClipboardList className="w-8 h-8" aria-hidden="true" />}
          title={t('activites.choisirColis')}
          description={t('activites.choisirColisAide')}
        />
      )}

      {!chargement && entrees !== null && entrees.length === 0 && (
        <EmptyState
          icon={<ClipboardList className="w-8 h-8" aria-hidden="true" />}
          title={t('activites.aucuneActivite')}
          description={t('activites.aucuneActiviteDescription')}
        />
      )}

      {!chargement && entrees !== null && entrees.length > 0 && (
        <>
          <ol className="space-y-2">
            {entrees.map((entree) => (
              <li key={entree.id} className="bg-white border border-slate-200 rounded-md p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {entree.actionLabel}
                      {entree.critical && (
                        <span className="ms-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
                          {t('activites.engagement')}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {entree.userName ?? 'Système'} · {entree.userRole ?? t('commun.inconnu')}
                    </p>
                  </div>
                  <time className="text-[11px] text-slate-400 font-mono shrink-0">
                    {formatDateTime(entree.timestamp)}
                  </time>
                </div>

                {entree.missingReason && (
                  <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    {t('activites.motifManquant')}
                  </p>
                )}

                {entree.reason && (
                  <p className="mt-2 text-xs text-slate-700">
                    <span className="text-slate-400">{t('colis.detail.motif')} : </span>
                    {entree.reason}
                  </p>
                )}

                <details className="mt-2 group">
                  <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700 select-none">
                    {t('activites.valeursAvantApres')}
                  </summary>
                  <Valeurs avant={entree.previousValues} apres={entree.newValues} />
                </details>
              </li>
            ))}
          </ol>

          {entrees.length >= LIMITE_SERVEUR && (
            <p className="text-[11px] text-slate-400">
              {t('activites.plafond', { n: LIMITE_SERVEUR })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Snapshot avant/après, rendu en paires lisibles plutôt qu'en JSON brut. */
function Valeurs({ avant, apres }: { avant: unknown; apres: unknown }) {
  const { t } = useI18n();
  const ancien = instantane(avant);
  const nouveau = instantane(apres);
  const cles = [...new Set([...Object.keys(ancien), ...Object.keys(nouveau)])];

  if (cles.length === 0) {
    return <p className="text-[11px] text-slate-400 mt-1">{t('activites.aucuneValeur')}</p>;
  }

  return (
    <dl className="mt-1.5 space-y-1">
      {cles.map((cle) => (
        <div key={cle} className="flex flex-wrap items-baseline gap-2 text-[11px]">
          <dt className="text-slate-500 min-w-28">{cle}</dt>
          <dd className="font-mono text-slate-500 line-through decoration-slate-300">
            {rendre(ancien[cle], t)}
          </dd>
          {/* En arabe, « avant » est à droite et « après » à gauche : la flèche
              doit donc pointer vers la fin de la ligne. */}
          <span className="text-slate-300 rtl:rotate-180">→</span>
          <dd className="font-mono font-semibold text-slate-800">{rendre(nouveau[cle], t)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** `previousValues` peut être un objet, une chaîne JSON, ou absent. */
function instantane(valeur: unknown): Record<string, unknown> {
  if (!valeur) return {};
  if (typeof valeur === 'object') return valeur as Record<string, unknown>;
  if (typeof valeur === 'string') {
    try {
      const lu = JSON.parse(valeur);
      return lu && typeof lu === 'object' ? (lu as Record<string, unknown>) : { valeur: lu };
    } catch {
      return { valeur };
    }
  }
  return { valeur };
}

function rendre(valeur: unknown, t: I18n['t']): string {
  if (valeur === null || valeur === undefined || valeur === '') return t('commun.inconnu');
  if (typeof valeur === 'boolean') return valeur ? t('commun.oui') : t('commun.non');
  if (typeof valeur === 'object') return JSON.stringify(valeur);
  return String(valeur);
}
