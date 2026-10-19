'use client';

/**
 * Confirmation de suppression d'un document (bon de retour, bordereau
 * inter-dépôt) : ce qui va se passer, puis « Supprimer ». Réservé aux
 * administrateurs (bouton affiché via `usePeutSupprimer`).
 */

import React from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Modal } from '@logixpress/ui';

export function ConfirmerSuppression({
  titre,
  consequences,
  bloque,
  enCours,
  onClose,
  onConfirm,
}: {
  titre: string;
  /** Effets de la suppression, une phrase par ligne. */
  consequences: string[];
  /** Raison pour laquelle la suppression est impossible (le bouton disparaît). */
  bloque?: string | null;
  enCours: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      isOpen
      onClose={() => !enCours && onClose()}
      title={titre}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={enCours}
            className="px-3 py-1.5 rounded-md border border-slate-200 text-sm cursor-pointer"
          >
            {bloque ? 'Fermer' : 'Annuler'}
          </button>
          {!bloque && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={enCours}
              data-testid="confirmer-suppression"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {enCours ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
              Supprimer
            </button>
          )}
        </div>
      }
    >
      {bloque ? (
        <p className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          {bloque}
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm text-slate-700 list-disc ps-5">
          {consequences.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li className="text-slate-500">La suppression est inscrite au journal d’audit.</li>
        </ul>
      )}
    </Modal>
  );
}
