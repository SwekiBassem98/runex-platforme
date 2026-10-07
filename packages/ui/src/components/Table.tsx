'use client';

/**
 * Tableau de données.
 *
 * C'est le composant le plus utilisé de l'application : inventaire, journal
 * d'audit, rapports, caisse, bordereaux, historique de réception. Ce qu'il fait
 * bien détermine si l'application paraît professionnelle.
 *
 * ## Pourquoi les colonnes déclarent une priorité
 *
 * Un tableau de treize colonnes n'a pas une seule bonne façon de tenir sur un
 * écran étroit, et « rétrécir les colonnes » — le comportement par défaut d'un
 * `<table>` — est la pire des trois : les montants deviennent illisibles et les
 * lignes cessent de s'aligner entre elles, si bien qu'on ne sait plus à quoi
 * correspond une valeur.
 *
 * Trois issues restent, et chacune se décide par colonne :
 *
 * - **ce qui identifie la ligne reste.** Numéro de suivi, nom : ce n'est jamais
 *   la colonne qu'on masque, parce que sans elle on ne sait plus de quoi on parle ;
 * - **le reste est réparti.** Une colonne secondaire se masque sous 640 px, une
 *   tertiaire sous 1280 px. Sur un grand écran, tout est visible — on ne retire
 *   rien pour gagner de la place.
 *
 * Ce qui ne tient dans aucune largeur défile horizontalement. C'est assumé, et
 * annoncé : la zone défilante est focusable et nommée, sinon elle est
 * inatteignable au clavier — la barre de défilement n'apparaît qu'à la souris et
 * les flèches font défiler la page entière. Les colonnes d'identification
 * restent collées pendant le défilement, ce qui est le seul moyen de savoir de
 * quelle ligne on parle.
 *
 * Sur un téléphone où aucune disposition ne convient, une page peut choisir de
 * rendre `FicheLigne` à la place du tableau. C'est une décision de page, pas une
 * règle générale : certains tableaux méritent le défilement, d'autres une fiche.
 */

import React from 'react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';

/**
 * Priorité d'une colonne : à partir de quelle largeur elle apparaît.
 *
 * `primaire`  — l'identité de la ligne et l'essentiel. Toujours visible.
 * `secondaire` — utile, mais absentable. Visible dès 640 px.
 * `tertiaire` — contexte. Visible dès 1280 px.
 */
export type Priorite = 'primaire' | 'secondaire' | 'tertiaire';

const VISIBILITE: Record<Priorite, string> = {
  primaire: '',
  secondaire: 'hidden sm:table-cell',
  tertiaire: 'hidden xl:table-cell',
};

/**
 * Cellule épinglée pendant le défilement horizontal.
 *
 * Le fond doit être opaque et porter une ombre portée à droite : sans cela, les
 * colonnes qui passent dessous se devinent à travers, et l'effet est pire que
 * sans épinglage. Cette colonne ne peut pas être masquée par la priorité — c'est
 * précisément elle qui identifie la ligne.
 *
 * `start-0` et non `left-0` : la colonne épinglée est la première colonne *du
 * tableau*, et le tableau se lit de droite à gauche en arabe. Avec `left-0`, la
 * colonne de suivi restait collée au bord gauche pendant que les autres columns
 * glissaient dessous — c'est-à-dire épinglée à l'envers. L'ombre suit le même
 * mouvement : elle désigne le côté par lequel les colonnes arrivent.
 */
const EPINGLE =
  'sticky start-0 z-10 bg-white shadow-[1px_0_0_0_var(--color-slate-200)] rtl:shadow-[-1px_0_0_0_var(--color-slate-200)]';

interface TableProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Nom de la région. Lu par les lecteurs d'écran, et indispensable : une zone
   * de défilement sans nom est une boîte dans laquelle on ne sait pas qu'il y a
   * des colonnes à droite. À défaut, le tableau se nomme lui-même.
   */
  libelle?: string;
  /**
   * Largeur minimale du contenu en dessous de laquelle le tableau défile au
   * lieu de comprimer ses colonnes.
   */
  largeurMin?: string;
}

