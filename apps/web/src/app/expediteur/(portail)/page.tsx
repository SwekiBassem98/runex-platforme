'use client';

/**
 * Racine du portail.
 *
 * Elle ne rend rien : elle oriente. `/expediteur` est l'adresse que la
 * documentation et les notifications citent ; le tableau de bord est la première
 * chose qu'un expéditeur doit voir.
 */

import { redirect } from 'next/navigation';

export default function ExpediteurPage() {
  redirect('/expediteur/tableau-de-bord');
}
