import React from 'react';
import type { EtatBonRetour } from '@/lib/api';

/** États d'un bon de retour : libellé et couleur, les mêmes partout. */
export const ETATS_BON: Record<EtatBonRetour, { libelle: string; classe: string }> = {
  PREPARE: { libelle: 'En préparation', classe: 'bg-slate-100 text-slate-700 border-slate-200' },
  EN_COURS: { libelle: 'En cours de livraison', classe: 'bg-blue-50 text-blue-700 border-blue-200' },
  REMIS: { libelle: 'Remis à l’expéditeur', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ANNULE: { libelle: 'Annulé', classe: 'bg-red-50 text-red-700 border-red-200' },
};

export function EtatBon({ status }: { status: EtatBonRetour }) {
  const e = ETATS_BON[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${e.classe}`}>
      {e.libelle}
    </span>
  );
}
