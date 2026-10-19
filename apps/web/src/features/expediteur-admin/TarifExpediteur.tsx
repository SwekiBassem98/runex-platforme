'use client';

/**
 * Tarif d'un expéditeur — saisie (formulaire du dossier) et aperçu.
 *
 *   - frais de livraison par type de colis : appliqués automatiquement à
 *     chaque colis que l'expéditeur crée, selon le type choisi ;
 *   - frais de retour (par colis retourné), frais de gestion (par paiement)
 *     et R.A.S. (3 % du net à payer) : déduits quand on paie l'expéditeur.
 *
 * L'exemple de paiement, sous la saisie, se recalcule à chaque frappe : il
 * montre à l'administrateur ce que son tarif donne sur un cas concret.
 */

import React from 'react';
import { Package, Percent, Receipt, Undo2 } from 'lucide-react';
import type { TailleColis, TarifExpediteur } from '@/lib/api';

export interface TarifSaisie {
  LEGERE: string;
  MOYENNE: string;
  LOURDE: string;
  VOLUMINEUSE: string;
  retour: string;
  gestion: string;
  rasActive: boolean;
  tauxRas: string;
}

export const TYPES_COLIS: { taille: TailleColis; libelle: string; aide: string }[] = [
  { taille: 'LEGERE', libelle: 'Légère', aide: 'moins de 2 kg' },
  { taille: 'MOYENNE', libelle: 'Normale', aide: '2 à 5 kg' },
  { taille: 'LOURDE', libelle: 'Lourde', aide: '5 à 15 kg' },
  { taille: 'VOLUMINEUSE', libelle: 'Volumineuse', aide: 'plus de 15 kg ou encombrant' },
];

export const TARIF_SAISIE_VIDE: TarifSaisie = {
  LEGERE: '8',
  MOYENNE: '8',
  LOURDE: '8',
  VOLUMINEUSE: '8',
  retour: '0',
  gestion: '0',
  rasActive: false,
  tauxRas: '3',
};

const texte = (n: number) => String(Math.round(n * 1000) / 1000);

export function saisieDepuisTarif(t: TarifExpediteur | undefined): TarifSaisie {
  if (!t) return TARIF_SAISIE_VIDE;
  return {
    LEGERE: texte(t.livraison.LEGERE),
    MOYENNE: texte(t.livraison.MOYENNE),
    LOURDE: texte(t.livraison.LOURDE),
    VOLUMINEUSE: texte(t.livraison.VOLUMINEUSE),
    retour: texte(t.retour),
    gestion: texte(t.gestion),
    rasActive: t.rasActive,
    tauxRas: t.rasActive ? texte(t.tauxRas) : '3',
  };
}

const nombre = (v: string) => Number(String(v).replace(',', '.'));

/** Erreurs par champ (clés `tarif.<champ>`), vides quand tout est valable. */
export function verifierTarif(t: TarifSaisie): Record<string, string> {
  const erreurs: Record<string, string> = {};
  const champs: (keyof TarifSaisie)[] = ['LEGERE', 'MOYENNE', 'LOURDE', 'VOLUMINEUSE', 'retour', 'gestion'];
  for (const c of champs) {
    const v = String(t[c]).trim();
    const n = nombre(v);
    if (v === '' || !Number.isFinite(n) || n < 0) erreurs[`tarif.${c}`] = 'Montant positif en DT.';
  }
  if (t.rasActive) {
    const p = nombre(t.tauxRas);
    if (!Number.isFinite(p) || p <= 0 || p > 100) erreurs['tarif.tauxRas'] = 'Taux entre 0 et 100 %.';
  }
  return erreurs;
}

/** Corps envoyé à l'API. */
export function corpsTarif(t: TarifSaisie) {
  return {
    livraison: { LEGERE: nombre(t.LEGERE), MOYENNE: nombre(t.MOYENNE), LOURDE: nombre(t.LOURDE), VOLUMINEUSE: nombre(t.VOLUMINEUSE) },
    retour: nombre(t.retour),
    gestion: nombre(t.gestion),
    rasActive: t.rasActive,
    tauxRas: t.rasActive ? nombre(t.tauxRas) : 0,
  };
}

