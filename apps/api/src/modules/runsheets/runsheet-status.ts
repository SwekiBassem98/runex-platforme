/**
 * Correspondance entre les statuts de tournée.
 *
 * Deux vocabulaires coexistent et ne sont pas alignés :
 *
 *  - le schéma Prisma, qui décrit le cycle de vie réel ;
 *  - l'énumération partagée `RunsheetStatus`, qui contient les huit valeurs
 *    Prisma (section « compatibilité ») **et** quatre valeurs historiques
 *    issues de l'API d'origine : PREPARE, ASSIGNE, TERMINE, VALIDE.
 *
 * Tant que le produit n'a pas tranché, on ne supprime rien : ce module
 * convertit dans les deux sens et signale les valeurs inconnues. Le choix du
 * vocabulaire canonique reste une décision produit (cf. tableau ci-dessous).
 */

import { RunsheetStatus } from '@logixpress/types';

type PrismaRunsheetStatus =
  | 'BROUILLON'
  | 'EN_ATTENTE'
  | 'VALIDEE_DEPART'
  | 'EN_COURS'
  | 'RETOUR_DEPOT'
  | 'CLOTUREE_CONFORME'
  | 'CLOTUREE_DEFICIT'
  | 'ANNULEE';

/** Statuts Prisma → statut partagé (identité pour les huit valeurs communes). */
const FROM_PRISMA: Record<string, RunsheetStatus> = {
  BROUILLON: RunsheetStatus.BROUILLON,
  EN_ATTENTE: RunsheetStatus.EN_ATTENTE,
  VALIDEE_DEPART: RunsheetStatus.VALIDEE_DEPART,
  EN_COURS: RunsheetStatus.EN_COURS,
  RETOUR_DEPOT: RunsheetStatus.RETOUR_DEPOT,
  CLOTUREE_CONFORME: RunsheetStatus.CLOTUREE_CONFORME,
  CLOTUREE_DEFICIT: RunsheetStatus.CLOTUREE_DEFICIT,
  ANNULEE: RunsheetStatus.ANNULEE,
};

/**
 * Statuts historiques de l'API → équivalent Prisma.
 *
 * Ces quatre valeurs n'existent pas en base. Le rapprochement est le suivant :
 *
 *   PREPARE   → EN_ATTENTE       tournée prête au départ
 *   ASSIGNE   → EN_ATTENTE       tournée constituée, non partie
 *   TERMINE   → RETOUR_DEPOT     livreur rentré, chiffres non encore validés
 *   VALIDE    → CLOTUREE_CONFORME caisse rapprochée sans écart
 *
 * Le dernier point est le plus discutable : « VALIDE » ne distingue pas
 * une clôture conforme d'une clôture avec déficit, alors que la caisse a
 * besoin de cette distinction. Une clôture à écart doit donc être déclarée
 * explicitement en CLOTUREE_DEFICIT.
 */
const TO_PRISMA: Record<string, PrismaRunsheetStatus> = {
  BROUILLON: 'BROUILLON',
  PREPARE: 'EN_ATTENTE',
  EN_ATTENTE: 'EN_ATTENTE',
  ASSIGNE: 'EN_ATTENTE',
  VALIDEE_DEPART: 'VALIDEE_DEPART',
  EN_COURS: 'EN_COURS',
  TERMINE: 'RETOUR_DEPOT',
  RETOUR_DEPOT: 'RETOUR_DEPOT',
  VALIDE: 'CLOTUREE_CONFORME',
  CLOTUREE_CONFORME: 'CLOTUREE_CONFORME',
  CLOTUREE_DEFICIT: 'CLOTUREE_DEFICIT',
  ANNULE: 'ANNULEE',
  ANNULEE: 'ANNULEE',
};

/** Statuts qu'une tournée en base peut prendre. */
export const PERSISTED_RUNSHEET_STATUSES = Object.keys(FROM_PRISMA) as PrismaRunsheetStatus[];

/** Statuts acceptés en entrée, incluant le vocabulaire historique. */
export const ACCEPTED_RUNSHEET_STATUSES = Object.keys(TO_PRISMA);

export function toSharedRunsheetStatus(status: string): RunsheetStatus {
  return FROM_PRISMA[status] ?? (status as RunsheetStatus);
}

export function toPersistedRunsheetStatus(status: string): PrismaRunsheetStatus | null {
  return TO_PRISMA[status] ?? null;
}

export function isTerminalRunsheetStatus(status: string): boolean {
  return ['RETOUR_DEPOT', 'CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT', 'ANNULEE'].includes(
    toPersistedRunsheetStatus(status) ?? ''
  );
}

export type { PrismaRunsheetStatus };
