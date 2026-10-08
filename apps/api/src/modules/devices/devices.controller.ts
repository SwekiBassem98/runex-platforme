import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { devicesService } from './devices.service';
import { respondError } from '../../common/errors/respond-error';

export class DevicesController {
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    const devices = await devicesService.listForUser(userId);
    // Ne jamais exposer le jeton complet : le frontend n'en a pas besoin, et
    // un vol de base n'expose pas les jetons poussés.
    const masked = devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      deviceId: d.deviceId,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      tokenPreview: d.token.slice(0, 12) + '…' + d.token.slice(-6),
    }));
    res.json({ success: true, data: masked, meta: { total: devices.length } });
  }

  async register(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    try {
      const { token, platform, deviceId } = req.body ?? {};
      if (!token || typeof token !== 'string' || !token.trim()) {
        res.status(400).json({ success: false, message: 'Le champ « token » est obligatoire.' });
        return;
      }
      const device = await devicesService.registerToken(userId, { token, platform, deviceId });
      // Réponse sans exposer le jeton complet en clair dans les logs côté client
      res.status(201).json({
        success: true,
        data: { id: device.id, platform: device.platform, deviceId: device.deviceId, isActive: device.isActive },
        message: 'Appareil enregistré pour les notifications poussées.',
      });
    } catch (err: unknown) {
      respondError(res, err, 'Enregistrement impossible.');
    }
  }

  async removeByToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    try {
      const token = (req.body?.token as string) ?? (req.query.token as string) ?? '';
      const result = await devicesService.removeToken(userId, token);
      res.json({ success: true, data: result, message: result.removed ? 'Jeton désactivé.' : 'Jeton déjà inactif.' });
    } catch (err: unknown) {
      respondError(res, err, 'Suppression impossible.');
    }
  }

  async removeById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    try {
      const result = await devicesService.removeDevice(userId, req.params.id!);
      res.json({ success: true, data: result, message: 'Appareil désactivé.' });
    } catch (err: unknown) {
      respondError(res, err, 'Suppression impossible.');
    }
  }
}

export const devicesController = new DevicesController();
