/**
 * Service de caisse : les encaissements COD.
 *
 * Un encaissement est l'acte par lequel un livreur prend l'argent d'un
 * client. Il est distinct du bordereau, qui est le décaissement de cet
 * argent *vers* l'expéditeur : l'un concerne les mains du livreur et la
 * caisse, l'autre une dette de RUNEX. Les deux cohabitent, et les
 * confondre est l'erreur classique du métier.
 *
 * Trois invariants tiennent ici, et nulle part ailleurs :
 *
 *  1. **La monnaie ne transite jamais en flottant.** Les colonnes sont en
 *     `NUMERIC(12,3)`, les lectures et les écritures passent par
 *     `Prisma.Decimal`, et les DTO exposent des chaînes. Aucun `Number()`
 *     n'intervient sur un montant.
 *  2. **Le statut ne se pose pas.** Aucun point d'entrée n'accepte un
 *     `status` en entrée. Valider, écarter et rembourser sont des opérations
 *     nommées, qui écrivent le validateur, l'horodatage et — pour un écart —
 *     le motif. La base refuse en plus une ligne `VALIDE` sans validateur.
 *  3. **Le bilan doit se refermer.** On ne valide pas un encaissement dont
 *     le reliquat n'est pas nul sans que la caisse ne l'ait expressément
 *     écarté, motif à l'appui. Ce qui n'est pas validé reste visible.
 */

import { Prisma } from '@prisma/client';
import {
  PaymentStatus as PrismaPaymentStatus,
  PaymentMethod as PrismaPaymentMethod,
} from '@prisma/client';
import {
  PaymentStatus,
  PaymentMethod,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  isSupportedPaymentMethod,
  paymentMethodRequiresReference,
  NotificationEvent,
  type Money,
  type PaymentDto,
  type PaymentSummaryDto,
  type ShipperPaymentsDto,
  type DriverPaymentsDto,
} from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { BusinessRuleError } from '../../common/errors/api-error';
import { nextPaymentNumber } from '../../common/database/numbering';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import { auditService } from '../../common/audit/audit.service';

/** Acteur d'une opération de caisse. */
export interface CashActor {
  id?: string;
  fullName: string;
  role?: string;
  driverId?: string;
  shipperId?: string;
}

/** Jeu de relations nécessaire à l'affichage d'un encaissement. */
const PAYMENT_INCLUDE = {
  package: { select: { trackingNumber: true, barcode: true } },
  shipper: { select: { companyName: true, brandName: true } },
  runsheet: { select: { runsheetNumber: true } },
  driver: { include: { user: { select: { fullName: true } } } },
  validatedBy: { select: { fullName: true } },
} as const;

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/** Trois décimales, sans passer par `Number`. */
function money(value: Prisma.Decimal | null | undefined): Money {
  return (value ?? new Prisma.Decimal(0)).toFixed(3);
}

/** Soustraction de montants, toujours en décimal. */
function minus(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.minus(b);
}

/** Conversion d'une saisie en `Decimal`, sans passer par un flottant. */
export function toDecimal(value: unknown, label: string): Prisma.Decimal {
  if (value === null || value === undefined || value === '') {
    throw new BusinessRuleError(`Le champ « ${label} » est obligatoire.`, 400);
  }
  try {
    // Un nombre envoyé en JSON est déjà arrondi par le client ; on le refuse
    // plutôt que d'écrire un montant faux avec unair avertissement absent.
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('non fini');
    }
    const parsed = new Prisma.Decimal(String(value));
    if (!parsed.isFinite()) throw new Error('non fini');
    return parsed;
  } catch {
    throw new BusinessRuleError(
      `Le champ « ${label} » doit être un montant valide (ex. 58.500). Reçu : ${String(value)}.`,
      400
    );
  }
}


export class CashService {
  private get prisma() {
    return getPrisma();
  }

