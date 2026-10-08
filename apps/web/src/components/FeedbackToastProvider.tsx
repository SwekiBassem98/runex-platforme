'use client';

import React, { useCallback } from 'react';
import { ToastProvider, type ToastItem } from '@logixpress/ui';
import { playFeedback, SOUND_KINDS, type SoundKind } from '@/lib/feedback';

const BY_TYPE: Partial<Record<ToastItem['type'], SoundKind>> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
};

/**
 * Notifications de l'application avec leur retour sonore : chaque succès,
 * refus ou avertissement annoncé à l'écran est aussi entendu (téléphone en
 * poche, opérateur au scanner). Un écran peut choisir un autre son
 * (`sound: 'complete'`) ou le taire (`sound: false`).
 */
export function FeedbackToastProvider({ children }: { children: React.ReactNode }) {
  const onToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    if (toast.sound === false) return;
    const kind =
      typeof toast.sound === 'string' && (SOUND_KINDS as string[]).includes(toast.sound)
        ? (toast.sound as SoundKind)
        : BY_TYPE[toast.type];
    if (kind) playFeedback(kind);
  }, []);
  return <ToastProvider onToast={onToast}>{children}</ToastProvider>;
}
