/**
 * Traduction d'une erreur de service en réponse HTTP.
 *
 * Un module qui attrape une exception doit-il même écrire la réponse ? C'est
 * toujours la même traduction : un `BusinessRuleError` porte son code, tout
 * le reste devient un 400 avec le message du service. Répéter ce petit
 * contrat dans chaque contrôleur le ferait diverger — c'est arrivé, avec
 * trois variantes du même bloc.
 */

import type { Response } from 'express';
import { BusinessRuleError } from './api-error';

export function respondError(res: Response, error: unknown, fallback: string): void {
  const status = error instanceof BusinessRuleError ? error.status : 400;
  const message = error instanceof Error ? error.message : fallback;
  res.status(status).json({ success: false, message });
}
