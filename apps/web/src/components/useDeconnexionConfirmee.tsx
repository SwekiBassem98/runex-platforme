'use client';

/**
 * Déconnexion avec confirmation.
 *
 * Un clic sur « Se déconnecter » (barre latérale, profil, écran refusé) ouvre
 * d'abord une boîte de dialogue : une déconnexion par erreur, au milieu d'une
 * saisie, oblige à retaper ses identifiants. Les textes viennent du
 * dictionnaire : en français pour l'exploitation, dans la langue choisie sur le
 * portail expéditeur.
 *
 *   const { demanderDeconnexion, dialogueDeconnexion } = useDeconnexionConfirmee();
 *   <button onClick={demanderDeconnexion}>…</button>
 *   {dialogueDeconnexion}
 */

import React, { useCallback, useState } from 'react';
import { ConfirmDialog } from '@logixpress/ui';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n';

export function useDeconnexionConfirmee() {
  const { logout, user } = useAuth();
  const { t } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);

  const demanderDeconnexion = useCallback(() => setOuvert(true), []);

  const confirmer = useCallback(async () => {
    setEnCours(true);
    try {
      await logout();
    } finally {
      setEnCours(false);
      setOuvert(false);
    }
  }, [logout]);

  const dialogueDeconnexion = (
    <ConfirmDialog
      isOpen={ouvert}
      onClose={() => {
        if (!enCours) setOuvert(false);
      }}
      onConfirm={() => void confirmer()}
      title={t('deconnexion.titre')}
      message={t('deconnexion.message')}
      confirmText={t('deconnexion.confirmer')}
      cancelText={t('deconnexion.annuler')}
      type="warning"
      isLoading={enCours}
      details={
        user ? (
          <>
            <span className="block text-xs text-slate-500">{t('deconnexion.compte')}</span>
            <span className="block font-semibold text-slate-900 truncate">{user.fullName || user.email}</span>
            <span className="block text-xs text-slate-500 truncate" dir="ltr">
              {user.email}
            </span>
          </>
        ) : undefined
      }
    />
  );

  return { demanderDeconnexion, dialogueDeconnexion };
}
