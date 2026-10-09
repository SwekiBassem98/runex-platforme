import { dashboardService } from './dashboard.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { RoleType } from '@logixpress/types';
import { getShipperDashboard } from './shipper-dashboard.service';
import { respondError } from '../../common/errors/respond-error';

export class DashboardController {
  async getMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
    // Le livreur reçoit son propre tableau de bord (ses colis, sa caisse) :
    // le tableau de bord global porte les montants de toute la plateforme et
    // n'a pas à partir vers un appareil de terrain.
    // Un agent dépôt (AGENT_DEPOT) ne doit jamais voir la plateforme entière :
    // son tableau de bord est filtré par son dépôt via `req.dataScope`.
    let data: unknown;
    if (req.user?.role === RoleType.LIVREUR && req.user?.driverId) {
      data = await dashboardService.getDriverMetrics(req.user.driverId);
    } else if (req.dataScope?.depositId) {
      data = await dashboardService.getMetrics({ depositId: req.dataScope.depositId });
    } else {
      data = await dashboardService.getMetrics();
    }
    res.json({
      success: true,
      data,
    });
  }

  /** `GET /shipper/dashboard?days=7|14|30|90` — indicateurs de l'expéditeur connecté. */
  async getShipperDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    const shipperId = req.dataScope?.shipperId;
    if (req.user?.role !== RoleType.EXPEDITEUR || !shipperId) {
      res.status(403).json({ success: false, message: 'Réservé aux expéditeurs.' });
      return;
    }
    try {
      const days = Number.parseInt(String(req.query.days ?? '14'), 10);
      res.json({ success: true, data: await getShipperDashboard(shipperId, days) });
    } catch (error) {
      respondError(res, error, 'Tableau de bord indisponible.');
    }
  }
}

export const dashboardController = new DashboardController();
