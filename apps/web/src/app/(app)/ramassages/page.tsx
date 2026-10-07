'use client';

/**
 * Rendez-vous de ramassage : liste des collectes programmées.
 * Écran migré depuis l'application Vite, relié au client API commun.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, Table, Tbody, Td, Th, Thead, Tr, Badge } from '@logixpress/ui';
import { ramassagesApi } from '@/lib/api';
import type { PickupAppointmentDto } from '@logixpress/types';

export default function RamassagesPage() {
  const [pickups, setPickups] = useState<PickupAppointmentDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await ramassagesApi.list();
      setPickups(response.data ?? []);
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
        title="Rendez-vous de Ramassage"
        description="Collectes programmées auprès des expéditeurs e-commerce."
        breadcrumbs={[{ label: 'Opérations' }, { label: 'Ramassages', active: true }]}
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
                <Th>Référence</Th>
                <Th>Livreur Collecteur</Th>
                <Th>Créneau Horaire</Th>
                <Th>Adresse</Th>
                <Th>Expéditeur</Th>
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
              ) : pickups.length === 0 ? (
                <tr>
                  <Td colSpan={6} align="center" className="text-slate-500 py-6">
                    Aucun rendez-vous de ramassage.
                  </Td>
                </tr>
              ) : (
                pickups.map((pick) => (
                  <Tr key={pick.id}>
                    <Td className="font-mono font-bold text-slate-800">{pick.referenceNumber}</Td>
                    <Td>{pick.assignedDriverName ?? '—'}</Td>
                    <Td className="font-mono">
                      {pick.timeSlotStartHour}h - {pick.timeSlotEndHour}h
                    </Td>
                    <Td>{pick.pickupAddress}</Td>
                    <Td className="font-semibold text-slate-900">{pick.shipperName}</Td>
                    <Td align="center">
                      <Badge variant="warning">{pick.status}</Badge>
                    </Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
