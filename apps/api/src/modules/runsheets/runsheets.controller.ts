import { runsheetsService } from './runsheets.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { RoleType, RunsheetStatus } from '@logixpress/types';
import {
  requireString,
  requireOneOf,
  optionalNumber,
} from '../../common/validation/validators';

const RUNSHEET_STATUSES = [
  RunsheetStatus.BROUILLON,
  RunsheetStatus.PREPARE,
  RunsheetStatus.ASSIGNE,
  RunsheetStatus.EN_COURS,
  RunsheetStatus.TERMINE,
  RunsheetStatus.VALIDE,
  RunsheetStatus.ANNULE,
] as const;

export class RunsheetsController {
  async getAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { driverId, status, date } = req.query;
    // Le périmètre porté par le jeton prime sur tout paramètre : un livreur
    // ne peut pas élargir sa vue en passant l'identifiant d'un autre
    // chauffeur. Les rôles de bureau, sans périmètre chauffeur, conservent le
    // filtre par query.
    const list = await runsheetsService.findAll({
      driverId: req.dataScope?.assignedDriverId ?? ((driverId as string) || undefined),
      status: status as string,
      date: date as string,
    });

    res.json({
      success: true,
      data: list,
      meta: {
        total: list.length,
      },
    });
  }

  async getByNumber(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const runsheet = await runsheetsService.findByNumber(id);
    if (!runsheet) {
      res.status(404).json({ success: false, message: 'Feuille de tournée introuvable' });
      return;
    }
    // Un livreur ne lit que ses propres tournées : même un numéro deviné ne
    // doit pas ouvrir la tournée d'un collègue (adresses et montants clients).
    if (req.user?.role === RoleType.LIVREUR && runsheet.driverId !== req.user?.driverId) {
      res.status(404).json({ success: false, message: 'Feuille de tournée introuvable' });
      return;
    }
    res.json({ success: true, data: runsheet });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Seul l'identifiant du livreur est demandé : son nom vient de la base.
      // Exiger un nom côté client aurait laissé passer une valeur fausse,
      // ignorée mais affichée dans les erreurs.
      const driverId = requireString(req.body, 'driverId', 'Chauffeur (driverId)');
      const tourDate = requireString(req.body, 'tourDate', 'Date de tournée (tourDate)');

      if (!/^\d{4}-\d{2}-\d{2}$/.test(tourDate)) {
        res.status(400).json({
          success: false,
          message: 'Le champ « Date de tournée » doit être au format AAAA-MM-JJ.',
        });
        return;
      }

      const runsheet = await runsheetsService.create({
        driverId,
        driverCode: req.body.driverCode,
        tourDate,
        depositId: req.body.depositId || req.user?.depositId,
        type: req.body.type,
        packageIds: Array.isArray(req.body.packageIds) ? req.body.packageIds : undefined,
        notes: req.body.notes,
      });

      res.status(201).json({
        success: true,
        data: runsheet,
        message: `Feuille de tournée #${runsheet.runsheetNumber} créée avec succès.`,
      });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async addPackage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      const packageIdentifier = requireString(
        req.body,
        'packageIdentifier',
        'Identifiant du colis (packageIdentifier)'
      );
      const runsheet = await runsheetsService.addPackage(id, packageIdentifier, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Gestionnaire',
      });
      res.json({
        success: true,
        data: runsheet,
        message: `Colis #${packageIdentifier} ajouté à la feuille de tournée #${runsheet.runsheetNumber}.`,
      });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async removePackage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      const packageIdentifier = requireString(
        req.body,
        'packageIdentifier',
        'Identifiant du colis (packageIdentifier)'
      );
      const runsheet = await runsheetsService.removePackage(id, packageIdentifier);
      res.json({
        success: true,
        data: runsheet,
        message: `Colis #${packageIdentifier} retiré de la tournée.`,
      });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async updateStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      const status = requireOneOf(req.body, 'status', RUNSHEET_STATUSES, 'Statut');
      const runsheet = await runsheetsService.updateStatus(id, status, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Exploitation',
        driverId: req.user?.driverId,
        role: req.user?.role,
      });
      res.json({
        success: true,
        data: runsheet,
        message: `Statut de la tournée passé à [${status}].`,
      });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async close(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { notes } = req.body;
    try {
      const collectedCash = optionalNumber(req.body, 'collectedCash', 'Montant encaissé');
      if (collectedCash === undefined) {
        res.status(400).json({
          success: false,
          message: 'Le champ « Montant encaissé » (collectedCash) est obligatoire.',
        });
        return;
      }

      const collectedChecks = optionalNumber(req.body, 'collectedChecks', 'Montant des chèques') ?? 0;
      const runsheet = await runsheetsService.closeRunsheet(
        id,
        { collectedCash, collectedChecks, notes },
        { id: req.user?.id, fullName: req.user?.fullName || 'Livreur' }
      );
      res.json({
        success: true,
        data: runsheet,
        message: `Tournée #${runsheet.runsheetNumber} terminée avec ${collectedCash.toFixed(3)} DT encaissés.`,
      });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async validate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    const { notes } = req.body;
    try {
      const runsheet = await runsheetsService.validateRunsheet(id, notes, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Caissier',
      });
      res.json({
        success: true,
        data: runsheet,
        message: `Tournée #${runsheet.runsheetNumber} validée et rapprochée en caisse.`,
      });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      const payload: Record<string, unknown> = {};
      if (req.body.driverId !== undefined) payload.driverId = String(req.body.driverId);
      if (req.body.tourDate !== undefined) payload.tourDate = String(req.body.tourDate);
      if (req.body.notes !== undefined) payload.notes = req.body.notes === null ? null : String(req.body.notes);
      if (req.body.zone !== undefined && payload.notes === undefined) payload.notes = String(req.body.zone);
      if (req.body.depositId !== undefined) payload.depositId = String(req.body.depositId);
      if (req.body.type !== undefined) payload.type = String(req.body.type);

      if (Object.keys(payload).length === 0) {
        res.status(400).json({ success: false, message: 'Aucune donnée à mettre à jour.' });
        return;
      }

      const runsheet = await runsheetsService.update(
        id,
        payload as { driverId?: string; tourDate?: string; notes?: string; depositId?: string; type?: string },
        { id: req.user?.id, fullName: req.user?.fullName || 'Gestionnaire', depositId: req.user?.depositId },
        req.dataScope
      );
      res.json({ success: true, data: runsheet, message: `Tournée #${runsheet.runsheetNumber} mise à jour.` });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async remove(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params;
    try {
      await runsheetsService.remove(
        id,
        { id: req.user?.id, fullName: req.user?.fullName || 'Gestionnaire' },
        req.dataScope
      );
      res.json({ success: true, message: 'Tournée supprimée.' });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res.status(status).json({ success: false, message: err.message });
    }
  }

  async getActiveDriverRunsheet(req: AuthenticatedRequest, res: Response): Promise<void> {
    // Le livreur ne choisit pas le chauffeur dont il lit la tournée : son
    // identité vient du jeton. Le paramètre de requête reste offert aux rôles
    // de bureau qui pilotent plusieurs chauffeurs.
    const driverId =
      req.user?.role === RoleType.LIVREUR
        ? req.user?.driverId
        : (req.query.driverId as string) || req.user?.driverId;
    if (!driverId) {
      res.status(400).json({ success: false, message: 'Identifiant chauffeur requis.' });
      return;
    }
    const runsheet = await runsheetsService.getActiveRunsheetForDriver(driverId);
    if (!runsheet) {
      res.status(404).json({ success: false, message: 'Aucune tournée active pour ce chauffeur.' });
      return;
    }
    res.json({ success: true, data: runsheet });
  }
}

export const runsheetsController = new RunsheetsController();
