'use client';

/**
 * JOURNAL D'AUDIT — historique des opérations.
 *
 * L'écran se lit comme un registre, pas comme une liste de données : une
 * ligne est « qui, quoi, quand, depuis quelle machine », et le reste — l'état
 * avant, l'état après, le motif — se déplie à la demande. C'est la réponse à
 * la question qu'on pose vraiment en ouvrant ce type d'écran : *rends-moi ce
 * qui s'est passé sur ce colis, et dis-moi qui l'a fait*.
 *
 * Trois parti pris.
 *
 * **Rien n'est modifiable.** Il n'y a ni bouton d'édition, ni suppression, ni
 * même de case à cocher pour « nettoyer ». Ce n'est pas une retenue d'interface
 * : l'API n'expose aucune écriture et la base refuse toute modification. Le
 * journal se remplit parce que les opérations métier le remplissent, et il se
 * relit. Le bandeau en tête le dit, parce qu'une absence de boutons se lit
 * facilement comme un oubli — mieux vaut l'expliquer que le laisser deviner.
 *
 * **Le filtre propose ce qui existe.** Les actions listées viennent de la base,
 * pas d'un catalogue théorique : proposer un filtre qui ne ramène rien est
 * plus pénible que de ne pas le proposer. Un code écrit par une version
 * antérieure reste affichable, marqué comme tel.
 *
 * **Les filtres vivent dans l'URL.** Un lien vers « les encaissements contestés
 * de mars » se transmet tel quel, et se recharge à l'identique.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ErrorBanner, formatDateTime } from '@logixpress/ui';
import { rendreCodesLisibles } from '@logixpress/types';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Filter,
  Loader2,
  Lock,
  RotateCcw,
  ScrollText,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  auditApi,
  type AuditActionFacet,
  type AuditEntry,
  type AuditFilters,
} from '@/lib/api';

const PAGE = 50;

const FILTRE_VIDE: AuditFilters = {
  search: '',
  entityType: '',
  entityId: '',
  action: '',
  category: '',
  from: '',
  to: '',
};

function estActif(filtres: AuditFilters): boolean {
  return (Object.keys(FILTRE_VIDE) as (keyof AuditFilters)[]).some(
    (cle) => filtres[cle] !== undefined && filtres[cle] !== ''
  );
}

/*
 * L'horodatage n'a plus de formateur local.
 *
 * Une seconde était ajoutée ici alors que le formateur unique s'arrête à la
 * minute. Dans une trace d'audit, la seconde est ce qui distingue deux actions
 * successives sur le même colis : elle est donc affichée explicitement, à
 * partir du même formateur que le reste de l'application.
 */
function horodatage(iso: string): string {
  return formatDateTime(iso);
}

/**
 * Une valeur d'audit, rendue lisible.
 *
 * Le journal stocke du JSON libre : un montant y est une chaîne, un booléen un
 * booléen. Les deux sont affichés tels quels, distinction comprise — ce qui compte dans
 * une trace est la valeur réellement écrite, pas une reformulation.
 */
function valeur(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '—';
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (typeof valeur === 'number') return String(valeur);
  if (typeof valeur === 'string') return valeur;
  return JSON.stringify(valeur, null, 2);
}

/** Paires clé/valeur d'un instantané, pour l'affichage en deux colonnes. */
function instantane(donnees: unknown): Array<[string, string]> {
  if (!donnees || typeof donnees !== 'object' || Array.isArray(donnees)) {
    return donnees === null || donnees === undefined ? [] : [['valeur', valeur(donnees)]];
  }
  return Object.entries(donnees as Record<string, unknown>).map(([cle, val]) => [cle, valeur(val)]);
}

/**
 * Détail d'une ligne.
 *
 * L'état avant et l'état après sont superposés ligne à ligne plutôt que
 * présentés en deux blocs : la question n'est pas « qu'est-ce qui a changé »
 * mais « de combien, et vers quoi ».
 */
