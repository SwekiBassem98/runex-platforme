'use client';

/**
 * Pagination.
 *
 * Elle doit dire deux choses que l'utilisateur ne peut pas deviner : **où** il
 * est, et **combien** il y a en tout. Un « Page 3 » seul ne dit rien sur la
 * taille de la population — et c'est précisément ce qu'on cherche quand on
 * pagine.
 *
 * Les boutons sont annoncés par leur action (« Page précédente ») et non par
 * leur glyphe : une flèche sans nom n'est rien pour un lecteur d'écran, et rien
 * non plus pour quelqu'un qui ne sait pas laquelle des deux flèches va où.
 *
 * Sur un téléphone, le compteur de pages cède la place à « Page 3 sur 47 » : la
 * liste des numéros de page tient mal et devient une seconde barre de défilement
 * horizontale, ce qui est pire que le problème qu'elle devait résoudre.
 */

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';
import { useId } from '../hooks/useInterface';

/**
 * Singulier d'un libellé pluriel.
 *
 * Retirer le « s » final suffit pour « résultats » et échoue sur « colis », qui
 * devient « coli ». Un état vide qui annonce « Aucun coli » fait croire à un
 * défaut d'orthographe — ou, pire, à un état que l'utilisateur ne sait pas
 * interpréter. Les pluriels irréguliers sont donc déclarés.
 */
const SINGULIERS: Record<string, string> = {
  colis: 'colis',
  résultat: 'résultat',
  resultat: 'résultat',
  ligne: 'ligne',
  tournées: 'tournée',
  tournees: 'tournée',
  encaissement: 'encaissement',
  bordereau: 'bordereau',
  expéditeur: 'expéditeur',
  expediteur: 'expéditeur',
  livreur: 'livreur',
  dépôt: 'dépôt',
  depot: 'dépôt',
  transfert: 'transfert',
  navette: 'navette',
  mouvement: 'mouvement',
  entrée: 'entrée',
  notification: 'notification',
  élément: 'élément',
  element: 'élément',
};

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  libelle?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  libelle = 'résultats',
}: PaginationProps) {
  const { libelles, format } = useLibellesUI();
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);
  const nb = Math.max(1, totalPages);
  // Deux paginations sur le même écran — portail expéditeur et liste de colis,
  // par exemple — ne peuvent pas partager l'identifiant du sélecteur de taille :
  // le libellé du second désignerait le premier.
  const idTaille = useId('taille-page');
  const singulier = SINGULIERS[libelle.toLowerCase()] ?? libelle.replace(/s$/, '');

  // Fenêtre glissante : cinq numéros autour de la page courante, recalée aux
  // extrémités pour ne jamais proposer une page vide.
  const fenetre = (): number[] => {
    const largeur = 5;
    let debut = Math.max(1, currentPage - Math.floor(largeur / 2));
    const fin = Math.min(nb, debut + largeur - 1);
    debut = Math.max(1, Math.min(debut, fin - largeur + 1));
    return Array.from({ length: fin - debut + 1 }, (_, i) => debut + i);
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 sm:px-4 py-3 bg-white border-t border-slate-200 text-xs text-slate-600">
      {/*
        Le compteur est une région `status` : changer de page modifie une
        région de la page sans déplacer le focus, et sans cela le changement est
        muet pour un lecteur d'écran.
      */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center justify-center gap-2"
      >
        <span>
          {totalItems === 0 ? (
            format(libelles['pagination.aucun'], { libelle: singulier })
          ) : (
            format(libelles['pagination.resume'], {
              debut: startItem,
              fin: endItem,
              total: totalItems,
              libelle,
            })
          )}
        </span>
        {onPageSizeChange && (
          <>
            <label htmlFor={idTaille} className="sr-only">
              {format(libelles['pagination.nombreParPage'], { libelle })}
            </label>
            <select
              id={idTaille}
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="px-2 py-1 border border-slate-300 rounded bg-slate-50 text-xs text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-600/20"
            >
              <option value={10}>{format(libelles['pagination.parPage'], { n: 10 })}</option>
              <option value={20}>{format(libelles['pagination.parPage'], { n: 20 })}</option>
              <option value={50}>{format(libelles['pagination.parPage'], { n: 50 })}</option>
              <option value={100}>{format(libelles['pagination.parPage'], { n: 100 })}</option>
            </select>
          </>
        )}
      </div>

      <nav aria-label={libelles['pagination.libelle']} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="w-9 h-9 inline-flex items-center justify-center rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          aria-label={libelles['pagination.precedente']}
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>

        {/* Sous 640 px, les numéros de page sont une barre de défilement de plus. */}
        <div className="hidden sm:flex items-center gap-1">
          {fenetre().map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={p === currentPage ? 'page' : undefined}
              aria-label={`${libelles['pagination.page']} ${p}`}
              className={`min-w-9 h-9 px-2 inline-flex items-center justify-center rounded text-xs font-medium border transition cursor-pointer ${
                p === currentPage
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <span className="sm:hidden px-2 text-xs font-medium text-slate-900">
          {currentPage} / {nb}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= nb}
          className="w-9 h-9 inline-flex items-center justify-center rounded border border-slate-300 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          aria-label={libelles['pagination.suivante']}
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
