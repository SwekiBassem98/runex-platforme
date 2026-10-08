'use client';

/**
 * Liste des colis de l'expéditeur.
 *
 * Le filtrage et la pagination se font sur le serveur — l'API prend `search`,
 * `status`, `type`, `city`, `paymentStatus`, `date`, `page` et `limit`, et
 * répond avec `meta.total`. Le navigateur ne reçoit jamais plus d'une page :
 * il n'y a pas de « tout charger puis filtrer », qui deviendrait faux au-delà
 * de la première page.
 *
 * Ce que le serveur ne sait pas faire, l'écran le dit au lieu de le simuler :
 * il n'y a pas de tri distant, donc le tri s'applique à la page affichée et
 * l'interface l'annonce ; il n'y a pas de plage de dates, seulement un jour.
 */

import React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, PlusCircle, Printer, RotateCcw, SortAsc } from 'lucide-react';
import { PackageStatus, PackageType, type PackageDto } from '@logixpress/types';
import {
  Badge,
  BasculeFiches,
  ChargementEnCours,
  EmptyState,
  ErrorBanner,
  FicheLigne,
  FilterBar,
  FilterSelect,
  FormField,
  Input,
  Pagination,
  SearchInput,
  SkeletonTable,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDifferee,
  useToast,
} from '@logixpress/ui';
import { listerColis, lireColis, type FiltresColis } from '@/features/expediteur/lib/client';
import { GOUVERNORATS, VARIANTE_TYPE, useVocabulaire } from '@/features/expediteur/lib/libelles';
import { useI18n, type Cle } from '@/i18n';
import {
  genererHtmlColisListe,
  genererHtmlColisUnique,
  ouvrirImpression,
  recupererTousLesColisPourImpression,
  LIMITE_IMPRESSION,
} from './impression';

type VueColis = 'tous' | 'livres' | 'reportes' | 'retours';

/**
 * Les catégories demandées par les expéditeurs.
 *
 * « Livrés », « reportés » et « retours » sont des états du domaine, pas des
 * filtres d'affichage : chacun correspond à un ou plusieurs statuts que
 * l'API sait compter. Ce qui n'a pas de statut — « en transit inter-dépôts »,
 * par exemple — reste accessible par le filtre de statut, mais ne fabrique pas
 * une catégorie de plus.
 *
 * Le libellé est une clé, pas un mot : la catégorie suit la langue courante et
 * n'a pas à être reconstruite au changement de langue.
 */
const VUES: Array<{ id: VueColis; cle: Cle; statuts: PackageStatus[] }> = [
  { id: 'tous', cle: 'colis.liste.categorie.tous', statuts: [] },
  { id: 'livres', cle: 'colis.liste.categorie.livres', statuts: [PackageStatus.LIVRE] },
  { id: 'reportes', cle: 'colis.liste.categorie.reportes', statuts: [PackageStatus.REPORTE] },
  {
    id: 'retours',
    cle: 'colis.liste.categorie.retours',
    statuts: [
      PackageStatus.LIVRAISON_PARTIELLE,
      PackageStatus.RETOUR_DEPOT,
      PackageStatus.EN_RUNSHEET_RETOUR,
      PackageStatus.RETOURNE_EXPEDITEUR,
    ],
  },
];

