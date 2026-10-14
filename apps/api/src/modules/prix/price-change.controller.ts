import type { Response } from 'express';
import { RoleType } from '@logixpress/types';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { priceChangeService } from './price-change.service';

const q = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export class PriceChangeController {
  /** `GET /colis/demandes-prix?status=&packageId=` — l'expéditeur ne voit que les siennes. */
  async lister(req: AuthenticatedRequest, res: Response): Promise<void> {
    const shipperId = req.user?.role === RoleType.EXPEDITEUR ? req.user.shipperId : q(req.query.shipperId);
    if (req.user?.role === RoleType.EXPEDITEUR && !shipperId) {
      res.json({ success: true, data: [] });
      return;
    }
    const data = await priceChangeService.lister({
      status: q(req.query.status),
      packageId: q(req.query.packageId),
      shipperId,
    });
    res.json({ success: true, data, meta: { total: data.length } });
  }

  /** `GET /colis/demandes-prix/compteur` — pastille du menu. */
  async compteur(_req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({ success: true, data: { enAttente: await priceChangeService.compterEnAttente() } });
  }

  private async decider(req: AuthenticatedRequest, res: Response, approuver: boolean): Promise<void> {
    const note = q(req.body?.note) ?? null;
    const data = await priceChangeService.decider(String(req.params.id), approuver, note, {
      id: req.user?.id,
      fullName: req.user?.fullName ?? 'Administration',
    });
    res.json({
      success: true,
      data,
      message: approuver
        ? `Nouveau prix appliqué au colis ${data.trackingNumber}.`
        : `Demande refusée : le colis ${data.trackingNumber} garde son prix.`,
    });
  }

  approuver(req: AuthenticatedRequest, res: Response) {
    return this.decider(req, res, true);
  }

  refuser(req: AuthenticatedRequest, res: Response) {
    return this.decider(req, res, false);
  }
}

export const priceChangeController = new PriceChangeController();
