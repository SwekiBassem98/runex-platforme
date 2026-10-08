'use client';

/**
 * Liste des inter-dépôts (livraison ou retours), vue depuis une agence.
 *
 * Quatre compteurs sur la période : envoyés en attente, envoyés reçus, à
 * recevoir, reçus. Tableau filtrable par colonne, actions voir / imprimer le
 * bordereau, et les deux entrées « Ajouter un inter dépôt » et
 * « Acceptation inter dépôt ».
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Filter, Plus, Printer, RotateCcw, ScanLine } from 'lucide-react';
import { PermissionCode, RoleType } from '@logixpress/types';
import {
  Badge,
  type BadgeVariant,
  Card,
  ErrorState,
  EmptyState,
  PageHeader,
  SkeletonTable,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@logixpress/ui';
import {
  ApiError,
  interDepotsApi,
  type InterDepotDto,
  type InterDepotFormOptions,
  type InterDepotStats,
  type InterDepotType,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { imprimerBordereau } from './bordereau';

const VARIANTE: Record<string, BadgeVariant> = {
  CRE: 'danger',
  RECU_PARTIEL: 'warning',
  RECU: 'success',
  ANNULE: 'secondary',
  PREPARE: 'danger',
  EN_TRANSIT: 'danger',
};

type FiltreEtat = 'ALL' | 'sentPending' | 'sentReceived' | 'toReceive' | 'received';

const isoJour = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
};

function Jauge({ valeur, total, libelle, actif, onClick }: { valeur: number; total: number; libelle: string; actif: boolean; onClick: () => void }) {
  const pct = total > 0 ? Math.round((valeur / total) * 100) : 0;
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-left text-white transition shadow-sm cursor-pointer ${
        actif ? 'bg-teal-700 ring-2 ring-teal-900' : 'bg-teal-500 hover:bg-teal-600'
      }`}
    >
      <span>
        <span className="block text-2xl font-bold tabular-nums">
          {valeur}/{total}
        </span>
        <span className="block text-xs opacity-90">{libelle}</span>
      </span>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-label={`${pct} %`} className="shrink-0">
        <circle cx="26" cy="26" r={r} stroke="rgba(255,255,255,.35)" strokeWidth="4" fill="none" />
        <circle
          cx="26"
          cy="26"
          r={r}
          stroke="#fff"
          strokeWidth="4"
          fill="none"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 26 26)"
          strokeLinecap="round"
        />
        <text x="26" y="30" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">
          {pct}%
        </text>
      </svg>
    </button>
  );
}

export function InterDepotListe({ type }: { type: InterDepotType }) {
  const router = useRouter();
  const { user } = useAuth();
  const retour = type === 'RETOUR';
  const peutGerer = user?.permissions?.includes(PermissionCode.INTERDEPOT_MANAGE) ?? false;
  const estAgent = user?.role === RoleType.AGENT_DEPOT;

  const aujourdHui = new Date();
  const [debut, setDebut] = useState(isoJour(new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), 1)));
  const [fin, setFin] = useState(isoJour(aujourdHui));
  const [periode, setPeriode] = useState({ debut, fin });
  const [rows, setRows] = useState<InterDepotDto[]>([]);
  const [stats, setStats] = useState<InterDepotStats | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [options, setOptions] = useState<InterDepotFormOptions | null>(null);
  const [agence, setAgence] = useState<string>('');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<FiltreEtat>('ALL');
  const [f, setF] = useState({ numero: '', livreur: '', origine: '', destination: '', cmdMin: '', cmdMax: '', colisMin: '', colisMax: '', sens: '' });

  useEffect(() => {
    interDepotsApi.formOptions().then(setOptions).catch(() => setOptions(null));
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const res = await interDepotsApi.list({ type, start: periode.debut, end: periode.fin, depositId: agence || undefined });
      setRows(res.data ?? []);
      const meta = (res.meta ?? {}) as { stats?: InterDepotStats; viewerDepositId?: string | null };
      setStats(meta.stats ?? null);
      setViewer(meta.viewerDepositId ?? null);
    } catch (e) {
      setErreur(e instanceof ApiError ? e.message : 'Liste indisponible.');
    } finally {
      setChargement(false);
    }
  }, [type, periode, agence]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const visibles = useMemo(() => {
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    return rows.filter((t) => {
      const ouvert = t.status === 'CRE' || t.status === 'RECU_PARTIEL' || t.status === 'PREPARE' || t.status === 'EN_TRANSIT';
      if (etat === 'sentPending' && !(t.direction === 'ENVOI' && ouvert)) return false;
      if (etat === 'sentReceived' && !(t.direction === 'ENVOI' && t.status === 'RECU')) return false;
      if (etat === 'toReceive' && !(t.direction === 'RECEPTION' && ouvert)) return false;
      if (etat === 'received' && !(t.direction === 'RECEPTION' && t.status === 'RECU')) return false;
      if (f.numero && !t.transferNumber.toLowerCase().includes(f.numero.toLowerCase())) return false;
      if (f.livreur && t.driverId !== f.livreur) return false;
      if (f.origine && t.sourceDepositId !== f.origine) return false;
      if (f.destination && t.destinationDepositId !== f.destination) return false;
      if (f.sens && t.direction !== f.sens) return false;
      const cmin = num(f.cmdMin), cmax = num(f.cmdMax), kmin = num(f.colisMin), kmax = num(f.colisMax);
      if (cmin !== null && t.totalPackages < cmin) return false;
      if (cmax !== null && t.totalPackages > cmax) return false;
      if (kmin !== null && t.totalPieces < kmin) return false;
      if (kmax !== null && t.totalPieces > kmax) return false;
      return true;
    });
  }, [rows, etat, f]);

  const total = stats?.total ?? rows.length;
  const libelleType = retour ? 'inter dépôt retours' : 'inter dépôt';
  const base = '/inter-depots';

  const imprimer = async (numero: string) => {
    try {
      imprimerBordereau(await interDepotsApi.get(numero));
    } catch {
      /* l'erreur réseau est déjà visible dans la liste */
    }
  };

  const reinitialiser = () => {
    setEtat('ALL');
    setF({ numero: '', livreur: '', origine: '', destination: '', cmdMin: '', cmdMax: '', colisMin: '', colisMax: '', sens: '' });
  };

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={retour ? 'Liste des inter dépôts retours' : 'Liste des inter dépôts'}
        description={retour ? 'Retours et échanges rendus aux agences des expéditeurs.' : 'Colis acheminés entre agences, chargés et acceptés au scan.'}
        breadcrumbs={[{ label: 'Inter dépôts' }, { label: retour ? 'Inter dépôts retours' : 'Inter dépôt livraison' }]}
      />
      <div className="px-4 sm:px-6 space-y-4">
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm text-slate-700">
              Liste des <span className="text-red-600 font-semibold">{etat === 'ALL' ? 'toutes les' : ''} {libelleType}</span> du :
            </p>
            <label className="text-xs text-slate-600">
              <span className="sr-only">Début</span>
              <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </label>
            <span className="text-slate-400">→</span>
            <label className="text-xs text-slate-600">
              <span className="sr-only">Fin</span>
              <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            </label>
            <button
              type="button"
              onClick={() => setPeriode({ debut, fin })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold cursor-pointer"
            >
              <Filter className="w-4 h-4" aria-hidden="true" /> Filtrer
            </button>
            {!estAgent && options && (
              <label className="ms-auto text-xs text-slate-600 flex items-center gap-2">
                Agence
                <select
                  value={agence || viewer || ''}
                  onChange={(e) => setAgence(e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1.5 text-sm"
                  aria-label="Agence consultée"
                >
                  {options.deposits.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
            <Jauge valeur={stats?.sentPending ?? 0} total={total} libelle={`${retour ? 'Inter dépôts retours' : 'Inter dépôts'} envoyés en attentes`} actif={etat === 'sentPending'} onClick={() => setEtat(etat === 'sentPending' ? 'ALL' : 'sentPending')} />
            <Jauge valeur={stats?.sentReceived ?? 0} total={total} libelle={`${retour ? 'Inter dépôts retours' : 'Inter dépôts'} envoyés reçus`} actif={etat === 'sentReceived'} onClick={() => setEtat(etat === 'sentReceived' ? 'ALL' : 'sentReceived')} />
            <Jauge valeur={stats?.toReceive ?? 0} total={total} libelle={`${retour ? 'Inter dépôts retours' : 'Inter dépôts'} pour réception`} actif={etat === 'toReceive'} onClick={() => setEtat(etat === 'toReceive' ? 'ALL' : 'toReceive')} />
            <Jauge valeur={stats?.received ?? 0} total={total} libelle={`${retour ? 'Inter dépôts retours' : 'Inter dépôts'} reçus`} actif={etat === 'received'} onClick={() => setEtat(etat === 'received' ? 'ALL' : 'received')} />
          </div>
          <button
            type="button"
            onClick={() => setEtat('ALL')}
            className="mt-3 w-full text-left rounded bg-teal-600 text-white text-sm font-semibold px-4 py-2 cursor-pointer"
          >
            {retour ? 'Toutes les inter dépôts retours' : 'Toutes les inter dépôts'} ({total})
          </button>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-slate-800">{retour ? 'Liste des inter dépôts retours' : 'Liste des inter dépôts'}</h2>
            {peutGerer && (
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`${base}/nouveau?type=${type}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" /> Ajouter un {libelleType}
                </Link>
                <Link
                  href={`${base}/acceptation?type=${type}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
                >
                  <ScanLine className="w-4 h-4" aria-hidden="true" /> Acceptation {libelleType}
                </Link>
              </div>
            )}
          </div>

          {erreur ? (
            <ErrorState message={erreur} onRetry={charger} title="Liste indisponible" />
          ) : chargement ? (
            <SkeletonTable rows={5} cols={9} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>N°</Th>
                    <Th>Date</Th>
                    <Th>Livreur</Th>
                    <Th>Agence origine</Th>
                    <Th>Agence destination</Th>
                    <Th align="center">Commandes</Th>
                    <Th align="center">Colis</Th>
                    <Th align="center">État</Th>
                    <Th align="center">Type</Th>
                    <Th align="right">Action</Th>
                  </Tr>
                  <Tr>
                    <Th>
                      <input aria-label="Filtrer par numéro" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} className="w-28 border border-slate-300 rounded px-1.5 py-1 text-xs font-normal" />
                    </Th>
                    <Th> </Th>
                    <Th>
                      <select aria-label="Filtrer par livreur" value={f.livreur} onChange={(e) => setF({ ...f, livreur: e.target.value })} className="w-32 border border-slate-300 rounded px-1 py-1 text-xs font-normal">
                        <option value="">Tous les livreurs</option>
                        {options?.drivers.map((d) => (
                          <option key={d.id} value={d.id}>{d.fullName}</option>
                        ))}
                      </select>
                    </Th>
                    <Th>
                      <select aria-label="Filtrer par agence origine" value={f.origine} onChange={(e) => setF({ ...f, origine: e.target.value })} className="w-28 border border-slate-300 rounded px-1 py-1 text-xs font-normal">
                        <option value="">Toutes les agences</option>
                        {options?.deposits.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </Th>
                    <Th>
                      <select aria-label="Filtrer par agence destination" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} className="w-28 border border-slate-300 rounded px-1 py-1 text-xs font-normal">
                        <option value="">Toutes les agences</option>
                        {options?.deposits.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </Th>
                    <Th>
                      <div className="flex flex-col gap-1">
                        <input aria-label="Commandes min" placeholder="Min" value={f.cmdMin} onChange={(e) => setF({ ...f, cmdMin: e.target.value })} className="w-16 border border-slate-300 rounded px-1 py-0.5 text-xs font-normal" />
                        <input aria-label="Commandes max" placeholder="Max" value={f.cmdMax} onChange={(e) => setF({ ...f, cmdMax: e.target.value })} className="w-16 border border-slate-300 rounded px-1 py-0.5 text-xs font-normal" />
                      </div>
                    </Th>
                    <Th>
                      <div className="flex flex-col gap-1">
                        <input aria-label="Colis min" placeholder="Min" value={f.colisMin} onChange={(e) => setF({ ...f, colisMin: e.target.value })} className="w-16 border border-slate-300 rounded px-1 py-0.5 text-xs font-normal" />
                        <input aria-label="Colis max" placeholder="Max" value={f.colisMax} onChange={(e) => setF({ ...f, colisMax: e.target.value })} className="w-16 border border-slate-300 rounded px-1 py-0.5 text-xs font-normal" />
                      </div>
                    </Th>
                    <Th> </Th>
                    <Th>
                      <select aria-label="Filtrer par type" value={f.sens} onChange={(e) => setF({ ...f, sens: e.target.value })} className="w-24 border border-slate-300 rounded px-1 py-1 text-xs font-normal">
                        <option value="">-</option>
                        <option value="ENVOI">Envoi</option>
                        <option value="RECEPTION">Réception</option>
                      </select>
                    </Th>
                    <Th align="right">
                      <button type="button" onClick={reinitialiser} title="Réinitialiser les filtres" aria-label="Réinitialiser les filtres" className="p-1.5 rounded bg-emerald-600 text-white cursor-pointer">
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {visibles.length === 0 ? (
                    <Tr>
                      <Td colSpan={10}>
                        <EmptyState title="Aucun inter-dépôt" description="Aucun bordereau ne correspond à la période et aux filtres." />
                      </Td>
                    </Tr>
                  ) : (
                    visibles.map((t) => (
                      <Tr key={t.id} onClick={() => router.push(`${base}/${t.transferNumber}`)}>
                        <Td>
                          <span className="font-mono text-xs font-semibold text-red-600">{t.transferNumber}</span>
                        </Td>
                        <Td>{t.departureAt ? new Date(t.departureAt).toLocaleString('fr-TN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</Td>
                        <Td>{t.driverName ?? 'N/A'}</Td>
                        <Td>{t.sourceDeposit}</Td>
                        <Td>{t.destinationDeposit}</Td>
                        <Td align="center">{t.totalPackages}</Td>
                        <Td align="center">{t.totalPieces}</Td>
                        <Td align="center">
                          <Badge variant={VARIANTE[t.status] ?? 'default'}>{t.statusLabel}</Badge>
                        </Td>
                        <Td align="center">
                          {t.direction ? (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${t.direction === 'ENVOI' ? 'bg-rose-600' : 'bg-orange-400'}`}>
                              {t.direction === 'ENVOI' ? 'Envoi' : 'Réception'}
                            </span>
                          ) : '—'}
                        </Td>
                        <Td align="right">
                          <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <Link href={`${base}/${t.transferNumber}`} title="Voir le bordereau" aria-label={`Voir ${t.transferNumber}`} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50">
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            </Link>
                            <button type="button" onClick={() => void imprimer(t.transferNumber)} title="Imprimer le bordereau" aria-label={`Imprimer ${t.transferNumber}`} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 cursor-pointer">
                              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </span>
                        </Td>
                      </Tr>
                    ))
                  )}
                </Tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