export function VueColis() {
  const { t, formatDate, formatDateTime, formatTND } = useI18n();
  const voc = useVocabulaire();
  const router = useRouter();
  const params = useSearchParams();

  const [vue, setVue] = React.useState<VueColis>(() => {
    const demandee = params.get('vue');
    return VUES.some((v) => v.id === demandee) ? (demandee as VueColis) : 'tous';
  });
  const [recherche, setRecherche] = React.useState(params.get('q') ?? '');
  const [statut, setStatut] = React.useState(params.get('statut') ?? 'ALL');
  const [type, setType] = React.useState(params.get('type') ?? 'ALL');
  const [gouvernorat, setGouvernorat] = React.useState(params.get('ville') ?? 'ALL');
  const [date, setDate] = React.useState(params.get('date') ?? '');
  const [page, setPage] = React.useState(1);
  const [taille, setTaille] = React.useState(20);
  const [tri, setTri] = React.useState<'recent' | 'ancien' | 'montant'>('recent');
  const [enFiches, setEnFiches] = React.useState(false);

  const [colis, setColis] = React.useState<PackageDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [chargement, setChargement] = React.useState(true);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [impressionEnCours, setImpressionEnCours] = React.useState(false);
  const { addToast } = useToast();

  const rechercheAppliquee = useDifferee(recherche.trim(), 350);

  /*
   * « Retours » couvre quatre statuts et l'API n'en accepte qu'un par
   * requête. On les interroge donc séparément et on fusionne — en gardant le
   * total comme la somme des totaux annoncés, jamais la longueur du résultat
   * affiché, qui serait le nombre de lignes d'une page et non celui des colis.
   */
  React.useEffect(() => {
    let annule = false;

    const charger = async () => {
      setChargement(true);
      setErreur(null);
      const base: FiltresColis = {
        limit: taille,
        ...(rechercheAppliquee ? { search: rechercheAppliquee } : {}),
        ...(statut !== 'ALL' ? { status: statut } : {}),
        ...(type !== 'ALL' ? { type } : {}),
        ...(gouvernorat !== 'ALL' ? { city: gouvernorat } : {}),
        ...(date ? { date } : {}),
      };

      try {
        if (vue === 'retours' && statut === 'ALL') {
          const reponses = await Promise.all(
            VUES[3].statuts.map((s) =>
              listerColis({ ...base, status: s, page, limit: taille })
            )
          );
          if (annule) return;
          const fusion = new Map<string, PackageDto>();
          for (const r of reponses) for (const c of r.colis) fusion.set(c.id, c);
          setColis([...fusion.values()]);
          setTotal(reponses.reduce((somme, r) => somme + r.total, 0));
        } else {
          const reponse = await listerColis({
            ...base,
            ...(vue !== 'tous' && statut === 'ALL'
              ? { status: VUES.find((v) => v.id === vue)?.statuts[0] }
              : {}),
            page,
          });
          if (annule) return;
          setColis(reponse.colis);
          setTotal(reponse.total);
        }
      } catch (err) {
        if (annule) return;
        setColis([]);
        setTotal(0);
        setErreur(err instanceof Error ? err.message : t('erreur.generique'));
      } finally {
        if (!annule) setChargement(false);
      }
    };

    void charger();
    return () => {
      annule = true;
    };
  }, [vue, rechercheAppliquee, statut, type, gouvernorat, date, page, taille]);

  /*
   * Tri de la page affichée.
   *
   * L'API renvoie ses colis du plus récent au plus ancien et n'expose aucun
   * paramètre d'ordre. Le tri ne porte donc que sur ce qui est à l'écran, et le
   * bouton le dit — sinon un expéditeur croissant par montant croirait avoir
   * trié ses trois cents colis alors qu'il en a vu vingt.
   */
  const colisAffiches = React.useMemo(() => {
    const copie = [...colis];
    if (tri === 'ancien') copie.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    else if (tri === 'montant')
      copie.sort((a, b) => Number(b.totalPrice ?? 0) - Number(a.totalPrice ?? 0));
    else copie.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return copie;
  }, [colis, tri]);

  /* La catégorie courante, résolue une fois : `vue` est toujours un identifiant
     de `VUES`, et le filtre actif doit pouvoir la nommer sans `undefined`. */
  const vueCourante = VUES.find((v) => v.id === vue) ?? VUES[0];

  const changerVue = (id: VueColis) => {
    setVue(id);
    setPage(1);
    router.replace(`/expediteur/colis${id === 'tous' ? '' : `?vue=${id}`}`, { scroll: false });
  };

  const reinitialiser = () => {
    setRecherche('');
    setStatut('ALL');
    setType('ALL');
    setGouvernorat('ALL');
    setDate('');
    setPage(1);
    setTri('recent');
    router.replace('/expediteur/colis', { scroll: false });
  };

  const handleImprimer = async () => {
    if (impressionEnCours) return;
    if (total === 0) {
      addToast({ type: 'info', title: t('colis.liste.impressionVide') });
      return;
    }
    setImpressionEnCours(true);
    try {
      const base: Record<string, unknown> = {
        ...(rechercheAppliquee ? { search: rechercheAppliquee } : {}),
        ...(statut !== 'ALL' ? { status: statut } : {}),
        ...(type !== 'ALL' ? { type } : {}),
        ...(gouvernorat !== 'ALL' ? { city: gouvernorat } : {}),
        ...(date ? { date } : {}),
      };

      // Construit la fonction lister adaptée à la vue courante (retours = 4 statuts)
      const listerAdapte = async (filtres: Record<string, unknown>) => {
        if (vue === 'retours' && statut === 'ALL') {
          const reponses = await Promise.all(
            VUES[3].statuts.map((s) => listerColis({ ...(filtres as FiltresColis), status: s } as FiltresColis))
          );
          const fusion = new Map<string, PackageDto>();
          for (const r of reponses) for (const c of r.colis) fusion.set(c.id, c);
          const tous = [...fusion.values()].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
          const tot = reponses.reduce((s, r) => s + r.total, 0);
          return { colis: tous, total: tot };
        }
        // Pour les autres vues, on respecte le statut implicite de la vue si aucun filtre statut
        const f = {
          ...(filtres as FiltresColis),
          ...(vue !== 'tous' && statut === 'ALL' ? { status: VUES.find((v) => v.id === vue)?.statuts[0] } : {}),
        } as FiltresColis;
        return listerColis(f);
      };

      // Si le total est petit (<= page actuelle), on peut réutiliser l'affichage trié, sinon on recharge
      let colisAImprimer: PackageDto[] = [];
      let totalReel = total;

      if (total <= colisAffiches.length && total <= LIMITE_IMPRESSION) {
        // On imprime exactement ce qui est filtré et déjà chargé, trié comme à l'écran
        colisAImprimer = [...colisAffiches];
      } else {
        const fetched = await recupererTousLesColisPourImpression(
          listerAdapte as (f: Record<string, unknown>) => Promise<{ colis: PackageDto[]; total: number }>,
          base
        );
        colisAImprimer = fetched.colis;
        totalReel = fetched.total;
        // Appliquer le même tri que l'écran
        if (tri === 'ancien') colisAImprimer.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
        else if (tri === 'montant') colisAImprimer.sort((a, b) => Number(b.totalPrice ?? 0) - Number(a.totalPrice ?? 0));
        else colisAImprimer.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      }

      if (colisAImprimer.length === 0) {
        addToast({ type: 'info', title: t('colis.liste.impressionVide') });
        return;
      }

      const resumeFiltres = [
        vue !== 'tous' ? `${t(vueCourante.cle).toLowerCase()}` : null,
        rechercheAppliquee ? `recherche « ${rechercheAppliquee} »` : null,
        statut !== 'ALL' ? `statut ${statut}` : null,
        type !== 'ALL' ? `type ${type}` : null,
        gouvernorat !== 'ALL' ? `gouvernorat ${gouvernorat}` : null,
        date ? `créés le ${date}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      const langue = document.documentElement.lang || 'fr';
      const dir = (document.documentElement.dir as 'ltr' | 'rtl') || 'ltr';

      // Entreprise : premier colis ou titre générique
      const entreprise = colisAImprimer[0]?.shipperName ?? t('coque.entreprise');

      const html = genererHtmlColisListe(colisAImprimer, {
        entreprise,
        langue,
        dir,
        formatTND,
        formatDate,
        formatDateTime,
        traduireStatut: (s) => voc.statutColis(s).label,
        traduireType: (s) => voc.type(s as PackageType),
      }, { total: totalReel, filtresResume: resumeFiltres || undefined });

      ouvrirImpression(html);

      if (totalReel > LIMITE_IMPRESSION) {
        addToast({
          type: 'warning',
          title: t('colis.liste.impressionLimite', { max: LIMITE_IMPRESSION, total: totalReel }),
        });
      }
    } catch (e) {
      addToast({ type: 'error', title: t('colis.liste.impressionErreur'), message: e instanceof Error ? e.message : undefined });
    } finally {
      setImpressionEnCours(false);
    }
  };

  const handleImprimerUn = async (colisId: string) => {
    try {
      const detail = await lireColis(colisId);
      const entreprise = detail.shipperName ?? t('coque.entreprise');
      const lang = document.documentElement.lang || 'fr';
      const dir = (document.documentElement.dir as 'ltr' | 'rtl') || 'ltr';
      const html = genererHtmlColisUnique(detail, {
        entreprise,
        langue: lang,
        dir,
        formatTND,
        formatDate,
        formatDateTime,
        traduireStatut: (s) => voc.statutColis(s).label,
        traduireType: (s) => voc.type(s as PackageType),
      });
      ouvrirImpression(html);
    } catch (e) {
      addToast({ type: 'error', title: t('colis.liste.impressionErreur'), message: e instanceof Error ? e.message : undefined });
    }
  };

  const filtresActifs =
    recherche.trim() !== '' ||
    statut !== 'ALL' ||
    type !== 'ALL' ||
    gouvernorat !== 'ALL' ||
    date !== '' ||
    vue !== 'tous';

  const nbPages = Math.max(1, Math.ceil(total / taille));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t('colis.liste.titre')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {chargement ? t('commun.chargement') : t('colis.liste.compte', { n: total })}
          </p>
        </div>
        <Link
          href="/expediteur/colis/nouveau"
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-semibold shadow-xs transition shrink-0"
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          {t('coque.nouveauColis')}
        </Link>
      </div>

      {/* Catégories opérationnelles */}
      <nav aria-label={t('colis.liste.categories')} className="flex gap-2 overflow-x-auto pb-1">
        {VUES.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => changerVue(v.id)}
            aria-current={vue === v.id ? 'page' : undefined}
            className={`shrink-0 px-3.5 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
              vue === v.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t(v.cle)}
          </button>
        ))}
      </nav>

      <FilterBar
        hasActiveFilters={filtresActifs}
        onReset={reinitialiser}
        resume={
          filtresActifs
            ? [
                vue !== 'tous' ? `catégorie ${t(vueCourante.cle).toLowerCase()}` : null,
                recherche.trim() ? `recherche « ${recherche.trim()} »` : null,
                statut !== 'ALL'
                  ? `${t('filtre.statut').toLowerCase()} ${voc.statutColis(statut).label.toLowerCase()}`
                  : null,
                type !== 'ALL'
                  ? `${t('filtre.type').toLowerCase()} ${voc.type(type).toLowerCase()}`
                  : null,
                gouvernorat !== 'ALL'
                  ? `${t('filtre.gouvernorat').toLowerCase()} ${voc.gouvernorat(gouvernorat).toLowerCase()}`
                  : null,
                date ? `${t('colis.liste.creesLe').toLowerCase()} ${date}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      >
        <div className="w-full sm:w-64">
          <SearchInput
            libelle={t('colis.liste.recherche')}
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
            { value: 'ALL', label: t('filtre.tousStatuts') },
            { value: PackageStatus.CREE, label: voc.statutColis(PackageStatus.CREE).label },
            { value: PackageStatus.RAMASSAGE_PROGRAMME, label: voc.statutColis(PackageStatus.RAMASSAGE_PROGRAMME).label },
            { value: PackageStatus.RAMASSE, label: voc.statutColis(PackageStatus.RAMASSE).label },
            { value: PackageStatus.RECU_DEPOT, label: voc.statutColis(PackageStatus.RECU_DEPOT).label },
            { value: PackageStatus.EN_COURS_LIVRAISON, label: voc.statutColis(PackageStatus.EN_COURS_LIVRAISON).label },
            { value: PackageStatus.LIVRE, label: voc.statutColis(PackageStatus.LIVRE).label },
            { value: PackageStatus.REPORTE, label: voc.statutColis(PackageStatus.REPORTE).label },
            { value: PackageStatus.ECHEC_LIVRAISON, label: voc.statutColis(PackageStatus.ECHEC_LIVRAISON).label },
            { value: PackageStatus.RETOUR_DEPOT, label: voc.statutColis(PackageStatus.RETOUR_DEPOT).label },
            { value: PackageStatus.RETOURNE_EXPEDITEUR, label: voc.statutColis(PackageStatus.RETOURNE_EXPEDITEUR).label },
            { value: PackageStatus.ANNULE, label: voc.statutColis(PackageStatus.ANNULE).label },
          ]}
        />

        <FilterSelect
          label={t('filtre.type')}
          selectedValue={type}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: t('filtre.tousTypes') },
            ...Object.values(PackageType).map((v) => ({
              value: v,
              label: voc.type(v),
            })),
          ]}
        />

        <FilterSelect
          label={t('filtre.gouvernorat')}
          selectedValue={gouvernorat}
          onChange={(v) => {
            setGouvernorat(v);
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: t('filtre.tousGouvernorats') },
            ...GOUVERNORATS.map((g) => ({ value: g, label: voc.gouvernorat(g) })),
          ]}
        />

        {/*
          * Un seul jour, pas une plage : c'est ce que l'API sait faire.
          * `date` se lit sur `createdAt`, au jour calendaire du serveur.
          */}
        <FormField label={t('colis.liste.creesLe')} className="w-full sm:w-44">
          <Input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </FormField>
      </FilterBar>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setTri((precedent) =>
                precedent === 'recent' ? 'ancien' : precedent === 'ancien' ? 'montant' : 'recent'
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-[11px] text-slate-600 hover:bg-slate-50 transition cursor-pointer"
            title={t('colis.liste.triAide')}
          >
            <SortAsc className="w-3.5 h-3.5" aria-hidden="true" />
            {tri === 'recent'
              ? t('colis.liste.tri.recent')
              : tri === 'ancien'
                ? t('colis.liste.tri.ancien')
                : t('colis.liste.tri.montant')}
          </button>
          <button
            type="button"
            onClick={() => void handleImprimer()}
            disabled={chargement || total === 0 || impressionEnCours}
            title={
              total === 0
                ? t('colis.liste.impressionVide')
                : filtresActifs
                  ? t('colis.liste.imprimerFiltres', { n: total })
                  : t('colis.liste.imprimerTous')
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
              chargement || total === 0
                ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {impressionEnCours ? (
              <Spinner size="sm" className="text-slate-500" />
            ) : (
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {impressionEnCours
                ? t('colis.liste.impressionEnCours')
                : filtresActifs
                  ? t('colis.liste.imprimerFiltres', { n: total })
                  : t('colis.liste.imprimerTous')}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[11px] text-slate-500">
            {total > LIMITE_IMPRESSION ? t('colis.liste.impressionLimite', { max: LIMITE_IMPRESSION, total }) : null}
          </span>
          <div className="sm:hidden">
            <BasculeFiches enFiches={enFiches} onChange={setEnFiches} />
          </div>
        </div>
      </div>

      {erreur && (
        <ErrorBanner
          message={`${erreur} ${t('colis.liste.erreur')}`}
          onDismiss={() => setErreur(null)}
        />
      )}

      {chargement ? (
        <>
          <ChargementEnCours message={t('colis.liste.chargement')} />
          <SkeletonTable rows={6} cols={6} />
        </>
      ) : colisAffiches.length === 0 ? (
        <EmptyState
          icon={<PackageIcon />}
          title={filtresActifs ? t('colis.liste.videFiltreTitre') : t('colis.liste.videTitre')}
          description={
            filtresActifs
              ? t('colis.liste.videFiltreDescription')
              : t('colis.liste.videDescription')
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
                href="/expediteur/colis/nouveau"
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition"
              >
                {t('coque.nouveauColis')}
              </Link>
            )
          }
        />
      ) : (
        <>
          {/* Cartes sur téléphone : un tableau à neuf colonnes sur 360 px est
              illisible, et le horizontally défilant fait perdre la ligne de
              vue dès le deuxième colis. */}
          {enFiches && (
            <div className="sm:hidden space-y-2">
              {colisAffiches.map((c) => {
                const badge = voc.statutColis(c.status);
                return (
                  <div key={c.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <FicheLigne
                      titre={c.customerName}
                      sousTitre={voc.gouvernorat(c.governorate)}
                      identifiant={c.trackingNumber}
                      action={
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}>
                          {badge.label}
                        </span>
                      }
                      champs={[
                        {
                          libelle: t('colis.detail.telephone'),
                          valeur: (
                            <span className="font-mono text-xs" dir="ltr">
                              {c.customerPhone}
                            </span>
                          ),
                        },
                        {
                          libelle: t('colis.liste.colonne.montant'),
                          valeur: formatTND(c.totalPrice),
                          numerique: true,
                        },
                        { libelle: t('colis.liste.creesLe'), valeur: formatDateTime(c.createdAt) },
                      ]}
                      onClick={() => router.push(`/expediteur/colis/${c.id}`)}
                    />
                    <div className="px-3 pb-3 flex justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleImprimerUn(c.id);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-md text-xs font-medium hover:bg-slate-50 transition"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('colis.liste.imprimer')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className={enFiches ? 'hidden sm:block' : ''}>
            <Table libelle={t('colis.liste.titre')} largeurMin="900px">
              <Thead>
                <tr>
                  <Th figee>{t('colis.liste.colonne.suivi')}</Th>
                  <Th>{t('colis.liste.colonne.destinataire')}</Th>
                  <Th priorite="secondaire">{t('colis.liste.colonne.destination')}</Th>
                  <Th priorite="tertiaire">{t('colis.liste.colonne.type')}</Th>
                  <Th align="right">{t('colis.liste.colonne.montant')}</Th>
                  <Th align="center">{t('colis.liste.colonne.statut')}</Th>
                  <Th align="right" priorite="secondaire">
                    {t('colis.liste.colonne.fiche')}
                  </Th>
                </tr>
              </Thead>
              <Tbody>
                {colisAffiches.map((c) => {
                  const badge = voc.statutColis(c.status);
                  return (
                    <Tr
                      key={c.id}
                      onClick={() => router.push(`/expediteur/colis/${c.id}`)}
                      resume={`${t('colis.liste.libelle')} ${c.trackingNumber}, ${c.customerName}, ${badge.label}`}
                    >
                      <Td figee>
                        <span className="font-mono text-xs font-bold text-red-600 block" dir="ltr">
                          {c.trackingNumber}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500" dir="ltr">
                          {c.barcode}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs font-medium text-slate-900 block">{c.customerName}</span>
                        <span className="font-mono text-[11px] text-slate-500" dir="ltr">
                          {c.customerPhone}
                        </span>
                      </Td>
                      <Td priorite="secondaire">
                        <span className="text-xs text-slate-700 block">{voc.gouvernorat(c.governorate)}</span>
                        <span className="text-[11px] text-slate-500 truncate block max-w-[180px]">
                          {c.address}
                        </span>
                      </Td>
                      <Td priorite="tertiaire">
                        <Badge variant={VARIANTE_TYPE[c.packageType] ?? 'default'}>
                          {voc.type(c.packageType)}
                        </Badge>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {voc.taille(c.sizeCategory)} · {t('commun.piecesAbregees', { n: c.pieceCount })}
                        </span>
                      </Td>
                      <Td align="right" numerique>
                        <span className="font-mono text-xs font-semibold">{formatTND(c.totalPrice)}</span>
                      </Td>
                      <Td align="center">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                        >
                          {badge.label}
                        </span>
                      </Td>
                      <Td align="right" priorite="secondaire">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleImprimerUn(c.id);
                            }}
                            title={t('colis.liste.imprimerColis')}
                            aria-label={t('colis.liste.imprimerColis')}
                            className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition"
                          >
                            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <span className="inline-flex items-center gap-1 text-[11px] text-red-600 font-semibold">
                            {t('commun.details')}
                            <ArrowRight className="w-3 h-3 rtl:rotate-180" aria-hidden="true" />
                          </span>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
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
            libelle={t('colis.liste.libelle')}
          />
        </>
      )}
    </div>
  );
}

function PackageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-8 h-8"
      aria-hidden="true"
    >
      <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
    </svg>
  );
}