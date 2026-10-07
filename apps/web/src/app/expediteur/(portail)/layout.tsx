'use client';

/**
 * Portail expéditeur : point d'entrée de l'espace client.
 *
 * Deux cadres sont posés ici, une fois pour toutes les routes du groupe.
 *
 * `I18nProvider` d'abord : langue, direction d'écriture, formatage des dates et
 * libellés du design system. Il enveloppe la garde et non l'inverse, pour que la
 * langue soit déjà appliquée à l'écran de connexion à la session expirée, qui
 * s'affiche quand même.
 *
 * `RequireExpediteur` ensuite : elle ne monte son enfant que pour une session
 * `EXPEDITEUR`, donc aucune requête n'est émise avant que le rôle soit connu.
 */

import React from 'react';
import { RequireExpediteur } from '@/components/RequireExpediteur';
import { I18nProvider } from '@/i18n';
import { CoquillePortail } from '@/features/expediteur/shell/CoquillePortail';

export default function ExpediteurLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <RequireExpediteur>
        <CoquillePortail>{children}</CoquillePortail>
      </RequireExpediteur>
    </I18nProvider>
  );
}