const dt = (n: number) => `${(Number.isFinite(n) ? n : 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

/** Calcul du net (identique à l'API). */
export function simulerPaiement(t: { encaisse: number; fraisLivraison: number; fraisRetour: number; gestion: number; tauxRas: number }) {
  const avantRas = Math.round((t.encaisse - t.fraisLivraison - t.fraisRetour - t.gestion) * 1000) / 1000;
  const ras = Math.round(Math.max(0, avantRas) * (t.tauxRas / 100) * 1000) / 1000;
  return { avantRas, ras, net: Math.round((avantRas - ras) * 1000) / 1000 };
}

function ChampMontant({
  id,
  libelle,
  aide,
  valeur,
  onChange,
  erreur,
  suffixe = 'DT',
  disabled,
}: {
  id: string;
  libelle: string;
  aide?: string;
  valeur: string;
  onChange: (v: string) => void;
  erreur?: string;
  suffixe?: string;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-semibold text-slate-700">{libelle}</span>
      {aide && <span className="block text-[10px] text-slate-400 leading-tight">{aide}</span>}
      <span className={`mt-1 flex items-center rounded-md border bg-white focus-within:ring-2 focus-within:ring-red-500/30 ${erreur ? 'border-red-400' : 'border-slate-300'} ${disabled ? 'opacity-50' : ''}`}>
        <input
          id={id}
          inputMode="decimal"
          value={valeur}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 px-2.5 py-1.5 text-sm font-mono bg-transparent focus:outline-none"
          data-testid={id}
        />
        <span className="px-2 text-[11px] font-semibold text-slate-400 shrink-0">{suffixe}</span>
      </span>
      {erreur && <span className="block text-[10px] text-red-600 mt-0.5">{erreur}</span>}
    </label>
  );
}

export function ChampsTarif({
  valeur,
  onChange,
  erreurs,
}: {
  valeur: TarifSaisie;
  onChange: (t: TarifSaisie) => void;
  erreurs: Record<string, string>;
}) {
  const maj = (patch: Partial<TarifSaisie>) => onChange({ ...valeur, ...patch });
  // Exemple : 10 colis normaux livrés (prix 50 DT chacun) et 1 retour.
  const frais = nombre(valeur.MOYENNE) || 0;
  const exemple = simulerPaiement({
    encaisse: 10 * (50 + frais),
    fraisLivraison: 10 * frais,
    fraisRetour: nombre(valeur.retour) || 0,
    gestion: nombre(valeur.gestion) || 0,
    tauxRas: valeur.rasActive ? nombre(valeur.tauxRas) || 0 : 0,
  });

  return (
    <section className="space-y-4 border-t border-slate-200 pt-4" aria-labelledby="titre-tarif" data-testid="section-tarif">
      <div>
        <h3 id="titre-tarif" className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Package className="w-4 h-4 text-red-600" aria-hidden="true" />
          Prix de livraison par type de colis
        </h3>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Appliqués automatiquement à chaque colis de cet expéditeur, selon le type choisi, et ajoutés au prix de la marchandise.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TYPES_COLIS.map((t) => (
          <ChampMontant
            key={t.taille}
            id={`tarif-${t.taille}`}
            libelle={t.libelle}
            aide={t.aide}
            valeur={valeur[t.taille]}
            onChange={(v) => maj({ [t.taille]: v } as Partial<TarifSaisie>)}
            erreur={erreurs[`tarif.${t.taille}`]}
          />
        ))}
      </div>

      <div>
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-red-600" aria-hidden="true" />
          Déductions au paiement de l’expéditeur
        </h3>
        <p className="text-[11px] text-slate-500 mt-0.5">Retirées du montant encaissé quand l’administration règle l’expéditeur.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ChampMontant
          id="tarif-retour"
          libelle="Frais de retour"
          aide="par colis retourné"
          valeur={valeur.retour}
          onChange={(v) => maj({ retour: v })}
          erreur={erreurs['tarif.retour']}
        />
        <ChampMontant
          id="tarif-gestion"
          libelle="Frais de gestion"
          aide="par paiement (bordereau)"
          valeur={valeur.gestion}
          onChange={(v) => maj({ gestion: v })}
          erreur={erreurs['tarif.gestion']}
        />
        <div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={valeur.rasActive}
              onChange={(e) => maj({ rasActive: e.target.checked })}
              className="mt-0.5"
              data-testid="tarif-ras-active"
            />
            <span>
              <span className="block text-xs font-semibold text-slate-700">Appliquer la R.A.S.</span>
              <span className="block text-[10px] text-slate-400 leading-tight">retenue à la source sur le net à payer</span>
            </span>
          </label>
          <div className="mt-1">
            <ChampMontant
              id="tarif-tauxRas"
              libelle=""
              valeur={valeur.tauxRas}
              onChange={(v) => maj({ tauxRas: v })}
              erreur={erreurs['tarif.tauxRas']}
              suffixe="%"
              disabled={!valeur.rasActive}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3" data-testid="tarif-exemple">
        <p className="text-[11px] font-semibold text-slate-600 mb-2">
          Exemple : 10 colis normaux livrés (marchandise à 50 DT) et 1 retour
        </p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[11px]">
          <dt className="text-slate-500">Encaissé chez les clients</dt>
          <dd className="font-mono text-right text-slate-900">{dt(10 * (50 + frais))}</dd>
          <dt className="text-slate-500">− Frais de livraison (10 × {dt(frais)})</dt>
          <dd className="font-mono text-right text-slate-700">− {dt(10 * frais)}</dd>
          <dt className="text-slate-500 inline-flex items-center gap-1">
            <Undo2 className="w-3 h-3" aria-hidden="true" />− Frais de retour (1 colis)
          </dt>
          <dd className="font-mono text-right text-slate-700">− {dt(nombre(valeur.retour) || 0)}</dd>
          <dt className="text-slate-500">− Frais de gestion</dt>
          <dd className="font-mono text-right text-slate-700">− {dt(nombre(valeur.gestion) || 0)}</dd>
          {valeur.rasActive && (
            <>
              <dt className="text-slate-500 inline-flex items-center gap-1">
                <Percent className="w-3 h-3" aria-hidden="true" />− R.A.S. {nombre(valeur.tauxRas) || 0} % de {dt(exemple.avantRas)}
              </dt>
              <dd className="font-mono text-right text-slate-700">− {dt(exemple.ras)}</dd>
            </>
          )}
          <dt className="font-bold text-slate-900 border-t border-slate-200 pt-1">Net à payer à l’expéditeur</dt>
          <dd className="font-mono font-bold text-right text-emerald-700 border-t border-slate-200 pt-1" data-testid="tarif-exemple-net">
            {dt(exemple.net)}
          </dd>
        </dl>
      </div>
    </section>
  );
}

/** Aperçu lecture seule (fiche expéditeur, finance). */
export function ApercuTarif({ tarif, compact = false }: { tarif: TarifExpediteur | undefined; compact?: boolean }) {
  if (!tarif) return <p className="text-xs text-slate-400">Tarif non défini.</p>;
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'} data-testid="apercu-tarif">
      <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TYPES_COLIS.map((t) => (
          <li key={t.taille} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t.libelle}</span>
            <span className="block text-sm font-bold text-slate-900 font-mono">{dt(tarif.livraison[t.taille])}</span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-2 text-[11px]">
        <li className="px-2 py-1 rounded-full bg-orange-50 text-orange-800 border border-orange-200">
          Retour : <b className="font-mono">{dt(tarif.retour)}</b> / colis
        </li>
        <li className="px-2 py-1 rounded-full bg-violet-50 text-violet-800 border border-violet-200">
          Gestion : <b className="font-mono">{dt(tarif.gestion)}</b> / paiement
        </li>
        <li className={`px-2 py-1 rounded-full border ${tarif.rasActive ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
          R.A.S. : <b>{tarif.rasActive ? `${tarif.tauxRas} % du net` : 'non appliquée'}</b>
        </li>
      </ul>
    </div>
  );
}
