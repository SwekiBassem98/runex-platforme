import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { respondError } from '../../common/errors/respond-error';
import { ScanError, scanService } from './scan.service';

/**
 * `GET /scan/:code` et `POST /scan { code }` — le second pour un contenu de QR
 * qui ne tiendrait pas proprement dans un chemin (lien complet, par exemple).
 *
 * Réponse refusée : `{ success: false, code: ScanErrorCode, message }`.
 */
export class ScanController {
  async scan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const raw = req.method === 'GET' ? req.params.code : (req.body as { code?: unknown } | undefined)?.code;
    try {
      const user = req.user!;
      const data = await scanService.resolve(raw, {
        role: user.role,
        driverId: user.driverId,
        shipperId: user.shipperId,
        depositId: req.dataScope?.depositId ?? user.depositId,
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof ScanError) {
        res.status(error.status).json({ success: false, code: error.code, message: error.message });
        return;
      }
      respondError(res, error, 'Scan impossible.');
    }
  }
}

export const scanController = new ScanController();
