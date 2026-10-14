'use client';

/**
 * Caisse société & livreurs.
 *
 * L'écran répond, dans cet ordre, à trois questions :
 *  1. « Qu'est-ce que je dois faire maintenant ? » — l'argent qui attend une
 *     action (espèces à valider, expéditeurs à payer, livreurs à payer) ;
 *  2. « Combien la société a-t-elle gagné sur la période ? » — un calcul lu de
 *     haut en bas : encaissé − part des expéditeurs = frais ; frais −
 *     livreurs = bénéfice ;
 *  3. « Combien dois-je à chaque livreur ? » — une ligne par livreur, avec le
 *     bouton pour le payer.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Banknote, CheckCircle2, ChevronDown, ChevronUp, HandCoins, History, Store, Truck } from 'lucide-react';
import { Card, Modal, PageHeader, formatTND, useToast } from '@logixpress/ui';
import { PermissionCode } from '@logixpress/types';
import { caisseApi, type LigneCaisseLivreur, type PaiementLivreur, type ResumeCaisse } from '@/lib/api';
import { useAuth } from '@/lib/auth';

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

const PRESETS: { id: Preset; libelle: string; phrase: string }[] = [
  { id: 'jour', libelle: "Aujourd'hui", phrase: "aujourd'hui" },
  { id: 'semaine', libelle: '7 jours', phrase: 'sur les 7 derniers jours' },
  { id: 'mois', libelle: 'Ce mois', phrase: 'ce mois-ci' },
  { id: 'tout', libelle: 'Depuis le début', phrase: 'depuis le début' },
  { id: 'perso', libelle: 'Dates…', phrase: 'sur la période choisie' },
];

/** Tarif livreur lisible : « 3 DT », pas « 3,000 DT ». */
const tarif = (r: ResumeCaisse | null) => `${r ? Number(r.tarifLivreur.toFixed(3)) : 3} DT`;

const dateCourte = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-TN', { day: 'numeric', month: 'short' });

