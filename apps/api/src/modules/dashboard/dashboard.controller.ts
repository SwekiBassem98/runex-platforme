import { dashboardService } from './dashboard.service';
import type { Request, Response } from 'express';

export class DashboardController {
  async getMetrics(req: Request, res: Response): Promise<void> {
    const data = await dashboardService.getMetrics();
    res.json({
      success: true,
      data,
    });
  }
}

export const dashboardController = new DashboardController();
