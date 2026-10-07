'use client';

/**
 * Onglets.
 *
 * Trois règles, dont deux-tenent sur un écran étroit.
 *
 * **La rangée défile, elle ne déborde pas.** Cinq onglets d'exploitation —
 * Colis, Expéditeurs, Livreurs, Finance, Dépôts — mesurent environ 500 px. Sur
 * un téléphone, l'espace utile est de 340 px. Sans zone de défilement, les
 * onglets du bout passent sous le bord droit et deviennent inatteignables :
 * l'utilisateur ne peut plus consulter le rapport finance. La rangée défile donc
 * horizontalement, avec la même région focusable et nommée que les tableaux.
 *
 * **L'onglet courant est annoncé, pas seulement coloré.** Un onglet actif ne se
 * distingue que par sa couleur de fond et son trait rouge : pour un lecteur
 * d'écran, les cinq onglets se ressemblent. `aria-selected` et le groupe
 * `tablist` disent lequel est ouvert.
 *
 * **On navigue aux flèches.** Cinq onglets, c'est cinq arrêts de tabulation
 * pour en consulter un autre. Sur un clavier, `←`/`→` passent d'un onglet à
 * l'autre et `Origine`/`Fin` vont aux extrémités, comme le demande le motif
 * « onglets ».
 */

import React, { useRef } from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  variant?: 'underline' | 'pills';
}

export function Tabs({ tabs, activeTab, onChange, variant = 'underline' }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  /**
   * Déplacement entre onglets.
   *
   * Le focus suit l'onglet choisi, et l'onglet est activé au passage : dans un
   * panneau d'onglets, les deux vont ensemble — un focus qui se pose sans
   * activer demande une seconde frappe pour rien.
   */
  const naviguer = (evenement: React.KeyboardEvent, index: number) => {
    const dernier = tabs.length - 1;
    let cible: number | null = null;

    if (evenement.key === 'ArrowRight') cible = index === dernier ? 0 : index + 1;
    else if (evenement.key === 'ArrowLeft') cible = index === 0 ? dernier : index - 1;
    else if (evenement.key === 'Home') cible = 0;
    else if (evenement.key === 'End') cible = dernier;
    else return;

    evenement.preventDefault();
    const id = tabs[cible].id;
    onChange(id);
    refs.current[id]?.focus();
  };

  /** Compteur d'une pastille : lu après le libellé, il annonce le volume. */
  const pastille = (tab: TabItem, actif: boolean) => (
    <span
      className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
        actif
          ? variant === 'pills'
            ? 'bg-red-50 text-red-600 font-semibold'
            : 'bg-red-50 text-red-600'
          : variant === 'pills'
            ? 'bg-slate-200 text-slate-600'
            : 'bg-slate-100 text-slate-600'
      }`}
    >
      {tab.count}
    </span>
  );

  if (variant === 'pills') {
    return (
      <div
        role="tablist"
        aria-label="Sections"
        className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              ref={(element) => {
                refs.current[tab.id] = element;
              }}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => naviguer(e, index)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                isActive
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.count !== undefined && pastille(tab, isActive)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Sections"
      className="border-b border-slate-200 flex items-center gap-4 scroll-region-x"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            ref={(element) => {
              refs.current[tab.id] = element;
            }}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => naviguer(e, index)}
            className={`flex shrink-0 items-center gap-2 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition cursor-pointer ${
              isActive
                ? 'border-red-600 text-red-600'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && pastille(tab, isActive)}
          </button>
        );
      })}
    </div>
  );
}