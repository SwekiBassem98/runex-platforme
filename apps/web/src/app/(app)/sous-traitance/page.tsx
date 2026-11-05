'use client';

/**
 * Sous-traitance JAX — pilotage de la livraison confiée au partenaire JAX.
 *
 *  - Colis confiés : code JAX, étape, statut lu chez JAX, gestes (relire,
 *    retour reçu) ;
 *  - À confier : colis reçus dans une agence Runex, à envoyer à JAX ;
 *  - Enlèvements : colis créés chez JAX, à faire enlever par agence ;
 *  - Encaissements : montants encaissés par JAX, à reverser à Runex — un
 *    expéditeur n'est réglé qu'une fois le reversement reçu ;
 *  - Paramètres : connexion, référentiels JAX, zones confiées
 *    automatiquement, correspondance des statuts JAX.
 */

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Coins, Handshake, PackageCheck, RefreshCw, Send, Settings2, Truck } from 'lucide-react';
import { Card, PageHeader, useToast } from '@logixpress/ui';
import { ETATS_SOUS_TRAITANCE } from '@logixpress/types';
import {
  interDepotsApi,
  sousTraitanceApi,
  type ColisEligibleJax,
  type EnlevementJax,
  type ListeSousTraitance,
  type ParametresJax,
} from '@/lib/api';
import { GOUVERNORATS } from '@/features/expediteur/lib/libelles';
import { EtatJax } from '@/features/sous-traitance/EtatJax';

