import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { inventoryExceptionsService, type InventoryExceptionParams } from './inventory-exceptions.service';
import { respondError } from '../../common/errors/respond-error';
import { asUuid } from '../../common/errors/api-error';

function readFilters(req: Request): InventoryExceptionParams {
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
    category: q.category ?? q.reason,
    severity: q.severity,
    page: q.page ? Number(q.page) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
    stuckHours: q.stuckHours ? Number(q.stuckHours) : undefined,
    blockedHours: q.blockedHours ? Number(q.blockedHours) : undefined,
    nonTraceableHours: q.nonTraceableHours ? Number(q.nonTraceableHours) : undefined,
    nonEnvoyeHours: q.nonEnvoyeHours ? Number(q.nonEnvoyeHours) : undefined,
  };
}

export class InventoryExceptionsController {
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    try {
      const result = await inventoryExceptionsService.list({ ...readFilters(req), scope: req.dataScope });
      res.json({ success: true, data: result.rows, meta: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages, appliedFilters: result.appliedFilters, thresholds: result.thresholds } });
    } catch (err: unknown) {
      respondError(res, err, 'Exceptions d\'inventaire inaccessibles.');
    }
  }

  async facets(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    try {
      const facets = await inventoryExceptionsService.facets({ ...readFilters(req), scope: req.dataScope });
      res.json({ success: true, data: facets });
    } catch (err: unknown) {
      respondError(res, err, 'Facettes indisponibles.');
    }
  }

  async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    const id = req.params.id as string;
    if (!asUuid(id)) {
      res.status(400).json({ success: false, message: 'Identifiant invalide.' });
      return;
    }
    try {
      const result = await inventoryExceptionsService.getById(id, req.dataScope);
      if (!result) {
        res.status(404).json({ success: false, message: 'Colis introuvable.' });
        return;
      }
      res.json({ success: true, data: result });
    } catch (err: unknown) {
      respondError(res, err, 'Détail inaccessible.');
    }
  }
}

export const inventoryExceptionsController = new InventoryExceptionsController();
