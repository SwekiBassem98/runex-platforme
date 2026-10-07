/**
 * Contrôleur de la caisse.
 *
 * Deux responsabilités distinctes : les bordereaux d'expéditeur, qui sont les
 * décaissements *vers* l'expéditeur, et les encaissements COD, qui sont
 * l'argent des clients pris par les livreurs. Les exposer côte à côte
 * permettrait de les confondre ; ils restent donc sur deux services et deux
 * games de routes.
 *
 * Règle appliquée à toutes les actions d'écriture : le corps de la requête
 * ne contient jamais un statut. Valider, écarter et rembourser sont des
 * routes nommées, et ce sont elles qui écrivent qui, quand et pourquoi.
 */

import { paymentsService } from './payments.service';
import { cashService, type CashActor } from './cash.service';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { respondError } from '../../common/errors/respond-error';

/** Acteur tel qu'il vient du jeton. */
function actorOf(req: AuthenticatedRequest): CashActor {
  return {
    id: req.user?.id,
    fullName: req.user?.fullName || '',
    role: req.user?.role,
    driverId: req.user?.driverId,
    shipperId: req.user?.shipperId,
  };
}

export class PaymentsController {
  /* ---------------------------------------------------------------- */
  /* Bordereaux d'expéditeur                                            */
  /* ---------------------------------------------------------------- */

  async getAll(req: AuthenticatedRequest, res: Response): Promise<void> {
    const list = await paymentsService.findAll({
      id: req.user?.id,
      fullName: req.user?.fullName || '',
      shipperId: req.user?.shipperId,
    });

    // Les agrégats sont calculés à partir de la liste réellement retournée :
    // le client peut ainsi rapprocher `data` et `meta`.
    const sumNetPayable = (filter: (status: string) => boolean) =>
      list.filter((v) => filter(v.status)).reduce((sum, v) => sum + v.netPayable, 0);

    const confirmed = list.filter((v) => v.status === 'CONFIRME');
    const paid = list.filter((v) => v.status === 'PAYE');

    res.json({
      success: true,
      data: list,
      meta: {
        total: list.length,
        totalAmountTND: parseFloat(sumNetPayable(() => true).toFixed(3)),
        confirmedCount: confirmed.length,
        confirmedAmountTND: parseFloat(sumNetPayable((s) => s === 'CONFIRME').toFixed(3)),
        paidCount: paid.length,
        paidAmountTND: parseFloat(sumNetPayable((s) => s === 'PAYE').toFixed(3)),
      },
    });
  }

  /**
   * Décaissement d'un bordereau, gardé sous son ancien chemin.
   *
   * Un paiement ne se valide pas non plus en changeant un statut : il exige
   * le code secret de l'expéditeur, et l'écriture est conditionnée pour
   * qu'un double décaissement soit impossible.
   */
  async validatePayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Le numéro de bordereau est dans le chemin — c'est lui qui identifie
      // ce qui est décaissé. Le lire dans le corps seul revenait à l'ignorer :
      // une recherche sur un numéro absent levait une erreur de validation de
      // Prisma, et l'appel répondait 400 au lieu du 404 attendu. Le corps
      // reste accepté, pour les clients qui l'y placent encore.
      const voucherNumber =
        req.params.voucherNumber ?? (req.body as { voucherNumber?: string } | undefined)?.voucherNumber;
      const { secretCode, paymentMethod, transactionRef } = req.body ?? {};
      const result = await paymentsService.validateAndPay(
        voucherNumber,
        secretCode,
        paymentMethod,
        { id: req.user?.id, fullName: req.user?.fullName || 'Régisseur' },
        transactionRef
      );
      res.status(result.success ? 200 : result.httpStatus).json(result);
    } catch (err: unknown) {
      respondError(res, err, 'Décaissement impossible.');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Encaissements COD                                                  */
  /* ---------------------------------------------------------------- */

  async listPayments(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { status, shipperId, driverId, page, limit } = req.query as Record<string, string>;
      const result = await cashService.findAll(actorOf(req), {
        status,
        shipperId,
        driverId,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      res.json({ success: true, data: result.data, meta: result.meta });
    } catch (err: unknown) {
      respondError(res, err, 'Lecture des encaissements impossible.');
    }
  }

  async getPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const payment = await cashService.findOne(req.params.id, actorOf(req));
      res.json({ success: true, data: payment });
    } catch (err: unknown) {
      respondError(res, err, 'Encaissement introuvable.');
    }
  }

  /** Les cinq chiffres de la caisse. */
  async getSummary(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { shipperId, driverId, from, to } = req.query as Record<string, string>;
      const summary = await cashService.summary(actorOf(req), { shipperId, driverId, from, to });
      res.json({ success: true, data: summary });
    } catch (err: unknown) {
      respondError(res, err, 'Synthèse impossible.');
    }
  }

  async getByShipper(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await cashService.byShipper(actorOf(req)) });
    } catch (err: unknown) {
      respondError(res, err, 'Cumul par expéditeur impossible.');
    }
  }

  async getByDriver(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      res.json({ success: true, data: await cashService.byDriver(actorOf(req)) });
    } catch (err: unknown) {
      respondError(res, err, 'Cumul par livreur impossible.');
    }
  }

  /**
   * Validation d'un encaissement.
   *
   * Le corps ne porte que des précisions (référence, note) : ni montant, ni
   * statut. Le montant à valider est celui que le livreur a déclaré, et la
   * caisse tranche sur sa concordance — pas sur ce que l'écran lui dit.
   */
  async validatePaymentRecord(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { transactionRef, notes } = req.body ?? {};
      const payment = await cashService.validate(
        req.params.id,
        { transactionRef, notes },
        actorOf(req)
      );
      res.json({
        success: true,
        data: payment,
        message: `Encaissement ${payment.paymentNumber} validé.`,
      });
    } catch (err: unknown) {
      respondError(res, err, 'Validation impossible.');
    }
  }

  /** Écart motivé sur un encaissement dont le bilan ne se referme pas. */
  async rejectPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { reason, notes } = req.body ?? {};
      const payment = await cashService.reject(req.params.id, { reason, notes }, actorOf(req));
      res.json({
        success: true,
        data: payment,
        message: `Encaissement ${payment.paymentNumber} écarté.`,
      });
    } catch (err: unknown) {
      respondError(res, err, 'Écart impossible.');
    }
  }
}

export const paymentsController = new PaymentsController();
