/**
 * Contrôleur des rendez-vous de ramassage.
 *
 * Le périmètre d'accès est transmis au service depuis le jeton : un expéditeur
 * ne voit que ses propres demandes, un livreur que celles qui lui sont affectées.
 * Aucun paramètre de requête ne peut élargir ce périmètre.
 */

import { ramassagesService } from './ramassages.service';
import type { PickupActor } from './ramassages.service';
import { RoleType } from '@logixpress/types';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';

/** Traduit l'utilisateur du jeton en acteur du service. */
function actorOf(req: AuthenticatedRequest): PickupActor {
  return {
    id: req.user?.id,
    fullName: req.user?.fullName || 'Exploitation',
    role: (req.user?.role ?? RoleType.ADMIN) as RoleType,
    driverId: req.user?.driverId,
    shipperId: req.user?.shipperId,
  };
}

export class RamassagesController {
  async getAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    const list = await ramassagesService.findAll(actorOf(req), {
      status: req.query.status as string | undefined,
      date: req.query.date as string | undefined,
      start: req.query.start as string | undefined,
      end: req.query.end as string | undefined,
    });

    res.json({
      success: true,
      data: list,
      meta: {
        total: list.length,
        toConfirm: list.filter((p) => p.status === 'A_CONFIRMER').length,
        pending: list.filter((p) => p.status === 'EN_ATTENTE').length,
        done: list.filter((p) => p.status === 'EFFECTUE').length,
        // Vue agence : en attente (tout ce qui n'est ni fait ni annulé).
        waiting: list.filter((p) => p.status !== 'EFFECTUE' && p.status !== 'ANNULE').length,
        cancelled: list.filter((p) => p.status === 'ANNULE').length,
      },
    });
  }

  /** Rendez-vous du livreur authentifié, pour son écran de terrain. */
  async getForDriver(req: AuthenticatedRequest, res: Response): Promise<void> {
    const list = await ramassagesService.findForDriver(actorOf(req));
    res.json({
      success: true,
      data: list,
      meta: { total: list.length },
      message: `${list.length} ramassage(s) à collecter.`,
    });
  }

  async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const pickup = await ramassagesService.findById(req.params.id!, actorOf(req));
    // Même code pour « absent » et « appartient à quelqu'un d'autre » : un
    // expéditeur ne doit pas pouvoir sonder l'existence des demandes d'autrui.
    if (!pickup) {
      res.status(404).json({ success: false, message: 'Ramassage introuvable.' });
      return;
    }
    res.json({ success: true, data: pickup });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    // Un expéditeur ne peut demander un ramassage que pour lui-même ; à défaut,
    // c'est l'exploitation qui saisit pour le compte d'un fournisseur.
    const shipperId = req.user?.shipperId ?? req.body.shipperId;
    if (!shipperId) {
      res.status(400).json({ success: false, message: 'Expéditeur non renseigné.' });
      return;
    }

    const created = await ramassagesService.create(actorOf(req), { ...req.body, shipperId });
    res.status(201).json({
      success: true,
      data: created,
      message: created.status === 'ASSIGNE'
        ? `Ramassage ${created.referenceNumber} organisé et affecté à ${created.assignedDriverName ?? 'un livreur'}.`
        : `Rendez-vous ${created.referenceNumber} enregistré, en attente de confirmation.`,
    });
  }

  async confirm(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await ramassagesService.confirm(req.params.id!, actorOf(req));
    res.json({
      success: true,
      data: updated,
      message: `Créneau du ${updated.scheduledDate} (${updated.timeSlotStartHour}h–${updated.timeSlotEndHour}h) confirmé.`,
    });
  }

  async assign(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { driverId } = req.body;
    const updated = await ramassagesService.transition(
      req.params.id!,
      'ASSIGNE',
      actorOf(req),
      { driverId }
    );
    res.json({
      success: true,
      data: updated,
      message: `Ramassage affecté à ${updated.assignedDriverName ?? 'un livreur'}.`,
    });
  }

  async start(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await ramassagesService.transition(req.params.id!, 'EN_COURS', actorOf(req));
    res.json({ success: true, data: updated, message: 'Collecte démarrée.' });
  }

  async complete(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await ramassagesService.transition(req.params.id!, 'EFFECTUE', actorOf(req));
    res.json({
      success: true,
      data: updated,
      message: `${updated.actualPickedCount} colis collectés.`,
    });
  }

  async cancel(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await ramassagesService.transition(req.params.id!, 'ANNULE', actorOf(req));
    res.json({ success: true, data: updated, message: 'Ramassage annulé.' });
  }

  /** Rattache ou détache des colis ; la quantité collectée en découle. */
  async syncPackages(req: AuthenticatedRequest, res: Response): Promise<void> {
    const updated = await ramassagesService.syncPackages(req.params.id!, actorOf(req), {
      attach: Array.isArray(req.body.attach) ? req.body.attach : undefined,
      detach: Array.isArray(req.body.detach) ? req.body.detach : undefined,
    });
    res.json({
      success: true,
      data: updated,
      message: `${updated.actualPickedCount} colis rattachés au ramassage ${updated.referenceNumber}.`,
    });
  }
}

export const ramassagesController = new RamassagesController();
