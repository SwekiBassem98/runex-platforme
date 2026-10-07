'use client';

/**
 * Module Finance — tableau de bord de la caisse.
 *
 * Cette page répond à une seule question, celle du contrôleur en fin de
 * journée : « l'argent du COD est-il rentré, validé et carré ? ». Elle
 * affiche donc un bilan global, puis la liste de ce qui bloque encore — les
 * écarts d'abord, parce que ce sont eux qui empêchent de clôturer.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, PageHeader, Badge, formatMoney } from '@logixpress/ui';
import { cashApi } from '@/lib/api';
import { CashSummaryStrip } from '@/features/finance/CashSummaryStrip';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PaymentStatus,
  type PaymentDto,
  type PaymentSummaryDto,
} from '@logixpress/types';

const STATUS_VARIANT: Record<PaymentStatus, 'default' | 'success' | 'warning' | 'danger' | 'secondary'> = {
  EN_ATTENTE: 'warning',
  VALIDE: 'success',
  ECARTE: 'danger',
  REMBOURSE: 'secondary',
  ANNULE: 'default',
};

const ACTIONS = [
  { label: 'Tous les encaissements', to: '/paiements' },
  { label: 'Suivre par expéditeur', to: '/paiements/expediteurs' },
  { label: 'Apurer par livreur', to: '/paiements/livreurs' },
  { label: 'Bordereaux à valider', to: '/paiements/bordereaux' },
];

export default function FinancePage() {
  const router = useRouter();
  const [summary, setSummary] = useState<PaymentSummaryDto | null>(null);
  const [open, setOpen] = useState<PaymentDto[]>([]);
  /*
   * La liste n'affiche que les premiers encaissements, pour ne pas charger tout
   * l'historique d'un coup. Le compteur du résumé fait autorité : sans lui, la
   * caisse voyait vingt lignes sous un titre silencieusement tronqué, et lisait
   * « la caisse est à jour » alors que deux cents encaissements attendaient.
   */
  const [limiteAffichee, setLimiteAffichee] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [totals, list] = await Promise.all([
        cashApi.summary(),
        cashApi.list({ status: 'EN_ATTENTE', limit: limiteAffichee }),
      ]);
      setSummary(totals);
      setOpen(list.data ?? []);
    } catch (err) {
      setSummary(null);
      setOpen([]);
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, [limiteAffichee]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tant qu'un écart traîne, le total « encaissé » veut dire « pris par les
  // livreurs », pas « reçu par la caisse ». Le bandeau le signale, et cette
  // liste dit lesquels.
  const blocked = summary && summary.discrepancyCount > 0;
  const enAttente = summary?.pendingCount ?? open.length;
  const tronques = enAttente > open.length && open.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Bilan de la caisse COD : attendu, encaissé, validé, et ce qui ne se solde pas."
        breadcrumbs={[{ label: 'Finance', active: true }]}
        actions={
          <div className="flex gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.to}
                type="button"
                onClick={() => router.push(a.to)}
                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded text-xs font-semibold transition cursor-pointer"
              >
                {a.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-6 space-y-4">
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {summary && <CashSummaryStrip summary={summary} isLoading={isLoading} />}

        {summary && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title="Répartition" subtitle="Réponses à donner aux clients (COD).">
              <dl className="space-y-2">
                <div className="flex justify-between text-xs">
                  <dt className="text-slate-500">Encaissements attendus</dt>
                  <dd className="font-mono font-semibold">
                    {Object.values(summary.byStatus).reduce((n, s) => n + s.count, 0)}
                  </dd>
                </div>
                <div className="flex justify-between text-xs">
                  <dt className="text-slate-500">Moyens acceptés</dt>
                  <dd className="text-slate-700">
                    {Object.values(PAYMENT_METHOD_LABELS).join(', ')}
                  </dd>
                </div>
                <div className="flex justify-between text-xs">
                  <dt className="text-slate-500">Remboursements</dt>
                  <dd className="font-mono font-semibold">
                    {formatMoney(summary.totalRefunded)}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card
              className="lg:col-span-2"
              title={`En attente de la caisse${isLoading ? '' : ` (${enAttente})`}`}
              subtitle="Ce que les livreurs ont pris et qui n'est pas encore signé." 
              action={
                <button
                  type="button"
                  onClick={() => router.push('/paiements?status=EN_ATTENTE')}
                  className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 rounded text-xs font-semibold"
                >
                  Traiter
                </button>
              }
            >
              <div className="space-y-1.5">
                {open.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => router.push(`/paiements/${p.id}`)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-slate-200 hover:border-slate-300 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-slate-900">
                        {p.paymentNumber} · #{p.packageTrackingNumber}
                      </span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {p.shipperName} — {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs font-semibold">
                        {formatMoney(p.amountCollected)}
                      </span>
                      <Badge variant={STATUS_VARIANT[p.status]}>
                        {PAYMENT_STATUS_LABELS[p.status]}
                      </Badge>
                    </span>
                  </button>
                ))}
                {/* La troncature est annoncée : une liste qui s'arrête sans le dire
                    se lit comme une liste complète, et c'est ici que se joue la
                    confiance dans les chiffres de la caisse. */}
                {tronques && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    {open.length} sur {enAttente} encaissements en attente sont affichés ici. Le
                    solde se traite depuis « Traiter ».
                  </p>
                )}
                {tronques && (
                  <button
                    type="button"
                    onClick={() => setLimiteAffichee((v) => v + 20)}
                    className="w-full px-3 py-1.5 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                  >
                    Charger 20 encaissements de plus
                  </button>
                )}
                {!isLoading && open.length === 0 && (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                    {enAttente === 0
                      ? 'Aucun encaissement en attente : la caisse est à jour.'
                      : `Aucun des ${enAttente} encaissements en attente n'a pu être chargé.`}
                  </p>
                )}
                {isLoading && (
                  <div className="h-24 rounded-md bg-slate-50 border border-slate-200 animate-pulse" />
                )}
              </div>
            </Card>
          </div>
        )}

        {blocked && (
          <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {summary.discrepancyCount} encaissement(s) présentent un écart de{' '}
            {formatMoney(summary.discrepancy)}. Tant qu'ils ne sont pas soldés ou motivés, les
            totaux ci-dessus ne sont pas définitifs.
          </p>
        )}
      </div>
    </div>
  );
}
