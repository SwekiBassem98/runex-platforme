import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { sousTraitanceService, type ActeurST } from './sous-traitance.service';

const q = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const acteur = (req: AuthenticatedRequest): ActeurST => ({ id: req.user?.id, fullName: req.user?.fullName ?? 'Exploitation' });

/** Sous-traitance JAX — exploitation (administrateur, gestionnaire). */
export class SousTraitanceController {
  /** `GET /sous-traitance/jax/parametres` — configuration, zones, référentiels. */
  async parametres(_req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await sousTraitanceService.parametres() });
  }
  /** `POST /sous-traitance/jax/referentiels` — relit gouvernorats et statuts chez JAX. */
  async referentiels(req: AuthenticatedRequest, res: Response) {
    const r = await sousTraitanceService.synchroniserReferentiels(acteur(req));
    res.json({ success: true, data: r, message: `Référentiels JAX relus : ${r.gouvernorats} gouvernorats, ${r.statuts} statuts.` });
  }
  /** `PUT /sous-traitance/jax/zones` — `{ governorates: string[] }` */
  async zones(req: AuthenticatedRequest, res: Response) {
    const zones = await sousTraitanceService.definirZones(req.body?.governorates, acteur(req));
    res.json({ success: true, data: zones, message: zones.length ? `${zones.length} gouvernorat(s) confié(s) automatiquement à JAX.` : 'Aucun envoi automatique à JAX.' });
  }
  /** `PATCH /sous-traitance/jax/statuts/:code` — `{ etat }` (null : automatique) */
  async statut(req: AuthenticatedRequest, res: Response) {
    await sousTraitanceService.definirStatut(String(req.params.code), req.body?.etat ?? null, acteur(req));
    res.json({ success: true, data: null, message: 'Correspondance enregistrée.' });
  }
  /** `GET /sous-traitance/jax/colis?etat=&depositId=&q=&cod=a_recevoir` */
  async lister(req: AuthenticatedRequest, res: Response) {
    res.json({
      success: true,
      data: await sousTraitanceService.lister({ etat: q(req.query.etat), depositId: q(req.query.depositId), q: q(req.query.q), cod: q(req.query.cod) }),
    });
  }
  /** `GET /sous-traitance/jax/eligibles?depositId=&governorate=&q=` */
  async eligibles(req: AuthenticatedRequest, res: Response) {
    res.json({
      success: true,
      data: await sousTraitanceService.eligibles({ depositId: q(req.query.depositId), governorate: q(req.query.governorate), q: q(req.query.q) }),
    });
  }
  /** `POST /sous-traitance/jax/envoyer` — `{ packageIds }` */
  async envoyer(req: AuthenticatedRequest, res: Response) {
    const r = await sousTraitanceService.envoyer(req.body?.packageIds, acteur(req));
    const ok = r.filter((x) => x.ok).length;
    res.json({ success: true, data: r, message: `${ok} colis confié(s) à JAX${r.length - ok ? `, ${r.length - ok} refusé(s)` : ''}.` });
  }
  /** `GET /sous-traitance/jax/enlevements` — en attente, par agence. */
  async enlevements(_req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await sousTraitanceService.enlevementsEnAttente() });
  }
  /** `POST /sous-traitance/jax/enlevements` — `{ depositId, note? }` */
  async demanderEnlevement(req: AuthenticatedRequest, res: Response) {
    const r = await sousTraitanceService.demanderEnlevement(req.body?.depositId, req.body?.note, acteur(req));
    res.status(201).json({ success: true, data: r, message: `Enlèvement demandé à JAX : ${r.colis} colis à ${r.agence}${r.reference ? ` (demande ${r.reference})` : ''}.` });
  }
  /** `POST /sous-traitance/jax/sync` — `{ packageIds? }` */
  async sync(req: AuthenticatedRequest, res: Response) {
    const r = await sousTraitanceService.synchroniser(req.body?.packageIds);
    res.json({ success: true, data: r, message: `${r.relus} colis relus chez JAX, ${r.changes} mis à jour.${r.erreurs.length ? ` Erreurs : ${r.erreurs.join(' ; ')}` : ''}` });
  }
  /** `GET /sous-traitance/colis/:id` */
  async detail(req: AuthenticatedRequest, res: Response) {
    res.json({ success: true, data: await sousTraitanceService.detail(String(req.params.id)) });
  }
  /** `POST /sous-traitance/jax/colis/:id/retour-recu` */
  async retourRecu(req: AuthenticatedRequest, res: Response) {
    const r = await sousTraitanceService.retourRecu(String(req.params.id), acteur(req));
    res.json({ success: true, data: null, message: r.message });
  }
  /** `POST /sous-traitance/jax/colis/:id/reprendre` */
  async reprendre(req: AuthenticatedRequest, res: Response) {
    const r = await sousTraitanceService.reprendre(String(req.params.id), acteur(req));
    res.json({ success: true, data: null, message: r.message });
  }
  /** `POST /sous-traitance/jax/encaissements` — `{ packageIds }` */
  async codRecu(req: AuthenticatedRequest, res: Response) {
    const r = await sousTraitanceService.marquerCodRecu(req.body?.packageIds, acteur(req));
    res.json({ success: true, data: r, message: `Reversement JAX enregistré : ${r.total.toFixed(3)} DT pour ${r.colis} colis.` });
  }
}

export const sousTraitanceController = new SousTraitanceController();
