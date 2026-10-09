/**
 * Tableau de bord de l'expéditeur — `GET /shipper/dashboard`.
 *
 * Tout est calculé en base, sur les colis de CET expéditeur seulement
 * (`shipperId` du jeton) : répartition par statut, parcours des colis,
 * évolution jour par jour, zones de destination, montants. Une seule requête
 * côté portail, au lieu d'une dizaine de comptages, et des totaux exacts
 * (jamais comptés sur une page tronquée).
 *
 * Les jours sont ceux de Tunis (`Africa/Tunis`), pas ceux du serveur (UTC) :
 * un colis créé à 00 h 30 compte pour le bon jour.
 */

import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';

const TZ = 'Africa/Tunis';

/** Étapes du parcours affiché, dans l'ordre, et les statuts qu'elles regroupent. */
export const ETAPES_PARCOURS = {
  preparation: ['CREE', 'RAMASSAGE_PROGRAMME'],
  collecte: ['RAMASSE'],
  depot: ['RECU_DEPOT', 'EN_LOT_INTER_DEPOT', 'EN_TRANSIT_INTER_DEPOT', 'RECU_DEPOT_DESTINATION'],
  livraison: ['AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON', 'REPORTE'],
  livre: ['LIVRE', 'LIVRAISON_PARTIELLE'],
  retour: ['ECHEC_LIVRAISON', 'RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'RETOURNE_EXPEDITEUR'],
} as const;

const LIVRES = ['LIVRE', 'LIVRAISON_PARTIELLE'];
const ECHECS = ['ECHEC_LIVRAISON', 'RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'RETOURNE_EXPEDITEUR'];
const TERMINES = [...LIVRES, 'RETOURNE_EXPEDITEUR', 'ANNULE'];

export interface ShipperDashboard {
  generatedAt: string;
  periodDays: number;
  totals: { all: number; active: number; delivered: number; returned: number; cancelled: number };
  byStatus: Record<string, number>;
  pipeline: Record<keyof typeof ETAPES_PARCOURS, number>;
  period: {
    created: number;
    delivered: number;
    failed: number;
    successRate: number | null;
    avgDeliveryHours: number | null;
    collected: number;
    fees: number;
  };
  previous: { created: number; delivered: number };
  today: { created: number; delivered: number; outForDelivery: number };
  daily: { date: string; created: number; delivered: number }[];
  zones: { zoneId: string | null; name: string; governorate: string; total: number; delivered: number; active: number }[];
  governorates: { governorate: string; total: number }[];
  money: { codInProgress: number; codInProgressCount: number };
  nextPickup: { id: string; scheduledDate: string; startHour: number; endHour: number; status: string } | null;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

export const ALLOWED_PERIODS = [7, 14, 30, 90] as const;

export async function getShipperDashboard(shipperId: string, periodDays = 14): Promise<ShipperDashboard> {
  const prisma = getPrisma();
  const days = (ALLOWED_PERIODS as readonly number[]).includes(periodDays) ? periodDays : 14;
  const sid = Prisma.sql`${shipperId}::uuid`;
  // Début de période : minuit (heure de Tunis) il y a `days - 1` jours.
  const debut = Prisma.sql`((date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${days - 1}::int)) AT TIME ZONE ${TZ})`;
  const debutPrecedent = Prisma.sql`((date_trunc('day', now() AT TIME ZONE ${TZ}) - make_interval(days => ${2 * days - 1}::int)) AT TIME ZONE ${TZ})`;
  const aujourdhui = Prisma.sql`(date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})`;

  const [statusRows, periodRows, dailyRows, zoneRows, govRows, pickup] = await Promise.all([
    prisma.$queryRaw<{ status: string; total: bigint; cod: Prisma.Decimal | null }[]>`
      SELECT p."status"::text AS status, count(*) AS total, sum(p."totalPrice") AS cod
      FROM "Package" p
      WHERE p."shipperId" = ${sid} AND p."deletedAt" IS NULL
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
        today_created: bigint;
        today_delivered: bigint;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE p."createdAt" >= ${debut}) AS created,
        count(*) FILTER (WHERE p."status"::text IN (${Prisma.join(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS delivered,
        count(*) FILTER (WHERE p."status"::text IN (${Prisma.join(ECHECS)}) AND p."updatedAt" >= ${debut}) AS failed,
        avg(EXTRACT(EPOCH FROM (p."deliveredAt" - p."createdAt")) / 3600.0)
          FILTER (WHERE p."status"::text IN (${Prisma.join(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS avg_hours,
        sum(p."collectedAmount") FILTER (WHERE p."status"::text IN (${Prisma.join(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS collected,
        sum(p."deliveryFee") FILTER (WHERE p."status"::text IN (${Prisma.join(LIVRES)}) AND p."deliveredAt" >= ${debut}) AS fees,
        count(*) FILTER (WHERE p."createdAt" >= ${debutPrecedent} AND p."createdAt" < ${debut}) AS prev_created,
        count(*) FILTER (WHERE p."status"::text IN (${Prisma.join(LIVRES)}) AND p."deliveredAt" >= ${debutPrecedent} AND p."deliveredAt" < ${debut}) AS prev_delivered,
        count(*) FILTER (WHERE p."createdAt" >= ${aujourdhui}) AS today_created,
        count(*) FILTER (WHERE p."status"::text IN (${Prisma.join(LIVRES)}) AND p."deliveredAt" >= ${aujourdhui}) AS today_delivered
      FROM "Package" p
      WHERE p."shipperId" = ${sid} AND p."deletedAt" IS NULL`,
    prisma.$queryRaw<{ day: string; created: bigint; delivered: bigint }[]>`
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
        WHERE p."shipperId" = ${sid} AND p."deletedAt" IS NULL AND p."createdAt" >= ${debut}
        GROUP BY 1
      ),
      livres AS (
        SELECT (p."deliveredAt" AT TIME ZONE ${TZ})::date AS day, count(*) AS n
        FROM "Package" p
        WHERE p."shipperId" = ${sid} AND p."deletedAt" IS NULL AND p."deliveredAt" >= ${debut}
          AND p."status"::text IN (${Prisma.join(LIVRES)})
        GROUP BY 1
      )
      SELECT to_char(j.day, 'YYYY-MM-DD') AS day, coalesce(c.n, 0) AS created, coalesce(l.n, 0) AS delivered
      FROM jours j
      LEFT JOIN crees c ON c.day = j.day
      LEFT JOIN livres l ON l.day = j.day
      ORDER BY j.day`,
    prisma.$queryRaw<
      { zone_id: string | null; name: string; governorate: string; total: bigint; delivered: bigint; active: bigint }[]
    >`
      SELECT z."id"::text AS zone_id,
             coalesce(z."name", a."delegation", a."governorate") AS name,
             coalesce(z."governorate", a."governorate") AS governorate,
             count(*) AS total,
             count(*) FILTER (WHERE p."status"::text IN (${Prisma.join(LIVRES)})) AS delivered,
             count(*) FILTER (WHERE p."status"::text NOT IN (${Prisma.join(TERMINES)})) AS active
      FROM "Package" p
      JOIN "CustomerAddress" a ON a."id" = p."customerAddressId"
      LEFT JOIN "DeliveryZone" z ON z."id" = a."zoneId"
      WHERE p."shipperId" = ${sid} AND p."deletedAt" IS NULL AND p."createdAt" >= ${debut}
      GROUP BY 1, 2, 3
      ORDER BY total DESC, name
      LIMIT 6`,
    prisma.$queryRaw<{ governorate: string; total: bigint }[]>`
      SELECT a."governorate" AS governorate, count(*) AS total
      FROM "Package" p
      JOIN "CustomerAddress" a ON a."id" = p."customerAddressId"
      WHERE p."shipperId" = ${sid} AND p."deletedAt" IS NULL AND p."createdAt" >= ${debut}
      GROUP BY 1
      ORDER BY total DESC, governorate
      LIMIT 8`,
    prisma.pickupAppointment.findFirst({
      where: {
        shipperId,
        status: { in: ['A_CONFIRMER', 'EN_ATTENTE', 'ASSIGNE', 'EN_COURS'] },
        scheduledDate: { gte: new Date(new Date().toISOString().slice(0, 10)) },
      },
      orderBy: [{ scheduledDate: 'asc' }, { timeSlotStartHour: 'asc' }],
      select: { id: true, scheduledDate: true, timeSlotStartHour: true, timeSlotEndHour: true, status: true },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  let all = 0;
  let codInProgress = 0;
  let codInProgressCount = 0;
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
    Object.entries(ETAPES_PARCOURS).map(([cle, statuts]) => [cle, somme(statuts)])
  ) as ShipperDashboard['pipeline'];

  const p = periodRows[0];
  const delivered = n(p?.delivered);
  const failed = n(p?.failed);

  return {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    totals: {
      all,
      active: all - somme(TERMINES),
      delivered: somme(LIVRES),
      returned: byStatus.RETOURNE_EXPEDITEUR ?? 0,
      cancelled: byStatus.ANNULE ?? 0,
    },
    byStatus,
    pipeline,
    period: {
      created: n(p?.created),
      delivered,
      failed,
      successRate: delivered + failed > 0 ? Math.round((delivered / (delivered + failed)) * 1000) / 10 : null,
      avgDeliveryHours: p?.avg_hours == null ? null : Math.round(Number(p.avg_hours) * 10) / 10,
      collected: Math.round(n(p?.collected) * 1000) / 1000,
      fees: Math.round(n(p?.fees) * 1000) / 1000,
    },
    previous: { created: n(p?.prev_created), delivered: n(p?.prev_delivered) },
    today: {
      created: n(p?.today_created),
      delivered: n(p?.today_delivered),
      outForDelivery: byStatus.EN_COURS_LIVRAISON ?? 0,
    },
    daily: dailyRows.map((r) => ({ date: r.day, created: n(r.created), delivered: n(r.delivered) })),
    zones: zoneRows.map((r) => ({
      zoneId: r.zone_id,
      name: r.name,
      governorate: r.governorate,
      total: n(r.total),
      delivered: n(r.delivered),
      active: n(r.active),
    })),
    governorates: govRows.map((r) => ({ governorate: r.governorate, total: n(r.total) })),
    money: { codInProgress: Math.round(codInProgress * 1000) / 1000, codInProgressCount },
    nextPickup: pickup
      ? {
          id: pickup.id,
          scheduledDate: pickup.scheduledDate.toISOString().slice(0, 10),
          startHour: pickup.timeSlotStartHour,
          endHour: pickup.timeSlotEndHour,
          status: pickup.status,
        }
      : null,
  };
}
