'use client';

/**
 * Écran d'ouverture d'une page : affiché dès le clic dans le menu, le temps
 * que la page arrive. La forme reprend celle des écrans (en-tête, cartes,
 * tableau) pour que la page « se remplisse » au lieu de sauter.
 */

import React from 'react';

export function PageEnChargement({ titre }: { titre?: string }) {
  return (
    <div className="relative min-h-[60vh]" role="status" aria-live="polite" data-testid="page-en-chargement">
      <span className="sr-only">{titre ? `Ouverture de ${titre}` : 'Ouverture de la page'}</span>

      {/* Squelette de page : en-tête, cartes, tableau. */}
      <div aria-hidden="true" className="animate-pulse">
        <div className="border-b border-slate-200 bg-white px-4 sm:px-6 py-4 space-y-3">
          <div className="h-3 w-32 rounded bg-slate-200" />
          <div className="h-6 w-64 rounded bg-slate-200" />
          <div className="h-3 w-96 max-w-full rounded bg-slate-100" />
        </div>
        <div className="px-4 sm:px-6 py-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="h-3 w-24 rounded bg-slate-200" />
                <div className="h-7 w-32 rounded bg-slate-200" />
                <div className="h-3 w-40 rounded bg-slate-100" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="h-4 w-48 rounded bg-slate-200" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>

      {/* Indicateur central, aux couleurs de RUNEX. */}
      <div className="pointer-events-none absolute inset-x-0 top-40 flex justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
          <span className="relative flex h-7 w-7 items-center justify-center">
            <span className="absolute inset-0 rounded-full border-2 border-red-100" />
            <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-red-600 animate-spin" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/runex-mark.png" alt="" className="h-3.5 w-3.5 object-contain" />
          </span>
          <span className="text-sm font-medium text-slate-700">
            {titre ? (
              <>
                Ouverture de <span className="font-semibold text-slate-900">{titre}</span>…
              </>
            ) : (
              'Ouverture…'
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Fine barre de progression en haut de l'écran, pendant une navigation. */
export function BarreNavigation({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-red-100" aria-hidden="true">
      <div className="h-full w-1/3 bg-red-600 animate-[runex-nav_1.1s_ease-in-out_infinite]" />
    </div>
  );
}
