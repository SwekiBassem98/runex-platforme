import { colisService } from './colis.service';
import { auditService } from '../../common/audit/audit.service';
import { receptionService } from '../depot/reception.service';
import type { Response } from 'express';
import { resolveOperatingDeposit, type AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { respondError } from '../../common/errors/respond-error';
import { PermissionCode, RoleType } from '@logixpress/types';
import {
  requireString,
  optionalNumber,
  optionalPositiveInt,
} from '../../common/validation/validators';

/** Nombre maximal de bons imprimés en une fois. */
export const BONS_LIVRAISON_MAX = 200;

export class ColisController {
  async getAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    const {
      search,
      status,
      city,
      driver,
      type,
      paymentStatus,
      date,
      page,
      limit,
    } = req.query;

    const result = await colisService.findAll({
      search: search as string,
      status: status as string,
      city: city as string,
      driver: driver as string,
      type: type as string,
      paymentStatus: paymentStatus as string,
      date: date as string,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 20,
      scope: req.dataScope,
    });

    res.json({
      success: true,
      data: result.packages,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
        scopedTo: req.user?.role,
        shipperId: req.dataScope?.shipperId,
        driverId: req.dataScope?.assignedDriverId,
      },
    });
  }

  async getByIdentifier(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    const pkg = await colisService.findById(identifier, req.dataScope);
    if (!pkg) {
      res.status(404).json({
        success: false,
        message: 'Colis introuvable ou vous n\'avez pas l\'autorisation d\'y accéder.',
      });
      return;
    }
    res.json({ success: true, data: pkg });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Le client et l'adresse sont indispensables : on refuse une commande
      // inexploitable plutôt que d'enregistrer un colis avec des valeurs par
      // défaut silencieuses.
      requireString(req.body, 'customerName', 'Nom du destinataire');
      requireString(req.body, 'customerPhone', 'Téléphone du destinataire');
      requireString(req.body, 'address', 'Adresse de livraison');

      optionalNumber(req.body, 'totalPrice', 'Montant à encaisser');
      optionalPositiveInt(req.body, 'pieceCount', 'Nombre de pièces');

      // Un expéditeur crée toujours pour son propre compte (le corps est
      // ignoré). L'exploitation (ADMIN, GESTIONNAIRE) saisit pour le compte
      // d'un expéditeur désigné explicitement : sans cela, l'écran « Nouveau
      // colis » du back-office échouait systématiquement.
      const staff = req.user?.role === RoleType.ADMIN || req.user?.role === RoleType.GESTIONNAIRE;
      const onBehalf = staff && typeof req.body?.shipperId === 'string' ? req.body.shipperId.trim() : '';
      if (staff && !req.user?.shipperId && !onBehalf) {
        res.status(400).json({ success: false, message: "Choisissez l'expéditeur pour le compte duquel le colis est créé." });
        return;
      }
      if (onBehalf && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(onBehalf)) {
        res.status(400).json({ success: false, message: 'Identifiant expéditeur invalide.' });
        return;
      }
      const pkg = await colisService.create(req.body, {
        shipperId: onBehalf || req.user?.shipperId,
        shipperName: onBehalf ? undefined : req.user?.shipperName,
        fullName: req.user?.fullName,
      });
      res.status(201).json({
        success: true,
        data: pkg,
        message: 'Colis créé avec succès.',
      });
    } catch (err: unknown) {
      respondError(res, err, 'Opération impossible.');
    }
  }

  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }

    try {
      const result = await colisService.update(identifier, req.body, {
        id: req.user.id,
        fullName: req.user.fullName,
        role: req.user.role,
        shipperId: req.user.shipperId,
      });

      res.json({
        success: true,
        data: result.package,
        driverNotified: result.driverNotified,
        message: result.driverNotified
          ? result.notificationMessage
          : 'Colis mis à jour avec succès.',
      });
    } catch (err: unknown) {
      respondError(res, err, 'Impossible de mettre à jour le colis.');
    }
  }

  async cancel(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    const { reason } = req.body;
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }

    try {
      const pkg = await colisService.cancel(identifier, reason, {
        id: req.user.id,
        fullName: req.user.fullName,
        role: req.user.role,
        shipperId: req.user.shipperId,
      });

      res.json({
        success: true,
        data: pkg,
        message: `Colis #${pkg.trackingNumber} annulé avec succès.`,
      });
    } catch (err: unknown) {
      respondError(res, err, "Impossible d'annuler le colis.");
    }
  }

  /**
   * Ancienne route de scan, conservée pour l'application archivée et les
   * scripts de régression.
   *
   * Elle délègue au service de réception. Auparavant, un code inconnu
   * créait un colis à 0 DT au nom d'un client « Client Comptoir » : une
   * réception ratée devenait une marchandise fantôme, non livrable et non
   * facturable. Une réception n'a de sens que si l'on sait ce qu'on reçoit.
   */
  async scanAccept(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    const code = String(req.body?.barcode ?? req.body?.code ?? '').trim();
    if (!code) {
      res.status(400).json({ success: false, message: 'Code-barres requis' });
      return;
    }

    try {
      const result = await receptionService.receive({
        code,
        // Ni identifiant codé en dur ni repli silencieux sur un dépôt qui
        // n'existe pas : à défaut, le dépôt de l'opérateur, puis le hub.
        depositId: await resolveOperatingDeposit(req, req.body?.depositId),
        actor: {
          id: req.user.id,
          fullName: req.user.fullName,
          role: req.user.role,
        },
        idempotencyKey: req.body?.idempotencyKey ?? null,
      });

      // Cette route répond toujours avec le colis en `data` : les appelants
      // existants s'en servent. Le motif de refus voyage dans `meta`, et le
      // code HTTP distingue le refus.
      const refused =
        result.outcome === 'UNKNOWN_CODE' || result.outcome === 'MALFORMED_CODE'
          ? 404
          : result.accepted
            ? 200
            : 409;

      // Hors colis trouvé, l'ancien contrat rendait le code lu dans
      // `data.barcode` : un appelant pouvait le relogger sans le connaître par
      // ailleurs. Le service le range sous un nom plus exact, la route le rejoue
      // sous l'ancien.
      const payload = result.package ? result.package : { ...result, barcode: code };

      res.status(refused).json({
        success: result.accepted,
        data: payload,
        message: result.message,
        meta: { outcome: result.outcome, accepted: result.accepted },
      });
    } catch (err: unknown) {
      respondError(res, err, 'Réception impossible.');
    }
  }

  async assign(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.assignDriver(
        identifier,
        req.body,
        {
          id: req.user?.id,
          fullName: req.user?.fullName || 'Gestionnaire',
          role: req.user?.role!,
        }
      );
      res.json({ success: true, data: pkg, message: `Colis assigné à ${req.body.driverName}` });
    } catch (err: unknown) {
      respondError(res, err, 'Opération impossible.');
    }
  }

  async deliver(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.markDelivered(identifier, req.body, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Livreur',
        role: req.user?.role!,
        driverId: req.user?.driverId,
      });
      res.json({ success: true, data: pkg, message: 'Colis livré avec succès' });
    } catch (err: unknown) {
      respondError(res, err, 'Opération impossible.');
    }
  }

  async partialDelivery(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.markPartialDelivery(identifier, req.body, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Livreur',
        role: req.user?.role!,
        driverId: req.user?.driverId,
      });
      res.json({ success: true, data: pkg, message: 'Livraison partielle enregistrée' });
    } catch (err: unknown) {
      respondError(res, err, 'Opération impossible.');
    }
  }

  async exchange(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.markExchange(identifier, req.body, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Livreur',
        role: req.user?.role!,
        driverId: req.user?.driverId,
      });
      res.json({ success: true, data: pkg, message: 'Échange effectué avec succès' });
    } catch (err: unknown) {
      respondError(res, err, 'Opération impossible.');
    }
  }

  async postpone(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.markPostponed(identifier, req.body, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Livreur',
        role: req.user?.role!,
        driverId: req.user?.driverId,
      });
      res.json({ success: true, data: pkg, message: 'Livraison reportée enregistrée' });
    } catch (err: unknown) {
      respondError(res, err, 'Opération impossible.');
    }
  }

  async returnPackage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.markReturn(
        identifier,
        req.body,
        {
          id: req.user?.id,
          fullName: req.user?.fullName || 'Livreur',
          role: req.user?.role!,
          driverId: req.user?.driverId,
        }
      );
      res.json({ success: true, data: pkg, message: 'Retour colis enregistré' });
    } catch (err: unknown) {
      respondError(res, err, 'Opération impossible.');
    }
  }

  /**
   * Démarrage de la livraison par le livreur : le colis passe en
   * « en cours de livraison » juste avant la présentation au client.
   */
  async startDelivery(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.startDelivery(identifier, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Livreur',
        role: req.user?.role!,
        driverId: req.user?.driverId,
      });
      res.json({ success: true, data: pkg, message: 'Livraison démarrée.' });
    } catch (err: unknown) {
      respondError(res, err, 'Impossible de démarrer la livraison.');
    }
  }

  /**
   * Restitution définitive du colis à son expéditeur (administration).
   */
  async returnToShipper(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    try {
      const pkg = await colisService.markReturnedToShipper(identifier, {
        id: req.user?.id,
        fullName: req.user?.fullName || 'Administration',
        role: req.user?.role!,
      });
      res.json({
        success: true,
        data: pkg,
        message: `Colis #${pkg.trackingNumber} restitué à l'expéditeur.`,
      });
    } catch (err: unknown) {
      respondError(res, err, 'Restitution impossible.');
    }
  }

  /**
   * Signale une tentative de livraison infructueuse (destinataire
   * injoignable, adresse fausse, pas assez d'espèces, refus).
   *
   * Le motif est obligatoire et normalisé : c'est lui qui rend le taux
   * d'échec exploitable, par zone et par livreur.
   */
  async failedAttempt(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    const { reasonCode, comment, callDurationSeconds, rescheduledFor, definitive } = req.body;

    if (!reasonCode) {
      res.status(400).json({
        success: false,
        message: "Le champ « Motif de l'échec » (reasonCode) est obligatoire.",
      });
      return;
    }

    try {
      const pkg = await colisService.markFailedAttempt(
        identifier,
        {
          reasonCode,
          comment,
          callDurationSeconds,
          rescheduledFor,
          definitive,
        },
        {
          id: req.user?.id,
          fullName: req.user?.fullName || 'Livreur',
          role: req.user?.role!,
          driverId: req.user?.driverId,
        }
      );

      res.json({
        success: true,
        data: pkg,
        message:
          pkg.status === 'ECHEC_LIVRAISON'
            ? 'Échec de livraison enregistré : le colis ne sera pas retenté.'
            : 'Tentative de livraison enregistrée, une reprise est prévue.',
      });
    } catch (err: unknown) {
      respondError(res, err, "Impossible d'enregistrer cet échec de livraison.");
    }
  }

  /**
   * Journal d'audit d'un colis : qui a fait quoi, quand et depuis quel statut.
   *
   * L'identifiant reçu peut être un numéro de suivi ; il est d'abord résolu
   * en UUID, car c'est cette valeur que porte l'audit.
   *
   * La résolution passe par le périmètre du demandeur : sans cela, un
   * expéditeur disposant de `COLIS_READ` pouvait demander le journal d'un colis
   * d'une autre entreprise et lire ses montants, ses statuts et ses auteurs.
   * Le 404 est indistinguable d'un colis inexistant, ce qui évite de confirmer
   * l'existence d'un colis étranger.
   */
  /** Bon de livraison d'un colis (une page par pièce, imprimée côté navigateur). */
  async bonLivraison(req: AuthenticatedRequest, res: Response): Promise<void> {
    const [bon] = await colisService.bonsLivraison([req.params.identifier!], req.dataScope);
    if (!bon) {
      res.status(404).json({
        success: false,
        message: 'Colis introuvable ou vous n\'avez pas l\'autorisation d\'y accéder.',
      });
      return;
    }
    res.json({ success: true, data: bon });
  }

  /**
   * Bons de livraison de plusieurs colis, pour une impression groupée.
   * Plafonné : au-delà, la fenêtre d'impression devient inutilisable.
   */
  async bonsLivraison(req: AuthenticatedRequest, res: Response): Promise<void> {
    const raw = (req.body as { identifiers?: unknown } | undefined)?.identifiers;
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((v) => typeof v !== 'string' || v.length > 64)) {
      res.status(400).json({ success: false, message: 'Liste de colis invalide (identifiers : tableau de chaînes).' });
      return;
    }
    if (raw.length > BONS_LIVRAISON_MAX) {
      res.status(400).json({
        success: false,
        message: `Au plus ${BONS_LIVRAISON_MAX} bons de livraison par impression.`,
      });
      return;
    }
    const data = await colisService.bonsLivraison(raw as string[], req.dataScope);
    res.json({ success: true, data });
  }

  async auditTrail(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const pkg = await colisService.findById(req.params.identifier!, req.dataScope);
      if (!pkg) {
        res.status(404).json({ success: false, message: 'Colis introuvable.' });
        return;
      }

      // Les entrées sont déjà formatées — libellé d'action, nom de l'auteur,
      // signaux d'anomalie — : le contrôleur n'a plus qu'à les rendre.
      const entries = await auditService.listForEntity('PACKAGE', pkg.id);
      // L'adresse IP et le navigateur des opérateurs sont des données
      // d'exploitation : seuls les profils habilités au journal d'audit les voient.
      const canSeeNetwork = req.user?.permissions.includes(PermissionCode.AUDIT_READ) || req.user?.role === RoleType.ADMIN;
      const data = canSeeNetwork
        ? entries
        : entries.map((entry) => {
            const { userIp: _ip, userAgent: _ua, ...rest } = entry as typeof entry & {
              userIp?: unknown;
              userAgent?: unknown;
            };
            return rest;
          });
      res.json({ success: true, data });
    } catch (err: unknown) {
      respondError(res, err, "Journal d'audit inaccessible.");
    }
  }

  /**
   * Suppression définitive d'un colis.
   *
   * La suppression est logique (`deletedAt`) : la ligne et son historique
   * restent consultables, conformément à l'exigence de traçabilité.
   */
  async remove(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { identifier } = req.params;
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }

    try {
      await colisService.remove(identifier, {
        id: req.user.id,
        fullName: req.user.fullName,
        role: req.user.role,
        shipperId: req.user.shipperId,
      });
      res.json({ success: true, message: 'Colis supprimé.' });
    } catch (err: unknown) {
      respondError(res, err, 'Suppression impossible.');
    }
  }
}

export const colisController = new ColisController();
