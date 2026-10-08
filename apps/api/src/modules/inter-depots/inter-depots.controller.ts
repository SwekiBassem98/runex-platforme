/**
 * Contrôleur des transferts inter-dépôts.
 *
 * Chaque route correspond à un moment de vérité du mouvement : constitution
 * du lot, préparation, départ, réception, annulation. Le contrôleur traduit
 * la requête en appel de service et n décide rien : les règles de transition,
 * les contrôles de dépôt et les refus de colis appartiennent au service, seul
 * à même de les appliquer de façon cohérente quel que soit le client.
 */

import { interDepotsService } from './inter-depots.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { InterDepotStatus } from '@logixpress/types';
import { badRequest, forbidden, notFound } from '../../common/errors/api-error';

/**
 * Périmètre des transferts :
 *  - un livreur ne voit que les transferts qu'il transporte ;
 *  - un magasinier ne voit que ceux qui partent de son dépôt ou y arrivent, et
 *    n'agit que du bon côté (préparer/expédier/annuler au départ, recevoir à
 *    l'arrivée) ;
 *  - l'exploitation voit tout.
 */
type TransferView = { sourceDepositId: string; destinationDepositId: string; driverId?: string | null };

function visibleTo(req: AuthenticatedRequest, t: TransferView): boolean {
  const scope = req.dataScope ?? {};
  if (scope.assignedDriverId) return t.driverId === scope.assignedDriverId;
  if (scope.depositId) return t.sourceDepositId === scope.depositId || t.destinationDepositId === scope.depositId;
  return true;
}

async function loadScoped(req: AuthenticatedRequest, side?: 'source' | 'destination') {
  const transfer = await interDepotsService.findByNumber(req.params.id!);
  if (!transfer || !visibleTo(req, transfer)) throw notFound('Transfert introuvable.');
  const depot = req.dataScope?.depositId;
  if (depot && side) {
    const expected = side === 'source' ? transfer.sourceDepositId : transfer.destinationDepositId;
    if (expected !== depot) {
      throw forbidden(
        side === 'source'
          ? 'Seul le dépôt de départ peut effectuer cette opération.'
          : "Seul le dépôt d'arrivée peut réceptionner ce transfert."
      );
    }
  }
  return transfer;
}

const actor = (req: AuthenticatedRequest, fallback: string) => ({
  id: req.user?.id,
  fullName: req.user?.fullName || fallback,
});

export class InterDepotsController {
  async getAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    const list = await interDepotsService.findAll({
      status: req.query.status as string | undefined,
      sourceDepositId: req.query.sourceDepositId as string | undefined,
      destinationDepositId: req.query.destinationDepositId as string | undefined,
    });

    const visibles = list.filter((t) => visibleTo(req, t));
    res.json({
      success: true,
      data: visibles,
      meta: {
        total: visibles.length,
        // Le parc se lit par état, pas par total : c'est le nombre de navettes
        // qui n'ont pas encore trouvé leur arrivée qui intéresse l'exploitation.
        enCours: visibles.filter(
          (t) => t.status !== InterDepotStatus.RECU && t.status !== InterDepotStatus.ANNULE
        ).length,
        // Seules les réceptions en écart traduisent une perte physique : elles
        // remontent à part, jamais noyées dans le total.
        anomalies: visibles.filter((t) => t.hasDiscrepancy).length,
        piecesEnMouvement: list
          .filter((t) => t.status === InterDepotStatus.EN_TRANSIT)
          .reduce((sum, t) => sum + t.totalPieces, 0),
      },
    });
  }

  async getByNumber(req: AuthenticatedRequest, res: Response): Promise<void> {
    const transfer = await loadScoped(req);
    res.json({ success: true, data: transfer });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const {
      sourceDepositId,
      destinationDepositId,
      transporterDriverId,
      scheduledDate,
      sealNumber,
      packageIds,
      notes,
      dispatchNotes,
    } = req.body;

    if (req.dataScope?.depositId && sourceDepositId !== req.dataScope.depositId) {
      throw forbidden('Un transfert ne peut être créé que depuis votre propre dépôt.');
    }
    if (!sourceDepositId || !destinationDepositId) {
      throw badRequest(
        'Les champs « Dépôt de départ » (sourceDepositId) et « Dépôt d\'arrivée » ' +
          '(destinationDepositId) sont obligatoires.'
      );
    }

    const transfer = await interDepotsService.create({
      sourceDepositId,
      destinationDepositId,
      transporterDriverId,
      scheduledDate,
      sealNumber,
      packageIds: Array.isArray(packageIds) ? packageIds : undefined,
      notes,
      dispatchNotes,
    });

    res.status(201).json({
      success: true,
      data: transfer,
      message:
        `Transfert ${transfer.transferNumber} créé : ` +
        `${transfer.sourceDeposit} → ${transfer.destinationDeposit}, ` +
        `${transfer.totalPackages} colis (${transfer.totalPieces} pièces).`,
    });
  }

  /** Préparation : le lot est conditionné et attend le chargement. */
  async prepare(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'source');
    const transfer = await interDepotsService.prepare(
      req.params.id!,
      actor(req, 'Magasin')
    );
    res.json({
      success: true,
      data: transfer,
      message: `Transfert ${transfer.transferNumber} préparé.`,
    });
  }

  /** Départ : le véhicule quitte le dépôt d'origine. */
  async dispatch(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'source');
    const transfer = await interDepotsService.dispatch(
      req.params.id!,
      actor(req, 'Exploitation')
    );
    res.json({
      success: true,
      data: transfer,
      message:
        `${transfer.totalPackages} colis expédiés vers ` +
        `${transfer.destinationDeposit} (${transfer.totalPieces} pièces).`,
    });
  }

  /**
   * Réception au dépôt d'arrivée.
   *
   * L'opérateur déclare ce qu'il a compté, jamais ce que la réception vaut :
   * l'écart avec l'expédié est calculé par le service. Un comptage partiel est
   * donc enregistré — avec la trace de ce qui manque — et non refusé : le
   * refuser laisserait la perte sans trace et le transfert bloqué.
   */
  async receive(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'destination');
    const { receivedPackages, receptionNotes } = req.body;

    const transfer = await interDepotsService.receive(req.params.id!, actor(req, 'Magasin'), {
      receivedPackages,
      receptionNotes,
    });

    res.json({
      success: true,
      data: transfer,
      message: transfer.hasDiscrepancy
        ? `Réception enregistrée en écart : ${transfer.discrepancy} colis manquants ` +
          `(${transfer.receivedPackages} reçus sur ${transfer.totalPackages}).`
        : `${transfer.receivedPackages} colis réceptionnés à ${transfer.destinationDeposit}.`,
    });
  }

  async cancel(req: AuthenticatedRequest, res: Response): Promise<void> {
    await loadScoped(req, 'source');
    const transfer = await interDepotsService.cancel(req.params.id!, actor(req, 'Exploitation'));
    res.json({
      success: true,
      data: transfer,
      message: `Transfert ${transfer.transferNumber} annulé : les colis redeviennent disponibles à ${transfer.sourceDeposit}.`,
    });
  }
}

export const interDepotsController = new InterDepotsController();
