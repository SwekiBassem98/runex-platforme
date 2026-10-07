/**
 * Contrôleur du référentiel des dépôts.
 *
 * L'écriture est réservée à l'exploitation (DEPOT_MANAGE) : la lecture est
 * ouverte à toute personne qui manipule des colis, livreur compris, qui a
 * besoin de savoir où un colis se trouve.
 */

import { depotsService } from './depots.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { DepositStatus } from '@logixpress/types';
import { badRequest, notFound } from '../../common/errors/api-error';

export class DepotsController {
  async getAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    const deposits = await depotsService.findAll({
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
    });

    res.json({
      success: true,
      data: deposits,
      meta: {
        total: deposits.length,
        // Le dépôt principal est explicite dans la réponse : le client
        // n'a pas à le deviner en triant sur un drapeau.
        mainHub: deposits.find((d) => d.isMainHub)?.id ?? null,
        actifs: deposits.filter((d) => d.status === DepositStatus.ACTIF).length,
        horsService: deposits.filter((d) => d.status !== DepositStatus.ACTIF).length,
        colisStockes: deposits.reduce((sum, d) => sum + d.packagesCount, 0),
      },
    });
  }

  async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const deposit = await depotsService.findById(req.params.id!);
    if (!deposit) throw notFound('Dépôt introuvable.');
    res.json({ success: true, data: deposit });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { code, name, address, city, governorate, zone, phone, managerId, isMainHub } = req.body;

    if (!code || !name || !city) {
      throw badRequest('Les champs « Code », « Nom » et « Ville » sont obligatoires.');
    }

    const deposit = await depotsService.create({
      code,
      name,
      address,
      city,
      governorate,
      zone,
      phone,
      managerId,
      isMainHub: isMainHub === true,
      status: req.body.status as DepositStatus | undefined,
    });

    res.status(201).json({
      success: true,
      data: deposit,
      message: `Dépôt « ${deposit.name} » créé.`,
    });
  }

  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const deposit = await depotsService.update(req.params.id!, req.body, {
      id: req.user?.id,
    });

    res.json({
      success: true,
      data: deposit,
      message: `Dépôt « ${deposit.name} » mis à jour.`,
    });
  }
}

export const depotsController = new DepotsController();
