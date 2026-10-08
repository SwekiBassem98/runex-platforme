/**
 * Contrôleur des inter-dépôts (livraison et retours).
 *
 * Périmètre :
 *  - un livreur ne voit que les bordereaux qu'il transporte ;
 *  - un agent de dépôt ne voit que ceux qui partent de son dépôt ou y arrivent,
 *    charge depuis son dépôt uniquement et n'accepte que ce qui arrive chez lui ;
 *  - l'exploitation voit tout et choisit le dépôt d'où elle opère.
 */

import { interDepotsService, type InterDepotActor } from './inter-depots.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { InterDepotType, RoleType } from '@logixpress/types';
import { ApiError, badRequest, forbidden, notFound } from '../../common/errors/api-error';

type TransferView = { sourceDepositId: string; destinationDepositId: string; driverId?: string | null };

function visibleTo(req: AuthenticatedRequest, t: TransferView): boolean {
  const scope = req.dataScope ?? {};
  if (scope.assignedDriverId) return t.driverId === scope.assignedDriverId;
  if (scope.depositId) return t.sourceDepositId === scope.depositId || t.destinationDepositId === scope.depositId;
  return true;
}

function actorOf(req: AuthenticatedRequest): InterDepotActor {
  return {
    id: req.user?.id,
    fullName: req.user?.fullName || 'Exploitation',
    role: (req.user?.role ?? RoleType.ADMIN) as RoleType,
    depositId: req.user?.depositId ?? null,
  };
}

/** Bordereau visible, et — pour un agent — du bon côté. */
async function loadScoped(req: AuthenticatedRequest, side?: 'source' | 'destination') {
  const viewer = req.dataScope?.depositId ?? req.user?.depositId ?? null;
  const transfer = await interDepotsService.findByNumber(req.params.id!, viewer);
  if (!transfer || !visibleTo(req, transfer)) throw notFound('Inter-dépôt introuvable.');
  const depot = req.dataScope?.depositId;
  if (depot && side) {
    const expected = side === 'source' ? transfer.sourceDepositId : transfer.destinationDepositId;
    if (expected !== depot) {
      throw forbidden(
        side === 'source'
          ? "Seul le dépôt de départ peut modifier ce bordereau."
          : "Seul le dépôt d'arrivée peut accepter ce bordereau."
      );
    }
  }
  return transfer;
}

function typeParam(value: unknown): InterDepotType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const t = String(value).toUpperCase();
  if (!Object.values(InterDepotType).includes(t as InterDepotType)) throw badRequest(`Type d'inter-dépôt inconnu : ${value}.`);
  return t as InterDepotType;
}

export class InterDepotsController {
  async getAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    const scope = req.dataScope ?? {};
    // Vue « agence » : celle de l'agent ; l'exploitation peut en choisir une
    // (?depositId=) ou voir l'ensemble (?depositId=ALL).
    let viewer: string | null = null;
    if (scope.depositId) viewer = scope.depositId;
    else if (!scope.assignedDriverId && req.query.depositId !== 'ALL') {
      viewer = await interDepotsService.operatingDepositId(actorOf(req), req.query.depositId as string | undefined);
    }
    const { rows, stats } = await interDepotsService.list({
      type: typeParam(req.query.type),
      status: req.query.status as string | undefined,
      start: req.query.start as string | undefined,
      end: req.query.end as string | undefined,
      viewerDepositId: viewer,
      sourceDepositId: req.query.sourceDepositId as string | undefined,
      destinationDepositId: req.query.destinationDepositId as string | undefined,
      driverId: scope.assignedDriverId ?? null,
    });
    const visibles = rows.filter((t) => visibleTo(req, t));
    res.json({
      success: true,
      data: visibles,
      meta: {
        total: visibles.length,
        viewerDepositId: viewer,
        stats,
        enCours: visibles.filter((t) => t.status === 'CRE' || t.status === 'RECU_PARTIEL').length,
        anomalies: visibles.filter((t) => t.status === 'RECU_PARTIEL').length,
        piecesEnMouvement: visibles
          .filter((t) => t.status === 'CRE' || t.status === 'RECU_PARTIEL')
          .reduce((sum, t) => sum + (t.totalPieces - t.receivedPieces), 0),
      },
    });
  }

  async getByNumber(req: AuthenticatedRequest, res: Response): Promise<void> {
    const transfer = await loadScoped(req);
    res.json({ success: true, data: transfer });
  }

  async formOptions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const options = await interDepotsService.formOptions();
    const operating =
      req.user?.role === RoleType.AGENT_DEPOT || req.user?.role === RoleType.ADMIN || req.user?.role === RoleType.GESTIONNAIRE
        ? await interDepotsService.operatingDepositId(actorOf(req), req.query.depositId as string | undefined).catch(() => null)
        : null;
    res.json({ success: true, data: { ...options, operatingDepositId: operating } });
  }

  async candidates(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'source');
    const rows = await interDepotsService.candidates(req.params.id!);
    res.json({ success: true, data: rows, meta: { total: rows.length } });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const actor = actorOf(req);
    if (req.dataScope?.depositId && req.body?.sourceDepositId && req.body.sourceDepositId !== req.dataScope.depositId) {
      throw forbidden('Un inter-dépôt ne peut partir que de votre propre dépôt.');
    }
    const transfer = await interDepotsService.create(actor, req.body ?? {});
    res.status(201).json({
      success: true,
      data: transfer,
      message: `Inter-dépôt ${transfer.transferNumber} enregistré : ${transfer.sourceDeposit} → ${transfer.destinationDeposit}. Scannez les colis.`,
    });
  }

  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'source');
    const transfer = await interDepotsService.updateHeader(req.params.id!, actorOf(req), req.body ?? {});
    res.json({ success: true, data: transfer, message: 'Bordereau mis à jour.' });
  }

  async scan(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'source');
    const result = await interDepotsService.scan(req.params.id!, actorOf(req), req.body ?? {});
    res.json({ success: true, data: result.transfer, message: result.message, meta: { mode: result.mode, trackingNumber: result.trackingNumber } });
  }

  async acceptanceBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
    const depositId = await interDepotsService.operatingDepositId(actorOf(req), req.query.depositId as string | undefined);
    const board = await interDepotsService.acceptanceBoard(depositId, typeParam(req.query.type) ?? InterDepotType.LIVRAISON);
    res.json({ success: true, data: board });
  }

  async acceptScan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const depositId = await interDepotsService.operatingDepositId(actorOf(req), req.body?.depositId);
    const result = await interDepotsService.acceptScan(actorOf(req), depositId, req.body ?? {});
    res.json({ success: true, data: result, message: result.message });
  }

  async cancel(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'source');
    const transfer = await interDepotsService.cancel(req.params.id!, actorOf(req));
    res.json({
      success: true,
      data: transfer,
      message: `Inter-dépôt ${transfer.transferNumber} annulé : les colis sont remis en stock à ${transfer.sourceDeposit}.`,
    });
  }

  /** Ancien cycle (préparer / expédier / réception au comptage) : remplacé par le scan. */
  async legacy(_req: AuthenticatedRequest, _res: Response): Promise<void> {
    throw new ApiError(
      "Étape supprimée : les colis partent au scan de chargement et l'arrivée se fait par « Acceptation inter dépôt » (scan de chaque pièce).",
      410
    );
  }
}

export const interDepotsController = new InterDepotsController();
