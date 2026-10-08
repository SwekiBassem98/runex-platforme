'use client';

/**
 * « Ajouter un inter dépôt » / « Ajouter un inter dépôt retours ».
 *
 * 1. En-tête : agence (destination, ou agence de l'expéditeur pour les
 *    retours), livreur — son immatriculation se remplit seule —, date et
 *    heure, puis « Enregistrer ». Le bordereau est « En attente ».
 * 2. « Ajouter colis au inter dépôt » : champ code-barres et interrupteur
 *    Ajouter ↔ Retirer. Chaque scan est accepté (bip) ou refusé (double buzz)
 *    avec son motif : un colis pour Nabeul ne monte pas dans un bordereau
 *    pour Sfax.
 * À gauche, les colis du dépôt qui peuvent partir vers l'agence choisie.
 */

import { feedback } from '@/lib/feedback';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Plus, Printer, Save } from 'lucide-react';
import { PermissionCode, RoleType } from '@logixpress/types';
import {
  Badge,
  type BadgeVariant,
  Card,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Spinner,
  Switch,
  useToast,
} from '@logixpress/ui';
import {
  ApiError,
  interDepotsApi,
  type InterDepotCandidate,
  type InterDepotDto,
  type InterDepotFormOptions,
  type InterDepotType,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { imprimerBordereau } from './bordereau';

const VARIANTE: Record<string, BadgeVariant> = {
  CRE: 'danger',
  RECU_PARTIEL: 'warning',
  RECU: 'success',
  ANNULE: 'secondary',
};

const TAILLE: Record<string, string> = {
  LEGERE: 'légère(s)',
  MOYENNE: 'moyenne(s)',
  LOURDE: 'lourde(s)',
  VOLUMINEUSE: 'volumineuse(s)',
};

/** Valeur `datetime-local` (heure de Tunis) d'une date ISO. */
function versChampDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}
/** Champ `datetime-local` (heure de Tunis, UTC+1) vers ISO. */
const depuisChampDate = (v: string) => (v ? new Date(`${v}:00+01:00`).toISOString() : undefined);

interface Retour {
  type: 'succes' | 'erreur' | 'retrait';
  message: string;
}