type Onglet = 'confies' | 'aconfier' | 'enlevements' | 'encaissements' | 'parametres';
const ONGLETS: { id: Onglet; libelle: string; icone: React.ElementType }[] = [
  { id: 'confies', libelle: 'Colis confiés', icone: Handshake },
  { id: 'aconfier', libelle: 'À confier', icone: Send },
  { id: 'enlevements', libelle: 'Enlèvements', icone: Truck },
  { id: 'encaissements', libelle: 'Encaissements JAX', icone: Coins },
  { id: 'parametres', libelle: 'Paramètres', icone: Settings2 },
];
const dt = (n: number) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;
const quand = (v: string | null) => (v ? new Date(v).toLocaleString('fr-TN', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const champ = 'border border-slate-300 rounded-md px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30';
const bouton = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition cursor-pointer disabled:opacity-50';

export default function SousTraitancePage() {
  const { addToast } = useToast();
  const [onglet, setOnglet] = React.useState<Onglet>('confies');
  const [params, setParams] = React.useState<ParametresJax | null>(null);
  const [depots, setDepots] = React.useState<{ id: string; name: string }[]>([]);
  const [compteurs, setCompteurs] = React.useState<ListeSousTraitance | null>(null);

  const chargerParams = React.useCallback(async () => {
    try {
      setParams(await sousTraitanceApi.parametres());
    } catch {
      setParams(null);
    }
  }, []);
  const chargerCompteurs = React.useCallback(async () => {
    try {
      setCompteurs(await sousTraitanceApi.lister());
    } catch {
      /* affiché dans l'onglet */
    }
  }, []);
  React.useEffect(() => {
    void chargerParams();
    void chargerCompteurs();
    interDepotsApi
      .formOptions()
      .then((o) => setDepots(o.deposits.map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => undefined);
  }, [chargerParams, chargerCompteurs]);

  const notifier = (ok: boolean, titre: string, message?: string) => addToast({ type: ok ? 'success' : 'error', title: titre, message });
  const c = compteurs?.compteurs ?? {};
  const actifs = (c.EN_ATTENTE_ENLEVEMENT ?? 0) + (c.ENLEVEMENT_DEMANDE ?? 0) + (c.PRIS_EN_CHARGE ?? 0) + (c.EN_LIVRAISON ?? 0) + (c.RETOUR_EN_COURS ?? 0);

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Sous-traitance JAX"
        description="Colis dont la livraison est confiée au partenaire JAX : envoi, enlèvement en agence, suivi des statuts JAX, retours et reversements."
        breadcrumbs={[{ label: 'Distribution' }, { label: 'Sous-traitance JAX', active: true }]}
      />
      <div className="px-4 sm:px-6 space-y-5">
        {params && !params.configure && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="jax-non-configure">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <p>
              <strong>JAX n’est pas encore connecté.</strong> Ajoutez le jeton fourni par JAX dans la variable <code>JAX_API_TOKEN</code> de
              l’API (Koyeb → Environment, type Secret), puis redéployez. Sans lui, aucun colis ne peut être envoyé à JAX.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="compteurs-jax">
          {[
            ['Chez JAX', actifs, 'bg-violet-50 border-violet-200 text-violet-900'],
            ['À faire enlever', c.EN_ATTENTE_ENLEVEMENT ?? 0, 'bg-slate-50 border-slate-200 text-slate-900'],
            ['Livrés par JAX', c.LIVRE ?? 0, 'bg-emerald-50 border-emerald-200 text-emerald-900'],
            ['Retours en cours', c.RETOUR_EN_COURS ?? 0, 'bg-rose-50 border-rose-200 text-rose-900'],
            ['À recevoir de JAX', compteurs ? dt(compteurs.codARecevoir.total) : '—', 'bg-amber-50 border-amber-200 text-amber-900'],
          ].map(([libelle, valeur, ton]) => (
            <div key={String(libelle)} className={`rounded-lg border px-4 py-3 ${ton}`}>
              <p className="text-xs font-semibold opacity-80">{libelle}</p>
              <p className="text-xl font-bold tabular-nums">{valeur}</p>
            </div>
          ))}
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Sections de la sous-traitance">
          {ONGLETS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setOnglet(o.id)}
              aria-current={onglet === o.id ? 'page' : undefined}
              data-testid={`onglet-${o.id}`}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-semibold transition cursor-pointer ${
                onglet === o.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <o.icone className="w-4 h-4" aria-hidden="true" /> {o.libelle}
            </button>
          ))}
        </nav>

        {onglet === 'confies' && <Confies depots={depots} notifier={notifier} onChange={chargerCompteurs} />}
        {onglet === 'aconfier' && <AConfier depots={depots} notifier={notifier} onChange={chargerCompteurs} configure={!!params?.configure} />}
        {onglet === 'enlevements' && <Enlevements notifier={notifier} onChange={chargerCompteurs} />}
        {onglet === 'encaissements' && <Encaissements notifier={notifier} onChange={chargerCompteurs} />}
        {onglet === 'parametres' && <Parametres params={params} recharger={chargerParams} notifier={notifier} />}
      </div>
    </div>
  );
}

type Notifier = (ok: boolean, titre: string, message?: string) => void;
const erreur = (e: unknown) => (e instanceof Error ? e.message : undefined);

/* ------------------------------------------------------------------ */

function Confies({ depots, notifier, onChange }: { depots: { id: string; name: string }[]; notifier: Notifier; onChange: () => void }) {
  const [etat, setEtat] = React.useState('');
  const [depot, setDepot] = React.useState('');
  const [q, setQ] = React.useState('');
  const [liste, setListe] = React.useState<ListeSousTraitance | null>(null);
  const [occupe, setOccupe] = React.useState<string | null>(null);

  const charger = React.useCallback(async () => {
    try {
      setListe(await sousTraitanceApi.lister({ etat: etat || undefined, depositId: depot || undefined, q: q.trim() || undefined }));
    } catch (e) {
      notifier(false, 'Liste indisponible', erreur(e));
    }
  }, [etat, depot, q, notifier]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void charger(), 250);
    return () => window.clearTimeout(t);
  }, [charger]);

  const relire = async () => {
    setOccupe('sync');
    try {
      const r = await sousTraitanceApi.sync();
      notifier(!(r.data?.erreurs?.length), r.message ?? 'Statuts relus');
      await charger();
      onChange();
    } catch (e) {
      notifier(false, 'Relecture JAX impossible', erreur(e));
    } finally {
      setOccupe(null);
    }
  };
  const retourRecu = async (packageId: string) => {
    setOccupe(packageId);
    try {
      notifier(true, (await sousTraitanceApi.retourRecu(packageId)).message ?? 'Retour reçu');
      await charger();
      onChange();
    } catch (e) {
      notifier(false, 'Retour refusé', erreur(e));
    } finally {
      setOccupe(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° Runex ou code JAX" aria-label="Rechercher" className={`${champ} w-52`} />
        <select value={etat} onChange={(e) => setEtat(e.target.value)} aria-label="Étape" className={champ}>
          <option value="">Toutes les étapes</option>
          {Object.entries(liste?.compteurs ?? {}).map(([e, n]) => (
            <option key={e} value={e}>
              {ETATS_SOUS_TRAITANCE[e as keyof typeof ETATS_SOUS_TRAITANCE] ?? e} ({n})
            </option>
          ))}
        </select>
        <select value={depot} onChange={(e) => setDepot(e.target.value)} aria-label="Agence" className={champ}>
          <option value="">Toutes les agences</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void relire()} disabled={!!occupe} data-testid="relire-tous" className={`${bouton} ms-auto bg-violet-700 text-white hover:bg-violet-800`}>
          <RefreshCw className={`w-4 h-4 ${occupe === 'sync' ? 'animate-spin' : ''}`} aria-hidden="true" /> Relire les statuts JAX
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]" data-testid="table-confies">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3">Colis Runex</th>
              <th className="py-2 pr-3">Code JAX</th>
              <th className="py-2 pr-3">Expéditeur → destination</th>
              <th className="py-2 pr-3">Agence</th>
              <th className="py-2 pr-3">Étape</th>
              <th className="py-2 pr-3">Statut chez JAX</th>
              <th className="py-2 pr-3 text-right">Montant</th>
              <th className="py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!liste ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">Chargement…</td>
              </tr>
            ) : liste.lignes.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">Aucun colis confié à JAX pour ces filtres.</td>
              </tr>
            ) : (
              liste.lignes.map((l) => (
                <tr key={l.packageId} data-testid={`confie-${l.trackingNumber}`}>
                  <td className="py-2.5 pr-3">
                    <Link href={`/colis/${l.packageId}`} className="font-mono text-xs font-bold text-red-700 hover:underline">
                      {l.trackingNumber}
                    </Link>
                    <span className="block text-[11px] text-slate-500">{l.mode === 'AUTO' ? 'auto (zone JAX)' : 'manuel'} · {quand(l.envoyeLe)}</span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs">{l.codeExterne ?? '—'}</td>
                  <td className="py-2.5 pr-3 text-xs">
                    <span className="font-semibold text-slate-800">{l.expediteur}</span>
                    <span className="block text-slate-500">
                      {l.destinataire} · {l.destination}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs">{l.agence ?? '—'}</td>
                  <td className="py-2.5 pr-3">
                    <EtatJax etat={l.etat} court />
                    {l.derniereErreur && <span className="block text-[11px] text-red-700 mt-1 max-w-[220px]">{l.derniereErreur}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    {l.statutExterne ?? '—'}
                    <span className="block text-[11px] text-slate-400">{quand(l.statutExterneLe)}</span>
                    {l.problemes && <span className="block text-[11px] text-amber-800">⚠ {l.problemes}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono text-xs">{dt(l.montant)}</td>
                  <td className="py-2.5 text-right">
                    {l.statutRunex === 'SOUS_TRAITE' && ['PRIS_EN_CHARGE', 'EN_LIVRAISON', 'RETOUR_EN_COURS'].includes(l.etat) ? (
                      <button
                        type="button"
                        disabled={occupe === l.packageId}
                        onClick={() => void retourRecu(l.packageId)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-rose-300 text-rose-800 text-[11px] font-semibold hover:bg-rose-50 cursor-pointer"
                      >
                        <PackageCheck className="w-3.5 h-3.5" aria-hidden="true" /> Retour reçu
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function AConfier({ depots, notifier, onChange, configure }: { depots: { id: string; name: string }[]; notifier: Notifier; onChange: () => void; configure: boolean }) {
  const [depot, setDepot] = React.useState('');
  const [gouv, setGouv] = React.useState('');
  const [q, setQ] = React.useState('');
  const [liste, setListe] = React.useState<ColisEligibleJax[] | null>(null);
  const [choix, setChoix] = React.useState<Set<string>>(new Set());
  const [envoi, setEnvoi] = React.useState(false);
  const [refus, setRefus] = React.useState<{ trackingNumber: string; message: string }[]>([]);

  const charger = React.useCallback(async () => {
    try {
      setListe(await sousTraitanceApi.eligibles({ depositId: depot || undefined, governorate: gouv || undefined, q: q.trim() || undefined }));
    } catch (e) {
      notifier(false, 'Liste indisponible', erreur(e));
    }
  }, [depot, gouv, q, notifier]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void charger(), 250);
    return () => window.clearTimeout(t);
  }, [charger]);

  const basculer = (id: string) =>
    setChoix((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const envoyer = async () => {
    setEnvoi(true);
    setRefus([]);
    try {
      const r = await sousTraitanceApi.envoyer([...choix]);
      const ko = (r.data ?? []).filter((x) => !x.ok);
      setRefus(ko.map((x) => ({ trackingNumber: x.trackingNumber, message: x.message })));
      notifier(ko.length === 0, r.message ?? 'Envoi terminé');
      setChoix(new Set());
      await charger();
      onChange();
    } catch (e) {
      notifier(false, 'Envoi à JAX impossible', erreur(e));
    } finally {
      setEnvoi(false);
    }
  };
  const tous = liste ?? [];

  return (
    <Card>
      <p className="text-xs text-slate-500 mb-3">
        Colis reçus dans une agence Runex, hors tournée et hors inter-dépôt. Une fois confiés, ils sont créés chez JAX (expéditeur RUNEX,
        référence = numéro Runex) et ne peuvent plus partir en tournée Runex. Les colis des zones JAX partent automatiquement à la réception.
      </p>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de colis" aria-label="N° de colis" className={`${champ} w-44`} />
        <select value={depot} onChange={(e) => setDepot(e.target.value)} aria-label="Agence" className={champ}>
          <option value="">Toutes les agences</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={gouv} onChange={(e) => setGouv(e.target.value)} aria-label="Gouvernorat de destination" className={champ}>
          <option value="">Toutes les destinations</option>
          {GOUVERNORATS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!choix.size || envoi || !configure}
          onClick={() => void envoyer()}
          data-testid="envoyer-jax"
          className={`${bouton} ms-auto bg-violet-700 text-white hover:bg-violet-800`}
          title={configure ? undefined : 'JAX n’est pas connecté (JAX_API_TOKEN)'}
        >
          <Send className="w-4 h-4" aria-hidden="true" /> {envoi ? 'Envoi…' : `Confier ${choix.size || ''} colis à JAX`}
        </button>
      </div>
      {refus.length > 0 && (
        <ul className="mb-3 space-y-1 text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="refus-envoi">
          {refus.map((r) => (
            <li key={r.trackingNumber}>
              <strong className="font-mono">{r.trackingNumber}</strong> : {r.message}
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]" data-testid="table-a-confier">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  checked={tous.length > 0 && choix.size === tous.length}
                  onChange={(e) => setChoix(e.target.checked ? new Set(tous.map((c) => c.id)) : new Set())}
                />
              </th>
              <th className="py-2 pr-3">Colis</th>
              <th className="py-2 pr-3">Expéditeur</th>
              <th className="py-2 pr-3">Destination</th>
              <th className="py-2 pr-3">Agence (enlèvement)</th>
              <th className="py-2 text-right">Montant</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!liste ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">Chargement…</td>
              </tr>
            ) : tous.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">Aucun colis à confier pour ces filtres.</td>
              </tr>
            ) : (
              tous.map((c) => (
                <tr key={c.id} className={choix.has(c.id) ? 'bg-violet-50/60' : ''}>
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label={`Choisir ${c.trackingNumber}`} checked={choix.has(c.id)} onChange={() => basculer(c.id)} data-testid={`choix-${c.trackingNumber}`} />
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs font-bold text-red-700">{c.trackingNumber}</span>
                    {c.echecPrecedent && <span className="block text-[11px] text-red-700">échec précédent : {c.echecPrecedent}</span>}
                  </td>
                  <td className="py-2 pr-3 text-xs">{c.expediteur}</td>
                  <td className="py-2 pr-3 text-xs">
                    {c.destination}
                    {c.zoneJax && <span className="ms-1.5 px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold">zone JAX</span>}
                  </td>
                  <td className="py-2 pr-3 text-xs">{c.agence}</td>
                  <td className="py-2 text-right font-mono text-xs">{dt(c.montant)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function Enlevements({ notifier, onChange }: { notifier: Notifier; onChange: () => void }) {
  const [liste, setListe] = React.useState<EnlevementJax[] | null>(null);
  const [occupe, setOccupe] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const charger = React.useCallback(async () => {
    try {
      setListe(await sousTraitanceApi.enlevements());
    } catch (e) {
      notifier(false, 'Liste indisponible', erreur(e));
    }
  }, [notifier]);
  React.useEffect(() => void charger(), [charger]);

  const demander = async (depositId: string) => {
    setOccupe(depositId);
    try {
      const r = await sousTraitanceApi.demanderEnlevement(depositId, notes[depositId]);
      notifier(true, r.message ?? 'Enlèvement demandé');
      await charger();
      onChange();
    } catch (e) {
      notifier(false, 'Demande d’enlèvement refusée', erreur(e));
    } finally {
      setOccupe(null);
    }
  };

  if (!liste) return <Card><p className="text-sm text-slate-400">Chargement…</p></Card>;
  if (!liste.length) return <Card><p className="text-sm text-slate-500 py-4 text-center">Aucun colis JAX en attente d’enlèvement.</p></Card>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {liste.map((g) => (
        <Card key={g.depositId ?? g.agence}>
          <div className="space-y-3" data-testid={`enlevement-${g.agence}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-violet-700" aria-hidden="true" /> {g.agence}
                </h3>
                <p className="text-xs text-slate-500">
                  {g.aDemander} colis à faire enlever · {g.demandes} déjà demandé{g.demandes > 1 ? 's' : ''} · {g.pieces} pièce{g.pieces > 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <ul className="max-h-40 overflow-y-auto text-xs divide-y divide-slate-100 border border-slate-200 rounded-md">
              {g.colis.map((c) => (
                <li key={c.codeExterne} className="flex items-center justify-between px-2.5 py-1.5">
                  <span className="font-mono">{c.trackingNumber}</span>
                  <span className="font-mono text-slate-500">{c.codeExterne}</span>
                  <EtatJax etat={c.etat} court />
                </li>
              ))}
            </ul>
            <input
              value={notes[g.depositId ?? ''] ?? ''}
              onChange={(e) => setNotes((n) => ({ ...n, [g.depositId ?? '']: e.target.value }))}
              placeholder="Note pour JAX (facultatif) : horaires, contact…"
              className={`${champ} w-full`}
              aria-label={`Note pour l’enlèvement à ${g.agence}`}
            />
            <button
              type="button"
              disabled={!g.aDemander || !g.depositId || occupe === g.depositId}
              onClick={() => g.depositId && void demander(g.depositId)}
              data-testid={`demander-enlevement-${g.agence}`}
              className={`${bouton} w-full justify-center bg-violet-700 text-white hover:bg-violet-800`}
            >
              <Truck className="w-4 h-4" aria-hidden="true" /> {g.aDemander ? `Demander l’enlèvement de ${g.aDemander} colis à JAX` : 'Enlèvement déjà demandé'}
            </button>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Encaissements({ notifier, onChange }: { notifier: Notifier; onChange: () => void }) {
  const [liste, setListe] = React.useState<ListeSousTraitance | null>(null);
  const [choix, setChoix] = React.useState<Set<string>>(new Set());
  const [occupe, setOccupe] = React.useState(false);
  const charger = React.useCallback(async () => {
    try {
      setListe(await sousTraitanceApi.lister({ cod: 'a_recevoir' }));
    } catch (e) {
      notifier(false, 'Liste indisponible', erreur(e));
    }
  }, [notifier]);
  React.useEffect(() => void charger(), [charger]);
  const lignes = liste?.lignes ?? [];
  const totalChoisi = lignes.filter((l) => choix.has(l.packageId)).reduce((s, l) => s + l.codMontant, 0);

  const recu = async () => {
    setOccupe(true);
    try {
      const r = await sousTraitanceApi.codRecu([...choix]);
      notifier(true, r.message ?? 'Reversement enregistré');
      setChoix(new Set());
      await charger();
      onChange();
    } catch (e) {
      notifier(false, 'Enregistrement impossible', erreur(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Card>
      <p className="text-xs text-slate-500 mb-3">
        JAX encaisse le montant des colis qu’il livre et le reverse à Runex. Cochez les colis dont vous avez reçu le montant : leurs
        expéditeurs pourront alors être réglés (bordereaux). Tant qu’un montant n’est pas reçu, le colis reste hors bordereau.
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <p className="text-sm text-slate-700">
          À recevoir : <strong className="font-mono">{dt(liste?.codARecevoir.total ?? 0)}</strong> ({liste?.codARecevoir.colis ?? 0} colis)
        </p>
        <button
          type="button"
          disabled={!choix.size || occupe}
          onClick={() => void recu()}
          data-testid="marquer-cod-recu"
          className={`${bouton} ms-auto bg-emerald-600 text-white hover:bg-emerald-700`}
        >
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Reçu de JAX : {dt(totalChoisi)} ({choix.size})
        </button>
      </div>
      <table className="w-full text-sm" data-testid="table-encaissements">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
            <th className="py-2 pr-2 w-8">
              <input
                type="checkbox"
                aria-label="Tout sélectionner"
                checked={lignes.length > 0 && choix.size === lignes.length}
                onChange={(e) => setChoix(e.target.checked ? new Set(lignes.map((l) => l.packageId)) : new Set())}
              />
            </th>
            <th className="py-2 pr-3">Colis</th>
            <th className="py-2 pr-3">Code JAX</th>
            <th className="py-2 pr-3">Expéditeur</th>
            <th className="py-2 pr-3">Livré</th>
            <th className="py-2 text-right">Montant encaissé par JAX</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lignes.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-500">Rien à recevoir de JAX.</td>
            </tr>
          ) : (
            lignes.map((l) => (
              <tr key={l.packageId}>
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    aria-label={`Choisir ${l.trackingNumber}`}
                    checked={choix.has(l.packageId)}
                    onChange={() =>
                      setChoix((p) => {
                        const n = new Set(p);
                        if (n.has(l.packageId)) n.delete(l.packageId);
                        else n.add(l.packageId);
                        return n;
                      })
                    }
                  />
                </td>
                <td className="py-2 pr-3 font-mono text-xs font-bold text-red-700">{l.trackingNumber}</td>
                <td className="py-2 pr-3 font-mono text-xs">{l.codeExterne}</td>
                <td className="py-2 pr-3 text-xs">{l.expediteur}</td>
                <td className="py-2 pr-3 text-xs">{quand(l.statutExterneLe)}</td>
                <td className="py-2 text-right font-mono text-xs">{dt(l.codMontant)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function Parametres({ params, recharger, notifier }: { params: ParametresJax | null; recharger: () => Promise<void>; notifier: Notifier }) {
  const [zones, setZones] = React.useState<Set<string>>(new Set());
  const [occupe, setOccupe] = React.useState<string | null>(null);
  React.useEffect(() => setZones(new Set(params?.zones ?? [])), [params]);
  if (!params) return <Card><p className="text-sm text-slate-400">Chargement…</p></Card>;

  const action = async (cle: string, f: () => Promise<{ message?: string }>, titreErreur: string) => {
    setOccupe(cle);
    try {
      notifier(true, (await f()).message ?? 'Enregistré');
      await recharger();
    } catch (e) {
      notifier(false, titreErreur, erreur(e));
    } finally {
      setOccupe(null);
    }
  };
  const jaxConnait = (g: string) => {
    const k = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(la|le|el) /, '').replace(/[^a-z]/g, '');
    return params.gouvernorats.some((x) => k(x.nom) === k(g) || k(x.nom).includes(k(g)) || k(g).includes(k(x.nom)));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Connexion à JAX">
        <dl className="text-sm space-y-1.5" data-testid="connexion-jax">
          <div className="flex gap-2">
            <dt className="text-slate-500 w-40">État</dt>
            <dd className={params.configure ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
              {params.configure ? 'Connecté (jeton présent)' : 'Non connecté — JAX_API_TOKEN absent'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-40">Adresse de l’API</dt>
            <dd className="font-mono text-xs break-all">{params.url}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-40">Expéditeur vu par JAX</dt>
            <dd>
              {params.expediteur.nom}
              {params.expediteur.tel ? ` · ${params.expediteur.tel}` : ' · téléphone de l’agence'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-40">Relecture des statuts</dt>
            <dd>{params.syncMinutes > 0 ? `toutes les ${params.syncMinutes} min` : 'manuelle seulement'}</dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={!params.configure || !!occupe}
          onClick={() => void action('ref', async () => ({ message: (await sousTraitanceApi.referentiels()).message }), 'Relecture impossible')}
          data-testid="relire-referentiels"
          className={`${bouton} mt-4 bg-slate-900 text-white hover:bg-slate-800`}
        >
          <RefreshCw className={`w-4 h-4 ${occupe === 'ref' ? 'animate-spin' : ''}`} aria-hidden="true" /> Relire gouvernorats et statuts JAX
        </button>
        <p className="mt-2 text-xs text-slate-500">
          {params.gouvernorats.length} gouvernorats et {params.statuts.length} statuts JAX connus. À relire une première fois, puis si JAX en ajoute.
        </p>
      </Card>

      <Card title="Zones confiées automatiquement à JAX">
        <p className="text-xs text-slate-500 mb-3">
          Un colis dont la destination est cochée part chez JAX dès sa réception dans une agence Runex. Les autres restent livrés par Runex,
          sauf envoi manuel (onglet « À confier »).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-sm" data-testid="zones-jax">
          {GOUVERNORATS.map((g) => (
            <label key={g} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={zones.has(g)}
                onChange={(e) =>
                  setZones((z) => {
                    const n = new Set(z);
                    if (e.target.checked) n.add(g);
                    else n.delete(g);
                    return n;
                  })
                }
              />
              {g}
              {params.gouvernorats.length > 0 && !jaxConnait(g) && <span className="text-[10px] text-red-700" title="Absent du référentiel JAX">⚠</span>}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={!!occupe}
          onClick={() => void action('zones', async () => ({ message: (await sousTraitanceApi.zones([...zones])).message }), 'Enregistrement impossible')}
          data-testid="enregistrer-zones"
          className={`${bouton} mt-4 bg-violet-700 text-white hover:bg-violet-800`}
        >
          Enregistrer les zones ({zones.size})
        </button>
      </Card>

      <Card title="Statuts JAX → étapes Runex" className="lg:col-span-2">
        <p className="text-xs text-slate-500 mb-3">
          Chaque statut lu chez JAX fait avancer le colis dans Runex. La correspondance est proposée d’après le libellé ; corrigez-la si un
          statut JAX signifie autre chose. « Livré par JAX » passe le colis à Livré ; « retour » le met en retour en cours.
        </p>
        {params.statuts.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun statut : relisez les référentiels JAX.</p>
        ) : (
          <table className="w-full text-sm" data-testid="table-statuts-jax">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Statut JAX</th>
                <th className="py-2">Étape Runex</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {params.statuts.map((s) => (
                <tr key={s.code}>
                  <td className="py-2 pr-3 font-mono text-xs">{s.code}</td>
                  <td className="py-2 pr-3">{s.libelle}</td>
                  <td className="py-2">
                    <select
                      value={s.manuel ? (s.etat ?? '') : ''}
                      onChange={(e) =>
                        void action(`st-${s.code}`, async () => ({ message: (await sousTraitanceApi.statut(s.code, e.target.value || null)).message }), 'Enregistrement impossible')
                      }
                      aria-label={`Étape Runex pour ${s.libelle}`}
                      className={champ}
                    >
                      <option value="">
                        Automatique : {params.etats.find((x) => x.etat === s.etatPropose)?.libelle ?? 'aucun changement'}
                      </option>
                      {params.etats.map((x) => (
                        <option key={x.etat} value={x.etat}>
                          {x.libelle}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
