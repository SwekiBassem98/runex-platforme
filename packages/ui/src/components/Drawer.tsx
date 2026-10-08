'use client';

/**
 * Tiroir latéral.
 *
 * Choisi partout où une modale ne convient pas : une fiche colis, un
 * bordereau, le détail d'une écriture. La différence n'est pas cosmétique — une
 * modale dit « traite ça, puis reviens », un tiroir dit « voici le détail, et le
 * reste est toujours là ». Sur les écrans de terrain, la seconde posture est
 * généralement la juste, parce qu'on compare en permanence.
 *
 * Le tiroir confine le focus et le rend à la fermeture, comme la modale, mais
 * **il ne le confisque pas à l'ouverture** quand il sert de navigation : la
 * navigation mobile s'ouvre sur le menu et doit laisser le focus là où il est,
 * sinon la tabulation repart du début de la page à chaque ouverture du menu.
 *
 * Sur un écran étroit, il occupe toute la largeur et devient une feuille
 * montante : sur un téléphone, un tiroir qui ne laisse que 40 px de page visible
 * donne l'impression d'un blocage.
 */

import React from 'react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';
import { X } from 'lucide-react';
import { useComportementCalque, useId } from '../hooks/useInterface';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Le tiroir ne vole pas le focus : réservé à la navigation. */
  roleNavigation?: boolean;
}

export function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'lg',
  roleNavigation = false,
}: DrawerProps) {
  const { libelles } = useLibellesUI();
  const idTitre = useId('drawer');
  const idDescription = useId('drawer-desc');

  const refTiroir = useComportementCalque<HTMLDivElement>({
    ouvert: isOpen,
    onFermer: onClose,
    piegeFocus: !roleNavigation,
  });

  if (!isOpen) return null;

  const widthClass = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-xl',
    xl: 'sm:max-w-3xl',
    full: 'sm:max-w-5xl',
  }[width];

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-overlay-in"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-0 flex justify-end sm:items-stretch max-sm:items-end max-sm:justify-stretch">
        <div
          ref={refTiroir}
          role={roleNavigation ? 'navigation' : 'dialog'}
          aria-modal={roleNavigation ? undefined : 'true'}
          aria-labelledby={idTitre}
          className={`w-full ${widthClass} bg-white border-s border-slate-200 shadow-2xl flex flex-col
            max-sm:rounded-t-2xl max-sm:border-s-0 max-sm:border-t
            /* La docstring annonce une feuille montante laissant de la page
               visible : sans borne de hauteur, le tiroir prenait 100 % de la
               hauteur, et les arrondis du haut ne bordaient rien. Sur un
               téléphone en paysage — 390 × 600 — il n'y avait plus de page à
               défiler derrière pour comprendre d'où vient le panneau. */
            max-sm:max-h-[88dvh]
            animate-sheet-up sm:animate-panel-in
            h-full sm:h-auto sm:inset-y-0`}
        >
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <h2 id={idTitre} className="text-sm font-bold text-slate-900 leading-snug">
                {title}
              </h2>
              {subtitle && (
                <p id={idDescription} className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  {subtitle}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 -me-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
              aria-label={libelles['panneau.fermer']}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/*
            La zone défilante est focusable et nommée, comme les tableaux. Sur
            une fiche longue, quelqu'un qui navigue au clavier ne peut pas faire
            défiler le corps du tiroir : les flèches font défiler la page
            derrière, qui ne bouge pas.
          */}
          <div
            tabIndex={0}
            role="region"
            aria-label={`Contenu — ${title}`}
            className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto flex-1 min-h-0 scroll-region"
          >
            {children}
          </div>

          {footer && (
            <div className="px-4 sm:px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0 safe-area-bottom">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}