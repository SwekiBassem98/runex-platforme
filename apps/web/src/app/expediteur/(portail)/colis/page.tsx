'use client';

import { Suspense } from 'react';
import { VueColis } from '@/features/expediteur/colis/VueColis';
import { ChargementEnCours } from '@logixpress/ui';

export default function ColisPage() {
  return (
    // `useSearchParams` exige un périmètre suspense pour le rendu statique.
    <Suspense fallback={<ChargementEnCours message="Chargement des colis" />}>
      <VueColis />
    </Suspense>
  );
}
