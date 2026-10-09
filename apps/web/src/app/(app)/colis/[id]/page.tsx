'use client';

/**
 * Fiche d'un colis par son adresse : `/colis/<id>`.
 *
 * Les notifications (« Livraison partielle », « Statut de livraison modifié »…),
 * la recherche globale et le magasin mènent ici. La fiche s'ouvre dans le
 * module Colis, avec le retour à la liste habituel.
 */

import { useParams } from 'next/navigation';
import { ColisManagementModule } from '@/features/ColisManagementModule';
import { useAuth } from '@/lib/auth';

export default function ColisDetailPage() {
  const { user, accessToken } = useAuth();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ''));

  if (!user) return null;

  return (
    <ColisManagementModule
      key={id}
      currentUser={user}
      token={accessToken ?? ''}
      initialColisId={id || null}
    />
  );
}
