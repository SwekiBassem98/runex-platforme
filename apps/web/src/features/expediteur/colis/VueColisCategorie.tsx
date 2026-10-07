'use client';

/**
 * Liste des colis d'une catégorie : les échanges, les retours.
 *
 * Ces deux écrans sont le même écran. Ce qui les sépare — le type que l'API
 * filtre, le titre affiché et le bloc qui accompagne chaque colis — est passé
 * en propriété : une seule implémentation, donc un seul endroit où le
 * chargement, la pagination et les états vides sont corrects.
 *
 * Le filtre porte sur `type`, donc il est appliqué par le serveur. Aucune
 * catégorie n'est reconstituée côté navigateur : `EXCHANGE` et `RETURN` sont
 * des valeurs de `packageType` que la base connaît, pas une reconstruction à
 * partir de statuts.
 */

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { PackageStatus, type PackageDto, type PackageType } from '@logixpress/types';
import {
  ChargementEnCours,
  EmptyState,
  ErrorBanner,
  FilterBar,
  FilterSelect,
  Pagination,
  SearchInput,
  SkeletonTable,
  useDifferee,
} from '@logixpress/ui';
import { listerColis, type FiltresColis } from '@/features/expediteur/lib/client';
import { useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n } from '@/i18n';

export interface VueColisCategorieProps {
  /** Valeur envoyée à `GET /colis?type=`. */
  type?: PackageType;
  /**
   * Statuts à additionner, quand la catégorie n'a pas de type mais des états.
   *
   * L'API n'accepte qu'un statut par requête : le composant interroge donc
   * chaque statut séparément et fusionne, en additionnant les totaux annoncés.
   * Ignoré dès qu'un filtre de statut explicite est choisi.
   */
  statuts?: PackageStatus[];
  titre: string;
  sousTitre: string;
  /** Message affiché quand la catégorie est vide. */
  videTitre: string;
  videDescription: string;
  /** Bloc métier sous l'en-tête de chaque colis : l'échange, le retour. */
  rendu: (colis: PackageDto) => React.ReactNode;
}

