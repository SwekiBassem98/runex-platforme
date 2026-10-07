import { runsheetsService } from './runsheets.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { RunsheetStatus } from '@logixpress/types';
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
    const list = await runsheetsService.findAll({
      driverId: (driverId as string) || req.dataScope?.assignedDriverId,
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
      res.status(400).json({ success: false, message: err.message });
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
      res.status(400).json({ success: false, message: err.message });
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
      res.status(400).json({ success: false, message: err.message });
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
      res.status(400).json({ success: false, message: err.message });
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
      res.status(400).json({ success: false, message: err.message });
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
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async getActiveDriverRunsheet(req: AuthenticatedRequest, res: Response): Promise<void> {
    const driverId = req.query.driverId as string || req.user?.driverId;
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
