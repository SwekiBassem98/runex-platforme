import type { Response } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Traduction d'une erreur quelconque en réponse HTTP sûre.
 *
 * Seules les erreurs « métier » portent un message destiné à l'utilisateur :
 * celles qui déclarent un statut HTTP 4xx (`ApiError`, `BusinessRuleError`,
 * `HttpError` des validateurs). Toute autre erreur — Prisma, réseau, bug — est
 * journalisée côté serveur et répond par un message générique : un message
 * Prisma brut révèle les noms de tables, de colonnes et le chemin des fichiers.
 */
export interface SafeHttpError {
  status: number;
  message: string;
}

const GENERIC_500 = 'Erreur interne du serveur.';

export function toSafeHttpError(error: unknown, fallback = 'Requête invalide.'): SafeHttpError {
  const candidate = error as { status?: unknown; statusCode?: unknown; message?: unknown; type?: unknown };

  // Corps JSON illisible (express.json) : erreur du client, sans détail interne.
  if (candidate?.type === 'entity.parse.failed') {
    return { status: 400, message: 'Corps de requête JSON invalide.' };
  }
  if (candidate?.type === 'entity.too.large') {
    return { status: 413, message: 'Corps de requête trop volumineux.' };
  }

  const status =
    typeof candidate?.status === 'number'
      ? candidate.status
      : typeof candidate?.statusCode === 'number'
        ? candidate.statusCode
        : undefined;
  if (status !== undefined && status >= 400 && status < 500 && typeof candidate.message === 'string') {
    return { status, message: candidate.message || fallback };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2025':
      case 'P2001':
      case 'P2015':
        return { status: 404, message: 'Ressource introuvable.' };
      case 'P2002':
        return { status: 409, message: 'Cette opération entre en conflit avec une donnée existante. Réessayez.' };
      case 'P2003':
        return { status: 409, message: 'Opération impossible : une donnée liée est manquante ou encore utilisée.' };
      case 'P2023':
      case 'P2007':
      case 'P2006':
      case 'P2009':
      case 'P2012':
      case 'P2019':
      case 'P2020':
        return { status: 400, message: fallback };
      case 'P2034':
        return { status: 409, message: 'Opération concurrente détectée. Réessayez.' };
      default:
        break;
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return { status: 400, message: fallback };
  }

  // Erreurs PostgreSQL remontées telles quelles (adaptateur de pilote, requêtes
  // brutes) : la classe SQLSTATE dit s'il s'agit d'une saisie invalide.
  const sqlState = String(
    (error as { cause?: { originalCode?: unknown } })?.cause?.originalCode ??
      (error as { meta?: { code?: unknown } })?.meta?.code ??
      ''
  );
  if (/^22/.test(sqlState)) return { status: 400, message: fallback };
  if (sqlState === '23505') {
    return { status: 409, message: 'Cette opération entre en conflit avec une donnée existante. Réessayez.' };
  }
  if (sqlState === '23503') {
    return { status: 409, message: 'Opération impossible : une donnée liée est manquante ou encore utilisée.' };
  }
  if (sqlState === '40001' || sqlState === '40P01') {
    return { status: 409, message: 'Opération concurrente détectée. Réessayez.' };
  }

  return { status: 500, message: GENERIC_500 };
}

export function respondError(res: Response, error: unknown, fallback: string): void {
  const safe = toSafeHttpError(error, fallback);
  if (safe.status >= 500) {
    console.error('[RUNEX API] Erreur non rattrapée :', error);
  }
  res.status(safe.status).json({ success: false, message: safe.message });
}