export function VueColisCategorie({
  type,
  statuts,
  titre,
  sousTitre,
  videTitre,
  videDescription,
  rendu,
}: VueColisCategorieProps) {
  const { t, formatDateTime, formatTND } = useI18n();
  const voc = useVocabulaire();
  const router = useRouter();

  const [recherche, setRecherche] = React.useState('');
  const [statut, setStatut] = React.useState('ALL');
  const [page, setPage] = React.useState(1);
  const [taille, setTaille] = React.useState(20);

  const [colis, setColis] = React.useState<PackageDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const rechercheAppliquee = useDifferee(recherche.trim(), 350);
  const cle = `${type ?? ''}|${(statuts ?? []).join(',')}`;

  React.useEffect(() => {
    let annule = false;

    const base: FiltresColis = {
      page,
      limit: taille,
      ...(type ? { type } : {}),
      ...(rechercheAppliquee ? { search: rechercheAppliquee } : {}),
      ...(statut !== 'ALL' ? { status: statut } : {}),
    };

    setChargement(true);
    setErreur(null);

    /*
     * Une catégorie faite de plusieurs statuts ne tient pas dans une requête :
     * l'API n'en accepte qu'un. On interroge donc en parallèle et on fusionne
     * par identifiant — un colis peut être compté deux fois s'il change de
     * statut entre deux réponses, et le dire deux fois serait faux.
     */
    const charger = async () => {
      const statutSeul = statut !== 'ALL' ? [statut] : (statuts ?? []);

      if (statutSeul.length > 1) {
        const reponses = await Promise.all(
          statutSeul.map((s) => listerColis({ ...base, status: s }))
        );
        const fusion = new Map<string, PackageDto>();
        for (const r of reponses) for (const c of r.colis) fusion.set(c.id, c);
        if (annule) return;
        setColis([...fusion.values()]);
        setTotal(reponses.reduce((somme, r) => somme + r.total, 0));
        return;
      }

      const reponse = await listerColis({ ...base, ...(statutSeul[0] ? { status: statutSeul[0] } : {}) });
      if (annule) return;
      setColis(reponse.colis);
      setTotal(reponse.total);
    };

    charger()
      .catch((err: unknown) => {
        if (annule) return;
        setColis([]);
        setTotal(0);
        setErreur(err instanceof Error ? err.message : t('erreur.generique'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });

    return () => {
      annule = true;
    };
  }, [cle, rechercheAppliquee, statut, page, taille]);

  const filtresActifs = recherche.trim() !== '' || statut !== 'ALL';

  const reinitialiser = () => {
    setRecherche('');
    setStatut('ALL');
    setPage(1);
  };

  const nbPages = Math.max(1, Math.ceil(total / taille));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{titre}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {chargement ? t('commun.chargement') : t('colis.categorie.compte', { n: total })} —{' '}
          {sousTitre}
        </p>
      </div>

      <FilterBar
        hasActiveFilters={filtresActifs}
        onReset={reinitialiser}
        resume={
          filtresActifs
            ? [
                recherche.trim() ? `recherche « ${recherche.trim()} »` : null,
                statut !== 'ALL'
                  ? `${t('filtre.statut').toLowerCase()} ${voc.statutColis(statut).label.toLowerCase()}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      >
        <div className="w-full sm:w-64">
          <SearchInput
            libelle={t('colis.categorie.recherche', { titre: titre.toLowerCase() })}
            placeholder={t('colis.liste.rechercheAide')}
            value={recherche}
            onChange={(v) => {
              setRecherche(v);
              setPage(1);
            }}
          />
        </div>

        <FilterSelect
          label={t('filtre.statut')}
          selectedValue={statut}
          onChange={(v) => {
            setStatut(v);
            setPage(1);
          }}
          options={[
            {
              value: 'ALL',
              label: statuts?.length
                ? t('colis.categorie.tousStatutsCategorie')
                : t('filtre.tousStatuts'),
            },
            ...(statuts ?? [
              PackageStatus.CREE,
              PackageStatus.EN_COURS_LIVRAISON,
              PackageStatus.LIVRE,
              PackageStatus.REPORTE,
              PackageStatus.ECHEC_LIVRAISON,
              PackageStatus.RETOUR_DEPOT,
              PackageStatus.EN_RUNSHEET_RETOUR,
              PackageStatus.RETOURNE_EXPEDITEUR,
              PackageStatus.ANNULE,
            ]).map((s) => ({ value: s, label: voc.statutColis(s).label })),
          ]}
        />
      </FilterBar>

      {erreur && (
        <ErrorBanner
          message={`${erreur} ${t('colis.liste.erreur')}`}
          onDismiss={() => setErreur(null)}
        />
      )}

      {chargement ? (
        <>
          <ChargementEnCours message={t('colis.liste.chargement')} />
          <SkeletonTable rows={4} cols={4} />
        </>
      ) : colis.length === 0 ? (
        <EmptyState
          title={filtresActifs ? t('colis.liste.videFiltreTitre') : videTitre}
          description={
            filtresActifs ? t('colis.liste.videFiltreDescription') : videDescription
          }
          action={
            filtresActifs ? (
              <button
                type="button"
                onClick={reinitialiser}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                {t('commun.reinitialiserFiltres')}
              </button>
            ) : (
              <Link
                href="/expediteur/colis"
                className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-medium transition"
              >
                {t('commun.voirTout')}
              </Link>
            )
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {colis.map((c) => {
              const badge = voc.statutColis(c.status);
              return (
                <article
                  key={c.id}
                  className="bg-white border border-slate-200 rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <Link
                        href={`/expediteur/colis/${c.id}`}
                        className="font-mono text-sm font-bold text-red-600 hover:text-red-700"
                        dir="ltr"
                      >
                        {c.trackingNumber}
                      </Link>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {c.customerName} · {voc.gouvernorat(c.governorate)}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        {/* Le code-barres reste lisible de gauche à droite ; le
                            reste de la ligne suit la direction du texte. */}
                        <span dir="ltr">{c.barcode}</span> · {voc.taille(c.sizeCategory)} ·{' '}
                        {t('commun.piecesAbregees', { n: c.pieceCount })}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                    <span>
                      {t('colis.liste.colonne.montant')}{' '}
                      <span className="font-mono font-semibold text-slate-700">
                        {formatTND(c.totalPrice)}
                      </span>
                    </span>
                    <span>
                      {t('colis.liste.creesLe')} {formatDateTime(c.createdAt)}
                    </span>
                  </div>

                  {rendu(c)}

                  <button
                    type="button"
                    onClick={() => router.push(`/expediteur/colis/${c.id}`)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                  >
                    {t('commun.ouvrirFiche')}
                    <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>

          <Pagination
            currentPage={page}
            totalPages={nbPages}
            totalItems={total}
            pageSize={taille}
            onPageChange={setPage}
            onPageSizeChange={(valeur) => {
              setTaille(valeur);
              setPage(1);
            }}
            libelle={t('colis.categorie.libelle')}
          />
        </>
      )}
    </div>
  );
}