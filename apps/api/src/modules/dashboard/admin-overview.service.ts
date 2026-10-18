/**
 * Vue d'ensemble du tableau de bord administrateur — `GET /dashboard?days=`.
 *
 * Complète les compteurs historiques de `DashboardService.getMetrics` (gardés
 * tels quels pour les clients existants) par ce dont l'écran a besoin pour
 * raconter la journée et la période :
 *
 *   - aujourd'hui (créés, livrés, en route, ramassages du jour) ;
 *   - la période choisie (7, 14, 30 ou 90 jours) et la précédente, pour les
 *     tendances ;
 *   - la courbe jour par jour (créés, livrés, échecs, encaissé) ;
 *   - le parcours des colis en cours, étape par étape ;
 *   - le classement réel des livreurs et des expéditeurs sur la période
 *     (et non plus les six premiers par ordre alphabétique) ;
 *   - le stock de chaque agence ;
 *   - l'argent : à encaisser chez les clients, espèces chez les livreurs.
 *
 * Tout est agrégé en SQL. Les jours sont ceux de Tunis (`Africa/Tunis`).
 * Un agent de dépôt ne voit que son dépôt (`depositId`).
 */

import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { isDriverOnline } from '../presence/presence.service';

const TZ = 'Africa/Tunis';

export const PERIODES_ADMIN = [7, 14, 30, 90] as const;

/** Étapes du parcours, dans l'ordre, et les statuts qu'elles regroupent. */
export const ETAPES_ADMIN = {
  preparation: ['CREE', 'RAMASSAGE_PROGRAMME'],
  collecte: ['RAMASSE'],
  depot: ['RECU_DEPOT', 'RECU_DEPOT_DESTINATION'],
  transit: ['EN_LOT_INTER_DEPOT', 'EN_TRANSIT_INTER_DEPOT'],
  livraison: ['AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON'],
  reporte: ['REPORTE'],
  retour: ['ECHEC_LIVRAISON', 'RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR'],
} as const;