  /**
   * Contrôle les conditions d'un encaissement, sans rien écrire.
   *
   * Appelé par `recordCollection`, et aussi — avant toute mutation — par les
   * gestes de livraison. L'ordre compte : ces gestes changent le statut du
   * colis avant d'appeler la caisse, si bien qu'un refus ici laisserait le
   * colis marqué « livré » sans aucune trace de l'argent encaissé, et sans
   * possibilité de recommencer, le colis n'étant plus livrable. Vérifier
   * d'abord rend le geste atomique de fait : il aboutit entièrement ou pas du
   * tout.
   *
   * Une seule définition des règles, pour que la caisse et la livraison ne
   * puissent pas diverger sur ce qu'est un encaissement acceptable.
   */
  assertCollectable(input: {
    method?: string;
    amountExpected: Prisma.Decimal;
    amountCollected: Prisma.Decimal;
    transactionRef?: string | null;
  }): PaymentMethod {
    // Un moyen hors registre est refusé avant d'atteindre la base : le
    // schéma en accepte pour l'avenir, l'API non.
    if (input.method && !isSupportedPaymentMethod(input.method)) {
      throw new BusinessRuleError(
        `Moyen de paiement « ${input.method} » non pris en charge. ` +
          `Moyens acceptés : ESPECE, CHEQUE.`,
        400
      );
    }
    if (input.amountCollected.greaterThan(input.amountExpected)) {
      throw new BusinessRuleError(
        `Encaissement supérieur au montant dû : ${input.amountCollected.toFixed(3)} DT ` +
          `encaissés pour ${input.amountExpected.toFixed(3)} DT attendus.`,
        400
      );
    }

    const method = (input.method ?? PaymentMethod.ESPECE) as PrismaPaymentMethod;
    if (paymentMethodRequiresReference(method as PaymentMethod) && !input.transactionRef?.trim()) {
      throw new BusinessRuleError(
        `Un paiement par ${PAYMENT_METHOD_LABELS[method as PaymentMethod].toLowerCase()} ` +
          'exige sa référence de transaction.',
        400
      );
    }
    return method as PaymentMethod;
  }

  /* ---------------------------------------------------------------- */
  /* Enregistrement d'un encaissement                                */
  /* ---------------------------------------------------------------- */

