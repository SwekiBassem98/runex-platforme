/**
 * Caisse de la société.
 *
 * Répond aux questions du gérant, sur une période :
 *  - combien a été encaissé (COD), combien est validé par la caisse ;
 *  - combien la société a gagné (frais de livraison et de retour) ;
 *  - combien est dû aux expéditeurs, combien leur a été réglé ;
 *  - combien coûtent les livreurs (3 DT par colis livré ou ramassage effectué),
 *    combien leur a été payé, combien reste à payer à chacun ;
 *  - la marge nette (frais − rémunération des livreurs).
 *
 * Tous les montants sont calculés en base (SQL), jamais sur une liste
 * tronquée. Les paiements des livreurs sont enregistrés (`DriverPayout`) :
 * « reste à payer » = gagné depuis toujours − payé depuis toujours.
 */

import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { asUuid, badRequest, conflict, notFound } from '../../common/errors/api-error';
import { periode, type Periode } from '../../common/dates/periode';

/** Rémunération d'un livreur par colis livré ou par ramassage effectué (DT). */
export const TARIF_LIVREUR = (() => {
  const v = Number(process.env.DRIVER_RATE_PER_JOB ?? 3);
  return Number.isFinite(v) && v >= 0 ? v : 3;
})();

const LIVRES = ['LIVRE', 'LIVRAISON_PARTIELLE'];
const n = (v: unknown) => Number(v ?? 0) || 0;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface ResumeCaisse {
  periode: { from: string | null; to: string | null };
  tarifLivreur: number;
  encaisse: number;
  encaisseValide: number;
  encaisseEnAttente: number;
  colisLivres: number;
  colisRetournes: number;
  fraisLivraison: number;
  fraisRetour: number;
  netExpediteurs: number;
  payeExpediteurs: number;
  resteExpediteurs: number;
  ramassagesEffectues: number;
  remunerationLivreurs: number;
  payeLivreurs: number;
  resteLivreurs: number;
  margeNette: number;
}

export interface LigneLivreur {
  driverId: string;
  driverCode: string;
  fullName: string;
  depositName: string | null;
  livres: number;
  ramassages: number;
  gainPeriode: number;
  encaissePeriode: number;
  especesNonValidees: number;
  totalGagne: number;
  totalPaye: number;
  resteAPayer: number;
  dernierPaiement: string | null;
}

function bornes(from?: string, to?: string): Periode {
  const p = periode(from, to);
  return p ?? {};
}

function sqlPeriode(colonne: Prisma.Sql, p: Periode): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (p.gte) parts.push(Prisma.sql`${colonne} >= ${p.gte}`);
  if (p.lt) parts.push(Prisma.sql`${colonne} < ${p.lt}`);
  return parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
}

