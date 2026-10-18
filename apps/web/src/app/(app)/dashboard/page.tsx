'use client';

/**
 * Poste de commandement — tableau de bord de l'administration.
 *
 * La mise en page vit dans `features/dashboard-admin` ; la page ne fait que
 * l'afficher.
 */

import { TableauDeBordAdmin } from '@/features/dashboard-admin/TableauDeBordAdmin';

export default function DashboardPage() {
  return <TableauDeBordAdmin />;
}
