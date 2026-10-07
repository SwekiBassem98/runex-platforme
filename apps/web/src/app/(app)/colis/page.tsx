'use client';

/**
 * Écran « Gestion des Colis » : délègue au module métier migré depuis
 * l'application Vite.
 */

import { ColisManagementModule } from '@/features/ColisManagementModule';
import { useAuth } from '@/lib/auth';

export default function ColisPage() {
  const { user, accessToken } = useAuth();

  if (!user) return null;

  return <ColisManagementModule currentUser={user} token={accessToken ?? ''} />;
}