function Detail({ entree }: { entree: AuditEntry }): React.ReactElement {
  const avant = useMemo(() => instantane(entree.previousValues), [entree.previousValues]);
  const apres = useMemo(() => instantane(entree.newValues), [entree.newValues]);
  const toutes = useMemo(
    () => [...new Set([...avant.map(([cle]) => cle), ...apres.map(([cle]) => cle)])],
    [avant, apres]
  );

  return (
    <div className="px-3 py-2.5 bg-slate-50 border-t border-slate-100 space-y-3">
      {entree.reason && (
        <p className="text-[11px] text-slate-700">
          <span className="font-semibold text-slate-500">Motif —</span> {rendreCodesLisibles(entree.reason)}
        </p>
      )}

      {toutes.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div />
          <span className="text-[9px] uppercase font-semibold text-slate-500">Avant</span>
          <span className="text-[9px] uppercase font-semibold text-slate-500">Après</span>
          {toutes.map((cle) => {
            const a = avant.find(([c]) => c === cle)?.[1];
            const b = apres.find(([c]) => c === cle)?.[1];
            const change = a !== undefined && b !== undefined && a !== b;
            return (
              <React.Fragment key={cle}>
                <span className="font-mono text-slate-600 truncate" title={cle}>
                  {cle}
                </span>
                <span className="font-mono text-slate-500 break-words">{a ?? '—'}</span>
                <span
                  className={`font-mono break-words ${change ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}
                >
                  {b ?? '—'}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-500">
        {entree.userName && (
          <span>
            <span className="font-semibold">Auteur —</span> {entree.userName}
            {entree.userRole ? ` (${entree.userRole})` : ''}
          </span>
        )}
        {entree.userIp && (
          <span>
            <span className="font-semibold">Adresse IP —</span>{' '}
            <span className="font-mono">{entree.userIp}</span>
          </span>
        )}
        {entree.userAgent && (
          <span className="truncate" title={entree.userAgent}>
            <span className="font-semibold">Client —</span> <span className="font-mono">{entree.userAgent}</span>
          </span>
        )}
        <span>
          <span className="font-semibold">Identifiant —</span>{' '}
          <span className="font-mono">{entree.entityId}</span>
        </span>
        <span>
          <span className="font-semibold">Code —</span> <span className="font-mono">{entree.action}</span>
        </span>
      </div>
    </div>
  );
}

function Ligne({ entree }: { entree: AuditEntry }): React.ReactElement {
  const [ouvert, setOuvert] = useState(false);
  const router = useRouter();

  // Un journal sans aucun moyen de consulter l'entité touchée ne sert à rien :
  // le clic mène au dossier, quand la ligne porte bien une entité consultable.
  const consultable = entree.entityType === 'PACKAGE';

  return (
    <>
      {/* Une ligne qui déplie son détail doit être atteignable au clavier : sans
          `tabIndex` ni gestion d'Entrée, personne ne pouvait déplier une seule
          entrée du journal sans souris. */}
      <tr
        onClick={() => setOuvert((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOuvert((v) => !v);
          }
        }}
        tabIndex={0}
        aria-expanded={ouvert}
        aria-label={`${entree.actionLabel} du ${formatDateTime(entree.timestamp)}, sur ${entree.entityLabel}, par ${entree.userName ?? 'opérateur inconnu'}`}
        className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer align-top"
      >
        <td className="px-2.5 py-2 w-6 text-slate-500">
          {ouvert ? (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </td>
        <td className="px-2.5 py-2 font-mono text-[11px] whitespace-nowrap text-slate-600 sticky left-0 bg-white shadow-[1px_0_0_0_var(--color-slate-200)]">
          {formatDateTime(entree.timestamp)}
        </td>
        <td className="px-2.5 py-2">
          <span className="text-[11px] font-semibold text-slate-800 inline-flex items-center gap-1.5">
            {entree.critical && <ShieldAlert className="w-3 h-3 text-amber-500" />}
            {entree.actionLabel}
          </span>
          {entree.missingReason && (
            <span className="block text-[11px] text-amber-700">Sans motif alors qu&apos;un motif était attendu</span>
          )}
          {!entree.knownAction && (
            <span className="block text-[11px] text-slate-500">
              Action hors catalogue — affichée telle qu&apos;écrite
            </span>
          )}
          {entree.reason && (
            <span className="block text-[11px] text-slate-500 line-clamp-1" title={rendreCodesLisibles(entree.reason)}>
              {rendreCodesLisibles(entree.reason)}
            </span>
          )}
        </td>
        <td className="px-2.5 py-2 text-[11px] whitespace-nowrap">{entree.entityLabel}</td>
        <td className="px-2.5 py-2 text-[11px] whitespace-nowrap">
          {entree.userName ?? <span className="text-slate-500">—</span>}
          {entree.userIp && (
            <span className="block font-mono text-[11px] text-slate-500">{entree.userIp}</span>
          )}
        </td>
        {/* Même visibilité que l'en-tête « Catégorie » : sinon, sous 1280 px, la
            catégorie glissait dans la colonne suivante. */}
        <td className="px-2.5 py-2 text-[11px] text-slate-600 whitespace-nowrap hidden xl:table-cell">
          {entree.categoryLabel}
        </td>
        <td className="px-2.5 py-2 w-10 text-right">
          {consultable && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/colis?tracking=${entree.entityLabel}`);
              }}
              aria-label={`Ouvrir le dossier du colis ${entree.entityLabel}`}
              className="inline-flex items-center min-h-6 px-1 -mx-1 rounded text-[11px] text-blue-700 hover:underline cursor-pointer"
            >
              Ouvrir
            </button>
          )}
        </td>
      </tr>
      {ouvert && (
        <tr>
          <td colSpan={7} className="p-0">
            <Detail entree={entree} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditPage(): React.ReactElement {
  const router = useRouter();
  const params = useSearchParams();

  // L'URL est la source de vérité du filtre : un lien se transmet avec son
  // contexte, et le rechargement ne perd rien.
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtres, setFiltres] = useState<AuditFilters>(() => ({
    search: params.get('search') ?? '',
    entityType: params.get('entityType') ?? '',
    entityId: params.get('entityId') ?? '',
    action: params.get('action') ?? '',
    category: params.get('category') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  }));
  const [offset, setOffset] = useState(0);
  const [entrees, setEntrees] = useState<AuditEntry[]>([]);
  const [meta, setMeta] = useState({ total: 0, hasMore: false });
  const [facettes, setFacettes] = useState<AuditActionFacet[]>([]);
  const [chargement, setChargement] = useState(true);
  const [saisie, setSaisie] = useState(filtres.search);

  useEffect(() => {
    auditApi
      .actions()
      .then(setFacettes)
      .catch(() => setFacettes([]));
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      const resultat = await auditApi.list({
        ...filtres,
        search: filtres.search || undefined,
        entityType: filtres.entityType || undefined,
        entityId: filtres.entityId || undefined,
        action: filtres.action || undefined,
        category: filtres.category || undefined,
        from: filtres.from || undefined,
        to: filtres.to || undefined,
        limit: PAGE,
        offset,
      });
      setErreur(null);
      setEntrees(resultat.entries);
      setMeta({ total: resultat.meta.total, hasMore: resultat.meta.hasMore });
    } catch (error) {
      // Un registre en panne affichait « aucune entrée pour ce filtre » : un
      // journal vide et un serveur injoignable donnaient la même page, sans
      // aucun moyen de réessayer.
      setEntrees([]);
      setMeta({ total: 0, hasMore: false });
      setErreur(
        error instanceof Error ? error.message : "Le journal d'audit est inaccessible."
      );
    } finally {
      setChargement(false);
    }
  }, [filtres, offset]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const appliquer = (modifs: Partial<AuditFilters>): void => {
    const suivant = { ...filtres, ...modifs };
    setFiltres(suivant);
    setOffset(0);

    const query = new URLSearchParams();
    for (const [cle, valeurFiltree] of Object.entries(suivant)) {
      if (valeurFiltree !== undefined && valeurFiltree !== '') query.set(cle, String(valeurFiltree));
    }
    router.replace(query.toString() ? `/audit?${query}` : '/audit');
  };

  const reinitialiser = (): void => {
    setSaisie('');
    setOffset(0);
    setFiltres(FILTRE_VIDE);
    router.replace('/audit');
  };

  const categories = useMemo(() => {
    const vues = new Map<string, string>();
    for (const facette of facettes) {
      if (facette.category && !vues.has(facette.category)) vues.set(facette.category, facette.categoryLabel);
    }
    return [...vues.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [facettes]);

  return (
    <div className="flex-1 p-4 lg:p-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ScrollText className="w-4 h-4" />
            Journal d&apos;audit
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Historique des opérations, avec leur auteur, leur origine et l&apos;état avant / après.
          </p>
        </div>
      </div>

      {/* Rappel du caractère non modifiable.
          Son absence se lirait comme un oubli, alors qu'elle est la règle. */}
      <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <Lock className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
        <p className="text-[11px] text-slate-600">
          Ce journal est <strong className="font-semibold">immuable</strong> : aucune ligne ne peut être
          modifiée ni supprimée, ni depuis l&apos;application, ni depuis la base. Une action écrite par une
          version antérieure du code reste visible telle quelle.
        </p>
      </div>

      {/* Filtres */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={saisie}
              onChange={(event) => setSaisie(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') appliquer({ search: saisie });
              }}
              placeholder="Rechercher dans les motifs…"
              className="w-full pl-8 pr-2 py-1.5 text-[11px] border border-slate-300 rounded-md focus:outline-none focus:border-slate-500"
            />
          </div>

          <select
            value={filtres.category}
            onChange={(event) => appliquer({ category: event.target.value, action: '' })}
            className="px-2 py-1.5 text-[11px] border border-slate-300 rounded-md bg-white"
          >
            <option value="">Toutes les catégories</option>
            {categories.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>

          <select
            value={filtres.action}
            onChange={(event) => appliquer({ action: event.target.value })}
            className="px-2 py-1.5 text-[11px] border border-slate-300 rounded-md bg-white max-w-[260px]"
          >
            <option value="">Toutes les actions</option>
            {facettes.map((facette) => (
              <option key={facette.action} value={facette.action}>
                {facette.label} ({facette.count})
              </option>
            ))}
          </select>

          <select
            value={filtres.entityType}
            onChange={(event) => appliquer({ entityType: event.target.value })}
            className="px-2 py-1.5 text-[11px] border border-slate-300 rounded-md bg-white"
          >
            <option value="">Toutes les entités</option>
            {[
              ['PACKAGE', 'Colis'],
              ['RUNSHEET', 'Tournée'],
              ['PAYMENT_VOUCHER', 'Bordereau'],
              ['CASH_PAYMENT', 'Encaissement'],
              ['DEPOSIT', 'Dépôt'],
              ['TRANSFER', 'Transfert'],
              ['PICKUP', 'Ramassage'],
            ].map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={filtres.from}
            onChange={(event) => appliquer({ from: event.target.value })}
            className="px-2 py-1.5 text-[11px] border border-slate-300 rounded-md"
            title="À partir du"
          />
          <span className="self-center text-[10px] text-slate-500">→</span>
          <input
            type="date"
            value={filtres.to}
            onChange={(event) => appliquer({ to: event.target.value })}
            className="px-2 py-1.5 text-[11px] border border-slate-300 rounded-md"
            title="Jusqu'au"
          />

          <button
            type="button"
            onClick={reinitialiser}
            disabled={!estActif(filtres)}
            className="px-2.5 py-1.5 text-[11px] border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Réinitialiser
          </button>
        </div>

        {estActif(filtres) && (
          <p className="text-[10px] text-slate-500 flex items-center gap-1">
            <Filter className="w-3 h-3" />
            Filtre actif
            {filtres.entityId && (
              <>
                {' '}
                sur l&apos;entité <span className="font-mono">{filtres.entityId}</span>
              </>
            )}
          </p>
        )}
      </div>

      {/* Registre */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-[11px] font-bold text-slate-700">
            {chargement ? 'Chargement…' : `${meta.total.toLocaleString('fr-FR')} entrée(s)`}
          </h2>
          <span className="text-[11px] text-slate-500">
            {entrees.length > 0 && `lignes ${offset + 1}–${offset + entrees.length}`}
          </span>
        </div>

        {erreur && (
          <div className="p-3 border-b border-slate-100">
            <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />
            <button
              type="button"
              onClick={() => void charger()}
              className="mt-2 px-3 py-1.5 bg-slate-900 text-white rounded-md text-[11px] font-semibold cursor-pointer"
            >
              Réessayer
            </button>
          </div>
        )}

        {entrees.length === 0 && !chargement ? (
          <p className="p-8 text-center text-[11px] text-slate-500">
            {estActif(filtres)
              ? 'Aucune entrée ne correspond à ces filtres.'
              : 'Le journal est vide : aucune action n\'a encore été tracée.'}
          </p>
        ) : (
          <div
            className="overflow-x-auto scroll-region-x"
            tabIndex={0}
            role="region"
            aria-label="Registre des actions tracées — défilement horizontal"
          >
            <table className="w-full text-left text-[11px]" style={{ minWidth: '760px' }}>
              <caption className="sr-only">
                Registre des actions tracées. Chaque ligne se déplie au clavier pour montrer le
                détail de la modification.
              </caption>
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th scope="col" className="px-2.5 py-1.5 w-6" />
                  <th scope="col" className="px-2.5 py-1.5 font-semibold sticky left-0 bg-slate-50">
                    Horodatage
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 font-semibold">Action</th>
                  <th scope="col" className="px-2.5 py-1.5 font-semibold">Entité</th>
                  <th scope="col" className="px-2.5 py-1.5 font-semibold">Auteur</th>
                  <th scope="col" className="px-2.5 py-1.5 font-semibold hidden xl:table-cell">
                    Catégorie
                  </th>
                  <th scope="col" className="px-2.5 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {entrees.map((entree) => (
                  <Ligne key={entree.id} entree={entree} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(offset > 0 || meta.hasMore) && (
          <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setOffset(Math.max(offset - PAGE, 0))}
              disabled={offset === 0 || chargement}
              className="px-2.5 py-1 text-[11px] border border-slate-300 rounded-md disabled:opacity-40 inline-flex items-center gap-1"
            >
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
              Précédentes
            </button>
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              {chargement && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
              page {Math.floor(offset / PAGE) + 1}
            </span>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE)}
              disabled={!meta.hasMore || chargement}
              className="px-2.5 py-1 text-[11px] border border-slate-300 rounded-md disabled:opacity-40 inline-flex items-center gap-1"
            >
              Suivantes
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}