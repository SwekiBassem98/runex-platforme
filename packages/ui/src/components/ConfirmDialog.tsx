'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmer',
  cancelText = 'Annuler',
  type = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const icon = {
    danger: <AlertCircle className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />,
    info: <Info className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />,
  }[type];

  const confirmBtnClass = {
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white',
    info: 'bg-slate-900 hover:bg-slate-800 text-white',
  }[type];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      /* Le message est l'information la plus importante d'une confirmation : il
         est donc le sous-titre du dialogue, relié par `aria-describedby`. Rendu
         dans le corps, il n'était ni annoncé ni rattaché à la boîte de dialogue
         — l'utilisateur entendait « Confirmer », sans savoir sur quoi. */
      subtitle={message}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="w-full sm:w-auto px-4 py-2 border border-slate-300 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            aria-busy={isLoading}
            className={`w-full sm:w-auto px-4 py-2 rounded-md text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer ${confirmBtnClass}`}
          >
            {isLoading && (
              <span
                aria-hidden="true"
                className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"
              />
            )}
            <span>{confirmText}</span>
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">{icon}</div>
    </Modal>
  );
}