export function Table({
  children,
  className = '',
  libelle,
  largeurMin = '640px',
}: TableProps) {
  const { libelles } = useLibellesUI();
  // Un tableau sans nom reste une boîte dans laquelle on ne sait pas qu'il y a
  // des colonnes à droite : le nom est donc fourni par défaut, et traduit.
  const nom = libelle ?? libelles['table.libelle'];
  return (
    <div className={`w-full bg-white border border-slate-200 rounded-lg shadow-xs ${className}`}>
      <div
        className="scroll-region-x w-full rounded-lg"
        tabIndex={0}
        role="region"
        aria-label={libelles['table.defilement']}
      >
        <table className="w-full text-start text-xs border-collapse" style={{ minWidth: largeurMin }}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[11px] font-semibold uppercase tracking-wide">
      {children}
    </thead>
  );
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-100 bg-white">{children}</tbody>;
}

/**
 * Ligne de tableau.
 *
 * Quand elle est cliquable, elle doit l'être au clavier. Un `onClick` seul sur
 * `<tr>` produit une ligne que la souris atteint et que le clavier ignore — la
 * moitié des utilisateurs ne pourraient pas ouvrir un colis. D'où le
 * `tabIndex`, la gestion d'Entrée et Espace, et le résumé lu par les lecteurs
 * d'écran : sans lui, une ligne de vingt cellules est annoncée cellule par
 * cellule, sans jamais dire de quoi elle parle.
 *
 * Le rôle reste `row`. Poser `role="button"` sur un `<tr>` — ce qui est tentant,
 * la ligne agissant comme un bouton — remplace le rôle de ligne dans l'arbre
 * d'accessibilité : le lecteur n'annonce plus ni la ligne ni ses cellules, et
 * une ligne de neuf colonnes devient un seul « bouton » sans contexte. Le
 * clavier est assuré par `tabIndex` et `onKeyDown`, la sémantique de tableau
 * n'est pas perdue.
 */
export function Tr({
  children,
  className = '',
  onClick,
  selected = false,
  resume,
  index,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  /** Phrase lue par les lecteurs d'écran pour comprendre la ligne. */
  resume?: string;
  /** Position dans l'ensemble, pour composer le résumé si l'appelant n'en fournit pas. */
  index?: number;
}) {
  const resumeEffectif = resume ?? (index !== undefined ? `Ligne ${index + 1}` : undefined);

  const surTouche = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };

  return (
    <tr
      onClick={onClick}
      onKeyDown={onClick ? surTouche : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={resumeEffectif}
      className={`transition-colors ${
        selected ? 'bg-red-50/60' : onClick ? 'hover:bg-slate-50 cursor-pointer' : ''
      } focus-visible:bg-red-50/50 ${className}`}
    >
      {children}
    </tr>
  );
}

