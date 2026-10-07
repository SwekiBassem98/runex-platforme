'use client';

/**
 * Bordereaux de paiement expéditeurs (CRBT).
 * Écran migré depuis l'application Vite, relié au client API commun.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Table, Tbody, Td, Th, Thead, Tr, Badge, formatTND } from '@logixpress/ui';
import { paymentsApi } from '@/lib/api';
import type { PaymentVoucherDto } from '@logixpress/types';

export default function PaiementsPage() {
  const [vouchers, setVouchers] = useState<PaymentVoucherDto[]>([]);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await paymentsApi.list();
      setVouchers(response.data ?? []);
      setMeta(response.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bordereaux de Paiement Expéditeurs (CRBT)"
        description="Règlement périodique des montants recouvrés avec validation par code secret."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Bordereaux', active: true }]}
      />

      <div className="p-6 space-y-4">
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <Card className="p-0">
          <Table>
            <Thead>
              <tr>
                <Th>N° Bordereau</Th>
                <Th>Expéditeur</Th>
                <Th align="center">Livrés / Retours</Th>
                <Th align="right">Brut Encaissé</Th>
                <Th align="right">Net à Payer (CR)</Th>
                <Th align="center">État</Th>
              </tr>
            </Thead>
            <Tbody>
              {isLoading ? (
                <tr>
                  <Td colSpan={6} align="center" className="text-slate-500 py-6">
                    Chargement…
                  </Td>
                </tr>
              ) : vouchers.length === 0 ? (
                <tr>
                  <Td colSpan={6} align="center" className="text-slate-500 py-6">
                    Aucun bordereau.
                  </Td>
                </tr>
              ) : (
                vouchers.map((v) => (
                  <Tr key={v.id}>
                    <Td className="font-mono font-bold text-amber-700">{v.voucherNumber}</Td>
                    <Td className="font-semibold">{v.shipperName}</Td>
                    <Td align="center">
                      <span className="text-emerald-700 font-bold">{v.deliveredCount} L</span>{' '}
                      / <span className="text-red-600 font-bold">{v.returnedCount} R</span>
                    </Td>
                    <Td align="right" className="font-mono">
                      {formatTND(v.grossCashCollected)}
                    </Td>
                    <Td align="right" className="font-mono font-bold text-slate-900">
                      {formatTND(v.netPayable)}
                    </Td>
                    <Td align="center">
                      <Badge variant={v.status === 'PAYE' ? 'success' : 'primary'}>{v.status}</Badge>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </Card>

        {meta && (
          <p className="text-xs text-slate-500">
            Total : {String(meta.total ?? vouchers.length)} bordereau(x)
          </p>
        )}
      </div>
    </div>
  );
}
