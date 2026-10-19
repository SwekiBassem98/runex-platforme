'use client';

/**
 * Finance — paiements des expéditeurs : à régler, à payer, payé, retenu, avec
 * la recherche d'un expéditeur et sa fiche (tarif, calcul, bordereaux).
 *
 * La mise en page vit dans `features/finance/TableauFinance`.
 */

import { TableauFinance } from '@/features/finance/TableauFinance';

export default function FinancePage() {
  return <TableauFinance />;
}
