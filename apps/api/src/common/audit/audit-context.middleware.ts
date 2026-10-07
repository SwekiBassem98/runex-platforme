/**
 * Ouverture du contexte d'audit pour chaque requête.
 *
 * Monté très tôt, avant l'authentification : l'adresse IP et le client
 * existent dès l'entrée de la requête, et une requête refusée — 401, 403 —
 * fait partie de l'histoire au même titre qu'une opération réussie.
 */

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { clientIp, clientUserAgent, runWithAuditContext } from './audit-context';

/**
 * @param req        Requête entrante.
 * @param res        Réponse, inemployée : la signature est celle d'un
 *                   middleware.
 * @param next       Suite de la chaîne, exécutée *dans* le contexte.
 * @param trustProxy L'application est-elle derrière un proxy de confiance ?
 *                   Vient de la configuration, jamais de l'en-tête seul :
 *                   croire `X-Forwarded-For` sans déploiement protégé rend
 *                   l'adresse falsifiable par n'importe quel client.
 */
/** `X-Forwarded-For` peut arriver en liste ; le client d'origine est le premier. */
function forwardedFor(entete: string | string[] | undefined): string | null {
  const brut = Array.isArray(entete) ? entete[0] : entete;
  return brut ?? null;
}

export function auditContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
  trustProxy = false
): void {
  const entetes = req.headers;
  const context = {
    ip: clientIp(req.ip, trustProxy ? forwardedFor(entetes['x-forwarded-for']) : null),
    userAgent: clientUserAgent(entetes['user-agent']),
    // Un identifiant de requête permet de relier plusieurs lignes d'audit
    // nées d'un même aller-retour : une réception, par exemple, écrit à la
    // fois sur le colis et sur son dépôt.
    requestId: randomUUID(),
  };

  // `next()` est appelé *dans* `run` : c'est ce qui rend le contexte visible à
  // toute la suite de la chaîne, attentes asynchrones comprises. L'appeler
  // après reviendrait à ne pas l'ouvrir du tout.
  runWithAuditContext(context, () => next());
}