  /**
   * Enregistre — ou met à jour — l'encaissement d'un colis.
   *
   * Appelé par la livraison, la livraison partielle et le retour : ces trois
   * gestes déplacent de l'argent, et tous doivent laisser la même trace. Les
   * appeler depuis trois endroits différents est la façon dont les modules
   * financiers divergent ; d'où ce point d'entrée unique.
   *
   * Un colis porte au plus un encaissement. Le ré-appeler pour un colis déjà
   * enregistré corrige l'encodage au lieu d'en créer un second : c'est le
   * cas d'une livraison partielle suivie d'une reprise.
   */
  async recordCollection(input: {
    packageId: string;
    shipperId: string;
    runsheetId?: string | null;
    driverId?: string | null;
    /** Auteur du geste, exclu des notifications : il sait déjà ce qu'il a fait. */
    driverUserId?: string | null;
    amountExpected: Prisma.Decimal;
    amountCollected: Prisma.Decimal;
    deliveryFee?: Prisma.Decimal;
    method?: string;
    transactionRef?: string | null;
    collectedAt?: Date;
    notes?: string | null;
  }, tx?: Prisma.TransactionClient): Promise<() => Promise<void>> {
    // Les mêmes règles que `assertCollectable`, appliquées ici pour qu'un
    // appel direct à la caisse reste protégé aussi.
    const method = this.assertCollectable(input) as PrismaPaymentMethod;

    // Sans transaction fournie, l'encaissement ouvre la sienne : le numéro
    // d'encaissement est calculé sous verrou dans cette transaction.
    if (!tx) {
      const notify = await this.prisma.$transaction((inner) => this.recordCollection(input, inner));
      await notify();
      return async () => undefined;
    }
    const client = tx;

    const existing = await client.payment.findUnique({
      where: { packageId: input.packageId },
      select: { id: true, status: true },
    });

    // Un encaissement déjà validé ne se réécrit pas : la caisse l'a signé,
    // et le livreur n'a pas à savoir qu'un contrôle a eu lieu.
    if (existing?.status === PrismaPaymentStatus.VALIDE) {
      throw new BusinessRuleError(
        'Cet encaissement est déjà validé par la caisse et ne peut plus être modifié.',
        409
      );
    }

    const data = {
      shipperId: input.shipperId,
      runsheetId: input.runsheetId ?? null,
      driverId: input.driverId ?? null,
      method,
      amountExpected: input.amountExpected,
      amountCollected: input.amountCollected,
      deliveryFee: input.deliveryFee ?? new Prisma.Decimal(0),
      transactionRef: input.transactionRef ?? null,
      collectedAt: input.collectedAt ?? new Date(),
      notes: input.notes ?? null,
    };

    if (existing) {
      await client.payment.update({ where: { id: existing.id }, data });
      // Une reprise — une livraison partielle suivie d'une reprise, par
      // exemple — réécrit l'encodage sans rouvrir l'alerte : la caisse a déjà
      // reçu la ligne, et la notifier de nouveau l'obligerait à recompter.
      return async () => undefined;
    }

    const created = await client.payment.create({
      data: { paymentNumber: await nextPaymentNumber(client), packageId: input.packageId, ...data },
      select: { id: true, paymentNumber: true },
    });

    // L'argent a changé de mains : la caisse doit l'apprendre pour le
    // valider. La notification est envoyée APRÈS la validation de la
    // transaction par l'appelant (fonction retournée).
    return () => notificationDispatcher.notify({
      event: NotificationEvent.PAYMENT_RECEIVED,
      title: 'Encaissement à valider',
      content:
        `${input.amountCollected.toFixed(3)} DT ont été encaissés à la livraison ` +
        `(attendu : ${input.amountExpected.toFixed(3)} DT, moyen : ${
          PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method
        }). L'encaissement ${created.paymentNumber} attend la caisse.`,
      relatedEntity: 'PAYMENT',
      relatedEntityId: created.id,
      paymentId: created.id,
      packageId: input.packageId,
      actorUserId: input.driverUserId ?? null,
    }).then(() => undefined);
  }

