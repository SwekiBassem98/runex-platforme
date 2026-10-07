'use client';

/**
 * RAPPORTS D'EXPLOITATION — cinq lectures de la même période.
 *
 * Un rapport n'est utile que s'il répond à une question qu'on se pose vraiment :
 * est-ce que le flux suit, qui fait des colis, qui livre bien, où est l'argent,
 * où est le stock. L'écran est découpé en cinq onglets, un par question, plutôt
 * qu'en une page unique de quinze sections — personne ne lit un mur.
 *
 * **La période est le paramètre qui compte.** Tous les chiffres sont bornés par
 * deux dates, et les bornes appliquées sont rappelées par le rapport lui-même :
 * comparer « le mois dernier » à « les trente derniers jours » donne des écarts
 * qui n'ont rien à voir avec l'exploitation. Les raccourcis couvrent donc les
 * questions habituelles — sept jours pour l'incident de la semaine, le mois
 * échu pour le bilan, le mois en cours pour le suivi — et une période libre
 * reste possible pour tout le reste.
 *
 * **Les filtres vivent dans l'URL.** « Les livreurs de septembre » est un lien
 * qu'on peut transmettre et qui se recharge à l'identique, comme sur les autres
 * écrans.
 *
 * **Le périmètre est annoncé, pas supposé.** Un expéditeur et un gestionnaire ne
 * voit pas les mêmes chiffres : ce n'est pas une restriction d'affichage, c'est
 * ce que l'API compte réellement. Chaque rapport rappelle donc ce qu'il a compté,
 * pour qu'aucun total soit lu comme plus large qu'il n'est.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Banknote,
  Building2,
  CalendarDays,
  Download,
  Loader2,
  Package,
  Truck,
} from 'lucide-react';
import { Card, ErrorBanner, PageHeader, SkeletonTable, Tabs } from '@logixpress/ui';
import { PermissionCode, type DomaineRapport, type Rapport } from '@logixpress/types';
import { reportsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { VueColis, VueDepots, VueExpediteurs, VueFinance, VueLivreurs } from '@/components/rapports/Vues';

interface Onglet {
  id: DomaineRapport;
  libelle: string;
  icone: React.ReactNode;
  question: string;
}

const ONGLETS: Onglet[] = [
  {
    id: 'colis',
    libelle: 'Colis',
    icone: <Package className="w-4 h-4" />,
    question: 'Le flux suit-il, et qu’est-ce qui le coince ?',
  },
  {
    id: 'expediteurs',
    libelle: 'Expéditeurs',
    icone: <Building2 className="w-4 h-4" />,
    question: 'Qui fait des colis, et qui est payé ?',
  },
  {
    id: 'livreurs',
    libelle: 'Livreurs',
    icone: <Truck className="w-4 h-4" />,
    question: 'Qui livre, et qui rapporte la caisse ?',
  },
  {
    id: 'finance',
    libelle: 'Finance',
    icone: <Banknote className="w-4 h-4" />,
    question: 'L’argent attendu est-il rentré, et où est le trou ?',
  },
  {
    id: 'depots',
    libelle: 'Dépôts',
    icone: <CalendarDays className="w-4 h-4" />,
    question: 'Où est le stock, et qu’est-ce qui bloque ?',
  },
];

const RACCOURCIS = [
  { id: '7j', libelle: '7 jours' },
  { id: '30j', libelle: '30 jours' },
  { id: '90j', libelle: '90 jours' },
  { id: 'mois-encours', libelle: 'Mois en cours' },
  { id: 'mois-precedent', libelle: 'Mois échu' },
  { id: 'libre', libelle: 'Période libre' },
] as const;

type Raccourci = (typeof RACCOURCIS)[number]['id'];

/** Date du jour au format `AAAA-MM-JJ`, en heure locale — pas en UTC. */
function aujourdhui(): string {
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const jour = String(maintenant.getDate()).padStart(2, '0');
  return `${maintenant.getFullYear()}-${mois}-${jour}`;
}

