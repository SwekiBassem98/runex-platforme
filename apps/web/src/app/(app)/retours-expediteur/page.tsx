'use client';

/**
 * Retours expéditeur — liste des bons de retour (comme ADEX).
 *
 * Un bon de retour rend à un expéditeur ses colis retournés au dépôt (et les
 * articles repris lors d'un échange). Il est porté par un livreur ; son état
 * suit la restitution : en préparation → en cours de livraison → remis.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PackageX, Plus, Printer, RotateCcw, Truck } from 'lucide-react';
import { Card, PageHeader, Table, Tbody, Td, Th, Thead, Tr, useToast } from '@logixpress/ui';
import {
  driversApi,
  retoursExpediteurApi,
  shippersApi,
  type BonRetour,
  type EtatBonRetour,
  type ExpediteurARendre,
} from '@/lib/api';
import { imprimerBonRetour } from '@/lib/impression-documents';
import { EtatBon, ETATS_BON } from '@/features/retours/EtatBon';
import { ModalEtat } from '@/features/retours/ModalEtat';

interface Filtres {
  shipperId: string;
  driverId: string;
  status: string;
  from: string;
  to: string;
  q: string;
}

const VIDE: Filtres = { shipperId: '', driverId: '', status: '', from: '', to: '', q: '' };

export default function RetoursExpediteurPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [filtres, setFiltres] = useState<Filtres>(VIDE);
  const [bons, setBons] = useState<BonRetour[]>([]);
  const [aRendre, setARendre] = useState<ExpediteurARendre[]>([]);
  const [expediteurs, setExpediteurs] = useState<{ id: string; nom: string }[]>([]);
  const [livreurs, setLivreurs] = useState<{ id: string; nom: string }[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [changement, setChangement] = useState<{ bon: BonRetour; status: EtatBonRetour } | null>(null);
  const [receveur, setReceveur] = useState('');

  useEffect(() => {
    shippersApi
      .list({ limit: 200 })
      .then((r) => setExpediteurs(r.items.map((s) => ({ id: s.id, nom: s.companyName }))))
      .catch(() => undefined);
    driversApi
      .list({ limit: 200 })
      .then((r) => setLivreurs(r.items.map((d) => ({ id: d.id, nom: d.user?.fullName ?? d.driverCode }))))
      .catch(() => undefined);
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const params = Object.fromEntries(Object.entries(filtres).filter(([, v]) => v)) as Partial<Filtres>;
      const [b, a] = await Promise.all([retoursExpediteurApi.bons(params), retoursExpediteurApi.aRendre()]);
      setBons(b);
      setARendre(a);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, [filtres]);

  useEffect(() => {
    const t = window.setTimeout(() => void charger(), 250);
    return () => window.clearTimeout(t);
  }, [charger]);

  const creerPour = async (shipperId: string) => {
    setOccupe(`creer-${shipperId}`);
    try {
      const r = await retoursExpediteurApi.creer({ shipperId });
      if (r.data) router.push(`/retours-expediteur/${r.data.id}`);
    } catch (e) {
      addToast({ type: 'error', title: 'Création impossible', message: e instanceof Error ? e.message : undefined });
      setOccupe(null);
    }
  };

  const imprimer = async (b: BonRetour) => {
    try {
      imprimerBonRetour(await retoursExpediteurApi.bon(b.id));
    } catch (e) {
      addToast({ type: 'error', title: 'Impression impossible', message: e instanceof Error ? e.message : undefined });
    }
  };

  const confirmerEtat = async () => {
    if (!changement) return;
    setOccupe(`etat-${changement.bon.id}`);
    try {
      const r = await retoursExpediteurApi.changerEtat(changement.bon.id, {
        status: changement.status,
        receiverName: receveur.trim() || undefined,
      });
      addToast({ type: 'success', title: r.message ?? 'État mis à jour' });
      setChangement(null);
      await charger();
    } catch (e) {
      addToast({ type: 'error', title: 'Changement refusé', message: e instanceof Error ? e.message : undefined });
    } finally {
      setOccupe(null);
    }
  };

  const enAttente = useMemo(() => aRendre.reduce((s, a) => s + a.colis + a.echanges, 0), [aRendre]);
  const filtresActifs = Object.values(filtres).some(Boolean);
  const champ = 'w-full border border-slate-200 rounded-md px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500/30';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retours expéditeur"
        description="Rendez à chaque expéditeur ses colis retournés : un bon par expéditeur, porté par un livreur."
        breadcrumbs={[{ label: 'Retours' }, { label: 'Bons de retour', active: true }]}
        actions={
          <Link
            href="/retours-expediteur/nouveau"
            data-testid="ajouter-bon"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Ajouter un bon de retour
          </Link>
        }
      />

      <div className="px-6 space-y-5">
        {/* Ce qui attend un bon : la raison d'être de l'écran. */}
        {aRendre.length > 0 && (
          <section
            className="rounded-lg border border-amber-200 bg-amber-50/70 p-4"
            aria-label="Colis en attente d'un bon de retour"
            data-testid="a-rendre"
          >
            <div className="flex items-center gap-2 text-amber-900">
              <PackageX className="w-4 h-4" aria-hidden="true" />
              <p className="text-sm font-semibold">
                {enAttente} colis retourné{enAttente > 1 ? 's' : ''} au dépôt attend{enAttente > 1 ? 'ent' : ''} un bon de retour
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {aRendre.map((a) => (
                <button
                  key={a.shipperId}
                  type="button"
                  disabled={occupe === `creer-${a.shipperId}`}
                  onClick={() => void creerPour(a.shipperId)}
                  className="group inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm hover:border-amber-500 disabled:opacity-50"
                  title="Créer le bon de retour de cet expéditeur"
                >
                  <span className="font-semibold text-slate-900">{a.shipperName}</span>
                  <span className="text-xs text-slate-500">
                    {a.colis} colis{a.echanges ? ` · ${a.echanges} échange${a.echanges > 1 ? 's' : ''}` : ''}
                  </span>
                  <span className="text-xs font-semibold text-red-600 group-hover:underline">Créer le bon →</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <Card className="p-0">
          <div className="px-4 pt-4 pb-3 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-800">Liste des bons de retour</h2>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2" data-testid="filtres-bons">
              <input
                type="search"
                placeholder="N° du bon"
                value={filtres.q}
                onChange={(e) => setFiltres((f) => ({ ...f, q: e.target.value }))}
                className={champ}
                aria-label="Numéro du bon"
              />
              <select
                value={filtres.shipperId}
                onChange={(e) => setFiltres((f) => ({ ...f, shipperId: e.target.value }))}
                className={champ}
                aria-label="Expéditeur"
              >
                <option value="">Tous les expéditeurs</option>
                {expediteurs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nom}
                  </option>
                ))}
              </select>
              <select
                value={filtres.driverId}
                onChange={(e) => setFiltres((f) => ({ ...f, driverId: e.target.value }))}
                className={champ}
                aria-label="Livreur"
              >
                <option value="">Tous les livreurs</option>
                {livreurs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
              <select
                value={filtres.status}
                onChange={(e) => setFiltres((f) => ({ ...f, status: e.target.value }))}
                className={champ}
                aria-label="État"
              >
                <option value="">Tous les états</option>
                {(Object.keys(ETATS_BON) as EtatBonRetour[]).map((s) => (
                  <option key={s} value={s}>
                    {ETATS_BON[s].libelle}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Du
                <input
                  type="date"
                  value={filtres.from}
                  onChange={(e) => setFiltres((f) => ({ ...f, from: e.target.value }))}
                  className={champ}
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Au
                <input
                  type="date"
                  value={filtres.to}
                  onChange={(e) => setFiltres((f) => ({ ...f, to: e.target.value }))}
                  className={champ}
                />
              </label>
            </div>
            {filtresActifs && (
              <button
                type="button"
                onClick={() => setFiltres(VIDE)}
                className="mt-2 inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" /> Réinitialiser les filtres
              </button>
            )}
          </div>

          {erreur && <p className="m-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erreur}</p>}

          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <tr>
                  <Th>N°</Th>
                  <Th>Date</Th>
                  <Th>Expéditeur</Th>
                  <Th>Livreur</Th>
                  <Th align="center">Colis</Th>
                  <Th align="center">Pièces</Th>
                  <Th>État</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </Thead>
              <Tbody>
                {chargement && bons.length === 0 ? (
                  <tr>
                    <Td colSpan={8} align="center" className="py-8 text-slate-500">
                      Chargement…
                    </Td>
                  </tr>
                ) : bons.length === 0 ? (
                  <tr>
                    <Td colSpan={8} align="center" className="py-10 text-slate-500">
                      {filtresActifs ? 'Aucun bon ne correspond aux filtres.' : 'Aucun bon de retour pour le moment.'}
                    </Td>
                  </tr>
                ) : (
                  bons.map((b) => (
                    <Tr key={b.id} data-testid={`bon-${b.slipNumber}`}>
                      <Td>
                        <Link
                          href={`/retours-expediteur/${b.id}`}
                          className="font-mono font-semibold text-red-700 hover:underline whitespace-nowrap"
                        >
                          {b.slipNumber}
                        </Link>
                      </Td>
                      <Td className="text-sm text-slate-700 whitespace-nowrap">
                        {new Date(b.createdAt).toLocaleDateString('fr-TN')}
                        <span className="block text-xs text-slate-400">
                          {new Date(b.createdAt).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </span>
                      </Td>
                      <Td className="font-medium text-slate-900 whitespace-nowrap">{b.shipperName}</Td>
                      <Td>
                        {b.driverName ? (
                          <span className="flex items-start gap-1.5 text-sm whitespace-nowrap">
                            <Truck className="w-3.5 h-3.5 mt-0.5 text-slate-400" aria-hidden="true" />
                            <span>
                              {b.driverName.replace(/\s*\(Livreur\)\s*$/, '')}
                              {b.vehiclePlate ? <span className="block text-xs text-slate-400">{b.vehiclePlate}</span> : null}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400 whitespace-nowrap">Non affecté</span>
                        )}
                      </Td>
                      <Td align="center">{b.colisCount}</Td>
                      <Td align="center">{b.piecesCount}</Td>
                      <Td>
                        {b.nextStatuses.length ? (
                          <select
                            value=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              setReceveur('');
                              setChangement({ bon: b, status: e.target.value as EtatBonRetour });
                            }}
                            className="max-w-[11rem] text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
                            aria-label={`Changer l'état du bon ${b.slipNumber}`}
                            data-testid="changer-etat"
                          >
                            <option value="">{b.statusLabel} ▾</option>
                            {b.nextStatuses.map((n) => (
                              <option key={n.status} value={n.status}>
                                → {n.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <EtatBon status={b.status} />
                        )}
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1.5 whitespace-nowrap">
                          <Link
                            href={`/retours-expediteur/${b.id}`}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50"
                          >
                            {b.status === 'PREPARE' ? 'Compléter' : 'Ouvrir'}
                          </Link>
                          <button
                            type="button"
                            onClick={() => void imprimer(b)}
                            title="Imprimer le bon"
                            aria-label={`Imprimer le bon ${b.slipNumber}`}
                            className="inline-flex items-center rounded-md bg-orange-600 px-2 py-1.5 text-white hover:bg-orange-700"
                          >
                            <Printer className="w-4 h-4" aria-hidden="true" />
                          </button>
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

      <ModalEtat
        changement={changement}
        receveur={receveur}
        setReceveur={setReceveur}
        occupe={!!occupe}
        onClose={() => setChangement(null)}
        onConfirm={() => void confirmerEtat()}
      />
    </div>
  );
}