export default function CaissePage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const peutPayer = user?.permissions?.includes(PermissionCode.PAYMENT_CASH_VALIDATE) ?? false;

  const [preset, setPreset] = useState<Preset>('mois');
  const [perso, setPerso] = useState({ from: '', to: '' });
  const bornes = useMemo(() => bornesPreset(preset, perso), [preset, perso]);
  const phrase = PRESETS.find((p) => p.id === preset)?.phrase ?? '';

  const [resume, setResume] = useState<ResumeCaisse | null>(null);
  const [livreurs, setLivreurs] = useState<LigneCaisseLivreur[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tous, setTous] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(null);

  const [aPayer, setAPayer] = useState<LigneCaisseLivreur | null>(null);
  const [montant, setMontant] = useState('');
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [historique, setHistorique] = useState<Record<string, PaiementLivreur[]>>({});

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

  // Ceux à qui on doit de l'argent d'abord, puis ceux qui ont travaillé.
  const lignes = useMemo(() => {
    const triees = [...livreurs].sort((a, b) => b.resteAPayer - a.resteAPayer || b.livres + b.ramassages - (a.livres + a.ramassages));
    return tous ? triees : triees.filter((l) => l.resteAPayer > 0 || l.livres + l.ramassages > 0);
  }, [livreurs, tous]);
  const masques = livreurs.length - lignes.length;

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
      setHistorique((h) => {
        const copie = { ...h };
        delete copie[aPayer.driverId];
        return copie;
      });
      await charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Paiement refusé', message: e instanceof Error ? e.message : undefined });
    } finally {
      setEnvoi(false);
    }
  };

  const basculer = async (l: LigneCaisseLivreur) => {
    if (ouvert === l.driverId) {
      setOuvert(null);
      return;
    }
    setOuvert(l.driverId);
    if (!historique[l.driverId]) {
      try {
        const h = await caisseApi.paiements(l.driverId);
        setHistorique((x) => ({ ...x, [l.driverId]: h }));
      } catch {
        setHistorique((x) => ({ ...x, [l.driverId]: [] }));
      }
    }
  };

  const r = resume;
  const libellePeriode =
    preset === 'perso' && (perso.from || perso.to)
      ? `du ${perso.from ? dateCourte(perso.from) : '…'} au ${perso.to ? dateCourte(perso.to) : '…'}`
      : bornes.from && bornes.to && bornes.from !== bornes.to
        ? `du ${dateCourte(bornes.from)} au ${dateCourte(bornes.to)}`
        : bornes.from
          ? `le ${dateCourte(bornes.from)}`
          : 'depuis le début';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Caisse société & livreurs"
        description="Ce que la société a encaissé, ce qu'elle doit reverser, ce qu'elle gagne, et ce qu'elle doit à chaque livreur."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Caisse', active: true }]}
      />

      <div className="px-6 space-y-8 pb-10">
        {erreur && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erreur}</p>}

        {/* ---------------------------------------------------- 1. À faire */}
        <section aria-labelledby="titre-a-faire" className="space-y-3">
          <div>
            <h2 id="titre-a-faire" className="text-base font-semibold text-slate-900">
              À faire maintenant
            </h2>
            <p className="text-sm text-slate-500">L&apos;argent qui attend une action, toutes dates confondues.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="caisse-a-faire">
            <Action
              icone={<Banknote className="w-5 h-5" aria-hidden="true" />}
              titre="Espèces à valider"
              montant={r?.especesAValider}
              explication="Encaissé par les livreurs chez les clients, pas encore compté et validé en caisse."
              lien="/paiements"
              action="Valider les encaissements"
              teinte="amber"
            />
            <Action
              icone={<Store className="w-5 h-5" aria-hidden="true" />}
              titre="À reverser aux expéditeurs"
              montant={r?.resteExpediteurs}
              explication="Argent des colis livrés qui appartient aux expéditeurs et ne leur a pas encore été payé."
              lien="/paiements/bordereaux"
              action="Préparer les bordereaux"
              teinte="sky"
            />
            <Action
              icone={<Truck className="w-5 h-5" aria-hidden="true" />}
              titre="À payer aux livreurs"
              montant={r?.resteLivreurs}
              explication={`Rémunération due aux livreurs : ${tarif(r)} par colis livré ou ramassage effectué.`}
              lien="#livreurs"
              action="Voir les livreurs"
              teinte="violet"
            />
          </div>
        </section>

        {/* ------------------------------------------------- 2. Bilan */}
        <section aria-labelledby="titre-bilan" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="titre-bilan" className="text-base font-semibold text-slate-900">
                Bilan {phrase}
              </h2>
              <p className="text-sm text-slate-500">Colis livrés {libellePeriode} — le calcul se lit de haut en bas.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Période">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={preset === p.id}
                    onClick={() => setPreset(p.id)}
                    className={`px-3 py-1.5 rounded-md text-sm ${
                      preset === p.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {p.libelle}
                  </button>
                ))}
              </div>
              {preset === 'perso' && (
                <div className="flex items-center gap-1.5 text-sm">
                  <input
                    type="date"
                    aria-label="Du"
                    value={perso.from}
                    onChange={(e) => setPerso((x) => ({ ...x, from: e.target.value }))}
                    className="border border-slate-200 rounded-md px-2 py-1.5"
                  />
                  <span className="text-slate-400">→</span>
                  <input
                    type="date"
                    aria-label="Au"
                    value={perso.to}
                    onChange={(e) => setPerso((x) => ({ ...x, to: e.target.value }))}
                    className="border border-slate-200 rounded-md px-2 py-1.5"
                  />
                </div>
              )}
            </div>
          </div>

          <Card className="p-0 overflow-hidden">
            {!r ? (
              <p className="p-6 text-sm text-slate-500">{chargement ? 'Chargement…' : '—'}</p>
            ) : r.colisLivres === 0 && r.colisRetournes === 0 ? (
              <p className="p-6 text-sm text-slate-500">Aucun colis livré {phrase}.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-5">
                <div className="lg:col-span-3 p-5 sm:p-6" data-testid="caisse-bilan">
                  <Ligne
                    libelle="Encaissé pour les colis livrés"
                    aide={`${r.colisLivres} colis livré${r.colisLivres > 1 ? 's' : ''} — ce que les clients ont payé`}
                    montant={r.encaisseColisLivres}
                  />
                  <Ligne
                    signe="−"
                    libelle="Part des expéditeurs"
                    aide="Prix des colis, à reverser aux expéditeurs"
                    montant={r.netExpediteurs}
                    couleur="text-sky-700"
                  />
                  <Ligne
                    signe="="
                    libelle="Frais de livraison gagnés"
                    aide="La part de la société sur chaque colis livré"
                    montant={r.fraisLivraison}
                    total
                  />
                  {r.fraisRetour > 0 && (
                    <Ligne
                      signe="+"
                      libelle="Frais de retour"
                      aide={`${r.colisRetournes} colis rendu${r.colisRetournes > 1 ? 's' : ''} à l'expéditeur`}
                      montant={r.fraisRetour}
                    />
                  )}
                  <Ligne
                    signe="−"
                    libelle="Rémunération des livreurs"
                    aide={`${tarif(r)} × ${Math.round(r.remunerationLivreurs / (r.tarifLivreur || 1))} colis livrés ou ramassages`}
                    montant={r.remunerationLivreurs}
                    couleur="text-violet-700"
                  />
                  <div className="mt-3 flex items-baseline justify-between gap-4 rounded-lg bg-emerald-50 px-4 py-3">
                    <div>
                      <p className="font-semibold text-emerald-900">= Bénéfice net</p>
                      <p className="text-xs text-emerald-800/80">Ce que la société garde {phrase}</p>
                    </div>
                    <p className={`text-2xl font-bold tabular-nums ${r.margeNette < 0 ? 'text-red-700' : 'text-emerald-800'}`} data-testid="benefice-net">
                      {formatTND(r.margeNette)}
                    </p>
                  </div>
                </div>

                {/* Répartition visuelle de l'argent encaissé. */}
                <div className="lg:col-span-2 border-t lg:border-t-0 lg:border-l border-slate-200 bg-slate-50/60 p-5 sm:p-6">
                  <p className="text-sm font-semibold text-slate-800">Où va l&apos;argent encaissé ?</p>
                  <Repartition
                    total={r.encaisseColisLivres}
                    parts={[
                      { libelle: 'Expéditeurs', valeur: r.netExpediteurs, classe: 'bg-sky-500' },
                      { libelle: 'Livreurs', valeur: Math.min(r.remunerationLivreurs, r.fraisLivraison), classe: 'bg-violet-500' },
                      { libelle: 'Bénéfice', valeur: Math.max(r.fraisLivraison - r.remunerationLivreurs, 0), classe: 'bg-emerald-500' },
                    ]}
                  />
                  <dl className="mt-5 space-y-2 border-t border-slate-200 pt-4 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Payé aux expéditeurs {phrase}</dt>
                      <dd className="font-medium tabular-nums text-slate-800">{formatTND(r.payeExpediteurs)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Payé aux livreurs {phrase}</dt>
                      <dd className="font-medium tabular-nums text-slate-800">{formatTND(r.payeLivreurs)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Espèces reçues {phrase}</dt>
                      <dd className="font-medium tabular-nums text-slate-800">
                        {formatTND(r.encaisse)}
                        <span className="block text-right text-xs font-normal text-slate-400">
                          dont {formatTND(r.encaisseValide)} validées
                        </span>
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* ------------------------------------------------ 3. Livreurs */}
        <section id="livreurs" aria-labelledby="titre-livreurs" className="space-y-3 scroll-mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="titre-livreurs" className="text-base font-semibold text-slate-900">
                Paiement des livreurs
              </h2>
              <p className="text-sm text-slate-500">
                Chaque livreur gagne {tarif(r)} par colis livré ou ramassage effectué. « Reste à payer »
                = tout ce qu&apos;il a gagné − tout ce qui lui a déjà été payé.
              </p>
            </div>
            {(masques > 0 || tous) && (
              <button type="button" onClick={() => setTous((t) => !t)} className="text-sm text-slate-600 underline-offset-2 hover:underline">
                {tous ? 'Masquer les livreurs sans activité' : `Afficher aussi ${masques} livreur${masques > 1 ? 's' : ''} sans activité`}
              </button>
            )}
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2.5 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <span className="col-span-4">Livreur</span>
              <span className="col-span-3">Travail {phrase}</span>
              <span className="col-span-2 text-right">Gagné {phrase}</span>
              <span className="col-span-3 text-right">Reste à payer</span>
            </div>
            {chargement && !livreurs.length ? (
              <p className="p-6 text-sm text-slate-500">Chargement…</p>
            ) : lignes.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">Aucun livreur n&apos;a travaillé {phrase}, et personne n&apos;attend de paiement.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lignes.map((l) => (
                  <li key={l.driverId} data-testid={`caisse-livreur-${l.driverCode}`}>
                    <div className="grid grid-cols-2 md:grid-cols-12 items-center gap-3 px-5 py-3.5">
                      <button type="button" onClick={() => void basculer(l)} className="col-span-2 md:col-span-4 flex items-center gap-3 text-left">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                          {initiales(l.fullName)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">{l.fullName}</span>
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            {l.driverCode}
                            {ouvert === l.driverId ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            <span className="sr-only">Détails</span>
                          </span>
                        </span>
                      </button>
                      <p className="md:col-span-3 text-sm text-slate-700">
                        <strong>{l.livres}</strong> livré{l.livres > 1 ? 's' : ''} · <strong>{l.ramassages}</strong> ramassage
                        {l.ramassages > 1 ? 's' : ''}
                      </p>
                      <p className="md:col-span-2 text-right text-sm tabular-nums text-slate-700">{formatTND(l.gainPeriode)}</p>
                      <div className="col-span-2 md:col-span-3 flex items-center justify-end gap-3">
                        {l.resteAPayer > 0 ? (
                          <>
                            <span className="text-base font-bold tabular-nums text-slate-900">{formatTND(l.resteAPayer)}</span>
                            {peutPayer && (
                              <button
                                type="button"
                                onClick={() => ouvrirPaiement(l)}
                                data-testid="caisse-payer"
                                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                              >
                                <HandCoins className="w-4 h-4" aria-hidden="true" /> Payer
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> À jour
                          </span>
                        )}
                      </div>
                    </div>
                    {ouvert === l.driverId && (
                      <div className="mx-5 mb-4 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                        <dl className="space-y-1.5 text-sm">
                          <Detail libelle="Gagné depuis le début" valeur={formatTND(l.totalGagne)} />
                          <Detail libelle="Déjà payé" valeur={formatTND(l.totalPaye)} />
                          <Detail libelle="Reste à payer" valeur={formatTND(l.resteAPayer)} fort />
                          <Detail libelle={`Espèces encaissées ${phrase}`} valeur={formatTND(l.encaissePeriode)} />
                          {l.especesNonValidees > 0 && (
                            <Detail libelle="Espèces encore à valider en caisse" valeur={formatTND(l.especesNonValidees)} alerte />
                          )}
                        </dl>
                        <div>
                          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <History className="w-3.5 h-3.5" aria-hidden="true" /> Derniers paiements
                          </p>
                          {!historique[l.driverId] ? (
                            <p className="mt-2 text-sm text-slate-400">Chargement…</p>
                          ) : historique[l.driverId]!.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-500">Aucun paiement enregistré.</p>
                          ) : (
                            <ul className="mt-2 space-y-1 text-sm">
                              {historique[l.driverId]!.slice(0, 5).map((p) => (
                                <li key={p.id} className="flex justify-between gap-3">
                                  <span className="text-slate-600">
                                    {new Date(p.paidAt).toLocaleDateString('fr-TN')}
                                    {p.note ? <span className="text-slate-400"> — {p.note}</span> : null}
                                  </span>
                                  <span className="font-medium tabular-nums">{formatTND(p.amount)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <Modal
        isOpen={!!aPayer}
        onClose={() => !envoi && setAPayer(null)}
        title={aPayer ? `Payer ${aPayer.fullName}` : ''}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAPayer(null)} disabled={envoi} className="px-3 py-1.5 rounded-md border border-slate-200 text-sm">
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void payer()}
              disabled={envoi}
              data-testid="caisse-confirmer-paiement"
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              {envoi ? 'Enregistrement…' : `Confirmer le paiement`}
            </button>
          </div>
        }
      >
        {aPayer && (
          <div className="space-y-4 text-sm">
            <dl className="rounded-lg bg-slate-50 p-3 space-y-1.5">
              <Detail libelle="Gagné depuis le début" valeur={formatTND(aPayer.totalGagne)} />
              <Detail libelle="Déjà payé" valeur={`− ${formatTND(aPayer.totalPaye)}`} />
              <Detail libelle="Reste à payer" valeur={formatTND(aPayer.resteAPayer)} fort />
            </dl>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Montant remis maintenant (DT)</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={montant}
                onChange={(e) => setMontant(e.target.value)}
                data-testid="caisse-montant"
                className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2 text-lg font-semibold tabular-nums"
              />
              <span className="mt-1 block text-xs text-slate-500">Par défaut, tout le reste à payer. Un paiement partiel est possible.</span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Note (facultatif)</span>
              <input
                type="text"
                value={note}
                maxLength={300}
                placeholder="ex. paiement de la semaine"
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-md px-3 py-2"
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

function initiales(nom: string): string {
  return nom
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((m) => m[0]?.toUpperCase())
    .join('');
}

const TEINTES = {
  amber: { fond: 'bg-amber-50', icone: 'bg-amber-100 text-amber-700', bouton: 'text-amber-800' },
  sky: { fond: 'bg-sky-50', icone: 'bg-sky-100 text-sky-700', bouton: 'text-sky-800' },
  violet: { fond: 'bg-violet-50', icone: 'bg-violet-100 text-violet-700', bouton: 'text-violet-800' },
} as const;

function Action({
  icone,
  titre,
  montant,
  explication,
  lien,
  action,
  teinte,
}: {
  icone: React.ReactNode;
  titre: string;
  montant: number | undefined;
  explication: string;
  lien: string;
  action: string;
  teinte: keyof typeof TEINTES;
}) {
  const t = TEINTES[teinte];
  const rien = montant !== undefined && montant <= 0;
  return (
    <div className={`flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-xs`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${rien ? 'bg-emerald-50 text-emerald-600' : t.icone}`}>
          {rien ? <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> : icone}
        </span>
        <p className="font-semibold text-slate-800">{titre}</p>
      </div>
      <p className={`mt-4 text-3xl font-bold tabular-nums tracking-tight ${rien ? 'text-slate-400' : 'text-slate-900'}`}>
        {montant === undefined ? '—' : formatTND(montant)}
      </p>
      <p className="mt-1 text-sm text-slate-500 flex-1">{rien ? 'Rien à faire : tout est à jour.' : explication}</p>
      {!rien && montant !== undefined && (
        <Link href={lien} className={`mt-4 inline-flex items-center gap-1 text-sm font-semibold ${t.bouton} hover:underline`}>
          {action} <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function Ligne({
  signe,
  libelle,
  aide,
  montant,
  couleur = 'text-slate-900',
  total,
}: {
  signe?: string;
  libelle: string;
  aide: string;
  montant: number;
  couleur?: string;
  total?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-3 ${total ? 'border-t-2 border-slate-900 mt-1' : 'border-b border-slate-100'}`}>
      <div className="flex gap-3">
        <span className="w-4 text-center font-semibold text-slate-400">{signe}</span>
        <div>
          <p className={`text-sm ${total ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{libelle}</p>
          <p className="text-xs text-slate-500">{aide}</p>
        </div>
      </div>
      <p className={`tabular-nums ${total ? 'text-lg font-bold' : 'text-base font-medium'} ${couleur}`}>{formatTND(montant)}</p>
    </div>
  );
}

function Repartition({ total, parts }: { total: number; parts: { libelle: string; valeur: number; classe: string }[] }) {
  const base = total > 0 ? total : parts.reduce((s, p) => s + p.valeur, 0) || 1;
  return (
    <div className="mt-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200" role="img" aria-label="Répartition de l'argent encaissé">
        {parts.map((p) => (
          <div key={p.libelle} className={p.classe} style={{ width: `${Math.max((p.valeur / base) * 100, 0)}%` }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.libelle} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className={`h-2.5 w-2.5 rounded-sm ${p.classe}`} aria-hidden="true" />
              {p.libelle}
            </span>
            <span className="tabular-nums text-slate-800">
              {formatTND(p.valeur)} <span className="text-xs text-slate-400">({Math.round((p.valeur / base) * 100)} %)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ libelle, valeur, fort, alerte }: { libelle: string; valeur: string; fort?: boolean; alerte?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={alerte ? 'text-amber-700' : 'text-slate-500'}>{libelle}</dt>
      <dd className={`tabular-nums ${fort ? 'font-bold text-slate-900' : alerte ? 'font-medium text-amber-700' : 'text-slate-800'}`}>{valeur}</dd>
    </div>
  );
}
