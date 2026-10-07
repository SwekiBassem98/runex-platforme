'use client';

import React from 'react';
import { AppLayout, RequireAuth } from '@/components/AppLayout';
import { NotificationProvider } from '@/lib/notification-provider';

/**
 * Groupe de routes authentifiées : toute page placée sous `(app)` exige une
 * session valide et s'affiche dans la coquille applicative.
 *
 * Le centre de notifications est monté ici, au-dessus de la coquille, pour que
 * le bandeau et les pages lisent le même état et la même connexion temps réel.
 */
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <NotificationProvider>
        <AppLayout>{children}</AppLayout>
      </NotificationProvider>
    </RequireAuth>
  );
}