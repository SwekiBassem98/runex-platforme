'use client';

/**
 * Compteurs de la liste des tournées (comme ADEX) : à valider, non soldées
 * (déficit), validées correctes, toutes — chacun avec sa part en anneau.
 * Un clic ouvre la vue correspondante.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Layers, type LucideIcon } from 'lucide-react';
import type { CompteursTournees } from '@/lib/api';

function Anneau({ part, couleur }: { part: number; couleur: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative w-12 h-12 shrink-0">
      <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={couleur}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * Math.min(100, part)) / 100}
          style={{ transition: 'stroke-dashoffset 700ms ease-out' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{Math.round(part)}%</span>
    </span>
  );
}

export function CompteursValidation({
  compteurs,
  actif,
  onChoisir,
}: {
  compteurs: CompteursTournees | null;
  actif: 'actives' | 'historique';
  onChoisir: (vue: 'actives' | 'historique', statut?: string) => void;
}) {
  const total = compteurs?.total ?? 0;
  const part = (n: number) => (total ? (n / total) * 100 : 0);
  const tuiles: { cle: string; libelle: string; n: number; icone: LucideIcon; couleur: string; fond: string; vue: 'actives' | 'historique'; statut?: string }[] = [
    { cle: 'aValider', libelle: 'Tournées à valider', n: compteurs?.aValider ?? 0, icone: Clock3, couleur: '#ffffff', fond: 'bg-slate-800 text-white border-slate-800', vue: 'actives' },
    { cle: 'deficit', libelle: 'Non soldées (déficit)', n: compteurs?.deficit ?? 0, icone: AlertTriangle, couleur: '#dc2626', fond: 'bg-white text-red-700 border-red-200', vue: 'historique', statut: 'CLOTUREE_DEFICIT' },
    { cle: 'conformes', libelle: 'Validées correctes', n: compteurs?.conformes ?? 0, icone: CheckCircle2, couleur: '#059669', fond: 'bg-white text-emerald-700 border-emerald-200', vue: 'historique', statut: 'CLOTUREE_CONFORME' },
    { cle: 'total', libelle: 'Toutes les tournées', n: total, icone: Layers, couleur: '#475569', fond: 'bg-white text-slate-700 border-slate-200', vue: 'historique' },
  ];
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" data-testid="compteurs-tournees">
      {tuiles.map((t) => {
        const Icone = t.icone;
        const choisi = t.cle === 'aValider' ? actif === 'actives' : false;
        return (
          <li key={t.cle}>
            <button
              type="button"
              onClick={() => onChoisir(t.vue, t.statut)}
              data-testid={`compteur-${t.cle}`}
              className={`w-full flex items-center justify-between gap-3 rounded-2xl border p-4 text-left shadow-xs hover:shadow-md hover:-translate-y-0.5 transition cursor-pointer ${t.fond} ${choisi ? 'ring-2 ring-red-500/40' : ''}`}
            >
              <span className="min-w-0">
                <span className="block text-2xl font-extrabold tabular-nums">
                  {compteurs ? (
                    <>
                      {t.n}
                      <span className="text-sm font-semibold opacity-60">/{total}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold opacity-90">
                  <Icone className="w-3.5 h-3.5" aria-hidden="true" /> {t.libelle}
                </span>
              </span>
              <Anneau part={part(t.n)} couleur={t.couleur} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
