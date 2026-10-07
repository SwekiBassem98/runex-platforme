'use client';

/**
 * Écran « Runsheets Livreurs » : délègue au module métier migré depuis
 * l'application Vite.
 */

import { RunsheetManagementModule } from '@/features/RunsheetManagementModule';
import { useAuth } from '@/lib/auth';

export default function RunsheetsPage() {
  const { user, accessToken } = useAuth();

  if (!user) return null;

  return <RunsheetManagementModule currentUser={user} token={accessToken ?? ''} />;
}
