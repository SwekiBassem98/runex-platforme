/** Projection d'une fiche de sous-traitance (sans dépendance lourde : importée par les mappers). */
import type { Prisma } from '@prisma/client';
import { ETATS_SOUS_TRAITANCE, type EtatSousTraitance, type SousTraitanceColisDto } from '@logixpress/types';

const n3 = (v: unknown) => Math.round(Number(v ?? 0) * 1000) / 1000;

export type LigneST = Prisma.SousTraitanceGetPayload<{ include: { deposit: { select: { name: true } } } }>;

export function versDto(r: LigneST | null | undefined): SousTraitanceColisDto | null {
  if (!r) return null;
  return {
    partenaire: r.partenaire,
    codeExterne: r.codeExterne,
    etat: r.etat as EtatSousTraitance,
    etatLibelle: ETATS_SOUS_TRAITANCE[r.etat as EtatSousTraitance] ?? r.etat,
    mode: r.mode,
    agence: r.deposit?.name ?? null,
    statutExterne: r.statutExterne,
    statutExterneLe: r.statutExterneLe?.toISOString() ?? null,
    problemes: r.problemes,
    envoyeLe: r.envoyeLe?.toISOString() ?? null,
    enlevementDemandeLe: r.enlevementDemandeLe?.toISOString() ?? null,
    derniereSyncLe: r.derniereSyncLe?.toISOString() ?? null,
    derniereErreur: r.derniereErreur,
    codMontant: n3(r.codMontant),
    codRecuLe: r.codRecuLe?.toISOString() ?? null,
  };
}

