'use client';

import React from 'react';
import { ETATS_SOUS_TRAITANCE, type EtatSousTraitance } from '@logixpress/types';

const TONS: Record<EtatSousTraitance, string> = {
  ECHEC_ENVOI: 'bg-red-50 text-red-800 border-red-200',
  EN_ATTENTE_ENLEVEMENT: 'bg-slate-100 text-slate-700 border-slate-300',
  ENLEVEMENT_DEMANDE: 'bg-sky-50 text-sky-800 border-sky-200',
  PRIS_EN_CHARGE: 'bg-violet-50 text-violet-800 border-violet-200',
  EN_LIVRAISON: 'bg-amber-50 text-amber-800 border-amber-200',
  LIVRE: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  RETOUR_EN_COURS: 'bg-rose-50 text-rose-800 border-rose-200',
  RETOURNE: 'bg-neutral-100 text-neutral-700 border-neutral-300',
  ANNULE: 'bg-gray-100 text-gray-500 border-gray-200',
};

/** Étape d'un colis chez le partenaire JAX. */
export function EtatJax({ etat, court = false }: { etat: EtatSousTraitance | string; court?: boolean }) {
  const e = etat as EtatSousTraitance;
  const libelle = ETATS_SOUS_TRAITANCE[e] ?? etat;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${TONS[e] ?? TONS.ANNULE}`}>
      {court ? libelle.replace(/ — .*/, '') : libelle}
    </span>
  );
}

/** Petite pastille « JAX » pour les listes de colis. */
export function PastilleJax({ titre }: { titre?: string }) {
  return (
    <span
      title={titre ?? 'Livraison confiée au partenaire JAX'}
      className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-600 text-white text-[9px] font-bold tracking-wide"
      data-testid="pastille-jax"
    >
      JAX
    </span>
  );
}
