/**
 * Erreurs d'API.
 *
 * Les services lèvent des erreurs métier, jamais des `Error` brutes : une
 * ressource absente doit répondre 404 et un doublon 409, pas 500. Sans ce
 * typage, la gestion globale d'erreurs ne peut que renvoyer 500 et l'appelant
 * ne distingue pas une panne d'un cas normal.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const notFound = (message: string): ApiError => new ApiError(message, 404);
export const badRequest = (message: string): ApiError => new ApiError(message, 400);
export const conflict = (message: string): ApiError => new ApiError(message, 409);
export const forbidden = (message: string): ApiError => new ApiError(message, 403);

/**
 * Erreur de règle métier : l'appel est bien formé, mais l'opération est
 * impossible dans l'état courant du monde.
 *
 * Elle vit ici, et non dans un module métier, parce que le service domaine et
 * les modules qui l'appellent doivent partager la même classe : un import
 * circulaire entre le service et celui qui l'appelle ferait échouer la
 * vérification de type sur des fichiers qui, pourtant, ne dépendent l'un de
 * l'autre que par accident.
 */
export class BusinessRuleError extends ApiError {
  constructor(message: string, status = 400) {
    super(message, status);
    this.name = 'BusinessRuleError';
  }
}

/** Format UUID canonique, le seul accepté par les colonnes UUID de PostgreSQL. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Ramène une valeur à un UUID exploitable, ou `null`.
 *
 * Indispensable avant toute requête sur une colonne UUID : PostgreSQL rejette
 * une chaîne non conforme (« invalid character … found `r` at 2 ») et
 * l'erreur remonte en 500 alors que l'appelant a simplement fourni un
 * identifiant maladroit.
 */
export function asUuid(value: string | null | undefined): string | null {
  return isUuid(value) ? (value as string) : null;
}
