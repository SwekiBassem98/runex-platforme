'use client';

/**
 * Caisse de la société.
 *
 * Sur une période : tout ce qui a été encaissé, le net dû aux expéditeurs,
 * les frais de livraison gagnés, et — livreur par livreur — ce qu'il a gagné
 * (3 DT par colis livré ou ramassage effectué), ce qui lui a été payé et ce
 * qu'il reste à lui payer. Le bouton « Payer » enregistre le paiement.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  MetricCard,
  Modal,
  PageHeader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  formatTND,
  useToast,
} from '@logixpress/ui';
import { caisseApi, type LigneCaisseLivreur, type PaiementLivreur, type ResumeCaisse } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PermissionCode } from '@logixpress/types';

type Preset = 'jour' | 'semaine' | 'mois' | 'tout' | 'perso';

/** Jour calendaire de Tunis, `AAAA-MM-JJ`. */
function jourTunis(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(d);
}

function bornesPreset(preset: Preset, perso: { from: string; to: string }): { from?: string; to?: string } {
  const aujourdhui = jourTunis();
  if (preset === 'jour') return { from: aujourdhui, to: aujourdhui };
  if (preset === 'semaine') return { from: jourTunis(new Date(Date.now() - 6 * 86400000)), to: aujourdhui };
  if (preset === 'mois') return { from: `${aujourdhui.slice(0, 8)}01`, to: aujourdhui };
  if (preset === 'perso') return { from: perso.from || undefined, to: perso.to || undefined };
  return {};
}

const PRESETS: { id: Preset; libelle: string }[] = [
  { id: 'jour', libelle: "Aujourd'hui" },
  { id: 'semaine', libelle: '7 derniers jours' },
  { id: 'mois', libelle: 'Ce mois' },
  { id: 'tout', libelle: 'Depuis le début' },
  { id: 'perso', libelle: 'Personnalisée' },
];

