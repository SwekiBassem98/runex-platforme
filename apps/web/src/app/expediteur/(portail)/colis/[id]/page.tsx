'use client';

import { use } from 'react';
import { VueColisDetail } from '@/features/expediteur/colis/VueColisDetail';

export default function ColisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <VueColisDetail identifiant={id} />;
}
