import { healthService } from './health.service';
import type { Request, Response } from 'express';

export class HealthController {
  async check(req: Request, res: Response): Promise<void> {
    const health = await healthService.getHealthStatus();
    const httpStatus = health.status === 'ok' ? 200 : 503;
    res.status(httpStatus).json(health);
  }
}

export const healthController = new HealthController();
