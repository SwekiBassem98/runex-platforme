'use client';

/**
 * Bandeau des cinq chiffres de la caisse.
 *
 * Réutilisé par `/finance`, `/paiements` et les vues par expéditeur et par
 * livreur : ces quatre écrans répondent à la même question — « combien
 * d'argent les livreurs ont-ils pris, combien la caisse a-t-il validé, et
 * combien manque-t-il ? » — et doivent donc afficher les mêmes chiffres,
 * calculés par le même appel.
 *
 * Les montants arrivent en chaîne depuis l'API et sont mis en forme sans
 * repasser par un flottant.
 */

import React from 'react';
import { formatMoney } from '@logixpress/ui';
import type { PaymentSummaryDto } from '@logixpress/types';

interface Props {
  summary: PaymentSummaryDto;
  isLoading?: boolean;
}

function Tile({
  title,
  value,
  hint,
  tone = 'default',
}: {
  title: string;
  value: string;
  hint: string;
  tone?: 'default' | 'warning' | 'success' | 'danger';
}) {
  const toneClass = {
    default: 'border-slate-200 bg-white',
    warning: 'border-amber-300 bg-amber-50',
    success: 'border-emerald-300 bg-emerald-50',
    danger: 'border-rose-300 bg-rose-50',
  }[tone];

  return (
    <div className={`rounded-lg border p-4 shadow-xs ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-2 font-mono text-xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

export function CashSummaryStrip({ summary, isLoading = false }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[104px] rounded-lg border border-slate-200 bg-slate-50 animate-pulse" />
        ))}
      </div>
    );
  }

  // Un écart n'est pas un montant en attente : l'argent a été pris, il
  // manque. Les deux sont donc affichés séparément, jamais additionnés.
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Tile
        title="Attendu"
        value={formatMoney(summary.totalExpected)}
        hint={`${summary.totalCollected ? formatMoney(summary.totalCollected) : '0.000 DT'} encaissés`}
      />
      <Tile
        title="Encaissé"
        value={formatMoney(summary.totalCollected)}
        hint={`dont ${formatMoney(summary.totalRefunded)} remboursés`}
      />
      <Tile
        title="En attente"
        value={formatMoney(summary.pending)}
        hint={`${summary.pendingCount} encaissement(s) non validés`}
        tone="warning"
      />
      <Tile
        title="Validé"
        value={formatMoney(summary.validated)}
        hint={`${summary.validatedCount} encaissement(s) signés`}
        tone="success"
      />
      <Tile
        title="Écarts"
        value={formatMoney(summary.discrepancy)}
        hint={`${summary.discrepancyCount} encaissement(s) non soldés`}
        tone={summary.discrepancyCount > 0 ? 'danger' : 'default'}
      />
    </div>
  );
}

export default CashSummaryStrip;
