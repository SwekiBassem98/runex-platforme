/**
 * Journal d'audit — point d'entrée HTTP.
 *
 * Trois lectures, et rien d'autre.
 *
 *   - `GET /audit`          : l'historique, filtré et paginé ;
 *   - `GET /audit/summary`  : la répartition des actions sur une période ;
 *   - `GET /audit/actions`  : les actions réellement présentes, pour le filtre.
 *
 * Il n'y a **aucune route d'écriture ni de suppression**, et ce n'est pas un
 * oubli. Le journal se remplit parce que les modules métier y écrivent au fil de
 * leur travail, jamais parce qu'un appelant le lui demande : une route
 * d'écriture serait un point d'entrée ouvert à quiconque sait écrire, et une
 * route de suppression une façon de faire disparaître une trace.
 *
 * L'immuabilité n'est pas comptée sur les seules routes : une route absente
 * peut toujours être ajoutée par erreur, un script run à la main peut toujours
 * écrire en SQL. La base refuse la modification, et c'est là que la règle est
 * appliquée — voir la migration `audit_log_immutable`.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { auditService, type AuditQuery } from '../../common/audit/audit.service';
import { respondError } from '../../common/errors/respond-error';

/** Première valeur d'un paramètre de requête, ou `undefined`. */
function param(source: unknown): string | undefined {
  const valeur = Array.isArray(source) ? source[0] : source;
  if (typeof valeur !== 'string') return undefined;
  const propre = valeur.trim();
  return propre.length > 0 ? propre : undefined;
}

/** Entier borné : une valeur absurde est ramenée dans les limites, pas refusée. */
function entier(source: unknown, defaut: number, min: number, max: number): number {
  const brut = Number(param(source));
  if (!Number.isFinite(brut)) return defaut;
  return Math.min(Math.max(Math.trunc(brut), min), max);
}

export class AuditController {
  /** Historique filtré. */
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    try {
      const filtres: AuditQuery = {
        entityType: param(req.query.entityType),
        entityId: param(req.query.entityId),
        action: param(req.query.action),
        userId: param(req.query.userId),
        category: param(req.query.category),
        from: param(req.query.from),
        to: param(req.query.to),
        search: param(req.query.search),
        limit: entier(req.query.limit, 50, 1, 200),
        offset: entier(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      };

      const resultat = await auditService.query(filtres);
      res.json({
        success: true,
        data: resultat.entries,
        meta: {
          total: resultat.total,
          limit: resultat.limit,
          offset: resultat.offset,
          returned: resultat.entries.length,
          hasMore: resultat.offset + resultat.entries.length < resultat.total,
        },
      });
    } catch (err: unknown) {
      respondError(res, err, "Journal d'audit inaccessible.");
    }
  }

  /** Répartition des actions sur une période. */
  async summary(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    try {
      res.json({
        success: true,
        data: await auditService.summary(param(req.query.from), param(req.query.to)),
      });
    } catch (err: unknown) {
      respondError(res, err, "Synthèse du journal impossible.");
    }
  }

  /**
   * Actions présentes dans le journal.
   *
   * La liste est tirée de la base et non du catalogue : un filtre doit proposer
   * ce sur quoi on peut réellement filtrer. Les entrées du catalogue jamais
   * utilisées n'en font donc pas partie : tant qu'aucune ligne ne les porte,
   * elles n'occupent l'écran de rien.
   */
  async actions(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    try {
      const actions = await auditService.knownActions();
      res.json({
        success: true,
        data: actions.map((entree) => ({
          action: entree.action,
          count: entree.count,
          label: entree.description.label,
          category: entree.description.category,
          categoryLabel: entree.description.categoryLabel,
          critical: entree.description.critical,
          known: entree.description.known,
        })),
      });
    } catch (err: unknown) {
      respondError(res, err, "Catalogue des actions inaccessible.");
    }
  }
}

export const auditController = new AuditController();