'use client';

/**
 * Cumul des encaissements par expéditeur.
 *
 * Vue de réclamation : un expéditeur qui écrit « on m'a livré sans payer »
 * doit pouvoir vérifier en une ligne combien on lui devait, combien on a
 * encaissé, et ce qui reste en suspens. L'écart est affiché par expéditeur,
 * parce que c'est à ce niveau qu'on relance.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, PageHeader, Table, Tbody, Td, Th, Thead, Tr, formatMoney } from '@logixpress/ui';
import { cashApi } from '@/lib/api';
import type { ShipperPaymentsDto } from '@logixpress/types';

export default function PaiementsExpediteursPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ShipperPaymentsDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await cashApi.byShipper();
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Chargement impossible.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Les gros reliquats d'abord : c'est l'ordre dans lequel on appelle.
  const sorted = [...rows].sort((a, b) => Number(b.discrepancy) - Number(a.discrepancy));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caisse par expéditeur"
        description="Cumul des montants pris sur les colis de chaque expéditeur, et ce qui reste dû."
        breadcrumbs={[
          { label: 'Finance' },
          { label: 'Paiements', href: '/paiements' },
          { label: 'Par expéditeur', active: true },
        ]}
      />

      <div className="px-6 space-y-4">
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <Card className="p-0">
          <Table>
            <Thead>
              <tr>
                <Th>Expéditeur</Th>
                <Th align="right">Colis</Th>
                <Th align="right">Attendu</Th>
                <Th align="right">Encaissé</Th>
                <Th align="right">En attente</Th>
                <Th align="right">Validé</Th>
                <Th align="right">Écart</Th>
              </tr>
            </Thead>
            <Tbody>
              {sorted.map((row) => (
                <Tr
                  key={row.shipperId}
                  onClick={() => router.push(`/paiements?shipperId=${row.shipperId}`)}
                  className="cursor-pointer"
                >
                  <Td className="font-medium">{row.shipperName}</Td>
                  <Td align="right" className="text-xs text-slate-500">
                    {row.count}
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(row.totalExpected)}
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(row.totalCollected)}
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(row.pending)}
                  </Td>
                  <Td align="right" className="font-mono text-xs text-emerald-700">
                    {formatMoney(row.validated)}
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    <span
                      className={
                        row.discrepancyCount > 0 ? 'text-rose-600 font-semibold' : 'text-slate-500'
                      }
                    >
                      {formatMoney(row.discrepancy)}
                    </span>
                    {row.discrepancyCount > 0 && (
                      <span className="ml-1 text-[11px] text-slate-500">
                        ({row.discrepancyCount})
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
              {!isLoading && sorted.length === 0 && (
                <tr>
                  <Td className="text-center text-slate-500 py-8">Aucun encaissement enregistré.</Td>
                </tr>
              )}
            </Tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
