import type { Response } from 'express';
import { RoleType } from '@logixpress/types';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { auditService } from '../../common/audit/audit.service';
import { respondError } from '../../common/errors/respond-error';
import { zonesService } from './zones.service';

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export class ZonesController {
  /** `GET /zones` — liste avec livreurs et nombre de colis (exploitation, livreurs). */
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const role = req.user?.role;
      if (role === RoleType.EXPEDITEUR) {
        res.status(403).json({ success: false, message: 'Réservé à l’exploitation et aux livreurs.' });
        return;
      }
      const isDriver = role === RoleType.LIVREUR;
      const zones = await zonesService.list({
        search: req.query.search as string | undefined,
        governorate: req.query.governorate as string | undefined,
        // Un livreur ne choisit que parmi les zones actives.
        active: isDriver ? 'true' : (req.query.active as string | undefined),
        depositId: req.dataScope?.depositId,
        withStats: !isDriver,
      });
      // Le livreur n'a pas à connaître la liste des collègues par zone.
      const data = isDriver ? zones.map(({ drivers: _d, ...z }) => z) : zones;
      res.json({ success: true, data, meta: { total: data.length } });
    } catch (error) {
      respondError(res, error, 'Zones indisponibles.');
    }
  }

  /** `GET /zones/suggestions?governorate=` — délégations connues (formulaire de colis). */
  async suggestions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await zonesService.suggestions(req.query.governorate as string | undefined) });
    } catch (error) {
      respondError(res, error, 'Suggestions indisponibles.');
    }
  }

  /** `PATCH /zones/:id` — nom, agence, tarif, activation, livreurs. */
  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const id = String(req.params.id ?? '');
      if (!isUuid(id)) {
        res.status(400).json({ success: false, message: 'Identifiant de zone invalide.' });
        return;
      }
      const body = req.body ?? {};
      const zone = await zonesService.update(id, {
        name: body.name,
        depositId: body.depositId,
        baseDeliveryFee: body.baseDeliveryFee,
        isActive: body.isActive,
        driverIds: body.driverIds,
      });
      await auditService.record({
        entityType: 'ZONE',
        entityId: zone.id,
        action: 'ZONE_MODIFIEE',
        userId: req.user?.id ?? null,
        reason: `Zone « ${zone.name} (${zone.governorate}) » modifiée.`,
        newValues: {
          name: zone.name,
          depositId: zone.depositId,
          baseDeliveryFee: zone.baseDeliveryFee,
          isActive: zone.isActive,
          drivers: (zone.drivers ?? []).map((d) => d.driverCode),
        },
      });
      res.json({ success: true, data: zone, message: 'Zone enregistrée.' });
    } catch (error) {
      respondError(res, error, 'Modification impossible.');
    }
  }

  /** `GET /drivers/me/zones` et `GET /drivers/:id/zones`. */
  async driverZones(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const driverId = this.targetDriver(req, res);
      if (!driverId) return;
      res.json({ success: true, data: await zonesService.driverZones(driverId) });
    } catch (error) {
      respondError(res, error, 'Zones du livreur indisponibles.');
    }
  }

  /** `PUT /drivers/me/zones` et `PUT /drivers/:id/zones` — `{ zoneIds: [] }`. */
  async setDriverZones(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const driverId = this.targetDriver(req, res);
      if (!driverId) return;
      const zones = await zonesService.setDriverZones(driverId, req.body?.zoneIds);
      await auditService.record({
        entityType: 'DRIVER',
        entityId: driverId,
        action: 'DRIVER_ZONES_MODIFIEES',
        userId: req.user?.id ?? null,
        reason: `Zones couvertes : ${zones.map((z) => z.name).join(', ') || 'aucune'}.`,
        newValues: { zoneIds: zones.map((z) => z.id) },
      });
      res.json({ success: true, data: zones, message: 'Zones enregistrées.' });
    } catch (error) {
      respondError(res, error, 'Enregistrement impossible.');
    }
  }

  /** `GET /colis/:id/driver-suggestions` — livreurs de la zone du colis d'abord. */
  async driverSuggestions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await zonesService.driversForPackage(String(req.params.id ?? '')) });
    } catch (error) {
      respondError(res, error, 'Suggestions indisponibles.');
    }
  }

  /** Livreur visé : soi-même (`/me`) ou `:id` pour l'exploitation. */
  private targetDriver(req: AuthenticatedRequest, res: Response): string | null {
    if (req.params.id === undefined) {
      if (req.user?.role !== RoleType.LIVREUR || !req.user.driverId) {
        res.status(403).json({ success: false, message: 'Réservé aux livreurs.' });
        return null;
      }
      return req.user.driverId;
    }
    const id = String(req.params.id);
    if (!isUuid(id)) {
      res.status(400).json({ success: false, message: 'Identifiant de livreur invalide.' });
      return null;
    }
    return id;
  }
}

export const zonesController = new ZonesController();
