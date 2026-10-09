/**
 * Zones de livraison.
 *
 * Une zone est un couple (gouvernorat, délégation) : « Rades (Ben Arous) ».
 *
 * Création automatique : à la saisie d'un colis — par un expéditeur ou par
 * l'exploitation — l'adresse du destinataire désigne sa zone. Si elle n'existe
 * pas encore, elle est créée et rattachée à l'agence qui dessert le
 * gouvernorat (hub central à défaut). L'adresse garde le lien (`zoneId`).
 *
 * Ce que la zone porte ensuite :
 *  - l'agence de livraison du colis (routage, voir common/routing) ;
 *  - les livreurs qui la couvrent (DriverZone), proposés en premier à
 *    l'affectation d'un colis de la zone ;
 *  - les filtres et statistiques par zone (back-office, portail expéditeur) ;
 *  - l'écran « Mes zones » de l'application livreur.
 *
 * Le code est déterministe (empreinte du couple normalisé) : deux saisies
 * simultanées de la même adresse nouvelle produisent le même code, et la
 * contrainte d'unicité garantit une seule zone.
 */

import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { BusinessRuleError } from '../../common/errors/api-error';
import { mainHubId, resolveDestinationDepositId } from '../../common/routing/deposit-routing';
import { auditService } from '../../common/audit/audit.service';

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Code stable d'un couple (gouvernorat, délégation). Même formule que la migration. */
export function zoneCode(governorate: string, delegation: string): string {
  const key = `${governorate.trim().toLowerCase()}|${delegation.trim().toLowerCase()}`;
  return `Z-${createHash('md5').update(key).digest('hex').slice(0, 10).toUpperCase()}`;
}

/** Statuts d'un colis encore « en cours » (pas encore terminé). */
const OPEN_STATUSES = [
  'CREE',
  'RAMASSAGE_PROGRAMME',
  'RAMASSE',
  'RECU_DEPOT',
  'EN_LOT_INTER_DEPOT',
  'EN_TRANSIT_INTER_DEPOT',
  'RECU_DEPOT_DESTINATION',
  'AFFECTE_RUNSHEET',
  'EN_COURS_LIVRAISON',
  'REPORTE',
] as const;

export interface ZoneDto {
  id: string;
  code: string;
  name: string;
  governorate: string;
  delegation: string;
  depositId: string;
  depositName: string | null;
  baseDeliveryFee: number;
  isActive: boolean;
  autoCreated: boolean;
  createdAt: string;
  /** Colis non terminés dont l'adresse est dans la zone. */
  openPackages?: number;
  /** Colis au total (toutes périodes). */
  totalPackages?: number;
  drivers?: { id: string; driverCode: string; fullName: string; isActive: boolean }[];
}

type ZoneRow = Prisma.DeliveryZoneGetPayload<{
  include: { deposit: { select: { name: true } } };
}>;

function toDto(z: ZoneRow): ZoneDto {
  return {
    id: z.id,
    code: z.code,
    name: z.name,
    governorate: z.governorate,
    delegation: z.delegation,
    depositId: z.depositId,
    depositName: z.deposit?.name ?? null,
    baseDeliveryFee: Number(z.baseDeliveryFee),
    isActive: z.isActive,
    autoCreated: z.autoCreated,
    createdAt: z.createdAt.toISOString(),
  };
}

