'use client';

import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Modal } from '@logixpress/ui';
import { FormulaireChangementMotDePasse } from '@/features/motdepasse/FormulaireChangement';

/**
 * Barre supérieure de l'exploitation : changer son mot de passe
 * (`POST /auth/change-password`). Le portail expéditeur a le même formulaire
 * dans son écran « Profil ».
 */
export function PasswordSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Changer mon mot de passe"
        title="Changer mon mot de passe"
        data-testid="password-settings"
        className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
      >
        <KeyRound className="w-5 h-5" aria-hidden="true" />
      </button>
      {open && (
        <Modal
          isOpen
          onClose={() => setOpen(false)}
          title="Changer mon mot de passe"
          subtitle="Mot de passe actuel exigé. Vos autres appareils seront déconnectés."
          size="md"
        >
          <FormulaireChangementMotDePasse />
        </Modal>
      )}
    </>
  );
}