export default function CaissePage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const peutPayer = user?.permissions?.includes(PermissionCode.PAYMENT_CASH_VALIDATE) ?? false;

  const [preset, setPreset] = useState<Preset>('mois');
  const [perso, setPerso] = useState({ from: '', to: '' });
  const bornes = useMemo(() => bornesPreset(preset, perso), [preset, perso]);

  const [resume, setResume] = useState<ResumeCaisse | null>(null);
  const [livreurs, setLivreurs] = useState<LigneCaisseLivreur[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');

  const [aPayer, setAPayer] = useState<LigneCaisseLivreur | null>(null);
  const [montant, setMontant] = useState('');
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [historique, setHistorique] = useState<{ livreur: LigneCaisseLivreur; lignes: PaiementLivreur[] } | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const [r, l] = await Promise.all([caisseApi.resume(bornes), caisseApi.livreurs(bornes)]);
      setResume(r);
      setLivreurs(l);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [bornes]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const lignes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return livreurs
      .filter((l) => !q || l.fullName.toLowerCase().includes(q) || l.driverCode.toLowerCase().includes(q))
      .sort((a, b) => b.resteAPayer - a.resteAPayer || b.livres - a.livres);
  }, [livreurs, recherche]);

  const ouvrirPaiement = (l: LigneCaisseLivreur) => {
    setAPayer(l);
    setMontant(l.resteAPayer.toFixed(3));
    setNote('');
  };

  const payer = async () => {
    if (!aPayer) return;
    const valeur = Number(montant.replace(',', '.'));
    if (!Number.isFinite(valeur) || valeur <= 0) {
      addToast({ type: 'error', title: 'Montant invalide' });
      return;
    }
    setEnvoi(true);
    try {
      const r = await caisseApi.payer(aPayer.driverId, { amount: valeur, note: note.trim() || undefined });
      addToast({ type: 'success', title: 'Paiement enregistré', message: r.message ?? r.data?.reference });
      setAPayer(null);
      await charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Paiement refusé', message: e instanceof Error ? e.message : undefined });
    } finally {
      setEnvoi(false);
    }
  };

  const voirHistorique = async (l: LigneCaisseLivreur) => {
    try {
      setHistorique({ livreur: l, lignes: await caisseApi.paiements(l.driverId) });
    } catch (e) {
      addToast({ type: 'error', title: 'Historique indisponible', message: e instanceof Error ? e.message : undefined });
    }
  };

  const m = (v: number | undefined) => (resume ? formatTND(v ?? 0) : '—');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caisse"
        description="Encaissements de la société, net expéditeurs, frais de livraison et paiement des livreurs."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Caisse', active: true }]}
      />

      <div className="px-6 space-y-6">
        <div className="flex flex-wrap items-end gap-2" data-testid="caisse-periode">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-md text-sm border ${
                preset === p.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
            >
              {p.libelle}
            </button>
          ))}
          {preset === 'perso' && (
            <>
              <label className="text-xs text-slate-500">
                Du
                <input
                  type="date"
                  value={perso.from}
                  onChange={(e) => setPerso((x) => ({ ...x, from: e.target.value }))}
                  className="ml-1 border border-slate-200 rounded-md px-2 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-slate-500">
                au
                <input
                  type="date"
                  value={perso.to}
                  onChange={(e) => setPerso((x) => ({ ...x, to: e.target.value }))}
                  className="ml-1 border border-slate-200 rounded-md px-2 py-1 text-sm"
                />
              </label>
            </>
          )}
        </div>

        {erreur && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erreur}</p>
        )}

        <section aria-label="Encaissements" className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Encaissements</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="caisse-kpi">
            <MetricCard title="Total encaissé" value={m(resume?.encaisse)} description="Espèces COD collectées" />
            <MetricCard title="Validé en caisse" value={m(resume?.encaisseValide)} />
            <MetricCard title="En attente de validation" value={m(resume?.encaisseEnAttente)} />
            <MetricCard
              title="Colis livrés / retournés"
              value={resume ? `${resume.colisLivres} / ${resume.colisRetournes}` : '—'}
            />
          </div>
        </section>

        <section aria-label="Société" className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Société et expéditeurs</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard title="Frais de livraison" value={m(resume?.fraisLivraison)} description="Gagnés sur les colis livrés" />
            <MetricCard title="Frais de retour" value={m(resume?.fraisRetour)} />
            <MetricCard title="Net expéditeurs" value={m(resume?.netExpediteurs)} description="Encaissé − frais (colis livrés)" />
            <MetricCard
              title="Reste dû aux expéditeurs"
              value={m(resume?.resteExpediteurs)}
              description={resume ? `Déjà réglé sur la période : ${formatTND(resume.payeExpediteurs)}` : undefined}
            />
          </div>
        </section>

        <section aria-label="Livreurs" className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Livreurs {resume ? `(${formatTND(resume.tarifLivreur)} par colis livré ou ramassage)` : ''}
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              title="Rémunération livreurs"
              value={m(resume?.remunerationLivreurs)}
              description={resume ? `${resume.ramassagesEffectues} ramassage(s) sur la période` : undefined}
            />
            <MetricCard title="Payé aux livreurs" value={m(resume?.payeLivreurs)} description="Sur la période" />
            <MetricCard title="Reste à payer (total)" value={m(resume?.resteLivreurs)} />
            <MetricCard title="Marge nette" value={m(resume?.margeNette)} description="Frais − rémunération livreurs" />
          </div>
        </section>

        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
            <h3 className="font-semibold text-slate-800">Paiement des livreurs</h3>
            <input
              type="search"
              placeholder="Rechercher un livreur…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-60"
            />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <tr>
                  <Th>Livreur</Th>
                  <Th align="center">Livrés</Th>
                  <Th align="center">Ramassages</Th>
                  <Th align="right">Gagné (période)</Th>
                  <Th align="right">Encaissé (période)</Th>
                  <Th align="right">Espèces à valider</Th>
                  <Th align="right">Gagné (total)</Th>
                  <Th align="right">Payé (total)</Th>
                  <Th align="right">Reste à payer</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </Thead>
              <Tbody>
                {chargement ? (
                  <tr>
                    <Td colSpan={10} align="center" className="text-slate-500 py-6">
                      Chargement…
                    </Td>
                  </tr>
                ) : lignes.length === 0 ? (
                  <tr>
                    <Td colSpan={10} align="center" className="text-slate-500 py-6">
                      Aucun livreur.
                    </Td>
                  </tr>
                ) : (
                  lignes.map((l) => (
                    <Tr key={l.driverId} data-testid={`caisse-livreur-${l.driverCode}`}>
                      <Td>
                        <div className="font-semibold text-slate-900">{l.fullName}</div>
                        <div className="text-xs text-slate-500 font-mono">
                          {l.driverCode}
                          {l.depositName ? ` · ${l.depositName}` : ''}
                        </div>
                      </Td>
                      <Td align="center">{l.livres}</Td>
                      <Td align="center">{l.ramassages}</Td>
                      <Td align="right" className="font-mono">{formatTND(l.gainPeriode)}</Td>
                      <Td align="right" className="font-mono">{formatTND(l.encaissePeriode)}</Td>
                      <Td align="right" className={`font-mono ${l.especesNonValidees > 0 ? 'text-amber-700' : ''}`}>
                        {formatTND(l.especesNonValidees)}
                      </Td>
                      <Td align="right" className="font-mono">{formatTND(l.totalGagne)}</Td>
                      <Td align="right" className="font-mono">{formatTND(l.totalPaye)}</Td>
                      <Td align="right" className="font-mono font-bold text-slate-900">{formatTND(l.resteAPayer)}</Td>
                      <Td align="right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void voirHistorique(l)}
                            className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50"
                          >
                            Historique
                          </button>
                          {peutPayer && (
                            <button
                              type="button"
                              disabled={l.resteAPayer <= 0}
                              onClick={() => ouvrirPaiement(l)}
                              data-testid="caisse-payer"
                              className="text-xs px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-700"
                            >
                              Payer
                            </button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </Card>
      </div>

      <Modal
        isOpen={!!aPayer}
        onClose={() => !envoi && setAPayer(null)}
        title={aPayer ? `Payer ${aPayer.fullName}` : ''}
        subtitle={aPayer ? `Reste à payer : ${formatTND(aPayer.resteAPayer)}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAPayer(null)}
              disabled={envoi}
              className="px-3 py-1.5 rounded-md border border-slate-200 text-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void payer()}
              disabled={envoi}
              data-testid="caisse-confirmer-paiement"
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
            >
              {envoi ? 'Enregistrement…' : 'Confirmer le paiement'}
            </button>
          </div>
        }
      >
        {aPayer && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">
              {aPayer.livres} colis livré(s) et {aPayer.ramassages} ramassage(s) sur la période. Gagné depuis le
              début : {formatTND(aPayer.totalGagne)}, déjà payé : {formatTND(aPayer.totalPaye)}.
            </p>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Montant (DT)</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
                data-testid="caisse-montant"
                className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Note (facultatif)</span>
              <input
                type="text"
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2"
              />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!historique}
        onClose={() => setHistorique(null)}
        title={historique ? `Paiements — ${historique.livreur.fullName}` : ''}
        size="md"
      >
        {historique && historique.lignes.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun paiement enregistré.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {historique?.lignes.map((p) => (
              <li key={p.id} className="py-2 flex justify-between gap-3">
                <div>
                  <div className="font-mono text-xs text-slate-500">{p.reference}</div>
                  <div className="text-slate-700">
                    {new Date(p.paidAt).toLocaleString('fr-TN')}
                    {p.note ? ` — ${p.note}` : ''}
                  </div>
                </div>
                <div className="font-mono font-bold">{formatTND(p.amount)}</div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
