import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { NotificationEvent } from '@logixpress/types';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import { caisseService } from './caisse.service';

const q = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export class CaisseController {
  /** `GET /caisse/resume?from=&to=` */
  async resume(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({ success: true, data: await caisseService.resume(q(req.query.from), q(req.query.to)) });
  }

  /** `GET /caisse/livreurs?from=&to=` */
  async livreurs(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({ success: true, data: await caisseService.livreurs(q(req.query.from), q(req.query.to)) });
  }

  /** `GET /caisse/livreurs/:id/paiements` */
  async paiementsLivreur(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({ success: true, data: await caisseService.paiementsLivreur(String(req.params.id)) });
  }

  /** `POST /caisse/livreurs/:id/paiements` — `{ amount?, note? }` (défaut : tout le reste à payer). */
  async payerLivreur(req: AuthenticatedRequest, res: Response): Promise<void> {
    const r = await caisseService.payerLivreur(String(req.params.id), req.body ?? {}, {
      id: req.user?.id ?? null,
      fullName: req.user?.fullName,
    });
    await notificationDispatcher
      .notify({
        event: NotificationEvent.PAYMENT_VALIDATED,
        title: 'Paiement reçu',
        content: `Vous avez été payé ${r.amount.toFixed(3)} DT (${r.reference}).`,
        relatedEntity: 'DRIVER',
        relatedEntityId: r.driver.id,
        userIds: [r.driver.userId],
      })
      .catch(() => undefined);
    res.status(201).json({
      success: true,
      data: r,
      message: `${r.driver.fullName} payé ${r.amount.toFixed(3)} DT (${r.reference}).`,
    });
  }

  /** `GET /drivers/me/gains` — gains du livreur connecté. */
  async mesGains(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user?.driverId) {
      res.status(403).json({ success: false, message: 'Réservé aux livreurs.' });
      return;
    }
    res.json({ success: true, data: await caisseService.gainsLivreur(req.user.driverId) });
  }
}

export const caisseController = new CaisseController();
