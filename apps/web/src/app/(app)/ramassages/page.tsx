'use client';

/**
 * Rendez-vous ramassages — vue agence.
 *
 * Trois compteurs sur la période (en attente, effectués, annulés), la liste des
 * rendez-vous (tranche horaire, adresse, téléphone, état, expéditeur) avec
 * « Effectuer » et « ✕ », et « Organiser un ramassage » : date, créneau d'une
 * heure au minimum entre 7 h et 21 h, expéditeur (adresse reprise), livreur,
 * observation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Filter, Plus, X } from 'lucide-react';
import { PermissionCode, type PickupAppointmentDto } from '@logixpress/types';
import {
  Badge,
  type BadgeVariant,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  SkeletonTable,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatDate,
  useToast,
} from '@logixpress/ui';
import { ApiError, interDepotsApi, ramassagesApi, shippersApi, type InterDepotFormOptions, type ShipperDto } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const ETAT: Record<string, { label: string; variant: BadgeVariant }> = {
  A_CONFIRMER: { label: 'À confirmer', variant: 'warning' },
  EN_ATTENTE: { label: 'En attente', variant: 'danger' },
  ASSIGNE: { label: 'En attente', variant: 'danger' },
  EN_COURS: { label: 'En cours', variant: 'warning' },
  EFFECTUE: { label: 'Effectué', variant: 'success' },
  ANNULE: { label: 'Annulé', variant: 'secondary' },
};

const HEURE_MIN = 7;
const HEURE_MAX = 21;

const jour = (d: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
};

function Compteur({ valeur, total, libelle }: { valeur: number; total: number; libelle: string }) {
  const pct = total > 0 ? Math.round((valeur / total) * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div>
        <p className="text-2xl font-bold tabular-nums text-slate-800">
          {valeur}/{total}
        </p>
        <p className="text-xs text-slate-500">{libelle}</p>
      </div>
      <span className="w-12 h-12 rounded-full border-4 border-slate-300 flex items-center justify-center text-[11px] font-semibold text-slate-600">{pct}%</span>
    </div>
  );
}

/** Créneau : deux curseurs sur 7 h–21 h, une heure au minimum. */
function Creneau({ debut, fin, onChange }: { debut: number; fin: number; onChange: (d: number, f: number) => void }) {
  const heures = Array.from({ length: HEURE_MAX - HEURE_MIN + 1 }, (_, i) => HEURE_MIN + i);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600">Créneau</span>
        <span className="rounded bg-red-600 text-white text-[11px] font-semibold px-2 py-0.5">
          {debut}h – {fin}h · une heure au minimum
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-600">
          De
          <input
            type="range"
            min={HEURE_MIN}
            max={HEURE_MAX - 1}
            value={debut}
            aria-label="Heure de début"
            onChange={(e) => {
              const d = Number(e.target.value);
              onChange(d, Math.max(fin, d + 1));
            }}
            className="w-full accent-red-600"
          />
        </label>
        <label className="text-xs text-slate-600">
          À
          <input
            type="range"
            min={HEURE_MIN + 1}
            max={HEURE_MAX}
            value={fin}
            aria-label="Heure de fin"
            onChange={(e) => {
              const f = Number(e.target.value);
              onChange(Math.min(debut, f - 1), f);
            }}
            className="w-full accent-red-600"
          />
        </label>
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 font-mono" aria-hidden="true">
        {heures.map((h) => (
          <span key={h}>{h}h</span>
        ))}
      </div>
    </div>
  );
}

