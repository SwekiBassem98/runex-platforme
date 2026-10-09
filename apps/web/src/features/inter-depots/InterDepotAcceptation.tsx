'use client';

/**
 * « Acceptation inter dépôt » (et « … retours ») par l'agence d'arrivée.
 *
 * On scanne l'étiquette de chaque pièce. Un colis est reçu quand toutes ses
 * pièces le sont ; sinon il compte parmi les « partiellement reçus ». Le
 * bordereau reste ouvert tant qu'une pièce manque. À gauche, les colis encore
 * attendus.
 */

import { feedback } from '@/lib/feedback';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, CircleDashed } from 'lucide-react';
import { Badge, Card, ErrorState, PageHeader, Spinner } from '@logixpress/ui';
import { ApiError, interDepotsApi, type AcceptanceBoard, type InterDepotFormOptions, type InterDepotType } from '@/lib/api';
import { RoleType } from '@logixpress/types';
import { useAuth } from '@/lib/auth';

const TAILLE: Record<string, string> = {
  LEGERE: 'légère(s)',
  MOYENNE: 'moyenne(s)',
  LOURDE: 'lourde(s)',
  VOLUMINEUSE: 'volumineuse(s)',
};

export function InterDepotAcceptation({ type }: { type: InterDepotType }) {
  const { user } = useAuth();
  const estRetour = type === 'RETOUR';
  const [board, setBoard] = useState<AcceptanceBoard | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [retour, setRetour] = useState<{ ok: boolean; message: string } | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const estAgent = user?.role === RoleType.AGENT_DEPOT;
  const [options, setOptions] = useState<InterDepotFormOptions | null>(null);
  const [depot, setDepot] = useState<string>('');

  useEffect(() => {
    if (estAgent) return;
    interDepotsApi
      .formOptions()
      .then((o) => {
        setOptions(o);
        setDepot((d) => d || o.operatingDepositId || '');
      })
      .catch(() => setOptions(null));
  }, [estAgent]);

  const charger = useCallback(async () => {
    try {
      setBoard(await interDepotsApi.acceptance(type, depot || undefined));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof ApiError ? e.message : 'Acceptation indisponible.');
    }
  }, [type, depot]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const accepter = async (e: React.FormEvent) => {
    e.preventDefault();
    const saisie = code.trim();
    if (!saisie || enCours) return;
    setEnCours(true);
    try {
      const res = await interDepotsApi.acceptScan(saisie, type, depot || undefined);
      setRetour({ ok: true, message: res.message ?? 'Pièce reçue.' });
      // Pièce lue → bip ; colis complet → succès ; bordereau entièrement reçu → arpège.
      const r = res.data;
      if (r?.transferStatus === 'RECU' && r.packageComplete) feedback.complete();
      else if (r?.packageComplete) feedback.success();
      else feedback.scan();
      await charger();
    } catch (err) {
      setRetour({ ok: false, message: err instanceof ApiError ? err.message : 'Scan refusé.' });
      feedback.error();
    } finally {
      setEnCours(false);
      setCode('');
      champ.current?.focus();
    }
  };

  const agence = options?.deposits.find((d) => d.id === (depot || board?.depositId))?.name ?? user?.depositName ?? '';
  const titre = estRetour ? 'Acceptation inter dépôt retours' : 'Acceptation inter dépôt';

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={titre}
        description="Scanner le code à barre du colis (une étiquette par pièce)."
        breadcrumbs={[{ label: 'Inter dépôts' }, { label: estRetour ? 'Inter dépôts retours' : 'Inter dépôt livraison', href: estRetour ? '/inter-depots/retours' : '/inter-depots' }, { label: 'Acceptation' }]}
        actions={
          <div className="flex items-center gap-2">
            {!estAgent && options && (
              <select aria-label="Dépôt qui réceptionne" value={depot} onChange={(e) => setDepot(e.target.value)} className="border border-slate-300 rounded px-2 py-2 text-sm">
                {options.deposits.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            <Link href={estRetour ? '/inter-depots/retours' : '/inter-depots'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 text-sm">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Liste
            </Link>
          </div>
        }
      />
      {erreur ? (
        <div className="px-4 sm:px-6"><ErrorState message={erreur} onRetry={charger} /></div>
      ) : !board ? (
        <div className="p-8 flex justify-center"><Spinner /></div>
      ) : (
        <div className="px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-[minmax(260px,340px)_1fr] gap-4 items-start">
          <Card>
            <div className="rounded bg-sky-50 border border-sky-100 p-3 mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">Colis attendus</p>
                <p className="text-xs text-slate-600">En route vers votre dépôt.</p>
              </div>
              <Badge variant="danger">{board.expectedCount} colis</Badge>
            </div>
            {board.expected.length === 0 ? (
              <p className="text-xs text-slate-500">Rien n’est attendu.</p>
            ) : (
              <div className="max-h-[520px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-start py-1">Colis</th>
                      <th className="text-center py-1">Pièce</th>
                      <th className="text-start py-1">Type pièce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.expected.map((i) => (
                      <tr key={`${i.transferNumber}-${i.packageId}`} className="border-t border-slate-100">
                        <td className="py-1.5 font-mono">
                          {i.barcode}
                          <span className="block text-[10px] text-slate-400 font-sans">{i.transferNumber} · {i.sourceDeposit}</span>
                        </td>
                        <td className="py-1.5 text-center">{i.receivedPieces}/{i.pieceCount}</td>
                        <td className="py-1.5">{i.pieceCount} {i.sizeCategory ? (TAILLE[i.sizeCategory] ?? i.sizeCategory) : 'pièce(s)'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center gap-6 mb-4">
              <div>
                <p className="text-lg font-semibold text-slate-800">{titre}</p>
                {agence && <p className="text-xs text-slate-500">Par {agence}</p>}
              </div>
              <div className="flex items-center gap-2 border-s-2 border-red-500 ps-3">
                <span className="w-9 h-9 rounded-full bg-orange-500 text-white flex items-center justify-center"><Check className="w-5 h-5" aria-hidden="true" /></span>
                <span><b className="text-lg" data-testid="compteur-recus">{board.receivedCount}</b> <span className="text-xs text-slate-600">colis reçus</span></span>
              </div>
              <div className="flex items-center gap-2 border-s-2 border-red-500 ps-3">
                <span className="w-9 h-9 rounded-full bg-orange-500 text-white flex items-center justify-center"><CircleDashed className="w-5 h-5" aria-hidden="true" /></span>
                <span><b className="text-lg" data-testid="compteur-partiels">{board.partialCount}</b> <span className="text-xs text-slate-600">colis partiellement reçus</span></span>
              </div>
            </div>
            <form onSubmit={accepter} className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <label htmlFor="code-barre-acceptation" className="text-sm font-semibold text-slate-700 sm:w-24">Code à barre</label>
              <input
                id="code-barre-acceptation"
                ref={champ}
                autoFocus
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="code à barre"
                className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm font-mono"
              />
              <button type="submit" disabled={enCours || !code.trim()} className="px-4 py-2 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer">
                Ajouter au dépôt
              </button>
            </form>
            {retour && (
              <p role={retour.ok ? 'status' : 'alert'} className={`mt-3 rounded px-3 py-2 text-sm font-medium border ${retour.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
                {retour.message}
              </p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs">
                  <tr>
                    <th className="text-start py-1.5">Colis</th>
                    <th className="text-start py-1.5">Expéditeur</th>
                    <th className="text-center py-1.5">Pièce(s)</th>
                    <th className="text-start py-1.5">Type de pièce</th>
                    <th className="text-center py-1.5">État</th>
                  </tr>
                </thead>
                <tbody>
                  {board.accepted.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center text-xs text-slate-500">Aucune pièce acceptée sur les dernières 24 h.</td></tr>
                  ) : (
                    board.accepted.map((a) => (
                      <tr key={`${a.transferNumber}-${a.trackingNumber}`} className="border-t border-slate-100">
                        <td className="py-1.5 font-mono text-xs">{a.barcode}</td>
                        <td className="py-1.5">{a.shipperName}</td>
                        <td className="py-1.5 text-center">{a.receivedPieces}/{a.pieceCount}</td>
                        <td className="py-1.5">{a.pieceCount} {TAILLE[a.sizeCategory] ?? a.sizeCategory}</td>
                        <td className="py-1.5 text-center">
                          <Badge variant={a.state === 'RECU' ? 'default' : 'warning'}>{a.state === 'RECU' ? 'Reçu' : 'Partiellement reçu'}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