const LIVRES = ['LIVRE', 'LIVRAISON_PARTIELLE'];
const ECHECS = ['ECHEC_LIVRAISON', 'RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'RETOURNE_EXPEDITEUR'];
const TERMINES = [...LIVRES, 'RETOURNE_EXPEDITEUR', 'ANNULE'];
const TENTATIVES_REUSSIES = ['REUSSIE', 'LIVRAISON_PARTIELLE'];

export interface AdminOverview {
  generatedAt: string;
  periodDays: number;
  today: { created: number; delivered: number; outForDelivery: number; pickups: number; pickupsDone: number };
  period: {
    created: number;
    delivered: number;
    failed: number;
    successRate: number | null;
    avgDeliveryHours: number | null;
    collected: number;
    fees: number;
  };
  previous: { created: number; delivered: number; failed: number; collected: number; successRate: number | null };
  active: number;
  pipeline: Record<keyof typeof ETAPES_ADMIN, number>;
  daily: { date: string; created: number; delivered: number; failed: number; collected: number }[];
  topDrivers: {
    id: string;
    code: string;
    name: string;
    delivered: number;
    failed: number;
    successRate: number | null;
    cash: number;
    online: boolean;
    onRun: boolean;
  }[];
  topShippers: {
    id: string;
    name: string;
    governorate: string;
    created: number;
    delivered: number;
    returned: number;
    amount: number;
  }[];
  agencies: {
    id: string;
    name: string;
    governorate: string;
    isMainHub: boolean;
    inStock: number;
    toAssign: number;
    returns: number;
    outForDelivery: number;
    incoming: number;
  }[];
  money: { codInProgress: number; codInProgressCount: number; cashWithDrivers: number; driversWithCash: number };
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const taux = (ok: number, ko: number) => (ok + ko > 0 ? Math.round((ok / (ok + ko)) * 1000) / 10 : null);

export async function getAdminOverview(periodDays = 14, depositId?: string): Promise<AdminOverview> {
  const prisma = getPrisma();
  const days = (PERIODES_ADMIN as readonly number[]).includes(periodDays) ? periodDays : 14;

  const debut = Prisma.sql`((date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${days - 1}::int)) AT TIME ZONE ${TZ})`;
  const debutPrecedent = Prisma.sql`((date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${2 * days - 1}::int)) AT TIME ZONE ${TZ})`;
  const aujourdhui = Prisma.sql`(date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})`;

  const dep = depositId ? Prisma.sql`${depositId}::uuid` : null;
  const portee = dep
    ? Prisma.sql`AND (p."currentDepositId" = ${dep} OR p."originDepositId" = ${dep} OR p."destinationDepositId" = ${dep})`
    : Prisma.empty;
  const porteeLivreur = dep ? Prisma.sql`AND u."depositId" = ${dep}` : Prisma.empty;
  const porteeAgence = dep ? Prisma.sql`AND d."id" = ${dep}` : Prisma.empty;
  const liste = (valeurs: readonly string[]) => Prisma.join(valeurs as string[]);

  const [statusRows, periodRows, dailyRows, attemptRows, driverRows, shipperRows, agencyRows, pickupRows, busy] =
    await Promise.all([
      prisma.$queryRaw<{ status: string; total: bigint; cod: Prisma.Decimal | null }[]>`
        SELECT p."status"::text AS status, count(*) AS total, sum(p."totalPrice") AS cod
        FROM "Package" p
        WHERE p."deletedAt" IS NULL ${portee}
        GROUP BY p."status"`,
      prisma.$queryRaw<
        {
          created: bigint;
          delivered: bigint;
          failed: bigint;
          avg_hours: number | null;
          collected: Prisma.Decimal | null;
          fees: Prisma.Decimal | null;
          prev_created: bigint;
          prev_delivered: bigint;
          prev_failed: bigint;
          prev_collected: Prisma.Decimal | null;
          today_created: bigint;
          today_delivered: bigint;
        }[]
      >`
        SELECT
          count(*) FILTER (WHERE p."createdAt" >= ${debut}) AS created,
          count(*) FILTER (WHERE p."status"::text IN (${liste(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS delivered,
          count(*) FILTER (WHERE p."status"::text IN (${liste(ECHECS)}) AND p."updatedAt" >= ${debut}) AS failed,
          avg(EXTRACT(EPOCH FROM (p."deliveredAt" - p."createdAt")) / 3600.0)
            FILTER (WHERE p."status"::text IN (${liste(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS avg_hours,
          sum(p."collectedAmount") FILTER (WHERE p."status"::text IN (${liste(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS collected,
          sum(p."deliveryFee") FILTER (WHERE p."status"::text IN (${liste(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS fees,
          count(*) FILTER (WHERE p."createdAt" >= ${debutPrecedent} AND p."createdAt" < ${debut}) AS prev_created,
          count(*) FILTER (WHERE p."status"::text IN (${liste(LIVRES)}) AND p."deliveredAt" >= ${debutPrecedent} AND p."deliveredAt" < ${debut}) AS prev_delivered,
          count(*) FILTER (WHERE p."status"::text IN (${liste(ECHECS)}) AND p."updatedAt" >= ${debutPrecedent} AND p."updatedAt" < ${debut}) AS prev_failed,
          sum(p."collectedAmount") FILTER (WHERE p."status"::text IN (${liste(LIVRES)}) AND p."deliveredAt" >= ${debutPrecedent} AND p."deliveredAt" < ${debut}) AS prev_collected,
          count(*) FILTER (WHERE p."createdAt" >= ${aujourdhui}) AS today_created,
          count(*) FILTER (WHERE p."status"::text IN (${liste(LIVRES)}) AND p."deliveredAt" >= ${aujourdhui}) AS today_delivered
        FROM "Package" p
        WHERE p."deletedAt" IS NULL ${portee}`,
      prisma.$queryRaw<{ day: string; created: bigint; delivered: bigint; collected: Prisma.Decimal | null }[]>`
        WITH jours AS (
          SELECT generate_series(
            date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${days - 1}::int),
            date_trunc('day', now() AT TIME ZONE ${TZ}),
            interval '1 day'
          )::date AS day
        ),
        crees AS (
          SELECT (p."createdAt" AT TIME ZONE ${TZ})::date AS day, count(*) AS n
          FROM "Package" p
          WHERE p."deletedAt" IS NULL AND p."createdAt" >= ${debut} ${portee}
          GROUP BY 1
        ),
        livres AS (
          SELECT (p."deliveredAt" AT TIME ZONE ${TZ})::date AS day, count(*) AS n, sum(p."collectedAmount") AS montant
          FROM "Package" p
          WHERE p."deletedAt" IS NULL AND p."deliveredAt" >= ${debut}
            AND p."status"::text IN (${liste(LIVRES)}) ${portee}
          GROUP BY 1
        )
        SELECT to_char(j.day, 'YYYY-MM-DD') AS day,
               coalesce(c.n, 0) AS created,
               coalesce(l.n, 0) AS delivered,
               coalesce(l.montant, 0) AS collected
        FROM jours j
        LEFT JOIN crees c ON c.day = j.day
        LEFT JOIN livres l ON l.day = j.day
        ORDER BY j.day`,
      // Échecs du jour : tentatives non abouties (reporté, refusé, injoignable…).
      prisma.$queryRaw<{ day: string; failed: bigint }[]>`
        SELECT to_char((a."attemptedAt" AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, count(*) AS failed
        FROM "DeliveryAttempt" a
        JOIN "Package" p ON p."id" = a."packageId"
        WHERE a."attemptedAt" >= ${debut}
          AND a."result"::text NOT IN (${liste(TENTATIVES_REUSSIES)}) ${portee}
        GROUP BY 1`,
      prisma.$queryRaw<
        {
          id: string;
          code: string;
          name: string;
          last_seen: Date | null;
          cash: Prisma.Decimal | null;
          ok: bigint;
          ko: bigint;
        }[]
      >`
        SELECT d."id"::text AS id, d."driverCode" AS code, u."fullName" AS name, d."lastSeenAt" AS last_seen,
               d."currentBalance" AS cash,
               count(a."id") FILTER (WHERE a."result"::text IN (${liste(TENTATIVES_REUSSIES)})) AS ok,
               count(a."id") FILTER (WHERE a."result"::text NOT IN (${liste(TENTATIVES_REUSSIES)})) AS ko
        FROM "Driver" d
        JOIN "User" u ON u."id" = d."userId"
        LEFT JOIN "DeliveryAttempt" a ON a."driverId" = d."id" AND a."attemptedAt" >= ${debut}
        WHERE d."deletedAt" IS NULL AND d."isActive" = true ${porteeLivreur}
        GROUP BY d."id", d."driverCode", u."fullName", d."lastSeenAt", d."currentBalance"
        ORDER BY ok DESC, ko ASC, u."fullName"`,
      prisma.$queryRaw<
        { id: string; name: string; governorate: string; created: bigint; delivered: bigint; returned: bigint; amount: Prisma.Decimal | null }[]
      >`
        SELECT s."id"::text AS id, s."companyName" AS name, s."governorate" AS governorate,
               count(*) AS created,
               count(*) FILTER (WHERE p."status"::text IN (${liste(LIVRES)})) AS delivered,
               count(*) FILTER (WHERE p."status"::text IN (${liste(ECHECS)})) AS returned,
               sum(p."totalPrice") AS amount
        FROM "Package" p
        JOIN "Shipper" s ON s."id" = p."shipperId"
        WHERE p."deletedAt" IS NULL AND p."createdAt" >= ${debut} ${portee}
        GROUP BY s."id", s."companyName", s."governorate"
        ORDER BY created DESC, s."companyName"
        LIMIT 6`,
      prisma.$queryRaw<
        {
          id: string;
          name: string;
          governorate: string;
          is_main_hub: boolean;
          in_stock: bigint;
          to_assign: bigint;
          returns: bigint;
          out_for_delivery: bigint;
          incoming: bigint;
        }[]
      >`
        SELECT d."id"::text AS id, d."name" AS name, d."governorate" AS governorate, d."isMainHub" AS is_main_hub,
          (SELECT count(*) FROM "Package" p WHERE p."deletedAt" IS NULL AND p."currentDepositId" = d."id"
             AND p."status"::text IN ('RECU_DEPOT', 'RECU_DEPOT_DESTINATION')) AS in_stock,
          (SELECT count(*) FROM "Package" p WHERE p."deletedAt" IS NULL AND p."currentDepositId" = d."id"
             AND p."status"::text IN ('RECU_DEPOT', 'RECU_DEPOT_DESTINATION') AND p."assignedDriverId" IS NULL) AS to_assign,
          (SELECT count(*) FROM "Package" p WHERE p."deletedAt" IS NULL AND p."currentDepositId" = d."id"
             AND p."status"::text IN ('RETOUR_DEPOT', 'ECHEC_LIVRAISON')) AS returns,
          (SELECT count(*) FROM "Package" p WHERE p."deletedAt" IS NULL AND p."currentDepositId" = d."id"
             AND p."status"::text IN ('AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON')) AS out_for_delivery,
          (SELECT count(*) FROM "Package" p JOIN "InterDepotTransfer" t ON t."id" = p."interDepotTransferId"
             WHERE p."deletedAt" IS NULL AND t."destinationDepositId" = d."id"
               AND p."status"::text IN ('EN_LOT_INTER_DEPOT', 'EN_TRANSIT_INTER_DEPOT')) AS incoming
        FROM "Deposit" d
        WHERE d."isActive" = true ${porteeAgence}
        ORDER BY d."isMainHub" DESC, d."name"`,
      prisma.$queryRaw<{ total: bigint; done: bigint }[]>`
        SELECT count(*) FILTER (WHERE pa."status"::text <> 'ANNULE') AS total,
               count(*) FILTER (WHERE pa."status"::text = 'EFFECTUE') AS done
        FROM "PickupAppointment" pa
        WHERE pa."scheduledDate" = (now() AT TIME ZONE ${TZ})::date`,
      prisma.runsheet.findMany({
        where: {
          status: { in: ['EN_COURS', 'VALIDEE_DEPART', 'EN_ATTENTE'] as never },
          ...(depositId ? { depositId } : {}),
        },
        select: { driverId: true },
        distinct: ['driverId'],
      }),
    ]);

  const byStatus: Record<string, number> = {};
  let codInProgress = 0;
  let codInProgressCount = 0;
  let all = 0;
  for (const row of statusRows) {
    const total = n(row.total);
    byStatus[row.status] = total;
    all += total;
    if (!TERMINES.includes(row.status)) {
      codInProgress += n(row.cod);
      codInProgressCount += total;
    }
  }
  const somme = (statuts: readonly string[]) => statuts.reduce((s, st) => s + (byStatus[st] ?? 0), 0);
  const pipeline = Object.fromEntries(
    Object.entries(ETAPES_ADMIN).map(([cle, statuts]) => [cle, somme(statuts)])
  ) as AdminOverview['pipeline'];

  const p = periodRows[0];
  const delivered = n(p?.delivered);
  const failed = n(p?.failed);
  const prevDelivered = n(p?.prev_delivered);
  const prevFailed = n(p?.prev_failed);
  const echecsParJour = new Map(attemptRows.map((r) => [r.day, n(r.failed)]));
  const enTournee = new Set(busy.map((b) => b.driverId));
  const maintenant = new Date();

  const livreurs = driverRows.map((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    delivered: n(d.ok),
    failed: n(d.ko),
    successRate: taux(n(d.ok), n(d.ko)),
    cash: r3(n(d.cash)),
    online: isDriverOnline(d.last_seen, maintenant),
    onRun: enTournee.has(d.id),
  }));
  const especes = livreurs.reduce((s, d) => s + d.cash, 0);

  return {
    generatedAt: maintenant.toISOString(),
    periodDays: days,
    today: {
      created: n(p?.today_created),
      delivered: n(p?.today_delivered),
      outForDelivery: byStatus.EN_COURS_LIVRAISON ?? 0,
      pickups: n(pickupRows[0]?.total),
      pickupsDone: n(pickupRows[0]?.done),
    },
    period: {
      created: n(p?.created),
      delivered,
      failed,
      successRate: taux(delivered, failed),
      avgDeliveryHours: p?.avg_hours == null ? null : Math.round(Number(p.avg_hours) * 10) / 10,
      collected: r3(n(p?.collected)),
      fees: r3(n(p?.fees)),
    },
    previous: {
      created: n(p?.prev_created),
      delivered: prevDelivered,
      failed: prevFailed,
      collected: r3(n(p?.prev_collected)),
      successRate: taux(prevDelivered, prevFailed),
    },
    active: all - somme(TERMINES),
    pipeline,
    daily: dailyRows.map((r) => ({
      date: r.day,
      created: n(r.created),
      delivered: n(r.delivered),
      failed: echecsParJour.get(r.day) ?? 0,
      collected: r3(n(r.collected)),
    })),
    topDrivers: livreurs.slice(0, 6),
    topShippers: shipperRows.map((s) => ({
      id: s.id,
      name: s.name,
      governorate: s.governorate,
      created: n(s.created),
      delivered: n(s.delivered),
      returned: n(s.returned),
      amount: r3(n(s.amount)),
    })),
    agencies: agencyRows.map((a) => ({
      id: a.id,
      name: a.name,
      governorate: a.governorate,
      isMainHub: a.is_main_hub,
      inStock: n(a.in_stock),
      toAssign: n(a.to_assign),
      returns: n(a.returns),
      outForDelivery: n(a.out_for_delivery),
      incoming: n(a.incoming),
    })),
    money: {
      codInProgress: r3(codInProgress),
      codInProgressCount,
      cashWithDrivers: r3(especes),
      driversWithCash: livreurs.filter((d) => d.cash > 0).length,
    },
  };
}