export function InterDepotEdition({ type: typeInitial, numero }: { type: InterDepotType; numero?: string }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { user } = useAuth();
  const peutGerer = user?.permissions?.includes(PermissionCode.INTERDEPOT_MANAGE) ?? false;

  const [options, setOptions] = useState<InterDepotFormOptions | null>(null);
  const [transfert, setTransfert] = useState<InterDepotDto | null>(null);
  const [candidats, setCandidats] = useState<InterDepotCandidate[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(false);

  const [agence, setAgence] = useState('');
  const estAgent = user?.role === RoleType.AGENT_DEPOT;
  const [depart, setDepart] = useState('');
  const [livreur, setLivreur] = useState('');
  const [matricule, setMatricule] = useState('');
  const [date, setDate] = useState(versChampDate());

  const [retirer, setRetirer] = useState(false);
  const [code, setCode] = useState('');
  const [retour, setRetour] = useState<Retour | null>(null);
  const [annulation, setAnnulation] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  const type: InterDepotType = transfert?.type ?? typeInitial;
  const estRetour = type === 'RETOUR';
  const base = estRetour ? '/inter-depots/retours' : '/inter-depots';

  const chargerCandidats = useCallback(async (num: string) => {
    try {
      setCandidats(await interDepotsApi.candidates(num));
    } catch {
      setCandidats([]);
    }
  }, []);

  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);
      try {
        const opts = await interDepotsApi.formOptions();
        if (annule) return;
        setOptions(opts);
        if (numero) {
          const t = await interDepotsApi.get(numero);
          if (annule) return;
          setTransfert(t);
          setAgence(t.destinationDepositId);
          setLivreur(t.driverId ?? '');
          setMatricule(t.vehiclePlate ?? '');
          setDate(versChampDate(t.departureAt));
          if (t.editable) void chargerCandidats(t.transferNumber);
        }
      } catch (e) {
        if (!annule) setErreur(e instanceof ApiError ? e.message : 'Inter-dépôt indisponible.');
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, [numero, chargerCandidats]);

  // Agences proposées : toutes sauf celle d'où l'on opère.
  const origine = transfert?.sourceDepositId ?? (depart || options?.operatingDepositId) ?? null;
  const agences = useMemo(() => (options?.deposits ?? []).filter((d) => d.id !== origine), [options, origine]);
  const agenceNom = (transfert?.destinationDeposit ?? agences.find((a) => a.id === agence)?.name) || '';

  const choisirLivreur = (id: string) => {
    setLivreur(id);
    const d = options?.drivers.find((x) => x.id === id);
    setMatricule(d?.licensePlate ?? '');
  };

  const enregistrer = async () => {
    if (!agence) return addToast({ type: 'warning', title: estRetour ? "Choisissez l'agence source" : "Choisissez l'agence" });
    if (!livreur) return addToast({ type: 'warning', title: 'Choisissez le livreur' });
    setEnCours(true);
    try {
      if (!transfert) {
        const t = await interDepotsApi.create({
          type,
          sourceDepositId: !estAgent && depart ? depart : undefined,
          destinationDepositId: agence,
          transporterDriverId: livreur,
          vehiclePlate: matricule || undefined,
          departureAt: depuisChampDate(date),
        });
        addToast({ type: 'success', title: `Inter-dépôt ${t.transferNumber} enregistré`, message: 'Scannez maintenant les colis.' });
        router.replace(`/inter-depots/${t.transferNumber}`);
      } else {
        const t = await interDepotsApi.update(transfert.transferNumber, {
          transporterDriverId: livreur,
          vehiclePlate: matricule,
          departureAt: depuisChampDate(date),
        });
        setTransfert(t);
        addToast({ type: 'success', title: 'Bordereau mis à jour' });
      }
    } catch (e) {
      addToast({ type: 'error', title: 'Enregistrement impossible', message: e instanceof ApiError ? e.message : undefined });
    } finally {
      setEnCours(false);
    }
  };

  const scanner = async (valeur?: string) => {
    const saisie = (valeur ?? code).trim();
    if (!transfert || !saisie || enCours) return;
    setEnCours(true);
    try {
      const res = await interDepotsApi.scan(transfert.transferNumber, saisie, retirer ? 'remove' : 'add');
      if (res.data) setTransfert(res.data);
      setRetour({ type: retirer ? 'retrait' : 'succes', message: res.message ?? 'OK' });
      // Colis chargé : bip de lecteur ; retiré : deux notes descendantes.
      if (retirer) feedback.remove();
      else feedback.scan();
      void chargerCandidats(transfert.transferNumber);
    } catch (e) {
      setRetour({ type: 'erreur', message: e instanceof ApiError ? e.message : 'Scan refusé.' });
      feedback.error();
    } finally {
      setEnCours(false);
      setCode('');
      champ.current?.focus();
    }
  };

  const annuler = async () => {
    if (!transfert) return;
    setAnnulation(false);
    try {
      const res = await interDepotsApi.cancel(transfert.transferNumber);
      if (res.data) setTransfert(res.data);
      addToast({ type: 'success', title: 'Inter-dépôt annulé', message: res.message });
      setCandidats([]);
    } catch (e) {
      addToast({ type: 'error', title: 'Annulation impossible', message: e instanceof ApiError ? e.message : undefined });
    }
  };

  if (chargement) {
    return (
      <div className="p-8 flex justify-center">
        <Spinner />
      </div>
    );
  }
  if (erreur) return <div className="p-6"><ErrorState message={erreur} title="Inter-dépôt introuvable" /></div>;

  const titre = estRetour ? 'Ajouter un inter dépôt retours' : 'Ajouter un inter dépôt';
  const modifiable = !transfert || transfert.editable;

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={transfert ? `${transfert.transferNumber}` : titre}
        description={
          estRetour
            ? "Choisissez agence source, livreur, date et indiquez le matricule, puis scannez chaque colis retour pour l'ajouter dans l'inter dépôt retour."
            : "Pour ajouter un inter dépôt, choisissez l'agence, livreur, date et indiquez le matricule, puis scannez chaque colis."
        }
        breadcrumbs={[{ label: 'Inter dépôts' }, { label: estRetour ? 'Inter dépôts retours' : 'Inter dépôt livraison', href: base }, { label: transfert ? transfert.transferNumber : 'Nouveau' }]}
        badge={transfert ? <Badge variant={VARIANTE[transfert.status] ?? 'default'}>{transfert.statusLabel}</Badge> : <Badge variant="danger">En attente</Badge>}
        actions={
          <div className="flex gap-2">
            <Link href={base} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 text-sm">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Liste
            </Link>
            {transfert && (
              <button type="button" onClick={() => imprimerBordereau(transfert)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-slate-300 text-sm cursor-pointer">
                <Printer className="w-4 h-4" aria-hidden="true" /> Imprimer le bordereau
              </button>
            )}
          </div>
        }
      />

      <div className="px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-[minmax(260px,340px)_1fr] gap-4 items-start">
        {/* Colis disponibles pour cette agence */}
        <Card>
          <div className="rounded bg-sky-50 border border-sky-100 p-3 mb-3">
            <p className="text-sm font-semibold text-slate-800">{estRetour ? 'Colis retour au dépôt' : 'Colis au dépôt'}</p>
            <p className="text-xs text-slate-600">
              {estRetour
                ? 'Liste des colis retour dans votre dépôt pour l’agence sélectionnée.'
                : 'Liste des colis dans votre dépôt et destinés vers l’agence sélectionnée.'}
            </p>
          </div>
          {!transfert ? (
            <p className="text-xs text-slate-500">Enregistrez le bordereau pour voir les colis proposés.</p>
          ) : !transfert.editable ? (
            <p className="text-xs text-slate-500">Bordereau clôturé au chargement.</p>
          ) : candidats.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun colis pour cette destination.</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-start py-1">Colis</th>
                    <th className="text-start py-1">Expéditeur</th>
                    <th className="text-center py-1">Pièce</th>
                    <th className="text-start py-1">Type pièce</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {candidats.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="py-1.5 font-mono">{c.barcode}</td>
                      <td className="py-1.5">{c.shipperName}</td>
                      <td className="py-1.5 text-center">{c.pieceCount}</td>
                      <td className="py-1.5">{c.pieceCount} {TAILLE[c.sizeCategory] ?? c.sizeCategory}</td>
                      <td className="py-1.5 text-end">
                        {peutGerer && !retirer && (
                          <button
                            type="button"
                            onClick={() => void scanner(c.barcode)}
                            title={`Ajouter ${c.trackingNumber}`}
                            aria-label={`Ajouter ${c.trackingNumber}`}
                            className="p-1 rounded bg-orange-500 text-white cursor-pointer"
                          >
                            <Plus className="w-3 h-3" aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">{candidats.length} colis</p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            {agenceNom && (
              <p className="text-base text-slate-700 mb-3">
                {estRetour ? 'Inter dépôt retour de l’agence ' : 'Inter dépôt vers l’agence '}
                <span className={`font-semibold ${estRetour ? 'text-red-600' : 'text-teal-700'}`}>{agenceNom}</span>
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
              {!transfert && !estAgent && options && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>Dépôt de départ</span>
                  <select value={depart || options.operatingDepositId || ''} onChange={(e) => { setDepart(e.target.value); if (e.target.value === agence) setAgence(''); }} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                    {options.deposits.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {!transfert && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>{estRetour ? 'Agence source' : 'Agence'}</span>
                  <select value={agence} onChange={(e) => setAgence(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                    <option value="">Choisissez agence</option>
                    {agences.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-xs text-slate-600 space-y-1">
                <span>Livreur</span>
                <select value={livreur} onChange={(e) => choisirLivreur(e.target.value)} disabled={!modifiable} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                  <option value="">Choisissez livreur</option>
                  {options?.drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Matricule</span>
                <input value={matricule} onChange={(e) => setMatricule(e.target.value)} disabled={!modifiable} placeholder="Matricule" className="w-full border border-slate-300 rounded px-2 py-2 text-sm font-mono" />
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Date</span>
                <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} disabled={!modifiable} className="w-full border border-slate-300 rounded px-2 py-2 text-sm" />
              </label>
            </div>
            {peutGerer && modifiable && (
              <button
                type="button"
                onClick={() => void enregistrer()}
                disabled={enCours}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2 text-sm cursor-pointer"
              >
                <Save className="w-4 h-4" aria-hidden="true" /> Enregistrer
              </button>
            )}
          </Card>

          {transfert && transfert.editable && peutGerer && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-sky-50 border border-sky-100 px-3 py-2 mb-3">
                <p className="text-sm font-medium text-slate-800">{estRetour ? 'Ajouter colis au inter dépôt retour' : 'Ajouter colis au inter dépôt'}</p>
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <span className={retirer ? 'text-slate-400' : 'text-slate-800'}>Ajouter au inter dépôt</span>
                  <Switch checked={retirer} onChange={(v) => { setRetirer(v); setRetour(null); champ.current?.focus(); }} label="Basculer Ajouter / Retirer" />
                  <span className={retirer ? 'text-red-700' : 'text-slate-400'}>Retirer de l’inter dépôt</span>
                </span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void scanner();
                }}
                className="flex flex-col sm:flex-row gap-2 sm:items-center"
              >
                <label htmlFor="code-barre-id" className="text-sm font-semibold text-slate-700 sm:w-24">Code à barre</label>
                <input
                  id="code-barre-id"
                  ref={champ}
                  autoFocus
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="code à barre"
                  className={`flex-1 border rounded px-3 py-2 text-sm font-mono ${retirer ? 'border-red-400' : 'border-slate-300'}`}
                />
                <button
                  type="submit"
                  disabled={enCours || !code.trim()}
                  className={`px-4 py-2 rounded text-white text-sm font-semibold disabled:opacity-60 cursor-pointer ${retirer ? 'bg-red-700 hover:bg-red-800' : 'bg-orange-500 hover:bg-orange-600'}`}
                >
                  {retirer ? 'Retirer de l’inter dépôt' : 'Ajouter au inter dépôt'}
                </button>
              </form>
              {retour && (
                <p
                  role={retour.type === 'erreur' ? 'alert' : 'status'}
                  className={`mt-3 rounded px-3 py-2 text-sm font-medium ${
                    retour.type === 'erreur' ? 'bg-red-50 text-red-800 border border-red-200' : retour.type === 'retrait' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {retour.message}
                </p>
              )}
            </Card>
          )}

          {transfert && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 className="text-sm font-semibold text-slate-800">
                  Colis chargés — {transfert.totalPackages} commande(s) · {transfert.totalPieces} pièce(s)
                  {transfert.status !== 'CRE' && ` · reçues ${transfert.receivedPieces}/${transfert.totalPieces}`}
                </h2>
                {transfert.editable && peutGerer && (
                  <button type="button" onClick={() => setAnnulation(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-300 text-rose-700 text-xs font-semibold cursor-pointer">
                    <Ban className="w-3.5 h-3.5" aria-hidden="true" /> Annuler le bordereau
                  </button>
                )}
              </div>
              {transfert.items.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun colis chargé pour l’instant.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-start py-1">Colis</th>
                        <th className="text-start py-1">Expéditeur</th>
                        <th className="text-start py-1">Destinataire</th>
                        <th className="text-center py-1">Pièce(s)</th>
                        <th className="text-center py-1">État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfert.items.map((i) => (
                        <tr key={i.packageId} className="border-t border-slate-100">
                          <td className="py-1.5 font-mono">{i.barcode}</td>
                          <td className="py-1.5">{i.shipperName}</td>
                          <td className="py-1.5">{i.customerName}<span className="block text-slate-400">{i.destination}</span></td>
                          <td className="py-1.5 text-center">{i.receivedPieces}/{i.pieceCount}</td>
                          <td className="py-1.5 text-center">
                            <Badge variant={i.receptionState === 'RECU' ? 'success' : i.receptionState === 'PARTIEL' ? 'warning' : 'secondary'}>
                              {i.receptionState === 'RECU' ? 'Reçu' : i.receptionState === 'PARTIEL' ? 'Partiellement reçu' : 'En route'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={annulation}
        onClose={() => setAnnulation(false)}
        onConfirm={() => void annuler()}
        title="Annuler l'inter-dépôt"
        message={`Les ${transfert?.totalPackages ?? 0} colis chargés seront remis en stock à ${transfert?.sourceDeposit ?? 'votre dépôt'}.`}
        confirmText="Annuler le bordereau"
        type="danger"
      />
    </div>
  );
}
