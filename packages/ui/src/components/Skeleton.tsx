'use client';

import React from 'react';

export function SkeletonLine({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="p-4 bg-white rounded-lg border border-slate-200 shadow-xs space-y-3">
      <SkeletonLine className="h-3 w-1/3" />
      <SkeletonLine className="h-7 w-1/2" />
      <SkeletonLine className="h-3 w-2/3" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  /*
   * Le squelette est décoratif : il n'annonce rien et n'est pas focusable.
   * L'attente est signalée une seule fois, par le texte du parent — sinon un
   * lecteur d'écran traverserait chaque bloc gris comme du contenu.
   */
  return (
    <div aria-hidden="true" className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-slate-100 p-2 space-y-3">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 py-2">
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonLine key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Annonce d'attente.
 *
 * À poser une fois à côté d'un squelette : elle dit ce qui se charge, ce que le
 * silence ne dit pas. `aria-busy` porté par le conteneur fait le reste.
 */
export function ChargementEnCours({ message = 'Chargement en cours' }: { message?: string }) {
  return <span role="status" className="sr-only">{message}</span>;
}
