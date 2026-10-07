'use client';

/**
 * Cumul des encaissements par livreur.
 *
 * Vue de l'apurement des tournées : chaque livreur rapporte l'argent qu'il a
 * pris, la caisse valide ce qu'elle a compté, et l'écart est le reliquat que
 * le livreur n'a pas rapporté. C'est le tableau que le contrôleur consulte
 * avant de clôturer une tournée.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, PageHeader, Table, Tbody, Td, Th, Thead, Tr, formatMoney } from '@logixpress/ui';
import { cashApi } from '@/lib/api';
import type { DriverPaymentsDto } from '@logixpress/types';

export default function PaiementsLivreursPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DriverPaymentsDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await cashApi.byDriver();
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

  // Comparaison pour ordonner l'affichage uniquement : aucune somme ni calcul
  // financier ne passe par là, tous les montants affichés sont ceux de l'API.
  const sorted = [...rows].sort((a, b) => Number(b.discrepancy) - Number(a.discrepancy));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caisse par livreur"
        description="Ce que chaque livreur a rapporté, ce que la caisse a validé, ce qu'il reste à récupérer."
        breadcrumbs={[
          { label: 'Finance' },
          { label: 'Paiements', href: '/paiements' },
          { label: 'Par livreur', active: true },
        ]}
      />

      <div className="px-6 space-y-4">
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-slate-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <Card className="p-0">
          <Table>
            <Thead>
              <tr>
                <Th>Livreur</Th>
                <Th align="right">Encaissements</Th>
                <Th align="right">Rapporté</Th>
                <Th align="right">Validé par la caisse</Th>
                <Th align="right">Restant à rapporter</Th>
                <Th align="right">En attente</Th>
              </tr>
            </Thead>
            <Tbody>
              {sorted.map((row) => (
                <Tr
                  key={row.driverId}
                  onClick={() => router.push(`/paiements?driverId=${row.driverId}`)}
                  className="cursor-pointer"
                >
                  <Td className="font-medium">{row.driverName}</Td>
                  <Td align="right" className="text-xs text-slate-500">
                    {row.count}
                  </Td>
                  <Td align="right" className="font-mono text-xs">
                    {formatMoney(row.totalCollected)}
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
                      <span className="ml-1 text-[11px] text-slate-500">({row.discrepancyCount})</span>
                    )}
                  </Td>
                  <Td align="right" className="font-mono text-xs text-amber-700">
                    {formatMoney(row.pending)}
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
