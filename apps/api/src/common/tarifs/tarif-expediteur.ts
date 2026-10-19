/**
 * Tarif d'un expéditeur — fixé par l'administration sur son dossier.
 *
 *   - frais de livraison par type de colis (légère, normale, lourde,
 *     volumineuse) : appliqués à la création de chaque colis, selon son type,
 *     et ajoutés au prix de la marchandise ;
 *   - frais de retour : par colis retourné à l'expéditeur ;
 *   - frais de gestion : montant fixe déduit à chaque paiement (bordereau) ;
 *   - R.A.S. : taux (3 % quand elle s'applique) prélevé sur le net à payer.
 *
 * Au paiement :
 *
 *   net avant R.A.S. = encaissé − frais de livraison − frais de retour − frais de gestion
 *   R.A.S.           = net avant R.A.S. × taux   (jamais sur un net négatif)
 *   net à payer      = net avant R.A.S. − R.A.S.
 */

import type { Prisma } from '@prisma/client';
import { badRequest } from '../errors/api-error';

export const TAILLES = ['LEGERE', 'MOYENNE', 'LOURDE', 'VOLUMINEUSE'] as const;
export type TailleColis = (typeof TAILLES)[number];

/** Frais de livraison quand l'expéditeur n'a pas de tarif propre. */
export const FRAIS_DEFAUT = 8;
/** Taux de R.A.S. proposé quand elle s'applique (3 %). */
export const TAUX_RAS_PAR_DEFAUT = 0.03;

export interface TarifExpediteur {
  livraison: Record<TailleColis, number>;
  retour: number;
  gestion: number;
  /** Taux de R.A.S. (0,03 = 3 %) ; 0 quand elle ne s'applique pas. */
  tauxRas: number;
}

type ConfigTarif = {
  feeLegere?: Prisma.Decimal | number | string | null;
  feeMoyenne?: Prisma.Decimal | number | string | null;
  feeLourde?: Prisma.Decimal | number | string | null;
  feeVolumineuse?: Prisma.Decimal | number | string | null;
  defaultDeliveryFee?: Prisma.Decimal | number | string | null;
  defaultReturnFee?: Prisma.Decimal | number | string | null;
  managementFee?: Prisma.Decimal | number | string | null;
  withholdingTaxRate?: Prisma.Decimal | number | string | null;
};

/** Sélection Prisma des colonnes du tarif. */
export const SELECT_TARIF = {
  feeLegere: true,
  feeMoyenne: true,
  feeLourde: true,
  feeVolumineuse: true,
  defaultDeliveryFee: true,
  defaultReturnFee: true,
  managementFee: true,
  withholdingTaxRate: true,
} as const;

const nombre = (v: unknown, defaut: number) => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? defaut : n;
};

export const arrondi3 = (n: number) => Math.round(n * 1000) / 1000;

export function tarifDepuisConfig(config: ConfigTarif | null | undefined): TarifExpediteur {
  const base = nombre(config?.defaultDeliveryFee, FRAIS_DEFAUT);
  return {
    livraison: {
      LEGERE: nombre(config?.feeLegere, base),
      MOYENNE: nombre(config?.feeMoyenne, base),
      LOURDE: nombre(config?.feeLourde, base),
      VOLUMINEUSE: nombre(config?.feeVolumineuse, base),
    },
    retour: nombre(config?.defaultReturnFee, 0),
    gestion: nombre(config?.managementFee, 0),
    tauxRas: nombre(config?.withholdingTaxRate, 0),
  };
}

export function fraisPourTaille(tarif: TarifExpediteur, taille: string | null | undefined): number {
  return (TAILLES as readonly string[]).includes(String(taille)) ? tarif.livraison[taille as TailleColis] : tarif.livraison.MOYENNE;
}

/** Calcul du net à payer d'un paiement (voir l'en-tête). */
export function calculerNet(montants: {
  encaisse: number;
  fraisLivraison: number;
  fraisRetour: number;
  fraisGestion: number;
  tauxRas: number;
}): { avantRas: number; ras: number; net: number } {
  const avantRas = arrondi3(montants.encaisse - montants.fraisLivraison - montants.fraisRetour - montants.fraisGestion);
  const ras = arrondi3(Math.max(0, avantRas) * Math.max(0, montants.tauxRas));
  return { avantRas, ras, net: arrondi3(avantRas - ras) };
}

/**
 * Lit le tarif saisi dans le formulaire du dossier expéditeur :
 *
 *   { livraison: { LEGERE, MOYENNE, LOURDE, VOLUMINEUSE }, retour, gestion,
 *     rasActive, tauxRas }
 *
 * Renvoie les colonnes à écrire dans `ShipperConfig` (seulement celles
 * fournies). Un montant doit être positif ou nul, en dinars, millimes compris.
 */
export function lireTarifSaisi(saisie: unknown): Prisma.ShipperConfigUpdateInput {
  if (saisie === undefined || saisie === null) return {};
  if (typeof saisie !== 'object') throw badRequest('Tarif invalide.');
  const t = saisie as Record<string, unknown>;
  const montant = (v: unknown, libelle: string): number => {
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    if (v === '' || !Number.isFinite(n) || n < 0 || n > 10000) {
      throw badRequest(`${libelle} : saisissez un montant positif (en DT).`);
    }
    return arrondi3(n);
  };
  const data: Record<string, unknown> = {};
  const livraison = (t.livraison ?? {}) as Record<string, unknown>;
  const colonnes: Record<TailleColis, [string, string]> = {
    LEGERE: ['feeLegere', 'Frais colis léger'],
    MOYENNE: ['feeMoyenne', 'Frais colis normal'],
    LOURDE: ['feeLourde', 'Frais colis lourd'],
    VOLUMINEUSE: ['feeVolumineuse', 'Frais colis volumineux'],
  };
  for (const taille of TAILLES) {
    if (livraison[taille] !== undefined) {
      const [colonne, libelle] = colonnes[taille];
      data[colonne] = montant(livraison[taille], libelle);
    }
  }
  // Le tarif « normal » reste aussi le tarif de référence (anciens écrans).
  if (data.feeMoyenne !== undefined) data.defaultDeliveryFee = data.feeMoyenne;
  if (t.retour !== undefined) data.defaultReturnFee = montant(t.retour, 'Frais de retour');
  if (t.gestion !== undefined) data.managementFee = montant(t.gestion, 'Frais de gestion');
  if (t.rasActive !== undefined || t.tauxRas !== undefined) {
    if (t.rasActive === false) {
      data.withholdingTaxRate = 0;
    } else {
      const pct = t.tauxRas === undefined || t.tauxRas === '' ? TAUX_RAS_PAR_DEFAUT * 100 : Number(t.tauxRas);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw badRequest('Taux de R.A.S. invalide (en %).');
      data.withholdingTaxRate = Math.round(pct * 100) / 10000;
    }
  }
  return data as Prisma.ShipperConfigUpdateInput;
}

/** Forme renvoyée aux écrans. */
export interface TarifDto {
  livraison: Record<TailleColis, number>;
  retour: number;
  gestion: number;
  rasActive: boolean;
  /** En pourcentage (3 = 3 %). */
  tauxRas: number;
}

export function tarifDto(config: ConfigTarif | null | undefined): TarifDto {
  const t = tarifDepuisConfig(config);
  return {
    livraison: t.livraison,
    retour: t.retour,
    gestion: t.gestion,
    rasActive: t.tauxRas > 0,
    tauxRas: Math.round(t.tauxRas * 10000) / 100,
  };
}
