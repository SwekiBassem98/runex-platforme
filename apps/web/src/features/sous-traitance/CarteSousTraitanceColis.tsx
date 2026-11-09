'use client';

/**
 * Fiche colis (exploitation) : livraison confiée au partenaire JAX.
 *
 * Montre le code JAX, l'étape, le dernier statut lu chez JAX et les problèmes
 * signalés, et porte les gestes possibles : confier à JAX, relire le statut,
 * reprendre avant enlèvement, pointer le retour reçu.
 */

import React from 'react';
import Link from 'next/link';
import { Handshake, RefreshCw, Undo2, PackageCheck, Send, AlertTriangle } from 'lucide-react';
import { useToast } from '@logixpress/ui';
import { sousTraitanceApi, type SousTraitanceColisDto } from '@/lib/api';
import { EtatJax } from './EtatJax';

const date = (v: string | null) => (v ? new Date(v).toLocaleString('fr-TN', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function CarteSousTraitanceColis({
  packageId,
  statut,
  sousTraitance,
  onChange,
}: {
  packageId: string;
  statut: string;
  sousTraitance: SousTraitanceColisDto | null | undefined;
  onChange: () => void;
}) {
  const { addToast } = useToast();
  const [occupe, setOccupe] = React.useState<string | null>(null);
  const st = sousTraitance ?? null;
  const actif = st && !['ANNULE', 'ECHEC_ENVOI', 'RETOURNE'].includes(st.etat);
  const enAgence = statut === 'RECU_DEPOT' || statut === 'RECU_DEPOT_DESTINATION';
  // Créé chez JAX dès sa création, le colis passe « Confié à JAX » à sa réception en agence.
  const creeChezJax = !!st && st.etat === 'EN_ATTENTE_ENLEVEMENT' && !!st.codeExterne && (statut === 'CREE' || enAgence);
  const confiable = ((statut === 'CREE' || enAgence) && !actif) || (enAgence && creeChezJax);
  if (!st && !confiable) return null;

  const agir = async (cle: string, action: () => Promise<{ message?: string }>, titreErreur: string) => {
    setOccupe(cle);
    try {
      const r = await action();
      addToast({ type: 'success', title: r.message ?? 'Fait.' });
      onChange();
    } catch (e) {
      addToast({ type: 'error', title: titreErreur, message: e instanceof Error ? e.message : undefined });
    } finally {
      setOccupe(null);
    }
  };

  const confier = () =>
    agir(
      'envoyer',
      async () => {
        const r = await sousTraitanceApi.envoyer([packageId]);
        const res = r.data?.[0];
        if (res && !res.ok) throw new Error(res.message);
        return { message: res?.message ?? r.message };
      },
      'Envoi à JAX refusé'
    );

  const bouton = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition cursor-pointer disabled:opacity-50';

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 space-y-3" data-testid="carte-jax" aria-labelledby="titre-carte-jax">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="titre-carte-jax" className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Handshake className="w-4 h-4 text-violet-700" aria-hidden="true" />
          Livraison sous-traitée — JAX
        </h3>
        {st && <EtatJax etat={st.etat} />}
      </div>

      {st && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-slate-500">Code JAX</dt>
            <dd className="font-mono font-bold text-slate-900" data-testid="code-jax">{st.codeExterne ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Statut chez JAX</dt>
            <dd className="font-semibold text-slate-900">{st.statutExterne ?? '—'}</dd>
            <dd className="text-[11px] text-slate-400">{date(st.statutExterneLe)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Enlèvement</dt>
            <dd className="text-slate-800">{st.agence ?? '—'}</dd>
            <dd className="text-[11px] text-slate-400">{st.enlevementDemandeLe ? `demandé le ${date(st.enlevementDemandeLe)}` : 'pas encore demandé'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Envoi</dt>
            <dd className="text-slate-800">{st.mode === 'AUTO' ? 'Automatique (zone JAX)' : 'Manuel'}</dd>
            <dd className="text-[11px] text-slate-400">{date(st.envoyeLe)} · relu {date(st.derniereSyncLe)}</dd>
          </div>
          {st.etat === 'LIVRE' && (
            <div className="col-span-2">
              <dt className="text-slate-500">Montant encaissé par JAX</dt>
              <dd className="font-mono font-semibold text-slate-900">
                {st.codMontant.toFixed(3)} DT ·{' '}
                {st.codRecuLe ? <span className="text-emerald-700">reversé le {date(st.codRecuLe)}</span> : <span className="text-amber-700">à recevoir de JAX</span>}
              </dd>
            </div>
          )}
        </dl>
      )}

      {creeChezJax && statut === 'CREE' && (
        <p className="text-xs text-violet-900 bg-violet-50 border border-violet-200 rounded-md px-3 py-2" data-testid="jax-avant-reception">
          Déjà créé chez JAX (code {st?.codeExterne}). Il passera « Confié au partenaire JAX » à sa réception dans une agence Runex ; l’enlèvement se demande ensuite.
        </p>
      )}
      {st?.problemes && (
        <p className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> Problème signalé par JAX : {st.problemes}
        </p>
      )}
      {st?.derniereErreur && (
        <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="erreur-jax">
          {st.etat === 'ECHEC_ENVOI' ? 'Envoi refusé : ' : 'Dernière relecture : '}
          {st.derniereErreur}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {confiable && (
          <button type="button" disabled={!!occupe} onClick={() => void confier()} data-testid="confier-jax" className={`${bouton} bg-violet-700 border-violet-700 text-white hover:bg-violet-800`}>
            <Send className="w-3.5 h-3.5" aria-hidden="true" /> {st?.etat === 'ECHEC_ENVOI' ? 'Réessayer l’envoi à JAX' : 'Confier à JAX'}
          </button>
        )}
        {actif && (
          <button
            type="button"
            disabled={!!occupe}
            onClick={() => void agir('sync', async () => ({ message: (await sousTraitanceApi.sync([packageId])).message }), 'Relecture JAX impossible')}
            data-testid="relire-jax"
            className={`${bouton} bg-white border-slate-300 text-slate-700 hover:bg-slate-50`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${occupe === 'sync' ? 'animate-spin' : ''}`} aria-hidden="true" /> Relire le statut JAX
          </button>
        )}
        {st && (st.etat === 'EN_ATTENTE_ENLEVEMENT' || st.etat === 'ENLEVEMENT_DEMANDE') && (statut === 'SOUS_TRAITE' || statut === 'CREE') && (
          <button
            type="button"
            disabled={!!occupe}
            onClick={() => void agir('reprendre', async () => ({ message: (await sousTraitanceApi.reprendre(packageId)).message }), 'Reprise impossible')}
            className={`${bouton} bg-white border-slate-300 text-slate-700 hover:bg-slate-50`}
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Reprendre (avant enlèvement)
          </button>
        )}
        {st && statut === 'SOUS_TRAITE' && st.etat !== 'LIVRE' && !['EN_ATTENTE_ENLEVEMENT', 'ENLEVEMENT_DEMANDE'].includes(st.etat) && (
          <button
            type="button"
            disabled={!!occupe}
            onClick={() => void agir('retour', async () => ({ message: (await sousTraitanceApi.retourRecu(packageId)).message }), 'Retour refusé')}
            data-testid="retour-jax-recu"
            className={`${bouton} bg-white border-rose-300 text-rose-800 hover:bg-rose-50`}
          >
            <PackageCheck className="w-3.5 h-3.5" aria-hidden="true" /> Retour JAX reçu à l’agence
          </button>
        )}
        <Link href="/sous-traitance" className="ms-auto self-center text-xs font-semibold text-violet-800 hover:underline">
          Sous-traitance JAX →
        </Link>
      </div>
    </section>
  );
}
