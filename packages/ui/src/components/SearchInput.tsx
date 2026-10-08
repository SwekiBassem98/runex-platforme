'use client';

/**
 * Champ de recherche.
 *
 * Le recherche est l'action la plus répétée de la journée, et celle qui doit
 * être la plus rapide à lancer. Trois détails y contribuent :
 *
 * - **`type="search"`** et non `text` : les navigateurs mobiles y ajoutent la
 *   touche d'effacement du clavier, ce qui évite d'atteindre la souris pour
 *   corriger une faute de frappe ;
 * - **Échap efface.** Un utilisateur qui tape par erreur dans une barre de
 *   recherche cherche d'abord à l'annuler, pas à sélectionner ses caractères
 *   un par un. Sur un clavier, c'est la seule manière rapide ;
 * - **la taille de police.** On saisit un numéro de suivi, donc 14 px comme
 *   tout ce qu'on saisit ailleurs — les chiffres en 12 px forcent à se coller à
 *   l'écran.
 *
 * Le libellé est masqué visuellement mais présent : « Rechercher » ne dit pas
 * *quoi*, donc le nom accessible reprend le contenu attendu, et c'est le
 * contexte de la page qui complète.
 */

import React from 'react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';
import { Search, X } from 'lucide-react';
import { useId } from '../hooks/useInterface';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  className?: string;
  /** Ce que la recherche porte. Lu par les lecteurs d'écran, et obligatoire. */
  libelle: string;
  onSubmit?: (value: string) => void;
  autoFocus?: boolean;
  /**
   * Identifiant du champ. À ne donner que si un libellé visible doit pointer
   * dessus : sinon l'identifiant est tiré au sort, et le `<label>` interne suit.
   *
   * Deux champs de recherche sur la même page — un portail qui liste ses colis
   * et un tableau de tournées, par exemple — ne peuvent pas partager un `id`
   * : le libellé du second désignerait le premier, et le clic sur « Rechercher »
   * placerait le focus dans le mauvais champ.
   */
  id?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Rechercher...',
  onClear,
  className = '',
  libelle,
  onSubmit,
  autoFocus,
  id,
}: SearchInputProps) {
  const { libelles } = useLibellesUI();
  const idAuto = useId('recherche');
  const idChamp = id ?? idAuto;

  return (
    <div className={`relative flex items-center ${className}`}>
      <label htmlFor={idChamp} className="sr-only">
        {libelle}
      </label>
      <Search className="w-4 h-4 text-slate-400 absolute start-3 pointer-events-none" aria-hidden="true" />
      <input
        id={idChamp}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
            onClear?.();
          }
          if (e.key === 'Enter') onSubmit?.(value);
        }}
        placeholder={placeholder}
        className="w-full ps-9 pe-8 py-2 bg-white border border-slate-300 hover:border-slate-400 rounded-md text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:border-red-600 focus:ring-2 focus:ring-red-600/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            onClear?.();
          }}
          className="absolute end-2 text-slate-400 hover:text-slate-700 p-0.5 rounded transition cursor-pointer"
          aria-label={libelles['recherche.effacer']}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
