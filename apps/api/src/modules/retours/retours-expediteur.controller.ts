import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { retoursExpediteurService, type ActeurRetour } from './retours-expediteur.service';

const q = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function acteur(req: AuthenticatedRequest): ActeurRetour {
  return {
    id: req.user?.id,
    fullName: req.user?.fullName ?? 'Exploitation',
    role: req.user!.role,
    shipperId: req.user?.shipperId,
    depositId: req.dataScope?.depositId,
  };
}

export class RetoursExpediteurController {
  /** `GET /retours-expediteur/a-rendre` — par expéditeur, colis et articles d'échange en attente. */
  async aRendre(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.aRendre(acteur(req));
    res.json({ success: true, data });
  }

  /** `GET /retours-expediteur/bons?status=&shipperId=&driverId=&from=&to=&q=` */
  async lister(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.lister(acteur(req), {
      status: q(req.query.status),
      shipperId: q(req.query.shipperId),
      driverId: q(req.query.driverId),
      from: q(req.query.from),
      to: q(req.query.to),
      q: q(req.query.q),
    });
    res.json({ success: true, data, meta: { total: data.length } });
  }

  /** `GET /retours-expediteur/bons/:id` */
  async detail(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({ success: true, data: await retoursExpediteurService.detail(String(req.params.id), acteur(req)) });
  }

  /** `POST /retours-expediteur/bons` — `{ shipperId, driverId?, vehiclePlate?, plannedDate? }` */
  async creer(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.creer(req.body ?? {}, acteur(req));
    res.status(201).json({ success: true, data, message: `Bon de retour ${data.slipNumber} créé pour ${data.shipperName}.` });
  }

  /** `PATCH /retours-expediteur/bons/:id` — `{ driverId?, vehiclePlate?, plannedDate?, notes? }` */
  async modifier(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.modifier(String(req.params.id), req.body ?? {}, acteur(req));
    res.json({ success: true, data, message: `Bon ${data.slipNumber} enregistré.` });
  }

  /** `POST /retours-expediteur/bons/:id/scan` — `{ code, mode: 'ajouter' | 'retirer' }` */
  async scanner(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { bon, message } = await retoursExpediteurService.scanner(String(req.params.id), req.body ?? {}, acteur(req));
    res.json({ success: true, data: bon, message });
  }

  /** `DELETE /retours-expediteur/bons/:id` — administrateur seulement. */
  async supprimer(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { slipNumber, message } = await retoursExpediteurService.supprimer(String(req.params.id), acteur(req));
    res.json({ success: true, data: { slipNumber }, message });
  }

  /** `POST /retours-expediteur/bons/:id/etat` — `{ status, receiverName?, code? }` (code exigé pour « remis »). */
  async changerEtat(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { bon, message } = await retoursExpediteurService.changerEtat(String(req.params.id), req.body ?? {}, acteur(req));
    res.json({ success: true, data: bon, message });
  }
}

export const retoursExpediteurController = new RetoursExpediteurController();