export function Th({
  children,
  className = '',
  align = 'left',
  priorite = 'primaire',
  figee = false,
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * Alignement dans le sens de *lecture* du tableau, pas dans celui de l'écran.
   *
   * `left` signifie « au début de la ligne » et `right` « à la fin ». En LTR les
   * deux se lisent physiquement ; en arabe, la même déclaration place la colonne
   * à droite du premier coup. C'est ce qui évite d'écrire une classe par langue
   * dans chaque en-tête.
   */
  align?: 'left' | 'center' | 'right';
  priorite?: Priorite;
  /** Reste visible pendant le défilement horizontal. */
  figee?: boolean;
}) {
  const alignClass = align === 'right' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start';
  return (
    <th
      scope="col"
      className={`px-3 sm:px-4 py-2.5 sm:py-3 font-semibold text-slate-600 whitespace-nowrap ${alignClass} ${
        figee ? EPINGLE.replace('bg-white', 'bg-slate-50') : VISIBILITE[priorite]
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = '',
  align = 'left',
  colSpan,
  priorite = 'primaire',
  numerique = false,
  figee = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Voir `Th` : `left` et `right` suivent le sens de lecture du tableau. */
  align?: 'left' | 'center' | 'right';
  /** Permet aux lignes d'état vide ou de synthèse de couvrir toute la table. */
  colSpan?: number;
  priorite?: Priorite;
  /** Chiffre ou montant : chasse fixe, sans quoi la colonne ne s'aligne pas. */
  numerique?: boolean;
  /** Reste visible pendant le défilement horizontal. */
  figee?: boolean;
}) {
  const alignClass = align === 'right' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start';
  return (
    <td
      colSpan={colSpan}
      className={`px-3 sm:px-4 py-2.5 sm:py-3 text-slate-700 ${alignClass} ${
        numerique ? 'tabular-nums' : ''
      } ${figee ? EPINGLE : VISIBILITE[priorite]} ${className}`}
    >
      {children}
    </td>
  );
}

/**
 * Fiche de substitution pour écran étroit.
 *
 * Pour les tableaux dont les colonnes sont des attributs d'un objet identifié :
 * sur un téléphone, une carte avec un titre, une liste libellé/valeur et une
 * action se lit ; treize colonnes compressées ne se lisent pas.
 *
 * Le titre porte l'identifiant, donc la question « de qui est cette ligne » a
 * une réponse avant même la première ligne de la fiche.
 */
export function FicheLigne({
  titre,
  sousTitre,
  identifiant,
  champs,
  action,
  onClick,
}: {
  titre: React.ReactNode;
  sousTitre?: React.ReactNode;
  identifiant?: string;
  champs: Array<{ libelle: string; valeur: React.ReactNode; numerique?: boolean }>;
  action?: React.ReactNode;
  onClick?: () => void;
}) {
  const classes =
    'w-full text-start p-4 border-b border-slate-100 last:border-b-0' +
    (onClick ? ' hover:bg-slate-50 transition cursor-pointer' : '');
  const contenu = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 leading-tight">{titre}</p>
          {identifiant && (
            <p className="text-[11px] font-mono text-slate-500 mt-0.5 break-all">{identifiant}</p>
          )}
          {sousTitre && <p className="text-xs text-slate-500 mt-1">{sousTitre}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {champs.map((champ) => (
          <div key={champ.libelle} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {champ.libelle}
            </dt>
            <dd
              className={`text-xs text-slate-700 mt-0.5 truncate ${
                champ.numerique ? 'tabular-nums' : ''
              }`}
            >
              {champ.valeur}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {contenu}
      </button>
    );
  }
  return <div className={classes}>{contenu}</div>;
}

/**
 * Bascule tableau / fiches.
 *
 * Réservée aux écrans étroits. Le bouton reste visible quand les fiches sont
 * possibles : c'est à l'utilisateur de choisir, parce que la réponse dépend de ce
 * qu'il cherche — une ligne pour la comparer à une autre, ou dix lignes pour les
 * parcourir.
 */
export function BasculeFiches({
  enFiches,
  onChange,
  available = true,
}: {
  enFiches: boolean;
  onChange: (v: boolean) => void;
  available?: boolean;
}) {
  if (!available) return null;
  const { libelles } = useLibellesUI();
  return (
    <button
      type="button"
      onClick={() => onChange(!enFiches)}
      className="sm:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 border border-slate-200 rounded-md bg-white hover:bg-slate-50 transition cursor-pointer"
    >
      {enFiches ? (
        <>
          <span aria-hidden="true">▦</span> Tableau
        </>
      ) : (
        <>
          <span aria-hidden="true">▤</span> {libelles['table.fiches']}
        </>
      )}
    </button>
  );
}

/**
 * Ligne d'état vide, occupant toute la largeur du tableau.
 *
 * Rendue dans un `<td colSpan>` pour rester dans la grille : un état vide placé
 * en dehors du tableau se retrouve collé en haut à gauche de son conteneur, ce
 * qui donne l'impression d'un rendu cassé plutôt que d'un résultat vide.
 */
export function LigneVide({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-xs text-slate-500">
        {children}
      </td>
    </tr>
  );
}