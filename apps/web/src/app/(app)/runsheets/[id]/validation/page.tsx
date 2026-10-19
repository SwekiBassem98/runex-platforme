'use client';

/**
 * Validation d'une tournée par la caisse (comme « Validation runsheet » chez
 * ADEX). La mise en page vit dans `features/runsheets/ValidationTournee`.
 */

import { useParams } from 'next/navigation';
import { ValidationTournee } from '@/features/runsheets/ValidationTournee';

export default function ValidationTourneePage() {
  const params = useParams<{ id: string }>();
  return <ValidationTournee id={decodeURIComponent(String(params?.id ?? ''))} />;
}