export class CaisseService {
  async resume(from?: string, to?: string): Promise<ResumeCaisse> {
    const prisma = getPrisma();
    const p = bornes(from, to);

    const [paiements, livraisons, retours, vouchersPayes, vouchersOuverts, horsBordereau, ramassages, payouts, gagneTotal, payeTotal] =
      await Promise.all([
        prisma.$queryRaw<{ total: Prisma.Decimal | null; valide: Prisma.Decimal | null; attente: Prisma.Decimal | null }[]>`
          SELECT sum("amountCollected" - "amountRefunded") AS total,
                 sum("amountCollected" - "amountRefunded") FILTER (WHERE status = 'VALIDE') AS valide,
                 sum("amountCollected" - "amountRefunded") FILTER (WHERE status = 'EN_ATTENTE') AS attente
          FROM "Payment"
          WHERE status <> 'ANNULE' AND ${sqlPeriode(Prisma.sql`"collectedAt"`, p)}`,
        // Net expéditeurs : ce qui a été encaissé pour ces colis (à défaut, le
        // montant à encaisser), moins les frais de livraison de la société.
        prisma.$queryRaw<{ nb: bigint; frais: Prisma.Decimal | null; net: Prisma.Decimal | null }[]>`
          SELECT count(*) AS nb, sum(p."deliveryFee") AS frais,
                 sum(COALESCE(pay.recu, p."totalPrice") - p."deliveryFee") AS net
          FROM "Package" p
          LEFT JOIN (SELECT "packageId", sum("amountCollected" - "amountRefunded") AS recu
                     FROM "Payment" WHERE status <> 'ANNULE' GROUP BY "packageId") pay ON pay."packageId" = p.id
          WHERE p."deletedAt" IS NULL AND p.status::text IN (${Prisma.join(LIVRES)})
            AND ${sqlPeriode(Prisma.sql`p."deliveredAt"`, p)}`,
        prisma.$queryRaw<{ nb: bigint; frais: Prisma.Decimal | null }[]>`
          SELECT count(*) AS nb, sum("returnFee") AS frais FROM "Package"
          WHERE "deletedAt" IS NULL AND status = 'RETOURNE_EXPEDITEUR'
            AND ${sqlPeriode(Prisma.sql`"updatedAt"`, p)}`,
        prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
          SELECT sum("netPayable") AS total FROM "PaymentVoucher"
          WHERE status = 'PAYE' AND ${sqlPeriode(Prisma.sql`"paidAt"`, p)}`,
        prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
          SELECT sum("netPayable") AS total FROM "PaymentVoucher" WHERE status IN ('EN_ATTENTE', 'CONFIRME')`,
        // Livré et encaissé, pas encore dans un bordereau : dû à l'expéditeur.
        prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
          SELECT sum(pay."amountCollected" - pay."amountRefunded" - p."deliveryFee") AS total
          FROM "Package" p JOIN "Payment" pay ON pay."packageId" = p.id
          WHERE p."deletedAt" IS NULL AND p."paymentVoucherId" IS NULL
            AND p.status::text IN (${Prisma.join(LIVRES)}) AND pay.status IN ('VALIDE', 'EN_ATTENTE')`,
        prisma.$queryRaw<{ nb: bigint }[]>`
          SELECT count(*) AS nb FROM "PickupAppointment"
          WHERE status = 'EFFECTUE' AND "assignedDriverId" IS NOT NULL AND ${sqlPeriode(Prisma.sql`"completedAt"`, p)}`,
        prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`
          SELECT sum(amount) AS total FROM "DriverPayout" WHERE ${sqlPeriode(Prisma.sql`"paidAt"`, p)}`,
        this.gagneParLivreur(),
        prisma.$queryRaw<{ total: Prisma.Decimal | null }[]>`SELECT sum(amount) AS total FROM "DriverPayout"`,
      ]);

    const encaisse = r3(n(paiements[0]?.total));
    const fraisLivraison = r3(n(livraisons[0]?.frais));
    const fraisRetour = r3(n(retours[0]?.frais));
    const colisLivresPeriode = n(livraisons[0]?.nb);
    const livresAvecLivreur = await prisma.package.count({
      where: {
        deletedAt: null,
        status: { in: LIVRES as never },
        assignedDriverId: { not: null },
        ...(p.gte || p.lt ? { deliveredAt: { ...(p.gte ? { gte: p.gte } : {}), ...(p.lt ? { lt: p.lt } : {}) } } : {}),
      },
    });
    const ramassagesEffectues = n(ramassages[0]?.nb);
    const remunerationLivreurs = r3((livresAvecLivreur + ramassagesEffectues) * TARIF_LIVREUR);
    const totalGagne = [...gagneTotal.values()].reduce((s, v) => s + v.gain, 0);

    return {
      periode: { from: from ?? null, to: to ?? null },
      tarifLivreur: TARIF_LIVREUR,
      encaisse,
      encaisseValide: r3(n(paiements[0]?.valide)),
      encaisseEnAttente: r3(n(paiements[0]?.attente)),
      colisLivres: colisLivresPeriode,
      colisRetournes: n(retours[0]?.nb),
      fraisLivraison,
      fraisRetour,
      netExpediteurs: r3(n(livraisons[0]?.net)),
      payeExpediteurs: r3(n(vouchersPayes[0]?.total)),
      resteExpediteurs: r3(n(vouchersOuverts[0]?.total) + n(horsBordereau[0]?.total)),
      ramassagesEffectues,
      remunerationLivreurs,
      payeLivreurs: r3(n(payouts[0]?.total)),
      resteLivreurs: r3(Math.max(totalGagne - n(payeTotal[0]?.total), 0)),
      margeNette: r3(fraisLivraison + fraisRetour - remunerationLivreurs),
    };
  }

  /** Gains depuis toujours, par livreur : (colis livrés + ramassages) × tarif. */
  private async gagneParLivreur(driverId?: string): Promise<Map<string, { livres: number; ramassages: number; gain: number }>> {
    const prisma = getPrisma();
    const filtre = driverId ? Prisma.sql`AND d.id = ${driverId}::uuid` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ id: string; livres: bigint; ramassages: bigint }[]>`
      SELECT d.id::text AS id,
        (SELECT count(*) FROM "Package" p WHERE p."assignedDriverId" = d.id AND p."deletedAt" IS NULL
           AND p.status::text IN (${Prisma.join(LIVRES)})) AS livres,
        (SELECT count(*) FROM "PickupAppointment" r WHERE r."assignedDriverId" = d.id AND r.status = 'EFFECTUE') AS ramassages
      FROM "Driver" d WHERE d."deletedAt" IS NULL ${filtre}`;
    return new Map(
      rows.map((r) => {
        const livres = n(r.livres);
        const ramassages = n(r.ramassages);
        return [r.id, { livres, ramassages, gain: r3((livres + ramassages) * TARIF_LIVREUR) }];
      })
    );
  }

  async livreurs(from?: string, to?: string): Promise<LigneLivreur[]> {
    const prisma = getPrisma();
    const p = bornes(from, to);
    const [drivers, gagne, periodeRows, payes] = await Promise.all([
      prisma.driver.findMany({
        where: { deletedAt: null },
        select: { id: true, driverCode: true, user: { select: { fullName: true, deposit: { select: { name: true } } } } },
        orderBy: { driverCode: 'asc' },
      }),
      this.gagneParLivreur(),
      prisma.$queryRaw<{ id: string; livres: bigint; ramassages: bigint; encaisse: Prisma.Decimal | null; attente: Prisma.Decimal | null }[]>`
        SELECT d.id::text AS id,
          (SELECT count(*) FROM "Package" x WHERE x."assignedDriverId" = d.id AND x."deletedAt" IS NULL
             AND x.status::text IN (${Prisma.join(LIVRES)}) AND ${sqlPeriode(Prisma.sql`x."deliveredAt"`, p)}) AS livres,
          (SELECT count(*) FROM "PickupAppointment" r WHERE r."assignedDriverId" = d.id AND r.status = 'EFFECTUE'
             AND ${sqlPeriode(Prisma.sql`r."completedAt"`, p)}) AS ramassages,
          (SELECT sum(y."amountCollected" - y."amountRefunded") FROM "Payment" y WHERE y."driverId" = d.id
             AND y.status <> 'ANNULE' AND ${sqlPeriode(Prisma.sql`y."collectedAt"`, p)}) AS encaisse,
          (SELECT sum(y."amountCollected" - y."amountRefunded") FROM "Payment" y WHERE y."driverId" = d.id
             AND y.status = 'EN_ATTENTE') AS attente
        FROM "Driver" d WHERE d."deletedAt" IS NULL`,
      prisma.driverPayout.groupBy({ by: ['driverId'], _sum: { amount: true }, _max: { paidAt: true } }),
    ]);
    const parId = new Map(periodeRows.map((r) => [r.id, r]));
    const payeParId = new Map(payes.map((x) => [x.driverId, x]));
    return drivers.map((d) => {
      const g = gagne.get(d.id) ?? { livres: 0, ramassages: 0, gain: 0 };
      const per = parId.get(d.id);
      const paye = n(payeParId.get(d.id)?._sum.amount);
      const livres = n(per?.livres);
      const ramassages = n(per?.ramassages);
      return {
        driverId: d.id,
        driverCode: d.driverCode,
        fullName: d.user.fullName,
        depositName: d.user.deposit?.name ?? null,
        livres,
        ramassages,
        gainPeriode: r3((livres + ramassages) * TARIF_LIVREUR),
        encaissePeriode: r3(n(per?.encaisse)),
        especesNonValidees: r3(n(per?.attente)),
        totalGagne: g.gain,
        totalPaye: r3(paye),
        resteAPayer: r3(Math.max(g.gain - paye, 0)),
        dernierPaiement: payeParId.get(d.id)?._max.paidAt?.toISOString() ?? null,
      };
    });
  }

  /** Historique des paiements d'un livreur. */
  async paiementsLivreur(driverId: string) {
    const id = asUuid(driverId);
    if (!id) throw badRequest('Identifiant de livreur invalide.');
    const rows = await getPrisma().driverPayout.findMany({ where: { driverId: id }, orderBy: { paidAt: 'desc' }, take: 100 });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      amount: n(r.amount),
      deliveredCount: r.deliveredCount,
      pickupCount: r.pickupCount,
      note: r.note,
      paidAt: r.paidAt.toISOString(),
    }));
  }

  /**
   * Paie un livreur : par défaut tout son reste à payer. Un montant supérieur
   * au reste est refusé (pas d'avance sur gains non réalisés).
   */
  async payerLivreur(driverId: string, body: { amount?: unknown; note?: unknown }, actor: { id?: string | null; fullName?: string }) {
    const prisma = getPrisma();
    const id = asUuid(driverId);
    if (!id) throw badRequest('Identifiant de livreur invalide.');
    const driver = await prisma.driver.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, driverCode: true, user: { select: { fullName: true, id: true } } },
    });
    if (!driver) throw notFound('Livreur introuvable.');

    return prisma.$transaction(async (tx) => {
      // Verrou du livreur : deux paiements simultanés ne paient pas deux fois.
      await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${id}::uuid FOR UPDATE`;
      const gagne = (await this.gagneParLivreur(id)).get(id) ?? { livres: 0, ramassages: 0, gain: 0 };
      const dejaPaye = n((await tx.driverPayout.aggregate({ where: { driverId: id }, _sum: { amount: true } }))._sum.amount);
      const reste = r3(Math.max(gagne.gain - dejaPaye, 0));
      const demande = body.amount === undefined || body.amount === null || body.amount === '' ? reste : Number(body.amount);
      if (!Number.isFinite(demande) || demande <= 0) {
        throw badRequest(reste > 0 ? 'Montant invalide.' : 'Rien à payer : ce livreur a déjà reçu tout ce qu’il a gagné.');
      }
      if (demande > reste + 0.0005) {
        throw conflict(`Le montant dépasse le reste à payer (${reste.toFixed(3)} DT).`);
      }
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 255) || null : null;
      const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date()).replace(/-/g, '');
      const duJour = await tx.driverPayout.count({ where: { reference: { startsWith: `PAI-LIV-${jour}-` } } });
      const payout = await tx.driverPayout.create({
        data: {
          reference: `PAI-LIV-${jour}-${String(duJour + 1).padStart(4, '0')}`,
          driverId: id,
          amount: new Prisma.Decimal(demande.toFixed(3)),
          deliveredCount: gagne.livres,
          pickupCount: gagne.ramassages,
          note,
          paidByUserId: actor.id ?? null,
        },
      });
      await auditService.record(
        {
          entityType: 'DRIVER',
          entityId: id,
          action: 'DRIVER_PAYE',
          userId: actor.id ?? null,
          reason: `Livreur ${driver.driverCode} (${driver.user.fullName}) payé ${demande.toFixed(3)} DT — ${payout.reference}.`,
          newValues: { reference: payout.reference, amount: demande, resteAvant: reste },
        },
        tx
      );
      return {
        reference: payout.reference,
        amount: r3(demande),
        resteAPayer: r3(reste - demande),
        driver: { id, driverCode: driver.driverCode, fullName: driver.user.fullName, userId: driver.user.id },
      };
    });
  }

  /** Gains du livreur connecté (application mobile). */
  async gainsLivreur(driverId: string) {
    const prisma = getPrisma();
    const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const mois = `${jour.slice(0, 8)}01`;
    const [aujourdhui, ceMois] = await Promise.all([this.compter(driverId, jour), this.compter(driverId, mois)]);
    const gagne = (await this.gagneParLivreur(driverId)).get(driverId) ?? { livres: 0, ramassages: 0, gain: 0 };
    const paye = await prisma.driverPayout.aggregate({ where: { driverId }, _sum: { amount: true }, _max: { paidAt: true } });
    return {
      tarif: TARIF_LIVREUR,
      aujourdhui,
      ceMois,
      totalGagne: gagne.gain,
      totalPaye: r3(n(paye._sum.amount)),
      resteAPayer: r3(Math.max(gagne.gain - n(paye._sum.amount), 0)),
      dernierPaiement: paye._max.paidAt?.toISOString() ?? null,
    };
  }

  private async compter(driverId: string, depuis: string) {
    const p = bornes(depuis);
    const prisma = getPrisma();
    const [livres, ramassages] = await Promise.all([
      prisma.package.count({
        where: { assignedDriverId: driverId, deletedAt: null, status: { in: LIVRES as never }, deliveredAt: p },
      }),
      prisma.pickupAppointment.count({ where: { assignedDriverId: driverId, status: 'EFFECTUE', completedAt: p } }),
    ]);
    return { livres, ramassages, gain: r3((livres + ramassages) * TARIF_LIVREUR) };
  }
}

export const caisseService = new CaisseService();
