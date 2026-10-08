'use client';

/**
 * Fenêtre modale.
 *
 * Une modale masque tout ce qui est derrière : tant qu'elle est ouverte, ce
 * qu'il y a dessous n'existe plus pour la souris, ni pour la tabulation. Trois
 * règles en découlent, et ce composant les porte pour que l'application n'ait
 * pas à s'en rappeler sur chaque écran.
 *
 * **Elle confine le focus.** Sans cela, Tabulation parcourt la page *derrière* la
 * modale : le focus part sur un bouton qu'on ne voit pas, et rien n'indique
 * pourquoi la tabulation semble ne rien faire.
 *
 * **Elle rend le focus à la fermeture.** Sinon le focus retombe sur `<body>` et
 * la tabulation repart du haut de la page — donc, après chaque ouverture, on
 * recommence sa navigation depuis le début.
 *
 * **Elle s'annonce.** `role="dialog"` et `aria-modal` disent aux lecteurs
 * d'écran ce qu'ils ont sous les yeux ; `aria-labelledby` leur donne le titre,
 * sinon ils annoncent « dialogue » sans dire lequel.
 *
 * Sur un écran étroit ou en paysage de téléphone, une modale centrée mange la
 * hauteur utile. Elle devient alors une feuille remontée du bas, ce qui laisse
 * le contexte derrière visible — l'utilisateur voit ce sur quoi il travaille au
 * lieu de se retrouver devant un mur blanc.
 */

import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';
import { useComportementCalque, useId } from '../hooks/useInterface';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Désactive la fermeture par Échap et le clic sur le fond, pour une confirmation obligatoire. */
  verrouille?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  verrouille = false,
}: ModalProps) {
  const { libelles } = useLibellesUI();
  const idTitre = useId('modal');
  const idDescription = useId('modal-desc');
  const refDeclencheur = useRef<HTMLElement | null>(null);

  const refModale = useComportementCalque<HTMLDivElement>({
    ouvert: isOpen,
    onFermer: verrouille ? () => {} : onClose,
    piegeFocus: true,
    refDeclencheur,
  });

  // Le déclencheur est mémorisé au moment de l'ouverture, pas au rendu : un
  // `ref` sur un bouton qui vient d'être démonté par le rechargement de la
  // liste ne contiendrait plus rien à la fermeture.
  const refPrecedente = React.useRef<HTMLElement | null>(null);
  if (isOpen && !refPrecedente.current) {
    refPrecedente.current = document.activeElement as HTMLElement | null;
  }
  refDeclencheur.current = refPrecedente.current;
  React.useEffect(() => {
    if (!isOpen) refPrecedente.current = null;
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClass = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-overlay-in"
        onClick={verrouille ? undefined : onClose}
        aria-hidden="true"
      />

      <div
        ref={refModale}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        aria-describedby={subtitle ? idDescription : undefined}
        className={`relative w-full ${sizeClass} bg-white sm:rounded-xl rounded-t-2xl shadow-2xl border border-slate-200 z-10 flex flex-col max-h-[92dvh] sm:max-h-[90vh] sm:my-4 animate-sheet-up sm:animate-panel-in`}
      >
        {/* Anse de saisie sur les écrans tactiles : sans elle, une feuille
            collée au bas se referme par inadvertance. */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-slate-300" />
        </div>

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
            disabled={verrouille}
            className="p-1.5 -me-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            aria-label={libelles['fenetre.fermer']}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto flex-1">{children}</div>

        {footer && (
          <div className="px-4 sm:px-6 py-3 bg-slate-50 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0 safe-area-bottom">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}