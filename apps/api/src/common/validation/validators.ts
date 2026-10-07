/**
 * Validation d'entrée minimaliste, sans dépendance externe.
 *
 * Objectif : empêcher qu'un corps de requête incomplet ou incohérent produise
 * un enregistrement invalide en silence. Les règles restent volontairement
 * simples et alignées sur les types DTO de `@logixpress/types`.
 */

/** Erreur applicative portant un code HTTP. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  label = field
): string {
  const value = body[field];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new HttpError(400, `Le champ « ${label} » est obligatoire.`);
  }
  return String(value);
}

export function optionalNumber(
  body: Record<string, unknown>,
  field: string,
  label = field
): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `Le champ « ${label} » doit être un nombre.`);
  }
  if (parsed < 0) {
    throw new HttpError(400, `Le champ « ${label} » ne peut pas être négatif.`);
  }
  return parsed;
}

export function optionalPositiveInt(
  body: Record<string, unknown>,
  field: string,
  label = field
): number | undefined {
  const parsed = optionalNumber(body, field, label);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `Le champ « ${label} » doit être un entier positif.`);
  }
  return parsed;
}

export function requireOneOf<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  label = field
): T {
  const value = body[field];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(
      400,
      `Le champ « ${label} » doit valoir l'un de : ${allowed.join(', ')}.`
    );
  }
  return value as T;
}

export function optionalOneOf<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  label = field
): T | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  return requireOneOf(body, field, allowed, label);
}
