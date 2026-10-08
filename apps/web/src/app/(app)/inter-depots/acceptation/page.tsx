'use client';

/** Acceptation inter dépôt (`?type=LIVRAISON|RETOUR`). */
import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Spinner } from '@logixpress/ui';
import { InterDepotAcceptation } from '@/features/inter-depots/InterDepotAcceptation';

function Contenu() {
  const type = useSearchParams().get('type') === 'RETOUR' ? 'RETOUR' : 'LIVRAISON';
  return <InterDepotAcceptation key={type} type={type} />;
}

export default function AcceptationInterDepotPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><Spinner /></div>}>
      <Contenu />
    </Suspense>
  );
}