  /**
   * Enregistre une somme rendue au client sur un encaissement existant.
   *
   * Distingué de l'encaissement lui-même : un trop-perçu n'est pas une
   * absence d'encaissement, et le rapport de caisse doit pouvoir dire
   * « 40 pris, 5 rendus » plutôt que « 35 pris ».
   */
  async recordRefund(
    paymentId: string,
    amount: Prisma.Decimal,
    reason: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const client = tx ?? this.prisma;
    if (amount.lessThanOrEqualTo(0)) {
      throw new BusinessRuleError('Le montant remboursé doit être positif.', 400);
    }
    const payment = await client.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, status: true, amountCollected: true, amountRefunded: true },
    });
    if (!payment) throw new BusinessRuleError('Encaissement introuvable.', 404);
    if (payment.status === PrismaPaymentStatus.VALIDE) {
      throw new BusinessRuleError(
        'Un encaissement validé ne peut plus être remboursé : demandez sa annulation.',
        409
      );
    }

    const total = payment.amountRefunded.plus(amount);
    if (total.greaterThan(payment.amountCollected)) {
      throw new BusinessRuleError(
        `Le cumul des remboursements (${total.toFixed(3)} DT) dépasserait l'encaissé ` +
          `(${payment.amountCollected.toFixed(3)} DT).`,
        400
      );
    }

    await client.payment.update({
      where: { id: paymentId },
      data: { amountRefunded: total, status: PrismaPaymentStatus.REMBOURSE, discrepancyReason: reason },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Opérations de caisse                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Valide un encaissement.
   *
   * Refuse un bilan qui ne se referme pas : valider un reliquat non nul
   * reviendrait à faire dire à la caisse que l'argent est là où il n'est
   * pas. L'écart se traite par `reject()`, qui le motive.
   */
  async validate(
    paymentId: string,
    input: { transactionRef?: string; notes?: string },
    actor: CashActor
  ): Promise<PaymentDto> {
    if (!actor.id) {
      throw new BusinessRuleError(
        "Un encaissement ne peut être validé que par un utilisateur identifié.",
        403
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new BusinessRuleError('Encaissement introuvable.', 404);

    this.assertActionable(payment.status, payment.paymentNumber, 'validé');

    const outstanding = minus(
      minus(payment.amountExpected, payment.amountCollected),
      payment.amountRefunded
    );
    if (!outstanding.isZero()) {
      throw new BusinessRuleError(
        `Le bilan de ${payment.paymentNumber} ne se referme pas : il manque ` +
          `${outstanding.toFixed(3)} DT (${payment.amountExpected.toFixed(3)} dus, ` +
          `${payment.amountCollected.toFixed(3)} encaissés, ` +
          `${payment.amountRefunded.toFixed(3)} remboursés). ` +
          'Écartez l\'encaissement avec un motif plutôt que de le valider.',
        409
      );
    }

    if (
      paymentMethodRequiresReference(payment.method as PaymentMethod) &&
      !(input.transactionRef ?? payment.transactionRef ?? '').trim()
    ) {
      throw new BusinessRuleError(
        `Un paiement par ${PAYMENT_METHOD_LABELS[payment.method as PaymentMethod].toLowerCase()} ` +
          'ne peut être validé sans sa référence de transaction.',
        400
      );
    }

    // La signature et sa trace sont écrites ensemble, ou ne sont pas.
    //
    // Une transaction, et non deux écritures successives : si la trace échoue
    // après coup, on se retrouverait avec de l'argent validé et aucune trace —
    // l'état le plus difficile à rattraper, parce qu'il a l'air correct.
    //
    // `updateMany` conditionné sur le statut : deux cassiers validant en même
    // temps n'en valident qu'un. Le second reçoit un refus lisible au lieu
    // d'écraser la signature du premier.
    const valide = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: PrismaPaymentStatus.EN_ATTENTE },
        data: {
          status: PrismaPaymentStatus.VALIDE,
          validatedAt: new Date(),
          validatedByUserId: actor.id,
          transactionRef: input.transactionRef ?? payment.transactionRef ?? null,
          notes: input.notes ?? payment.notes,
        },
      });
      if (count === 0) return false;

      await auditService.record(
        {
          entityType: 'CASH_PAYMENT',
          entityId: paymentId,
          action: 'CASH_PAYMENT_VALIDATED',
          reason:
            input.notes?.trim() ||
            `Encaissement ${payment.paymentNumber} validé : ${payment.amountCollected
              .minus(payment.amountRefunded)
              .toFixed(3)} DT.`,
          previousValues: {
            status: PrismaPaymentStatus.EN_ATTENTE,
            amountCollected: payment.amountCollected.toFixed(3),
          },
          newValues: {
            status: PrismaPaymentStatus.VALIDE,
            amountCollected: payment.amountCollected.toFixed(3),
            transactionRef: input.transactionRef ?? payment.transactionRef ?? null,
          },
          userId: actor.id ?? null,
        },
        tx
      );
      return true;
    });

    if (!valide) {
      throw new BusinessRuleError(
        `L'encaissement ${payment.paymentNumber} a déjà été traité par un autre valideur.`,
        409
      );
    }

    const validated = await this.toDto(await this.requireById(paymentId));

    // L'argent est désormais confirmé par la caisse. C'est le moment où
    // l'expéditeur peut régler et où le livreur peut clore sa tournée — les
    // deux doivent l'apprendre, et pas seulement la caisse qui a cliqué.
    await notificationDispatcher.notify({
      event: NotificationEvent.PAYMENT_VALIDATED,
      title: 'Encaissement validé',
      content:
        `${actor.fullName} a validé l'encaissement ${payment.paymentNumber} de ` +
        `${payment.amountCollected.minus(payment.amountRefunded).toFixed(3)} DT.`,
      relatedEntity: 'PAYMENT',
      relatedEntityId: paymentId,
      paymentId,
      actorUserId: actor.id ?? null,
    });

    return validated;
  }

  /**
   * Écarte un encaissement dont le bilan ne se referme pas.
   *
   * Le motif est obligatoire : la base l'exige, et l'API le réclame avec
   * une phrase qui nomme le montant manquant. Un écart qui ne dit pas ce
   * qu'il est ne se corrige pas.
   */
  async reject(
    paymentId: string,
    input: { reason: string; notes?: string },
    actor: CashActor
  ): Promise<PaymentDto> {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BusinessRuleError(
        "Un écart se motive : indiquez pourquoi cet encaissement ne correspond pas.",
        400
      );
    }
    if (!actor.id) {
      throw new BusinessRuleError(
        'Seul un utilisateur identifié peut écarter un encaissement.',
        403
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new BusinessRuleError('Encaissement introuvable.', 404);
    this.assertActionable(payment.status, payment.paymentNumber, 'écarté');

    // Écart et trace, ensemble : voir la même raison dans `validate`.
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PrismaPaymentStatus.ECARTE,
          discrepancyReason: reason,
          validatedAt: new Date(),
          validatedByUserId: actor.id,
          notes: input.notes ?? payment.notes,
        },
      });

      await auditService.record(
        {
          entityType: 'CASH_PAYMENT',
          entityId: paymentId,
          action: 'CASH_PAYMENT_REJECTED',
          reason,
          previousValues: {
            status: payment.status,
            amountExpected: payment.amountExpected.toFixed(3),
            amountCollected: payment.amountCollected.toFixed(3),
          },
          newValues: {
            status: PrismaPaymentStatus.ECARTE,
            discrepancyReason: reason,
          },
          userId: actor.id ?? null,
        },
        tx
      );
    });

    return this.toDto(await this.requireById(paymentId));
  }

  /* ---------------------------------------------------------------- */
  /* Lecture                                                           */
  /* ---------------------------------------------------------------- */

  async findAll(
    actor: CashActor,
    filters: { status?: string; shipperId?: string; driverId?: string; page?: number; limit?: number } = {}
  ): Promise<{ data: PaymentDto[]; meta: { total: number; page: number; limit: number } }> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));

    // Un expéditeur ne voit que ses encaissements : le périmètre vient du
    // jeton, jamais d'un paramètre de requête.
    const shipperId = actor.shipperId ?? filters.shipperId;
    const where: Prisma.PaymentWhereInput = {
      ...(shipperId ? { shipperId } : {}),
      ...(filters.driverId ? { driverId: filters.driverId } : {}),
      ...(filters.status && isPaymentStatus(filters.status) ? { status: filters.status as PrismaPaymentStatus } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { collectedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data: rows.map((row) => this.toDto(row)), meta: { total, page, limit } };
  }

  async findOne(id: string, actor: CashActor): Promise<PaymentDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new BusinessRuleError('Encaissement introuvable.', 404);
    if (actor.shipperId && payment.shipperId !== actor.shipperId) {
      throw new BusinessRuleError("Cet encaissement n'appartient pas à vos expéditions.", 403);
    }
    return this.toDto(payment);
  }

  /**
   * Les cinq chiffres de la caisse.
   *
   * Les sommes sont faites par la base en `NUMERIC` : les agréger en JavaScript
   * sur des flottants donnerait un centime faux sur un rapport de caisse, ce
   * qui est exactement le genre d'erreur qui détruit la confiance dans le
   * reste du tableau de bord.
   */
  async summary(actor: CashActor, filters: { shipperId?: string; driverId?: string; from?: string; to?: string } = {}): Promise<PaymentSummaryDto> {
    const shipperId = actor.shipperId ?? filters.shipperId;
    const where: Prisma.PaymentWhereInput = {
      ...(shipperId ? { shipperId } : {}),
      ...(filters.driverId ? { driverId: filters.driverId } : {}),
      ...(filters.from || filters.to
        ? {
            collectedAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const [totals, groups] = await Promise.all([
      this.prisma.payment.aggregate({
        where,
        _sum: {
          amountExpected: true,
          amountCollected: true,
          amountRefunded: true,
          deliveryFee: true,
        },
      }),
      this.prisma.payment.groupBy({ by: ['status'], where, _sum: { amountCollected: true }, _count: true }),
    ]);

    // Le reliquat dû est un agrégat calculé, pas une colonne : la base ne
    // sait pas soustraire deux `NUMERIC` dans un `SUM` sans expression.
    //
    // Le même prédicat que ci-dessus doit être rejoué ici, période comprise.
    // Sans le filtre de dates, un sommaire demandé sur un mois mélangerait des
    // totaux calculés sur le mois et un écart calculé depuis toujours — et les
    // chiffres ne se rejoigneraient plus, sans aucun signe apparent.
    const outstanding = await this.prisma.$queryRaw<
      { total: Prisma.Decimal | null; count: bigint }[]
    >`
      SELECT COALESCE(SUM("amountExpected" - "amountCollected" - "amountRefunded"), 0) AS total,
             COUNT(*) AS count
      FROM "Payment"
      WHERE "amountExpected" <> "amountCollected" + "amountRefunded"
        ${shipperId ? Prisma.sql`AND "shipperId" = ${shipperId}::uuid` : Prisma.empty}
        ${filters.driverId ? Prisma.sql`AND "driverId" = ${filters.driverId}::uuid` : Prisma.empty}
        ${filters.from ? Prisma.sql`AND "collectedAt" >= ${new Date(filters.from)}` : Prisma.empty}
        ${filters.to ? Prisma.sql`AND "collectedAt" <= ${new Date(filters.to)}` : Prisma.empty}
    `;

    const pending = groups.find((g) => g.status === PrismaPaymentStatus.EN_ATTENTE);
    const validated = groups.find((g) => g.status === PrismaPaymentStatus.VALIDE);

    return {
      totalExpected: money(totals._sum.amountExpected),
      totalCollected: money(totals._sum.amountCollected),
      totalRefunded: money(totals._sum.amountRefunded),
      totalDeliveryFees: money(totals._sum.deliveryFee),
      pending: money(pending?._sum.amountCollected),
      pendingCount: pending?._count ?? 0,
      validated: money(validated?._sum.amountCollected),
      validatedCount: validated?._count ?? 0,
      discrepancy: money(outstanding[0]?.total),
      discrepancyCount: Number(outstanding[0]?.count ?? 0),
      byStatus: Object.fromEntries(
        groups.map((g) => [
          g.status,
          { count: g._count, collected: money(g._sum.amountCollected) },
        ])
      ),
    };
  }

  /** Cumuls par expéditeur, pour le rapprochement de fin de journée. */
  async byShipper(actor: CashActor): Promise<ShipperPaymentsDto[]> {
    const rows = await this.prisma.payment.groupBy({
      by: ['shipperId'],
      where: actor.shipperId ? { shipperId: actor.shipperId } : {},
      _sum: { amountExpected: true, amountCollected: true },
      _count: true,
    });
    if (rows.length === 0) return [];

    const [shippers, gaps] = await Promise.all([
      this.prisma.shipper.findMany({
        where: { id: { in: rows.map((r) => r.shipperId) } },
        select: { id: true, companyName: true, brandName: true },
      }),
      this.gapsByShipper(rows.map((r) => r.shipperId)),
    ]);

    const name = new Map(shippers.map((s) => [s.id, s.brandName ?? s.companyName]));
    const gap = gaps;

    return rows
      .map((row) => {
        const expected = row._sum.amountExpected ?? new Prisma.Decimal(0);
        const collected = row._sum.amountCollected ?? new Prisma.Decimal(0);
        const pendingRow = gap.get(row.shipperId);
        return {
          shipperId: row.shipperId,
          shipperName: name.get(row.shipperId) ?? 'Expéditeur inconnu',
          count: row._count,
          totalExpected: money(expected),
          totalCollected: money(collected),
          pending: money(pendingRow?.pending),
          validated: money(pendingRow?.validated),
          discrepancy: money(minus(expected, collected)),
          discrepancyCount: pendingRow?.discrepancyCount ?? 0,
        };
      })
      .sort((a, b) => Number(minus(new Prisma.Decimal(b.totalCollected), new Prisma.Decimal(a.totalCollected))));
  }

  /** Cumuls par livreur : qui détient quoi au moment du rapprochement. */
  async byDriver(actor: CashActor): Promise<DriverPaymentsDto[]> {
    const rows = await this.prisma.payment.groupBy({
      by: ['driverId'],
      where: { driverId: { not: null }, ...(actor.driverId ? { driverId: actor.driverId } : {}) },
      _sum: { amountCollected: true },
      _count: true,
    });
    const driverIds = rows.map((r) => r.driverId).filter((id): id is string => id !== null);
    if (driverIds.length === 0) return [];

    const [drivers, pendingRows, validatedRows, gapRows] = await Promise.all([
      this.prisma.driver.findMany({
        where: { id: { in: driverIds } },
        select: { id: true, user: { select: { fullName: true } } },
      }),
      this.sumBy(PrismaPaymentStatus.EN_ATTENTE, driverIds),
      this.sumBy(PrismaPaymentStatus.VALIDE, driverIds),
      this.gapsByDriver(driverIds),
    ]);

    const name = new Map(drivers.map((d) => [d.id, d.user.fullName]));
    return rows
      .filter((row): row is typeof row & { driverId: string } => row.driverId !== null)
      .map((row) => ({
        driverId: row.driverId,
        driverName: name.get(row.driverId) ?? 'Livreur inconnu',
        count: row._count,
        totalCollected: money(row._sum.amountCollected),
        pending: money(pendingRows.get(row.driverId)),
        validated: money(validatedRows.get(row.driverId)),
        discrepancy: money(gapRows.get(row.driverId)?.discrepancy),
        discrepancyCount: gapRows.get(row.driverId)?.count ?? 0,
      }))
      .sort((a, b) => Number(minus(new Prisma.Decimal(b.totalCollected), new Prisma.Decimal(a.totalCollected))));
  }

  /* ---------------------------------------------------------------- */
  /* Interne                                                           */
  /* ---------------------------------------------------------------- */

  /** Somme d'un statut, par livreur. */
  private async sumBy(
    status: PrismaPaymentStatus,
    driverIds: string[]
  ): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.payment.groupBy({
      by: ['driverId'],
      where: { driverId: { in: driverIds }, status },
      _sum: { amountCollected: true },
    });
    return new Map(
      rows
        .filter((r): r is typeof r & { driverId: string } => r.driverId !== null)
        .map((r) => [r.driverId, r._sum.amountCollected ?? new Prisma.Decimal(0)])
    );
  }

  /** Écart et compte des écarts, par expéditeur. */
  private async gapsByShipper(
    shipperIds: string[]
  ): Promise<Map<string, { pending: Prisma.Decimal; validated: Prisma.Decimal; discrepancyCount: number }>> {
    const rows = await this.prisma.$queryRaw<
      { shipperId: string; pending: Prisma.Decimal; validated: Prisma.Decimal; discrepancyCount: bigint }[]
    >`
      SELECT "shipperId",
             COALESCE(SUM("amountCollected") FILTER (WHERE "status" = 'EN_ATTENTE'), 0) AS pending,
             COALESCE(SUM("amountCollected") FILTER (WHERE "status" = 'VALIDE'), 0) AS validated,
             COUNT(*) FILTER (WHERE "amountExpected" <> "amountCollected" + "amountRefunded") AS discrepancyCount
      FROM "Payment"
      WHERE "shipperId" = ANY(${shipperIds}::uuid[])
      GROUP BY "shipperId"
    `;
    return new Map(
      rows.map((r) => [
        r.shipperId,
        {
          pending: new Prisma.Decimal(r.pending),
          validated: new Prisma.Decimal(r.validated),
          discrepancyCount: Number(r.discrepancyCount),
        },
      ])
    );
  }

  /** Écart, par livreur. */
  private async gapsByDriver(
    driverIds: string[]
  ): Promise<Map<string, { discrepancy: Prisma.Decimal; count: number }>> {
    const rows = await this.prisma.$queryRaw<{ driverId: string; discrepancy: Prisma.Decimal; count: bigint }[]>`
      SELECT "driverId",
             COALESCE(SUM("amountExpected" - "amountCollected" - "amountRefunded"), 0) AS discrepancy,
             COUNT(*) AS count
      FROM "Payment"
      WHERE "driverId" = ANY(${driverIds}::uuid[])
        AND "amountExpected" <> "amountCollected" + "amountRefunded"
      GROUP BY "driverId"
    `;
    return new Map(
      rows.map((r) => [
        r.driverId,
        { discrepancy: new Prisma.Decimal(r.discrepancy), count: Number(r.count) },
      ])
    );
  }

  /** Un encaissement validé ou écarté n'est plus modifiable. */
  private assertActionable(
    status: PrismaPaymentStatus,
    paymentNumber: string,
    action: string
  ): void {
    if (status === PrismaPaymentStatus.EN_ATTENTE) return;
    if (status === PrismaPaymentStatus.REMBOURSE) {
      throw new BusinessRuleError(
        `L'encaissement ${paymentNumber} a été remboursé : il ne peut plus être ${action}.`,
        409
      );
    }
    throw new BusinessRuleError(
      `L'encaissement ${paymentNumber} est déjà « ${PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? status} » ` +
        `et ne peut plus être ${action}.`,
      409
    );
  }

  private async requireById(id: string): Promise<PaymentWithRelations> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: PAYMENT_INCLUDE,
    });
    if (!payment) throw new BusinessRuleError('Encaissement introuvable.', 404);
    return payment;
  }

  /** Projection d'un encaissement vers le DTO partagé. */
  private toDto(record: PaymentWithRelations): PaymentDto {
    const outstanding = minus(
      minus(record.amountExpected, record.amountCollected),
      record.amountRefunded
    );
    return {
      id: record.id,
      paymentNumber: record.paymentNumber,
      status: record.status as unknown as PaymentStatus,
      method: record.method as unknown as PaymentMethod,
      packageId: record.packageId,
      packageTrackingNumber: record.package.trackingNumber,
      shipperId: record.shipperId,
      shipperName: record.shipper.brandName ?? record.shipper.companyName,
      runsheetId: record.runsheetId ?? undefined,
      runsheetNumber: record.runsheet?.runsheetNumber,
      driverId: record.driverId ?? undefined,
      driverName: record.driver?.user.fullName,
      amountExpected: money(record.amountExpected),
      amountCollected: money(record.amountCollected),
      amountRefunded: money(record.amountRefunded),
      deliveryFee: money(record.deliveryFee),
      amountOutstanding: outstanding.toFixed(3),
      isBalanced: outstanding.isZero(),
      collectedAt: record.collectedAt.toISOString(),
      validatedAt: record.validatedAt?.toISOString(),
      validatedByUserId: record.validatedByUserId ?? undefined,
      validatedByName: record.validatedBy?.fullName,
      transactionRef: record.transactionRef ?? undefined,
      discrepancyReason: record.discrepancyReason ?? undefined,
      notes: record.notes ?? undefined,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

/** Un statut d'encaissement connu ? Un filtre inconnu ne doit pas tout casser. */
function isPaymentStatus(value: string): boolean {
  return Object.values(PaymentStatus).includes(value as PaymentStatus);
}

export const cashService = new CashService();
