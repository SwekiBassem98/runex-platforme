/**
 * Inventaire et historique — lecture de la requête.
 *
 * Le contrôleur se contente de lire la chaîne de requête et de la transmettre
 * au service. Aucun filtre n'est interprété ici : c'est le service qui sait
 * quelles valeurs sont acceptables, et il doit rester le seul endroit où une
 * requête est traduite en prédicat — l'export s'y branche aussi.
 */

import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import {
  inventoryService,
  type InventoryFilterParams,
} from './inventory.service';
import { respondError } from '../../common/errors/respond-error';

function readFilters(req: Request): InventoryFilterParams {
  const q = req.query as Record<string, string | undefined>;
  return {
    search: q.search ?? q.q,
    dateFrom: q.dateFrom ?? q.from,
    dateTo: q.dateTo ?? q.to,
    status: q.status,
    shipperId: q.shipperId,
    driverId: q.driverId,
    depositId: q.depositId,
    city: q.city,
    governorate: q.governorate,
    type: q.type ?? q.packageType,
    paymentStatus: q.paymentStatus,
    returnStatus: q.returnStatus,
    page: q.page ? Number(q.page) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  };
}

export class InventoryController {
  /** Liste paginée de l'historique. */
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    try {
      const result = await inventoryService.list({
        ...readFilters(req),
        scope: req.dataScope,
      });

      res.json({
        success: true,
        data: result.rows,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
          appliedFilters: result.appliedFilters,
        },
      });
    } catch (err: unknown) {
      respondError(res, err, 'Historique inaccessible.');
    }
  }

  /** Valeurs proposées pour alimenter les listes de filtres. */
  async facets(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    try {
      const facets = await inventoryService.facets({ scope: req.dataScope });
      res.json({ success: true, data: facets });
    } catch (err: unknown) {
      respondError(res, err, 'Filtres indisponibles.');
    }
  }

  /**
   * Export CSV.
   *
   * Répond en `text/csv` avec un `Content-Disposition` : le navigateur propose
   * alors l'enregistrement sous le nom calculé par le service, qui décrit les
   * filtres appliqués. Le fichier porte donc sur lui-même la trace de ce qu'il
   * contient.
   */
  async exportCsv(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    try {
      const { csv, filename, rowCount } = await inventoryService.exportCsv(
        { ...readFilters(req), scope: req.dataScope },
        { id: req.user.id, fullName: req.user.fullName }
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      // Le nombre de lignes est une donnée utile au client : il peut
      // confirmer à l'utilisateur ce qu'il vient d'extraire.
      res.setHeader('X-Export-Rows', String(rowCount));
      res.send(csv);
    } catch (err: unknown) {
      respondError(res, err, 'Export impossible.');
    }
  }
}

export const inventoryController = new InventoryController();
