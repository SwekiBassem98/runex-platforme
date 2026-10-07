/**
 * Réception en dépôt — points d'entrée HTTP.
 *
 * Trois routes, dans cet ordre :
 *
 *   - `GET  /depot/reception/depots` : les dépôts actifs, pour le sélecteur.
 *   - `POST /depot/reception/lookup`  : lit un code sans rien écrire.
 *   - `POST /depot/reception`        : reçoit le colis.
 *
 * `lookup` et `receive` partagent le même service, donc la même lecture du
 * code. Un écran qui prévisualise et confirme ne peut donc pas voir deux
 * verdicts différents sur le même code.
 *
 * La forme de la réponse est stable et documentée par son code, pas par son
 * texte : `UNKNOWN_CODE`, `ALREADY_RECEIVED`, `INVALID_DEPOSIT`… Une
 * application mobile compare ces valeurs ; un message, lui, peut être
 * retraduit ou reformulé sans que personne ne s'en aperçoive.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { RoleType } from '@logixpress/types';
import { receptionService } from './reception.service';
import { badRequest } from '../../common/errors/api-error';

/**
 * Statut HTTP correspondant à un refus.
 *
 * Un code inconnu ou mal formé répond 404 : l'opérateur cherche une étiquette,
 * pas un bug. Un code connu déjà reçu, ou dans un état qui interdit
 * l'accueil, répond 409 : la requête est en conflit avec l'état du colis.
 * Un dépôt inexistant répond 400 : la requête est mal formée.
 */
function httpStatus(outcome: string): number {
  switch (outcome) {
    case 'UNKNOWN_CODE':
    case 'MALFORMED_CODE':
      return 404;
    case 'ALREADY_RECEIVED':
    case 'INVALID_STATE':
      return 409;
    case 'INVALID_DEPOSIT':
      return 400;
    default:
      return 200;
  }
}

export class ReceptionController {
  async depots(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    try {
      res.json({ success: true, data: await receptionService.listDepots() });
    } catch {
      res.status(503).json({ success: false, message: 'Dépôts indisponibles.' });
    }
  }

  async lookup(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    const code = String(req.body?.code ?? req.query.code ?? '').trim();
    const depositId = req.body?.depositId ?? req.query.depositId ?? req.user.depositId ?? null;

    try {
      const result = await receptionService.lookup(code, depositId);
      res.json({
        success: true,
        data: result,
        meta: {
          // Motif de refus stable : `UNKNOWN_CODE`, `MALFORMED_CODE`, ou vide
          // quand le colis est trouvé.
          outcome:
            result.kind === 'malformed'
              ? 'MALFORMED_CODE'
              : result.depositError
                ? 'INVALID_DEPOSIT'
                : result.package
                  ? 'FOUND'
                  : 'UNKNOWN_CODE',
        },
      });
    } catch {
      res.status(503).json({ success: false, message: 'Lecture impossible.' });
    }
  }

  async receive(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    const code = String(req.body?.code ?? req.body?.barcode ?? '').trim();
    if (!code) {
      throw badRequest('Aucun code à recevoir.');
    }

    // Le dépôt omis retombe sur celui de l'opérateur : un agent affecté à
    // Sousse n'a pas à choisir le dépôt à chaque scan.
    const depositId = req.body?.depositId ?? req.user.depositId ?? null;

    const result = await receptionService.receive({
      code,
      depositId,
      actor: {
        id: req.user.id,
        fullName: req.user.fullName,
        role: (req.user.role as RoleType) ?? RoleType.AGENT_DEPOT,
      },
      idempotencyKey: req.body?.idempotencyKey ?? null,
    });

    res.status(httpStatus(result.outcome)).json({
      success: result.accepted,
      message: result.message,
      data: result,
    });
  }

  async recent(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }
    try {
      const brut = req.query.depositId;
      const depositId = (typeof brut === 'string' ? brut : null) ?? req.user.depositId ?? null;
      const limitBrut = req.query.limit;
      const limit = Math.min(Number(typeof limitBrut === 'string' ? limitBrut : 20) || 20, 50);
      res.json({ success: true, data: await receptionService.recentReceptions(depositId, limit) });
    } catch {
      res.status(503).json({ success: false, message: 'Historique de réception indisponible.' });
    }
  }
}

export const receptionController = new ReceptionController();