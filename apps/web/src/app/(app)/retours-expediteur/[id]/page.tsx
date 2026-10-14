'use client';

/**
 * Fiche d'un bon de retour (comme ADEX).
 *
 * À gauche, ce qui attend au dépôt pour cet expéditeur (colis retournés,
 * articles repris lors d'un échange). À droite, le livreur qui porte le bon,
 * le scan pour ajouter ou retirer un colis, et le contenu du bon. En bas,
 * l'étape suivante : lancer la livraison, puis marquer le bon remis.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeftRight, Barcode, Phone, MapPin, Printer, Truck, User, X, Plus } from 'lucide-react';
import { Card, PageHeader, useToast } from '@logixpress/ui';
import { driversApi, retoursExpediteurApi, type BonRetourDetail, type ColisBonRetour, type EtatBonRetour } from '@/lib/api';
import { imprimerBonRetour } from '@/lib/impression-documents';
import { EtatBon } from '@/features/retours/EtatBon';
import { ModalEtat } from '@/features/retours/ModalEtat';

interface Livreur {
  id: string;
  nom: string;
  plaque: string | null;
}

export default function BonRetourPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ''));
  const { addToast } = useToast();
  const [bon, setBon] = useState<BonRetourDetail | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [livreurs, setLivreurs] = useState<Livreur[]>([]);
  const [form, setForm] = useState({ driverId: '', vehiclePlate: '', plannedDate: '' });
  const [enregistrement, setEnregistrement] = useState(false);
  const [mode, setMode] = useState<'ajouter' | 'retirer'>('ajouter');
  const [code, setCode] = useState('');
  const [scan, setScan] = useState<{ ok: boolean; texte: string } | null>(null);
  const [scanEnCours, setScanEnCours] = useState(false);
  const [changement, setChangement] = useState<{ bon: BonRetourDetail; status: EtatBonRetour } | null>(null);
  const [receveur, setReceveur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const champScan = useRef<HTMLInputElement>(null);

  const appliquer = useCallback((b: BonRetourDetail) => {
    setBon(b);
    setForm({ driverId: b.driverId ?? '', vehiclePlate: b.vehiclePlate ?? '', plannedDate: b.plannedDate ?? '' });
  }, []);

  const charger = useCallback(async () => {
    try {
      appliquer(await retoursExpediteurApi.bon(id));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Bon introuvable.');
    }
  }, [id, appliquer]);

  useEffect(() => {
    void charger();
    driversApi
      .list({ limit: 200 })
      .then((r) =>
        setLivreurs(
          r.items.filter((d) => d.isActive).map((d) => ({ id: d.id, nom: d.user?.fullName ?? d.driverCode, plaque: d.licensePlate }))
        )
      )
      .catch(() => undefined);
  }, [charger]);

  const modifiable = bon?.status === 'PREPARE';
  const livreurChoisi = livreurs.find((l) => l.id === form.driverId);
  const enteteModifie =
    !!bon &&
    (form.driverId !== (bon.driverId ?? '') ||
      form.vehiclePlate !== (bon.vehiclePlate ?? '') ||
      form.plannedDate !== (bon.plannedDate ?? ''));

  const enregistrer = async () => {
    if (!bon) return;
    setEnregistrement(true);
    try {
      const r = await retoursExpediteurApi.modifier(bon.id, {
        driverId: form.driverId || null,
        vehiclePlate: form.vehiclePlate,
        plannedDate: form.plannedDate,
      });
      if (r.data) appliquer(r.data);
      addToast({ type: 'success', title: 'Livreur enregistré' });
      champScan.current?.focus();
    } catch (e) {
      addToast({ type: 'error', title: 'Enregistrement impossible', message: e instanceof Error ? e.message : undefined });
    } finally {
      setEnregistrement(false);
    }
  };

  const scanner = async (valeur: string, m: 'ajouter' | 'retirer' = mode) => {
    if (!bon || !valeur.trim()) return;
    setScanEnCours(true);
    try {
      const r = await retoursExpediteurApi.scanner(bon.id, { code: valeur.trim(), mode: m });
      if (r.data) appliquer(r.data);
      setScan({ ok: true, texte: r.message ?? 'Fait.' });
      setCode('');
    } catch (e) {
      setScan({ ok: false, texte: e instanceof Error ? e.message : 'Code refusé.' });
      // Le code refusé reste affiché, sélectionné : le scan suivant le remplace.
      window.setTimeout(() => champScan.current?.select(), 0);
    } finally {
      setScanEnCours(false);
      champScan.current?.focus();
    }
  };

  const confirmerEtat = async () => {
    if (!changement) return;
    setOccupe(true);
    try {
      const r = await retoursExpediteurApi.changerEtat(changement.bon.id, {
        status: changement.status,
        receiverName: receveur.trim() || undefined,
      });
      if (r.data) appliquer(r.data);
      addToast({ type: 'success', title: r.message ?? 'État mis à jour' });
      setChangement(null);
    } catch (e) {
      addToast({ type: 'error', title: 'Changement refusé', message: e instanceof Error ? e.message : undefined });
    } finally {
      setOccupe(false);
    }
  };

  if (erreur) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erreur}</p>
        <Link href="/retours-expediteur" className="mt-3 inline-block text-sm text-red-700 underline">
          Retour à la liste
        </Link>
      </div>
    );
  }
  if (!bon) return <p className="p-6 text-sm text-slate-500">Chargement…</p>;

  const demander = (status: EtatBonRetour) => {
    setReceveur('');
    setChangement({ bon, status });
  };
  const peutLancer = !!bon.driverId && bon.colisCount > 0 && !enteteModifie;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Bon de retour N° ${bon.slipNumber}`}
        description={
          modifiable
            ? 'Choisissez le livreur, scannez les colis à rendre, puis lancez la livraison.'
            : `Créé le ${new Date(bon.createdAt).toLocaleString('fr-TN')}${bon.createdBy ? ` par ${bon.createdBy}` : ''}.`
        }
        badge={<EtatBon status={bon.status} />}
        breadcrumbs={[{ label: 'Retours expéditeur', href: '/retours-expediteur' }, { label: bon.slipNumber, active: true }]}
        actions={
          <button
            type="button"
            onClick={() => imprimerBonRetour(bon)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700"
          >
            <Printer className="w-4 h-4" aria-hidden="true" /> Imprimer
          </button>
        }
      />

      <div className="px-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* ------------------------------------------------ colonne gauche */}
        {modifiable && (
          <div className="lg:col-span-5 space-y-5">
            <ListeDepot
              titre="Colis au dépôt"
              aide={`Retournés au dépôt, pour ${bon.shipperName}`}
              classeTitre="bg-sky-50 text-sky-900 border-sky-200"
              vide="Aucun colis au dépôt pour cet expéditeur."
              lignes={bon.colisAuDepot}
              onAjouter={(c) => void scanner(c.barcode, 'ajouter')}
              testId="colis-au-depot"
            />
            <ListeDepot
              titre="Produits d'échange au dépôt"
              aide="Articles repris chez le client lors d'un échange"
              classeTitre="bg-amber-50 text-amber-900 border-amber-200"
              icone={<ArrowLeftRight className="w-4 h-4" aria-hidden="true" />}
              vide="Aucun article d'échange en attente."
              lignes={bon.echangesAuDepot}
              onAjouter={(c) => void scanner(c.barcode, 'ajouter')}
              testId="echanges-au-depot"
            />
          </div>
        )}

        {/* ------------------------------------------------ colonne droite */}
        <div className={`${modifiable ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-5`}>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-lg font-semibold text-teal-700">
                  <User className="w-5 h-5" aria-hidden="true" /> {bon.shipperName}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  {bon.shipperPhone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" aria-hidden="true" /> {bon.shipperPhone}
                    </span>
                  )}
                  {bon.shipperAddress && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" aria-hidden="true" /> {bon.shipperAddress}
                    </span>
                  )}
                </p>
              </div>
              {bon.driverName && !modifiable && (
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Truck className="w-4 h-4" aria-hidden="true" /> {bon.driverName}
                  {bon.vehiclePlate ? <span className="font-normal text-slate-400">({bon.vehiclePlate})</span> : null}
                </p>
              )}
            </div>

            {modifiable && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="entete-livreur">
                <label className="block text-xs font-semibold text-slate-600">
                  Livreur
                  <select
                    value={form.driverId}
                    onChange={(e) => {
                      const l = livreurs.find((x) => x.id === e.target.value);
                      setForm((f) => ({ ...f, driverId: e.target.value, vehiclePlate: l?.plaque ?? f.vehiclePlate }));
                    }}
                    className="mt-1 w-full border border-slate-200 rounded-md px-2.5 py-2 text-sm font-normal bg-white"
                    data-testid="choix-livreur"
                  >
                    <option value="">Choisissez…</option>
                    {livreurs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nom}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Matricule du véhicule
                  <input
                    value={form.vehiclePlate}
                    maxLength={30}
                    placeholder={livreurChoisi?.plaque ?? 'ex. 214 TUN 4512'}
                    onChange={(e) => setForm((f) => ({ ...f, vehiclePlate: e.target.value }))}
                    className="mt-1 w-full border border-slate-200 rounded-md px-2.5 py-2 text-sm font-normal"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-600">
                  Date de restitution
                  <input
                    type="date"
                    value={form.plannedDate}
                    onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))}
                    className="mt-1 w-full border border-slate-200 rounded-md px-2.5 py-2 text-sm font-normal"
                  />
                </label>
                <div className="sm:col-span-3">
                  <button
                    type="button"
                    disabled={!enteteModifie || enregistrement}
                    onClick={() => void enregistrer()}
                    data-testid="enregistrer-livreur"
                    className="w-full py-2 rounded-md bg-orange-600 text-white text-sm font-semibold disabled:opacity-40"
                  >
                    {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            )}
          </Card>

          {modifiable && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Barcode className="w-4 h-4" aria-hidden="true" />
                  {mode === 'ajouter' ? 'Ajouter des colis au bon de retour' : 'Retirer des colis du bon de retour'}
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
                        setScan(null);
                        champScan.current?.focus();
                      }}
                      data-testid={`mode-${m}`}
                      className={`px-3 py-1.5 rounded ${
                        mode === m ? (m === 'ajouter' ? 'bg-sky-600 text-white' : 'bg-red-600 text-white') : 'text-slate-600'
                      }`}
                    >
                      {m === 'ajouter' ? 'Ajouter au bon' : 'Retirer du bon'}
                    </button>
                  ))}
                </div>
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void scanner(code);
                }}
              >
                <input
                  ref={champScan}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Scannez ou tapez le code-barres, puis Entrée"
                  className="flex-1 border border-slate-200 rounded-md px-3 py-2.5 font-mono text-sm"
                  data-testid="code-barre"
                  aria-label="Code-barres"
                />
                <button
                  type="submit"
                  disabled={!code.trim() || scanEnCours}
                  className={`px-4 rounded-md text-white text-sm font-semibold disabled:opacity-40 ${
                    mode === 'ajouter' ? 'bg-orange-600' : 'bg-red-600'
                  }`}
                  data-testid="valider-scan"
                >
                  {mode === 'ajouter' ? 'Ajouter' : 'Retirer'}
                </button>
              </form>
              {scan && (
                <p
                  role="status"
                  data-testid="resultat-scan"
                  className={`mt-2 text-sm rounded-md px-3 py-2 border ${
                    scan.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-red-800 border-red-200'
                  }`}
                >
                  {scan.texte}
                </p>
              )}
            </Card>
          )}

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800">Colis dans le bon</h3>
              <p className="text-sm text-slate-600" data-testid="totaux-bon">
                <strong>{bon.colisCount}</strong> colis · <strong>{bon.piecesCount}</strong> pièce{bon.piecesCount > 1 ? 's' : ''}
              </p>
            </div>
            {bon.colis.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                {modifiable ? 'Scannez un colis ou cliquez « + » dans la liste de gauche.' : 'Aucun colis.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">N°</th>
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Contenu</th>
                      <th className="px-3 py-2 text-right">Montant</th>
                      <th className="px-3 py-2 text-left">Client</th>
                      <th className="px-3 py-2 text-left">Adresse</th>
                      {modifiable && <th className="px-3 py-2" aria-label="Retirer" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {bon.colis.map((c, i) => (
                      <tr key={`${c.kind}-${c.id}`} data-testid={`dans-bon-${c.trackingNumber}`}>
                        <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 font-mono">
                          {c.trackingNumber}
                          {c.kind === 'ECHANGE' && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-sans font-semibold text-amber-800">
                              échange
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{c.content || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.kind === 'ECHANGE' ? '—' : `${c.amount.toFixed(3)} DT`}</td>
                        <td className="px-3 py-2">
                          {c.customerName}
                          {c.customerPhone && <div className="text-xs text-slate-400">{c.customerPhone}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">{c.address}</td>
                        {modifiable && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              title="Retirer du bon"
                              onClick={() => void scanner(c.barcode, 'retirer')}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Étape suivante : ce que le bon attend. */}
          {bon.nextStatuses.length > 0 && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  {bon.status === 'PREPARE'
                    ? !bon.driverId
                      ? 'Étape suivante : choisissez le livreur et enregistrez.'
                      : bon.colisCount === 0
                        ? 'Étape suivante : ajoutez les colis à rendre.'
                        : enteteModifie
                          ? 'Enregistrez le livreur avant de lancer la livraison.'
                          : `Prêt : ${bon.driverName} peut partir avec ${bon.colisCount} colis.`
                    : bon.status === 'EN_COURS'
                      ? `En route avec ${bon.driverName}. Au retour du bon signé, marquez-le remis.`
                      : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  {bon.status === 'PREPARE' && (
                    <>
                      <button
                        type="button"
                        onClick={() => demander('ANNULE')}
                        className="px-3 py-2 rounded-md border border-red-200 text-red-700 text-sm"
                      >
                        Annuler le bon
                      </button>
                      <button
                        type="button"
                        disabled={bon.colisCount === 0}
                        onClick={() => demander('REMIS')}
                        className="px-3 py-2 rounded-md border border-slate-200 text-sm disabled:opacity-40"
                        title="L'expéditeur récupère ses colis au guichet"
                      >
                        Remis au guichet
                      </button>
                      <button
                        type="button"
                        disabled={!peutLancer}
                        onClick={() => demander('EN_COURS')}
                        data-testid="lancer-livraison"
                        className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold disabled:opacity-40"
                      >
                        Lancer la livraison
                      </button>
                    </>
                  )}
                  {bon.status === 'EN_COURS' && (
                    <>
                      <button
                        type="button"
                        onClick={() => demander('PREPARE')}
                        className="px-3 py-2 rounded-md border border-slate-200 text-sm"
                      >
                        Revenu au dépôt (non remis)
                      </button>
                      <button
                        type="button"
                        onClick={() => demander('REMIS')}
                        data-testid="marquer-remis"
                        className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-semibold"
                      >
                        Marquer remis à l&apos;expéditeur
                      </button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          )}
          {bon.status === 'REMIS' && (
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              Remis le {new Date(bon.handedOverAt ?? bon.createdAt).toLocaleString('fr-TN')}
              {bon.receiverName ? ` à ${bon.receiverName}` : ''}
              {bon.handedOverBy ? ` (enregistré par ${bon.handedOverBy})` : ''}.
            </p>
          )}
        </div>
      </div>

      <ModalEtat
        changement={changement}
        receveur={receveur}
        setReceveur={setReceveur}
        occupe={occupe}
        onClose={() => setChangement(null)}
        onConfirm={() => void confirmerEtat()}
      />
    </div>
  );
}

function ListeDepot({
  titre,
  aide,
  classeTitre,
  icone,
  vide,
  lignes,
  onAjouter,
  testId,
}: {
  titre: string;
  aide: string;
  classeTitre: string;
  icone?: React.ReactNode;
  vide: string;
  lignes: ColisBonRetour[];
  onAjouter: (c: ColisBonRetour) => void;
  testId: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white overflow-hidden" data-testid={testId}>
      <div className={`px-4 py-3 border-b ${classeTitre}`}>
        <h3 className="font-semibold flex items-center gap-2">
          {icone}
          {titre}
          <span className="ml-auto text-xs font-normal opacity-80">{lignes.length}</span>
        </h3>
        <p className="text-xs opacity-80">{aide}</p>
      </div>
      {lignes.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-slate-500">{vide}</p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
          {lignes.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-slate-900">{c.kind === 'ECHANGE' ? c.barcode : c.trackingNumber}</p>
                <p className="truncate text-xs text-slate-500">
                  {c.kind === 'ECHANGE' ? `${c.content} · colis ${c.trackingNumber}` : `${c.customerName} · ${c.pieceCount} pièce${c.pieceCount > 1 ? 's' : ''}`}
                  {c.reason && c.kind !== 'ECHANGE' ? ` · ${c.reason}` : ''}
                </p>
              </div>
              <button
                type="button"
                title="Ajouter au bon"
                onClick={() => onAjouter(c)}
                className="shrink-0 rounded-md border border-slate-200 p-1.5 text-slate-500 hover:border-sky-400 hover:text-sky-700"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
