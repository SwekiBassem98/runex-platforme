import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { presenceService, isDriverOnline } from './presence.service';
import { RoleType } from '@logixpress/types';

export class PresenceController {
  /**
   * Battement livreur : authentifié JWT → Driver.lastSeenAt = now().
   *
   * Le client ne doit PAS envoyer `driverId` ni `lastSeenAt` : l'identité
   * vient du jeton, la date vient du serveur. Toute tentative d'injection
   * est ignorée.
   */
  async heartbeat(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.id) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    if (user.role !== RoleType.LIVREUR) {
      res.status(403).json({ success: false, message: 'Seul un livreur peut signaler sa présence.' });
      return;
    }
    if (!user.driverId) {
      res.status(404).json({ success: false, message: 'Profil livreur introuvable pour cet utilisateur.' });
      return;
    }
    try {
      const result = await presenceService.heartbeatByUserId(user.id);
      res.json({ success: true, data: result });
    } catch (error) {
      const status = (error as Error & { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : 'Battement impossible.';
      res.status(status).json({ success: false, message });
    }
  }

  /** Lecture admin : présence d'un livreur précis */
  async getOne(req: AuthenticatedRequest, res: Response): Promise<void> {
    const id = req.params.id?.trim();
    if (!id) {
      res.status(400).json({ success: false, message: 'Identifiant livreur requis.' });
      return;
    }
    const view = await presenceService.getForDriver(id);
    if (!view) {
      res.status(404).json({ success: false, message: 'Livreur introuvable.' });
      return;
    }
    res.json({ success: true, data: view });
  }

  /** Lecture admin : toutes les présences actives */
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await presenceService.listActive();
    res.json({ success: true, data });
  }
}

export const presenceController = new PresenceController();
