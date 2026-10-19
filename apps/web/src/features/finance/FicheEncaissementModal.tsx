'use client';

/**
 * Fiche d'encaissement d'un livreur (comptage de caisse), comme la feuille
 * « ENCAISSEMENT » tenue à la caisse : nom, tournées, nature, caissier ;
 * comptage par billet et pièce ; opérations ; total, total des opérations,
 * fond de caisse et décalage ; signatures.
 *
 * Le caissier peut compter avant d'imprimer (les totaux se calculent
 * pendant la saisie) ou imprimer une fiche vierge à remplir à la main. Les
 * opérations sont reprises des tournées du livreur pour le jour choisi, et
 * restent modifiables.
 */

import React from 'react';
import { Minus, Plus, Printer, Trash2 } from 'lucide-react';
import { Modal } from '@logixpress/ui';
import type { RunsheetSummaryDto } from '@logixpress/types';
import { requestData } from '@/lib/api';
import { COUPURES, imprimerFicheEncaissement, totauxFiche } from '@/lib/impression-documents';

export interface CibleFiche {
  driverId: string;
  driverCode: string;
  fullName: string;
  /** Fiche d'un paiement déjà fait au livreur. */
  paiement?: { reference: string; amount: number; paidAt: string; note: string | null };
}

const NATURES = ['Encaissement tournée', 'Paiement livreur', 'Versement', 'Autre'];