/** N jours avant aujourd'hui, au même format. */
function ilYA(jours: number): string {
  const date = new Date();
  date.setDate(date.getDate() - jours);
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

function bornes(raccourci: Raccourci): { from: string; to: string } {
  const maintenant = new Date();
  switch (raccourci) {
    case '7j':
      return { from: ilYA(6), to: aujourdhui() };
    case '30j':
      return { from: ilYA(29), to: aujourdhui() };
    case '90j':
      return { from: ilYA(89), to: aujourdhui() };
    case 'mois-encours':
      return {
        from: `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-01`,
        to: aujourdhui(),
      };
    case 'mois-precedent': {
      const premier = new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1);
      const dernier = new Date(maintenant.getFullYear(), maintenant.getMonth(), 0);
      const format = (date: Date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
          date.getDate()
        ).padStart(2, '0')}`;
      return { from: format(premier), to: format(dernier) };
    }
    default:
      return { from: ilYA(29), to: aujourdhui() };
  }
}

/**
 * Les bornes qu'un raccourci mène à.
 *
 * « Période libre » n'en a pas d propres : il part des trente derniers jours, et
 * ne fait que révéler les champs pour les affiner. On renvoie donc toujours un
 * couple de dates, écrit dans l'URL comme les autres — l'écran n'a ainsi jamais
 * deux endroits où la période pourrait se trouver.
 */
function bornesLibres(raccourci: Raccourci): [string, string] {
  const b = bornes(raccourci === 'libre' ? '30j' : raccourci);
  return [b.from, b.to];
}

/**
 * Le raccourci qui correspond à des bornes données — pour que l'onglet
 * « 30 jours » reste coché après un rechargement depuis l'URL.
 */
function raccourciDe(from: string, to: string): Raccourci {
  for (const entree of RACCOURCIS) {
    if (entree.id === 'libre') continue;
    const b = bornes(entree.id);
    if (b.from === from && b.to === to) return entree.id;
  }
  return 'libre';
}

export default function RapportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const domaine = (searchParams.get('domaine') as DomaineRapport | null) ?? 'colis';
  const ongletActif = ONGLETS.some((o) => o.id === domaine) ? domaine : 'colis';

  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const peutExporter = user?.permissions?.includes(PermissionCode.REPORT_EXPORT) ?? false;

  /**
   * L'URL est l'unique source de vérité de la période.
   *
   * L'alternative — un état local recopié dans l'URL, ou l'inverse — se paie
   * deux fois. D'abord à l'entrée : un lien vers « septembre » doit s'ouvrir
   * sur septembre. Ensuite pendant l'usage : revenir en arrière, ou suivre un
   * lien vers un autre rapport, se fait sans remonter le composant, et un état
   * lu une seule fois au montage garde alors la période précédente — l'écran
   * affiche des chiffres d'une autre période que celle qu'on lit dans la barre
   * d'adresse. Rien ne signale l'erreur.
   *
   * Ici, la période est lue de l'URL à chaque rendu et le raccourci en est
   * déduit. Cliquer un raccourci écrit l'URL ; changer un champ écrit l'URL. Il
   * n'y a qu'un seul endroit où la période existe.
   */
  const fromUrl = searchParams.get('from');
  const toUrl = searchParams.get('to');
  const bornesCourantes = React.useMemo(() => {
    if (fromUrl && toUrl) return { from: fromUrl, to: toUrl };
    const defaut = bornes('30j');
    return { from: fromUrl ?? defaut.from, to: toUrl ?? defaut.to };
  }, [fromUrl, toUrl]);

  // Le raccourci coché est déduit des bornes : « 90 jours » reste coché après un
  // rechargement depuis un lien, sans qu'aucun état ne doive être restauré.
  const raccourci: Raccourci =
    fromUrl && toUrl ? raccourciDe(fromUrl, toUrl) : '30j';

  const changerDomaine = useCallback(
    (suivant: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('domaine', suivant);
      router.replace(`/rapports?${params.toString()}`);
    },
    [router, searchParams]
  );

  /**
   * L'URL est écrite à chaque changement de période, pour que le lien
   * transmis reste juste.
   *
   * Les raccourcis passent par ici aussi, et pas seulement les champs de date :
   * c'est la seule façon qu'un lien vers « les 90 derniers jours » ouvre sur les
   * 90 derniers jours. Sans cela le lien se partageait avec la période par
   * défaut, et celui qui le recevait lisait une autre période sans le savoir.
   */
  const ecrireUrl = useCallback(
    (depuis: string, jusqua: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('domaine', ongletActif);
      params.set('from', depuis);
      params.set('to', jusqua);
      router.replace(`/rapports?${params.toString()}`);
    },
    [router, searchParams, ongletActif]
  );

  const appliquerRaccourci = useCallback(
    (choisi: Raccourci) => {
      // « Période libre » ne change pas les bornes : il révèle les champs, en
      // partant des trente derniers jours. Un rapport sans date n'a pas de sens,
      // et le dernier intervalle choisi est le meilleur point de départ pour
      // une recherche manuelle.
      ecrireUrl(...bornesLibres(choisi));
    },
    [ecrireUrl]
  );

  const charger = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resultat = await reportsApi.lire(ongletActif, {
        from: bornesCourantes.from,
        to: bornesCourantes.to,
      });
      setRapport(resultat);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger le rapport. Réessayez dans un instant.'
      );
      setRapport(null);
    } finally {
      setIsLoading(false);
    }
  }, [ongletActif, bornesCourantes.from, bornesCourantes.to]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const exporter = useCallback(async () => {
    setIsExporting(true);
    setMessage(null);
    try {
      const { rowCount, filename } = await reportsApi.exporter(ongletActif, bornesCourantes);
      setMessage(
        rowCount > 0
          ? `${filename} — ${rowCount} ligne${rowCount > 1 ? 's' : ''} exportée${rowCount > 1 ? 's' : ''}.`
          : `${filename} — aucune ligne sur cette période, le fichier est vide.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export refusé.');
    } finally {
      setIsExporting(false);
    }
  }, [ongletActif, bornesCourantes]);

  const ongletCourant = useMemo(
    () => ONGLETS.find((o) => o.id === ongletActif) ?? ONGLETS[0],
    [ongletActif]
  );

  return (
    <>
      <PageHeader
        title="Rapports d’exploitation"
        description={ongletCourant.question}
        actions={
          <>
            <div className="flex items-center gap-1.5">
              {RACCOURCIS.map((entree) => (
                <button
                  key={entree.id}
                  onClick={() => appliquerRaccourci(entree.id)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition cursor-pointer ${
                    raccourci === entree.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {entree.libelle}
                </button>
              ))}
            </div>
            {peutExporter && (
              <button
                onClick={exporter}
                disabled={isExporting || isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Exporter
              </button>
            )}
          </>
        }
      />

      <div className="px-6 py-5 space-y-4">
        <Tabs
          tabs={ONGLETS.map((onglet) => ({ id: onglet.id, label: onglet.libelle, icon: onglet.icone }))}
          activeTab={ongletActif}
          onChange={changerDomaine}
        />

        {/* Les deux champs ne servent qu'en période libre : les raccourcis
            calculent leurs bornes eux-mêmes, et un champ modifiable à côté
            d'un raccourci actif laisserait croire qu'il est pris en compte. */}
        {raccourci === 'libre' && (
          <Card>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Du
                </label>
                <input
                  type="date"
                  value={bornesCourantes.from}
                  max={bornesCourantes.to}
                  onChange={(e) => {
                    const depuis = e.target.value;
                    // Un début au-delà de la fin rendrait la période
                    // inexistante : on ramène la fin, plutôt que de laisser
                    // l'API refuser le rapport et l'utilisateur deviner pourquoi.
                    ecrireUrl(depuis, depuis > bornesCourantes.to ? depuis : bornesCourantes.to);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-red-600 focus:border-red-600"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Au
                </label>
                <input
                  type="date"
                  value={bornesCourantes.to}
                  min={bornesCourantes.from}
                  onChange={(e) => {
                    const jusqua = e.target.value;
                    ecrireUrl(jusqua < bornesCourantes.from ? jusqua : bornesCourantes.from, jusqua);
                  }}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-red-600 focus:border-red-600"
                />
              </div>
            </div>
          </Card>
        )}

        {message && (
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <span className="text-[11px] text-emerald-900">{message}</span>
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        {isLoading ? (
          <SkeletonTable rows={6} cols={5} />
        ) : rapport ? (
          <>
            {rapport.domaine === 'colis' && <VueColis rapport={rapport} />}
            {rapport.domaine === 'expediteurs' && <VueExpediteurs rapport={rapport} />}
            {rapport.domaine === 'livreurs' && <VueLivreurs rapport={rapport} />}
            {rapport.domaine === 'finance' && <VueFinance rapport={rapport} />}
            {rapport.domaine === 'depots' && <VueDepots rapport={rapport} />}
          </>
        ) : (
          !error && <SkeletonTable rows={3} cols={3} />
        )}
      </div>
    </>
  );
}