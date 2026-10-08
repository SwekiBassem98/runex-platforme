'use client';

/** Édition d'un inter-dépôt : en-tête, scan de chargement, état d'acceptation. */
import React from 'react';
import { useParams } from 'next/navigation';
import { InterDepotEdition } from '@/features/inter-depots/InterDepotEdition';

export default function InterDepotDetailPage() {
  const params = useParams<{ numero: string }>();
  const numero = decodeURIComponent(String(params?.numero ?? ''));
  return <InterDepotEdition key={numero} type="LIVRAISON" numero={numero} />;
}