const jourTunis = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(d);
const nb = (v: string) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function FicheEncaissementModal({ cible, caissier, onClose }: { cible: CibleFiche | null; caissier: string; onClose: () => void }) {
  const [jour, setJour] = React.useState(jourTunis());
  const [nature, setNature] = React.useState(NATURES[0]!);
  const [comptes, setComptes] = React.useState<string[]>(COUPURES.map(() => ''));
  const [operations, setOperations] = React.useState<{ libelle: string; montant: string }[]>([]);
  const [tournees, setTournees] = React.useState<string>('');
  const [fond, setFond] = React.useState('');
  const [chargement, setChargement] = React.useState(false);

  // À l'ouverture : nature et opérations selon la ligne (tournées du jour ou paiement).
  React.useEffect(() => {
    if (!cible) return;
    setComptes(COUPURES.map(() => ''));
    setFond('');
    if (cible.paiement) {
      setNature('Paiement livreur');
      setJour(jourTunis(new Date(cible.paiement.paidAt)));
      setOperations([{ libelle: `Paiement ${cible.paiement.reference}${cible.paiement.note ? ` — ${cible.paiement.note}` : ''}`, montant: String(cible.paiement.amount) }]);
      setTournees('');
    } else {
      setNature(NATURES[0]!);
      setJour(jourTunis());
    }
  }, [cible]);

  // Tournées du livreur pour le jour choisi.
  React.useEffect(() => {
    if (!cible || cible.paiement) return;
    let annule = false;
    setChargement(true);
    requestData<RunsheetSummaryDto[]>('/runsheets', { query: { driverId: cible.driverId, date: jour } })
      .then((liste) => {
        if (annule) return;
        const utiles = liste.filter((r) => String(r.status) !== 'ANNULEE');
        setTournees(utiles.map((r) => r.runsheetNumber).join(', '));
        setOperations(
          utiles.map((r) => {
            const cloturee = ['CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT'].includes(String(r.status));
            const montant = cloturee ? r.collectedCash : (r.montantLivre ?? r.collectedCash);
            return { libelle: `Tournée ${r.runsheetNumber} — ${r.deliveredCount} livré${r.deliveredCount > 1 ? 's' : ''}`, montant: String(montant ?? 0) };
          })
        );
      })
      .catch(() => {
        if (!annule) setOperations([]);
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [cible, jour]);

  const billets = COUPURES.map((c, i) => ({ ...c, nombre: comptes[i] === '' ? null : Math.max(0, Math.floor(nb(comptes[i]!))) }));
  const ops = operations.map((o) => ({ libelle: o.libelle, montant: o.montant === '' ? null : nb(o.montant) }));
  const tot = totauxFiche({ billets, operations: ops, fondDeCaisse: fond === '' ? null : nb(fond) });
  const compte = billets.some((b) => b.nombre !== null);

  const imprimer = (vierge: boolean) => {
    if (!cible) return;
    imprimerFicheEncaissement({
      livreur: cible.fullName,
      code: cible.driverCode,
      runsheets: tournees,
      nature,
      caissier,
      billets: vierge ? COUPURES.map((c) => ({ ...c, nombre: null })) : billets,
      operations: ops,
      fondDeCaisse: vierge || fond === '' ? null : nb(fond),
    });
  };

  const majCompte = (i: number, v: string) => setComptes((c) => c.map((x, k) => (k === i ? v.replace(/[^\d]/g, '') : x)));

  return (
    <Modal
      isOpen={cible !== null}
      onClose={onClose}
      title={cible ? `Fiche d’encaissement — ${cible.fullName}` : ''}
      subtitle="Comptez les billets et pièces, vérifiez les opérations, puis imprimez la fiche à signer."
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm cursor-pointer">
            Fermer
          </button>
          <button
            type="button"
            onClick={() => imprimer(true)}
            data-testid="fiche-imprimer-vierge"
            className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Imprimer à remplir
          </button>
          <button
            type="button"
            onClick={() => imprimer(false)}
            data-testid="fiche-imprimer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 cursor-pointer"
          >
            <Printer className="w-4 h-4" aria-hidden="true" /> Imprimer la fiche
          </button>
        </div>
      }
    >
      {cible && (
        <div className="space-y-4" data-testid="fiche-encaissement">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Jour</span>
              <input
                type="date"
                value={jour}
                onChange={(e) => setJour(e.target.value)}
                disabled={!!cible.paiement}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:bg-slate-50"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Nature</span>
              <select value={nature} onChange={(e) => setNature(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
                {NATURES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div>
              <span className="text-xs font-semibold text-slate-600">Caissier</span>
              <p className="mt-1 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm truncate">{caissier}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Tournée{tournees.includes(',') ? 's' : ''} : <span className="font-mono text-slate-800">{chargement ? '…' : tournees || '—'}</span>
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Comptage */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-[1fr_96px_1fr] gap-2 px-3 py-2 bg-slate-900 text-[10px] font-semibold uppercase tracking-wide text-white">
                <span>Billet / pièce</span>
                <span className="text-center">Nombre</span>
                <span className="text-right">Montant</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {COUPURES.map((c, i) => {
                  const n = comptes[i] === '' ? 0 : nb(comptes[i]!);
                  return (
                    <li key={`${c.valeur}-${c.type}`} className="grid grid-cols-[1fr_96px_1fr] gap-2 items-center px-3 py-1.5">
                      <span className="text-sm font-bold text-slate-900">
                        {c.valeur.toLocaleString('fr-FR')} <span className="text-[10px] font-normal text-slate-400">{c.type}</span>
                      </span>
                      <span className="flex items-center rounded-md border border-slate-300">
                        <button
                          type="button"
                          onClick={() => majCompte(i, String(Math.max(0, n - 1)))}
                          aria-label={`Moins de ${c.valeur}`}
                          className="px-1.5 text-slate-400 hover:text-slate-800 cursor-pointer"
                        >
                          <Minus className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <input
                          inputMode="numeric"
                          value={comptes[i]}
                          onChange={(e) => majCompte(i, e.target.value)}
                          aria-label={`Nombre de ${c.type}s de ${c.valeur} DT`}
                          data-testid={`compte-${i}`}
                          className="w-full min-w-0 text-center text-sm font-mono py-1 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => majCompte(i, String(n + 1))}
                          aria-label={`Plus de ${c.valeur}`}
                          className="px-1.5 text-slate-400 hover:text-slate-800 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </span>
                      <span className="text-right font-mono text-xs text-slate-700">{comptes[i] === '' ? '' : fmt(n * c.valeur)}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-between px-3 py-2 bg-slate-50 border-t border-slate-200 text-sm font-bold">
                <span>Total compté</span>
                <span className="font-mono" data-testid="fiche-total">{compte ? `${fmt(tot.total)} DT` : '—'}</span>
              </div>
            </div>

            {/* Opérations + totaux */}
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-[1fr_110px_24px] gap-2 px-3 py-2 bg-slate-900 text-[10px] font-semibold uppercase tracking-wide text-white">
                  <span>Opération</span>
                  <span className="text-right">Montant</span>
                  <span />
                </div>
                <ul className="divide-y divide-slate-100">
                  {operations.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">{chargement ? 'Chargement…' : 'Aucune tournée ce jour-là.'}</li>}
                  {operations.map((o, i) => (
                    <li key={i} className="grid grid-cols-[1fr_110px_24px] gap-2 items-center px-3 py-1.5">
                      <input
                        value={o.libelle}
                        onChange={(e) => setOperations((l) => l.map((x, k) => (k === i ? { ...x, libelle: e.target.value } : x)))}
                        className="min-w-0 text-xs px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none"
                        aria-label="Libellé de l’opération"
                      />
                      <input
                        inputMode="decimal"
                        value={o.montant}
                        onChange={(e) => setOperations((l) => l.map((x, k) => (k === i ? { ...x, montant: e.target.value } : x)))}
                        className="text-right text-xs font-mono px-2 py-1 rounded border border-slate-200 focus:outline-none focus:border-slate-400"
                        aria-label="Montant de l’opération"
                      />
                      <button
                        type="button"
                        onClick={() => setOperations((l) => l.filter((_, k) => k !== i))}
                        aria-label="Retirer l’opération"
                        className="text-slate-300 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setOperations((l) => [...l, { libelle: 'Opération', montant: '' }])}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 border-t border-slate-100 cursor-pointer"
                >
                  + Ajouter une opération
                </button>
              </div>

              <dl className="rounded-xl border border-slate-200 overflow-hidden text-sm">
                <div className="flex justify-between px-3 py-2 bg-amber-50">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-mono">{compte ? `${fmt(tot.total)} DT` : '—'}</dd>
                </div>
                <div className="flex justify-between px-3 py-2 bg-amber-50 border-t border-amber-100">
                  <dt className="font-semibold">Total opérations</dt>
                  <dd className="font-mono" data-testid="fiche-total-operations">{fmt(tot.operations)} DT</dd>
                </div>
                <label className="flex items-center justify-between gap-3 px-3 py-2 bg-amber-50 border-t border-amber-100">
                  <span className="font-semibold">Fond de caisse</span>
                  <input
                    inputMode="decimal"
                    value={fond}
                    onChange={(e) => setFond(e.target.value)}
                    placeholder="0"
                    className="w-28 text-right font-mono text-sm px-2 py-1 rounded border border-amber-200 bg-white focus:outline-none"
                    data-testid="fiche-fond"
                  />
                </label>
                <div className={`flex justify-between px-3 py-2 border-t ${!compte ? 'bg-slate-50' : tot.decalage === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                  <dt className="font-bold">Décalage</dt>
                  <dd className="font-mono font-bold" data-testid="fiche-decalage">{compte ? `${fmt(tot.decalage)} DT` : '—'}</dd>
                </div>
              </dl>
              <p className="text-[11px] text-slate-400">Décalage = total compté − total des opérations − fond de caisse.</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