export default function RamassagesPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const peutGerer = user?.permissions?.includes(PermissionCode.RAMASSAGE_MANAGE) ?? false;

  const aujourdHui = new Date();
  const [debut, setDebut] = useState(jour(aujourdHui));
  const [fin, setFin] = useState(jour(new Date(aujourdHui.getFullYear(), 11, 31)));
  const [periode, setPeriode] = useState({ debut, fin });
  const [liste, setListe] = useState<PickupAppointmentDto[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etatFiltre, setEtatFiltre] = useState('');
  const [expFiltre, setExpFiltre] = useState('');

  const [ouvert, setOuvert] = useState(false);
  const [expediteurs, setExpediteurs] = useState<ShipperDto[]>([]);
  const [options, setOptions] = useState<InterDepotFormOptions | null>(null);
  const [form, setForm] = useState({ date: jour(aujourdHui), debut: 14, fin: 15, shipperId: '', driverId: '', adresse: '', observation: '' });
  const [envoi, setEnvoi] = useState(false);
  const [aAnnuler, setAAnnuler] = useState<PickupAppointmentDto | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const res = await ramassagesApi.list({ start: periode.debut, end: periode.fin });
      setListe(res.data ?? []);
    } catch (e) {
      setErreur(e instanceof ApiError ? e.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [periode]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const ouvrir = async () => {
    setOuvert(true);
    if (expediteurs.length === 0) {
      shippersApi.list({ status: 'actif', limit: 200 }).then((p) => setExpediteurs(p.items)).catch(() => setExpediteurs([]));
    }
    if (!options) interDepotsApi.formOptions().then(setOptions).catch(() => setOptions(null));
  };

  const choisirExpediteur = (id: string) => {
    const s = expediteurs.find((x) => x.id === id);
    setForm((f) => ({ ...f, shipperId: id, adresse: s?.address ?? f.adresse }));
  };

  const enregistrer = async () => {
    if (!form.shipperId) return addToast({ type: 'warning', title: 'Choisissez l’expéditeur' });
    if (!form.driverId) return addToast({ type: 'warning', title: 'Choisissez le livreur' });
    if (form.fin - form.debut < 1) return addToast({ type: 'warning', title: 'Une heure au minimum' });
    setEnvoi(true);
    try {
      const res = await ramassagesApi.create({
        shipperId: form.shipperId,
        scheduledDate: form.date,
        timeSlotStartHour: form.debut,
        timeSlotEndHour: form.fin,
        pickupAddress: form.adresse,
        assignedDriverId: form.driverId,
        notes: form.observation || undefined,
      });
      addToast({ type: 'success', title: 'Ramassage organisé', message: res.message });
      setOuvert(false);
      setForm((f) => ({ ...f, shipperId: '', driverId: '', adresse: '', observation: '' }));
      void charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Enregistrement impossible', message: e instanceof ApiError ? e.message : undefined });
    } finally {
      setEnvoi(false);
    }
  };

  const effectuer = async (p: PickupAppointmentDto) => {
    try {
      const res = await ramassagesApi.complete(p.referenceNumber);
      addToast({ type: 'success', title: 'Ramassage effectué', message: res.message, sound: 'complete' });
      void charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Action impossible', message: e instanceof ApiError ? e.message : undefined });
    }
  };

  const annuler = async () => {
    const p = aAnnuler;
    setAAnnuler(null);
    if (!p) return;
    try {
      await ramassagesApi.cancel(p.referenceNumber);
      addToast({ type: 'success', title: 'Ramassage annulé', sound: 'remove' });
      void charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Annulation impossible', message: e instanceof ApiError ? e.message : undefined });
    }
  };

  const enAttente = liste.filter((p) => p.status !== 'EFFECTUE' && p.status !== 'ANNULE').length;
  const effectues = liste.filter((p) => p.status === 'EFFECTUE').length;
  const annules = liste.filter((p) => p.status === 'ANNULE').length;
  const visibles = useMemo(
    () =>
      liste.filter((p) => {
        if (etatFiltre === 'ATTENTE' && (p.status === 'EFFECTUE' || p.status === 'ANNULE')) return false;
        if (etatFiltre && etatFiltre !== 'ATTENTE' && p.status !== etatFiltre) return false;
        if (expFiltre && !p.shipperName.toLowerCase().includes(expFiltre.toLowerCase())) return false;
        return true;
      }),
    [liste, etatFiltre, expFiltre]
  );

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Rendez-vous ramassages"
        description="Collectes organisées chez les expéditeurs."
        breadcrumbs={[{ label: 'RDV Ramassage' }, { label: 'Liste', active: true }]}
        actions={
          peutGerer ? (
            <button type="button" onClick={() => void ouvrir()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm font-semibold cursor-pointer">
              <Plus className="w-4 h-4" aria-hidden="true" /> Organiser un ramassage
            </button>
          ) : undefined
        }
      />
      <div className="px-4 sm:px-6 space-y-4">
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm text-slate-700">
              Liste des <span className="text-red-600 font-semibold">tous les ramassages</span> pour tous les expéditeurs du :
            </p>
            <input type="date" aria-label="Début" value={debut} onChange={(e) => setDebut(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <span className="text-slate-400">→</span>
            <input type="date" aria-label="Fin" value={fin} onChange={(e) => setFin(e.target.value)} className="border border-slate-300 rounded px-2 py-1.5 text-sm" />
            <button type="button" onClick={() => setPeriode({ debut, fin })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold cursor-pointer">
              <Filter className="w-4 h-4" aria-hidden="true" /> Filtrer
            </button>
          </div>
          <div className="mt-3 rounded bg-slate-700 text-white text-sm font-semibold px-4 py-2">Tous les ramassages ({liste.length})</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <Compteur valeur={enAttente} total={liste.length} libelle="Ramassages : En attente" />
            <Compteur valeur={effectues} total={liste.length} libelle="Ramassages : Effectué" />
            <Compteur valeur={annules} total={liste.length} libelle="Ramassages : Annulé" />
          </div>
        </Card>

        <Card>
          {erreur ? (
            <ErrorState message={erreur} onRetry={charger} />
          ) : chargement ? (
            <SkeletonTable rows={5} cols={7} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Tranche horaire</Th>
                    <Th>Date</Th>
                    <Th>Adresse</Th>
                    <Th>Tél. Responsable</Th>
                    <Th>Livreur</Th>
                    <Th align="center">État</Th>
                    <Th>Expéditeur</Th>
                    <Th align="right">Actions</Th>
                  </Tr>
                  <Tr>
                    <Th> </Th><Th> </Th><Th> </Th><Th> </Th><Th> </Th>
                    <Th>
                      <select aria-label="Filtrer par état" value={etatFiltre} onChange={(e) => setEtatFiltre(e.target.value)} className="border border-slate-300 rounded px-1 py-1 text-xs font-normal">
                        <option value="">Tous</option>
                        <option value="ATTENTE">En attente</option>
                        <option value="EFFECTUE">Effectué</option>
                        <option value="ANNULE">Annulé</option>
                      </select>
                    </Th>
                    <Th>
                      <input aria-label="Rechercher un expéditeur" placeholder="Rechercher un expéditeur…" value={expFiltre} onChange={(e) => setExpFiltre(e.target.value)} className="w-40 border border-slate-300 rounded px-1.5 py-1 text-xs font-normal" />
                    </Th>
                    <Th> </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {visibles.length === 0 ? (
                    <Tr><Td colSpan={8}><EmptyState title="Aucun ramassage" description="Aucun rendez-vous sur la période." /></Td></Tr>
                  ) : (
                    visibles.map((p) => {
                      const e = ETAT[p.status] ?? { label: p.status, variant: 'default' as BadgeVariant };
                      const ouvertP = p.status !== 'EFFECTUE' && p.status !== 'ANNULE';
                      return (
                        <Tr key={p.id}>
                          <Td>{p.timeSlotStartHour}h – {p.timeSlotEndHour}h</Td>
                          <Td>{formatDate(p.scheduledDate)}</Td>
                          <Td>{p.pickupAddress}</Td>
                          <Td><span className="font-mono">{p.contactPhone}</span></Td>
                          <Td>{p.assignedDriverName ?? '—'}</Td>
                          <Td align="center"><Badge variant={e.variant}>{e.label}</Badge></Td>
                          <Td>{p.shipperName}</Td>
                          <Td align="right">
                            {peutGerer && ouvertP && (
                              <span className="inline-flex flex-col items-end gap-1">
                                {p.status === 'ASSIGNE' || p.status === 'EN_COURS' ? (
                                  <button type="button" onClick={() => void effectuer(p)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer">
                                    <Check className="w-3.5 h-3.5" aria-hidden="true" /> Effectuer
                                  </button>
                                ) : null}
                                <button type="button" onClick={() => setAAnnuler(p)} title="Annuler le ramassage" aria-label={`Annuler ${p.referenceNumber}`} className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">
                                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })
                  )}
                </Tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Modal isOpen={ouvert} onClose={() => setOuvert(false)} title="Organiser un ramassage" size="lg"
        footer={
          <>
            <button type="button" onClick={() => void enregistrer()} disabled={envoi} className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer">Enregistrer</button>
            <button type="button" onClick={() => setOuvert(false)} className="px-4 py-2 rounded border border-slate-300 text-sm cursor-pointer">Fermer</button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4 items-end">
            <label className="text-xs text-slate-600 space-y-1">
              <span>Disponibilité</span>
              <input type="date" value={form.date} min={jour(aujourdHui)} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border border-slate-300 rounded px-2 py-2 text-sm" />
            </label>
            <Creneau debut={form.debut} fin={form.fin} onChange={(d, f) => setForm({ ...form, debut: d, fin: f })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs text-slate-600 space-y-1">
              <span>Expéditeur</span>
              <select value={form.shipperId} onChange={(e) => choisirExpediteur(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                <option value="">Choisissez expéditeur</option>
                {expediteurs.map((s) => (
                  <option key={s.id} value={s.id}>{s.brandName || s.companyName}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600 space-y-1">
              <span>Livreur</span>
              <select value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                <option value="">Choisissez livreur</option>
                {options?.drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.fullName}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600 space-y-1">
              <span>Adresse</span>
              <textarea value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} rows={3} className="w-full border border-slate-300 rounded px-2 py-2 text-sm" />
            </label>
            <label className="text-xs text-slate-600 space-y-1">
              <span>Observation</span>
              <textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={3} className="w-full border border-slate-300 rounded px-2 py-2 text-sm" />
            </label>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={aAnnuler !== null}
        onClose={() => setAAnnuler(null)}
        onConfirm={() => void annuler()}
        title="Annuler le ramassage"
        message={`Le rendez-vous ${aAnnuler?.referenceNumber ?? ''} chez ${aAnnuler?.shipperName ?? ''} sera annulé.`}
        confirmText="Annuler le ramassage"
        type="danger"
      />
    </div>
  );
}
