'use client';

import React from 'react';
import { Modal } from '@logixpress/ui';
import type { BonRetour, EtatBonRetour } from '@/lib/api';
import { ETATS_BON } from './EtatBon';

/** Confirmation d'un changement d'état, avec ce qu'il entraîne pour les colis. */
export function ModalEtat({
  changement,
  receveur,
  setReceveur,
  occupe,
  onClose,
  onConfirm,
}: {
  changement: { bon: BonRetour; status: EtatBonRetour } | null;
  receveur: string;
  setReceveur: (v: string) => void;
  occupe: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const b = changement?.bon;
  const s = changement?.status;
  const effet: Record<EtatBonRetour, string> = {
    EN_COURS: `Les ${b?.colisCount ?? 0} colis partent avec ${b?.driverName ?? 'le livreur'} : ils passent « en cours de restitution ».`,
    REMIS: `Les ${b?.colisCount ?? 0} colis sont restitués à ${b?.shipperName ?? "l'expéditeur"}. Cette action est définitive.`,
    PREPARE: 'Le livreur n’a pas pu remettre le bon : les colis reviennent au dépôt et le bon redevient modifiable.',
    ANNULE: 'Le bon est annulé : ses colis redeviennent « à rendre » et pourront entrer dans un autre bon.',
  };
  return (
    <Modal
      isOpen={!!changement}
      onClose={() => !occupe && onClose()}
      title={b && s ? `Bon ${b.slipNumber} : ${s === 'PREPARE' ? 'revenu au dépôt' : ETATS_BON[s].libelle.toLowerCase()}` : ''}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm">
            Annuler
          </button>
          <button
            type="button"
            disabled={occupe}
            onClick={onConfirm}
            data-testid="confirmer-etat"
            className={`px-3 py-1.5 rounded-md text-white text-sm disabled:opacity-50 ${
              s === 'ANNULE' ? 'bg-red-600' : 'bg-emerald-600'
            }`}
          >
            Confirmer
          </button>
        </div>
      }
    >
      {s && (
        <div className="space-y-3 text-sm">
          <p className="text-slate-700">{effet[s]}</p>
          {s === 'REMIS' && (
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Reçu par (nom, facultatif)</span>
              <input
                value={receveur}
                maxLength={150}
                onChange={(e) => setReceveur(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2"
              />
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
