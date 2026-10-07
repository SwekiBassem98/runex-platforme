'use client';

import { Suspense } from 'react';
import { ChargementEnCours } from '@logixpress/ui';
import { VueSuivi } from '@/features/expediteur/suivi/VueSuivi';

export default function SuiviPage() {
  return (
    <Suspense fallback={<ChargementEnCours message="Chargement du suivi" />}>
      <VueSuivi />
    </Suspense>
  );
}
