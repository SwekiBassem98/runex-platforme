import { dashboardService } from './dashboard.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { RoleType } from '@logixpress/types';

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
}

export const dashboardController = new DashboardController();
