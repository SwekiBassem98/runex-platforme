'use client';

/**
 * Suppression définitive d'un compte (utilisateur, livreur ou expéditeur).
 *
 * Réservée aux administrateurs. La fenêtre lit d'abord l'aperçu de l'API
 * (`GET /<type>/:id/suppression`) :
 *  - si le compte a un historique (colis, tournées, encaissements…), elle dit
 *    pourquoi la suppression est impossible et propose la désactivation ;
 *  - sinon, elle liste ce qui sera effacé et demande de saisir « SUPPRIMER »
 *    avant d'appeler `DELETE /<type>/:id`.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { Modal } from '@logixpress/ui';
import { RoleType } from '@logixpress/types';
import { request, requestData } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export type RessourceCompte = 'users' | 'drivers' | 'shippers';

interface Apercu {
  type: 'USER' | 'DRIVER' | 'SHIPPER';
  id: string;
  nom: string;
  detail: string;
  possible: boolean;
  obstacles: { libelle: string; nombre: number }[];
  consequences: string[];
}

const MOT = 'SUPPRIMER';

const QUOI: Record<RessourceCompte, { titre: string; article: string }> = {
  users: { titre: 'ce compte utilisateur', article: 'Le compte' },
  drivers: { titre: 'ce livreur', article: 'Le livreur' },
  shippers: { titre: 'cet expéditeur', article: 'L’expéditeur' },
};

/** Vrai pour un administrateur : seul rôle qui voit le bouton « Supprimer ». */
export function usePeutSupprimer(): boolean {
  const { user } = useAuth();
  return user?.role === RoleType.ADMIN;
}

/** Bouton « corbeille », à placer dans la colonne Actions. */
export function BoutonSupprimer({ nom, onClick, compact = true }: { nom: string; onClick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`Supprimer définitivement ${nom}`}
      title="Supprimer définitivement"
      data-testid="supprimer-compte"
      className={
        compact
          ? 'p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer'
          : 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-md hover:bg-red-50 cursor-pointer'
      }
    >
      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
      {!compact && 'Supprimer'}
    </button>
  );
}

export function SuppressionDefinitive({
  ressource,
  id,
  onClose,
  onSupprime,
  onDesactiver,
}: {
  ressource: RessourceCompte;
  id: string;
  onClose: () => void;
  /** Appelé après suppression, avec le message de l'API. */
  onSupprime: (message: string) => void;
  /** Proposé quand la suppression est impossible (compte encore actif). */
  onDesactiver?: () => void;
}) {
  const [apercu, setApercu] = useState<Apercu | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [saisie, setSaisie] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    setApercu(null);
    setErreur(null);
    setSaisie('');
    requestData<Apercu>(`/${ressource}/${id}/suppression`)
      .then((a) => !annule && setApercu(a))
      .catch((err: unknown) => !annule && setErreur(err instanceof Error ? err.message : 'Aperçu indisponible.'));
    return () => {
      annule = true;
    };
  }, [ressource, id]);

  const confirme = saisie.trim().toUpperCase() === MOT;

  async function supprimer() {
    if (!apercu?.possible || !confirme) return;
    setEnCours(true);
    setErreur(null);
    try {
      const rep = await request<{ id: string }>(`/${ressource}/${id}`, { method: 'DELETE', body: { confirmation: MOT } });
      onSupprime(rep.message ?? `${QUOI[ressource].article} « ${apercu.nom} » a été supprimé définitivement.`);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Suppression impossible.');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => !enCours && onClose()}
      title={apercu ? `Supprimer définitivement « ${apercu.nom} » ?` : `Supprimer ${QUOI[ressource].titre} ?`}
      subtitle={apercu?.detail}
      size="md"
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
          <button
            type="button"
            onClick={onClose}
            disabled={enCours}
            className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
          >
            {apercu && !apercu.possible ? 'Fermer' : 'Annuler'}
          </button>
          {apercu && !apercu.possible && onDesactiver && (
            <button
              type="button"
              onClick={onDesactiver}
              className="px-4 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-md cursor-pointer"
            >
              Désactiver plutôt
            </button>
          )}
          {apercu?.possible && (
            <button
              type="button"
              onClick={() => void supprimer()}
              disabled={!confirme || enCours}
              data-testid="confirmer-suppression"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Supprimer définitivement
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4" data-testid="suppression-fenetre">
        {!apercu && !erreur && (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Vérification de l’historique du compte…
          </div>
        )}

        {erreur && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            {erreur}
          </p>
        )}

        {apercu && !apercu.possible && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2" data-testid="suppression-impossible">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <Ban className="w-4 h-4 shrink-0" aria-hidden="true" />
              Suppression impossible
            </p>
            <p className="text-xs text-amber-900">
              Ce compte est lié à un historique qui doit rester consultable et prouvable :
            </p>
            <ul className="list-disc ps-5 text-xs text-amber-900 space-y-0.5">
              {apercu.obstacles.map((o) => (
                <li key={o.libelle}>{o.libelle}</li>
              ))}
            </ul>
            <p className="text-xs text-amber-900">
              Désactivez-le à la place : il ne pourra plus se connecter, et son historique restera intact.
            </p>
          </div>
        )}

        {apercu?.possible && (
          <>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1.5">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                Action irréversible
              </p>
              <p className="text-xs text-red-800 leading-relaxed">
                {QUOI[ressource].article} sera effacé de la plateforme pour toujours : il ne pourra plus se connecter et
                il ne pourra pas être restauré. Seule une trace de la suppression restera dans le journal d’audit.
              </p>
            </div>
            {apercu.consequences.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1">Sera également effacé :</p>
                <ul className="space-y-1">
                  {apercu.consequences.map((c) => (
                    <li key={c} className="flex items-start gap-1.5 text-xs text-slate-600">
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <label className="block space-y-1.5">
              <span className="text-xs text-slate-700">
                Pour confirmer, saisissez <b className="font-mono text-red-700">{MOT}</b> :
              </span>
              <input
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void supprimer()}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                data-testid="saisie-confirmation"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono uppercase focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                placeholder={MOT}
              />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
