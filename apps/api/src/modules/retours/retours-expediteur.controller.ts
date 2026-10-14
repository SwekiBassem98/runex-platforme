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
  /** `GET /retours-expediteur/a-rendre?shipperId=` */
  async aRendre(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.aRendre(acteur(req), q(req.query.shipperId));
    res.json({ success: true, data, meta: { expediteurs: data.length, colis: data.reduce((s, g) => s + g.colis.length, 0) } });
  }

  /** `GET /retours-expediteur/bons?status=&shipperId=` */
  async lister(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.lister(acteur(req), { status: q(req.query.status), shipperId: q(req.query.shipperId) });
    res.json({ success: true, data, meta: { total: data.length } });
  }

  /** `GET /retours-expediteur/bons/:id` */
  async detail(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({ success: true, data: await retoursExpediteurService.detail(String(req.params.id), acteur(req)) });
  }

  /** `POST /retours-expediteur/bons` — `{ shipperId, packageIds?, notes? }` */
  async creer(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.creer(req.body ?? {}, acteur(req));
    res.status(201).json({ success: true, data, message: `Bon ${data.slipNumber} préparé (${data.packagesCount} colis).` });
  }

  /** `POST /retours-expediteur/bons/:id/remettre` — `{ code, receiverName? }` */
  async remettre(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.remettre(String(req.params.id), req.body ?? {}, acteur(req));
    res.json({ success: true, data, message: `Bon ${data.slipNumber} : ${data.packagesCount} colis remis à ${data.shipperName}.` });
  }

  /** `POST /retours-expediteur/bons/:id/annuler` */
  async annuler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await retoursExpediteurService.annuler(String(req.params.id), acteur(req));
    res.json({ success: true, data, message: `Bon ${data.slipNumber} annulé.` });
  }
}

export const retoursExpediteurController = new RetoursExpediteurController();
