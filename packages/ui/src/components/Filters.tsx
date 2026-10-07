'use client';

/**
 * Barre de filtres.
 *
 * La barre de filtres est le poste de travail de l'exploitation : c'est par elle
 * qu'on ramène des milliers de lignes à une poignée. Deux règles la rendent
 * utilisable, et les deux sont des questions de place.
 *
 * **Elle se replie.** Au-dessus de 1024 px, les filtres sont sur une ligne. En
 * dessous, ils passent à la ligne et deviennent pleine largeur — parce qu'un
 * menu déroulant de 150 px au milieu d'une barre de 320 px n'est pas un menu,
 * c'est un décor. Sur un téléphone, ils s'accordent en accordéon :six filtres
 * ouverts d'un coup occupent tout l'écran, et l'utilisateur ne voit plus les
 * résultats qu'il est censé filtrer.
 *
 * **Un filtre actif se voit.** Le bouton « réinitialiser » n'apparaît que s'il y
 * a quelque chose à réinitialiser, et les filtres actifs sont énumérés en clair.
 * Une barre qui dit « 30 jours » et « Tunis » sans le montrer laisse croire
 * qu'il n'y a aucun filtre — c'est le pire moment pour le découvrir, une fois
 * les chiffres lus.
 */

import React, { useState } from 'react';
import { Filter, RotateCcw, ChevronDown, X } from 'lucide-react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';

interface FilterOption {
  label: string;
  value: string;
}

interface FilterGroupProps {
  label: string;
  options: FilterOption[];
  selectedValue: string;
  onChange: (value: string) => void;
  /** Vrai si un filtre non vide est posé — le libellé s'assombrit pour le dire. */
  actif?: boolean;
}

export function FilterSelect({
  label,
  options,
  selectedValue,
  onChange,
  actif,
}: FilterGroupProps) {
  const id = `filtre-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const obtenu = options.some((o) => o.value === selectedValue);

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
      >
        {label}
      </label>
      <select
        id={id}
        value={selectedValue}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full min-w-0 px-2.5 py-1.5 bg-white border rounded-md text-sm text-slate-800 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-red-600/20 ${
          actif && obtenu ? 'border-red-300 bg-red-50/40 font-medium' : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterBar({
  children,
  onReset,
  hasActiveFilters = false,
  /** Description des filtres en cours, énumérés en clair sous la barre. */
  resume,
}: {
  children: React.ReactNode;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  resume?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const { libelles } = useLibellesUI();

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-xs">
      {/* Sous 1024 px, les filtres sont repliés : ouverts, ils pousseraient les
          résultats hors de l'écran, et l'utilisateur filtrerait à l'aveugle. */}
      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        aria-expanded={ouvert}
        aria-controls="zone-filtres"
        className="lg:hidden w-full flex items-center justify-between gap-2 px-3 py-2.5 text-start cursor-pointer"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Filter className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          {libelles['filtres.titre']}
          {hasActiveFilters && (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
              {libelles['filtres.actifsBadge']}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform ${ouvert ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/*
        Les filtres ne sont rendus qu'une fois.

        La barre se replie par CSS, pas par un second rendu : deux copies des
        mêmes enfants laissent deux fois le même `id` dans le document, et le
        `<label htmlFor>` du champ de recherche se résout alors sur la copie
        cachée — le clic sur le libellé ne place plus le focus dans le champ, et
        le lecteur d'écran annonce un contrôle invisible. Sur un écran d'entrepôt
        où la recherche est l'action la plus répétée, ce n'est pas un détail.
      */}
      <div
        id="zone-filtres"
        className={`${ouvert ? 'grid' : 'hidden'} lg:flex flex-wrap items-end justify-between gap-3 p-3 grid-cols-1 sm:grid-cols-2`}
      >
        <div className="grid gap-3 sm:contents lg:flex lg:flex-wrap lg:items-end">{children}</div>
        {hasActiveFilters && onReset && (
          <div className="sm:col-span-2 lg:col-auto">
            <BoutonReinit onReset={onReset} pleineLargeur={!ouvert} />
          </div>
        )}
      </div>

      {resume && (
        <p
          className={`${ouvert ? 'block' : 'hidden'} lg:block px-3 pb-2.5 text-[11px] text-slate-500 ${
            ouvert ? 'border-t border-slate-100 pt-2' : ''
          }`}
        >
          {resume}
        </p>
      )}
    </div>
  );
}

function BoutonReinit({ onReset, pleineLargeur = false }: { onReset: () => void; pleineLargeur?: boolean }) {
  const { libelles } = useLibellesUI();
  return (
    <button
      type="button"
      onClick={onReset}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-red-600 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-md transition cursor-pointer shrink-0 ${
        pleineLargeur ? 'w-full' : ''
      }`}
    >
      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{libelles['filtres.reinitialiser']}</span>
    </button>
  );
}

/**
 * Étiquette de filtre actif.
 *
 * Afficher le filtre en clair est le seul moyen de savoir *lequel* est posé. Un
 * menu déroulant qui affiche « Toutes les catégories » alors qu'une catégorie
 * est sélectionnée oblige à ouvrir le menu pour le vérifier.
 */
export function EtiquetteFiltre({
  libelle,
  onRetirer,
}: {
  libelle: string;
  onRetirer: () => void;
}) {
  const { libelles, format } = useLibellesUI();
  return (
    <span className="inline-flex items-center gap-1 ps-2 pe-1 py-0.5 rounded bg-red-50 border border-red-200 text-[11px] font-medium text-red-700">
      <span className="text-red-500/80">{libelle}</span>
      <button
        type="button"
        onClick={onRetirer}
        aria-label={format(libelles['filtres.retirer'], { libelle })}
        className="p-0.5 rounded hover:bg-red-100 transition cursor-pointer"
      >
        <X className="w-3 h-3" aria-hidden="true" />
      </button>
    </span>
  );
}