export class ZonesService {
  /**
   * Zone d'une adresse, créée si elle n'existe pas. Renvoie `null` si
   * l'adresse n'a pas de délégation exploitable (ou aucune agence n'existe).
   */
  async ensureZone(
    client: Client,
    governorateRaw: string | null | undefined,
    delegationRaw: string | null | undefined
  ): Promise<{ id: string; created: boolean } | null> {
    const governorate = clean(governorateRaw, 50);
    const delegation = clean(delegationRaw, 100);
    if (!governorate || !delegation) return null;

    const existing = await client.deliveryZone.findFirst({
      where: {
        governorate: { equals: governorate, mode: 'insensitive' },
        delegation: { equals: delegation, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const depositId =
      (await resolveDestinationDepositId(client, governorate, null)) ?? (await mainHubId(client));
    if (!depositId) return null;

    const code = zoneCode(governorate, delegation);
    // INSERT … ON CONFLICT DO NOTHING : deux saisies simultanées de la même
    // adresse nouvelle ne lèvent pas d'erreur (une erreur annulerait toute la
    // transaction de création du colis) ; la seconde attend la première et
    // relit la zone créée.
    const inserted = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO "DeliveryZone" ("id", "depositId", "code", "name", "governorate", "delegation", "postalCodes", "autoCreated", "updatedAt")
      VALUES (gen_random_uuid(), ${depositId}::uuid, ${code}, ${delegation}, ${governorate}, ${delegation}, ARRAY[]::text[], true, now())
      ON CONFLICT ("code") DO NOTHING
      RETURNING "id"::text AS id`;
    if (inserted.length === 0) {
      const again = await client.deliveryZone.findUnique({ where: { code }, select: { id: true } });
      return again ? { id: again.id, created: false } : null;
    }
    const zone = { id: inserted[0]!.id };
    await auditService.record(
      {
        entityType: 'ZONE',
        entityId: zone.id,
        action: 'ZONE_CREEE',
        reason: `Zone « ${delegation} (${governorate}) » créée automatiquement à la saisie d'un colis.`,
        newValues: { code, governorate, delegation, depositId },
      },
      client as Prisma.TransactionClient
    );
    return { id: zone.id, created: true };
  }

  async list(params: {
    search?: string;
    governorate?: string;
    active?: string;
    depositId?: string;
    withStats?: boolean;
  }): Promise<ZoneDto[]> {
    const prisma = getPrisma();
    const search = clean(params.search, 100);
    const where: Prisma.DeliveryZoneWhereInput = {
      ...(params.governorate ? { governorate: { equals: clean(params.governorate, 50), mode: 'insensitive' } } : {}),
      ...(params.depositId ? { depositId: params.depositId } : {}),
      ...(params.active === 'true' ? { isActive: true } : params.active === 'false' ? { isActive: false } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { delegation: { contains: search, mode: 'insensitive' } },
              { governorate: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const zones = await prisma.deliveryZone.findMany({
      where,
      include: {
        deposit: { select: { name: true } },
        drivers: {
          include: { driver: { select: { id: true, driverCode: true, isActive: true, user: { select: { fullName: true } } } } },
        },
      },
      orderBy: [{ governorate: 'asc' }, { delegation: 'asc' }],
      take: 500,
    });
    const dtos = zones.map((z) => ({
      ...toDto(z),
      drivers: z.drivers.map((dz) => ({
        id: dz.driver.id,
        driverCode: dz.driver.driverCode,
        fullName: dz.driver.user.fullName,
        isActive: dz.driver.isActive,
      })),
    }));
    if (!params.withStats || dtos.length === 0) return dtos;

    const ids = dtos.map((d) => d.id);
    const counts = await prisma.$queryRaw<{ zoneId: string; open: bigint; total: bigint }[]>`
      SELECT ca."zoneId"::text AS "zoneId",
             COUNT(*) FILTER (WHERE p.status::text = ANY(${[...OPEN_STATUSES]})) AS open,
             COUNT(*) AS total
      FROM "Package" p
      JOIN "CustomerAddress" ca ON ca.id = p."customerAddressId"
      WHERE p."deletedAt" IS NULL AND ca."zoneId" = ANY(${ids}::uuid[])
      GROUP BY ca."zoneId"`;
    const byZone = new Map(counts.map((c) => [c.zoneId, c]));
    return dtos.map((d) => ({
      ...d,
      openPackages: Number(byZone.get(d.id)?.open ?? 0),
      totalPackages: Number(byZone.get(d.id)?.total ?? 0),
    }));
  }

  /** Délégations connues d'un gouvernorat : suggestions du formulaire de colis. */
  async suggestions(governorate: string | undefined): Promise<{ governorate: string; delegation: string }[]> {
    const gov = clean(governorate, 50);
    const rows = await getPrisma().deliveryZone.findMany({
      where: { isActive: true, ...(gov ? { governorate: { equals: gov, mode: 'insensitive' } } : {}) },
      select: { governorate: true, delegation: true },
      orderBy: { delegation: 'asc' },
      take: 300,
    });
    return rows;
  }

  async update(
    id: string,
    input: { name?: unknown; depositId?: unknown; baseDeliveryFee?: unknown; isActive?: unknown; driverIds?: unknown }
  ): Promise<ZoneDto> {
    const prisma = getPrisma();
    const zone = await prisma.deliveryZone.findUnique({ where: { id } });
    if (!zone) throw new BusinessRuleError('Zone introuvable.', 404);

    const data: Prisma.DeliveryZoneUpdateInput = {};
    if (input.name !== undefined) {
      const name = clean(input.name, 100);
      if (!name) throw new BusinessRuleError('Le nom de la zone est obligatoire.', 400);
      data.name = name;
    }
    if (input.depositId !== undefined) {
      const deposit = await prisma.deposit.findUnique({ where: { id: String(input.depositId) } });
      if (!deposit || !deposit.isActive) throw new BusinessRuleError('Agence introuvable ou inactive.', 400);
      data.deposit = { connect: { id: deposit.id } };
    }
    if (input.baseDeliveryFee !== undefined) {
      const fee = Number(input.baseDeliveryFee);
      if (!Number.isFinite(fee) || fee < 0 || fee > 1000) {
        throw new BusinessRuleError('Tarif de zone invalide (0 à 1000 DT).', 400);
      }
      data.baseDeliveryFee = new Prisma.Decimal(fee.toFixed(3));
    }
    if (input.isActive !== undefined) data.isActive = input.isActive === true || input.isActive === 'true';

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.deliveryZone.update({ where: { id }, data });
      if (input.driverIds !== undefined) {
        const ids = Array.isArray(input.driverIds) ? [...new Set(input.driverIds.map(String))] : [];
        const found = await tx.driver.count({ where: { id: { in: ids }, deletedAt: null } });
        if (found !== ids.length) throw new BusinessRuleError('Livreur introuvable dans la sélection.', 400);
        await tx.driverZone.deleteMany({ where: { zoneId: id, driverId: { notIn: ids } } });
        await tx.driverZone.createMany({
          data: ids.map((driverId) => ({ driverId, zoneId: id })),
          skipDuplicates: true,
        });
      }
    });
    return (await this.list({})).find((z) => z.id === id)!;
  }

  /** Zones d'un livreur. */
  async driverZones(driverId: string): Promise<ZoneDto[]> {
    const rows = await getPrisma().driverZone.findMany({
      where: { driverId },
      include: { zone: { include: { deposit: { select: { name: true } } } } },
      orderBy: { zone: { delegation: 'asc' } },
    });
    return rows.map((r) => toDto(r.zone));
  }

  /** Remplace les zones d'un livreur (zones actives uniquement). */
  async setDriverZones(driverId: string, zoneIdsRaw: unknown): Promise<ZoneDto[]> {
    const prisma = getPrisma();
    if (!Array.isArray(zoneIdsRaw)) throw new BusinessRuleError('« zoneIds » doit être une liste.', 400);
    const zoneIds = [...new Set(zoneIdsRaw.map(String))];
    if (zoneIds.length > 100) throw new BusinessRuleError('100 zones au plus par livreur.', 400);
    const valid = await prisma.deliveryZone.count({ where: { id: { in: zoneIds }, isActive: true } });
    if (valid !== zoneIds.length) throw new BusinessRuleError('Zone inconnue ou désactivée dans la sélection.', 400);
    await prisma.$transaction([
      prisma.driverZone.deleteMany({ where: { driverId, zoneId: { notIn: zoneIds } } }),
      prisma.driverZone.createMany({ data: zoneIds.map((zoneId) => ({ driverId, zoneId })), skipDuplicates: true }),
    ]);
    return this.driverZones(driverId);
  }

  /**
   * Livreurs proposés pour un colis : ceux qui couvrent sa zone d'abord.
   * Renvoie l'identifiant de zone et la liste ordonnée des livreurs actifs.
   */
  async driversForPackage(packageId: string): Promise<{
    zone: { id: string; name: string; governorate: string } | null;
    drivers: { id: string; driverCode: string; fullName: string; coversZone: boolean; vehicleType: string }[];
  }> {
    const prisma = getPrisma();
    const pkg = await prisma.package.findFirst({
      where: { OR: [{ id: /^[0-9a-f-]{36}$/i.test(packageId) ? packageId : undefined }, { trackingNumber: packageId }] },
      select: { customerAddress: { select: { zone: { select: { id: true, name: true, governorate: true } } } } },
    });
    if (!pkg) throw new BusinessRuleError('Colis introuvable.', 404);
    const zone = pkg.customerAddress?.zone ?? null;
    const drivers = await prisma.driver.findMany({
      where: { isActive: true, deletedAt: null, user: { isActive: true } },
      select: {
        id: true,
        driverCode: true,
        vehicleType: true,
        user: { select: { fullName: true } },
        zones: zone ? { where: { zoneId: zone.id }, select: { zoneId: true } } : { take: 0, select: { zoneId: true } },
      },
      orderBy: { driverCode: 'asc' },
    });
    const list = drivers
      .map((d) => ({
        id: d.id,
        driverCode: d.driverCode,
        fullName: d.user.fullName,
        vehicleType: d.vehicleType,
        coversZone: d.zones.length > 0,
      }))
      .sort((a, b) => Number(b.coversZone) - Number(a.coversZone));
    return { zone, drivers: list };
  }
}

export const zonesService = new ZonesService();
