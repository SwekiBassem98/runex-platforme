'use client';

/**
 * Carte de scan « Ajouter / Retirer » — la même que dans le bon de retour.
 *
 * Un interrupteur choisit le sens, le champ reçoit le code-barres (douchette
 * ou clavier, validé par Entrée) et le résultat s'affiche juste dessous, en
 * clair. Un code refusé reste sélectionné : le scan suivant le remplace.
 */

import React, { useRef, useState } from 'react';
import { Barcode } from 'lucide-react';

export type ModeScan = 'ajouter' | 'retirer';

export function CarteScanAjoutRetrait({
  titreAjouter,
  titreRetirer,
  libelleAjouter = 'Ajouter',
  libelleRetirer = 'Retirer',
  onScan,
  aide,
  testIdPrefix = 'scan',
}: {
  titreAjouter: string;
  titreRetirer: string;
  libelleAjouter?: string;
  libelleRetirer?: string;
  /** Exécute l'ajout ou le retrait ; renvoie le message à afficher. */
  onScan: (code: string, mode: ModeScan) => Promise<{ ok: boolean; message: string }>;
  aide?: React.ReactNode;
  testIdPrefix?: string;
}) {
  const [mode, setMode] = useState<ModeScan>('ajouter');
  const [code, setCode] = useState('');
  const [resultat, setResultat] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  const valider = async () => {
    const valeur = code.trim();
    if (!valeur || enCours) return;
    setEnCours(true);
    try {
      const r = await onScan(valeur, mode);
      setResultat({ ok: r.ok, texte: r.message });
      if (r.ok) setCode('');
      else window.setTimeout(() => champ.current?.select(), 0);
    } catch (e) {
      setResultat({ ok: false, texte: e instanceof Error ? e.message : 'Code refusé.' });
      window.setTimeout(() => champ.current?.select(), 0);
    } finally {
      setEnCours(false);
      champ.current?.focus();
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs" data-testid={`${testIdPrefix}-carte`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800">
          <Barcode className="h-4 w-4" aria-hidden="true" />
          {mode === 'ajouter' ? titreAjouter : titreRetirer}
        </h3>
        <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs" role="radiogroup" aria-label="Mode du scan">
          {(['ajouter', 'retirer'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                setResultat(null);
                champ.current?.focus();
              }}
              data-testid={`${testIdPrefix}-mode-${m}`}
              className={`rounded px-3 py-1.5 ${
                mode === m ? (m === 'ajouter' ? 'bg-sky-600 text-white' : 'bg-red-600 text-white') : 'text-slate-600'
              }`}
            >
              {m === 'ajouter' ? libelleAjouter : libelleRetirer}
            </button>
          ))}
        </div>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void valider();
        }}
      >
        <input
          ref={champ}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Scannez ou tapez le code-barres, puis Entrée"
          className={`flex-1 rounded-md border px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 ${
            mode === 'ajouter' ? 'border-slate-200 focus:ring-sky-500/30' : 'border-red-300 focus:ring-red-500/30'
          }`}
          data-testid={`${testIdPrefix}-code`}
          aria-label="Code-barres"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!code.trim() || enCours}
          className={`rounded-md px-4 text-sm font-semibold text-white disabled:opacity-40 ${
            mode === 'ajouter' ? 'bg-orange-600' : 'bg-red-600'
          }`}
          data-testid={`${testIdPrefix}-valider`}
        >
          {mode === 'ajouter' ? 'Ajouter' : 'Retirer'}
        </button>
      </form>
      {aide && !resultat && <p className="mt-2 text-xs text-slate-500">{aide}</p>}
      {resultat && (
        <p
          role="status"
          data-testid={`${testIdPrefix}-resultat`}
          className={`mt-2 rounded-md border px-3 py-2 text-sm ${
            resultat.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {resultat.texte}
        </p>
      )}
    </section>
  );
}
