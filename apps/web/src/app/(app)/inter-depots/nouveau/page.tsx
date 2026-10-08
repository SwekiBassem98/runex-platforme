'use client';

/** Ajouter un inter dépôt (`?type=LIVRAISON|RETOUR`). */
import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Spinner } from '@logixpress/ui';
import { InterDepotEdition } from '@/features/inter-depots/InterDepotEdition';

function Contenu() {
  const type = useSearchParams().get('type') === 'RETOUR' ? 'RETOUR' : 'LIVRAISON';
  return <InterDepotEdition key={type} type={type} />;
}

export default function NouvelInterDepotPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><Spinner /></div>}>
      <Contenu />
    </Suspense>
  );
}
