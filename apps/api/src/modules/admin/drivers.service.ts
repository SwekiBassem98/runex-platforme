/**
 * Administration des livreurs (fiches chauffeur).
 *
 * ## Un livreur, un compte
 *
 * `Driver.userId` porte une contrainte d'unicité en base : une fiche chauffeur ne
 * peut pas avoir deux comptes, et un compte ne peut pas avoir deux fiches. Cette
 * garantie vient du schéma, pas du code — le service se contente de la vérifier
 * avant l'écriture pour répondre 409 plutôt que de laisser la contrainte remonter
 * en 500.
 *
 * C'est exactement l'exigence « pas de comptes multiples en conflit » : elle est
 * déjà structurelle, aucune migration n'était nécessaire.
 *
 * ## Affectation en cours
 *
 * L'état opérationnel est déduit de la tournée ouverte la plus récente. Une
 * tournée est « ouverte » tant qu'elle n'est ni clôturée ni annulée. Ce calcul
 * n'est fait que pour les identifiants de la page courante, en une requête.
 */

import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { badRequest, conflict, notFound, asUuid } from '../../common/errors/api-error';
import { usersService, type ActorRef } from './users.service';
import { isDriverOnline } from '../presence/presence.service';

/** États dans lesquels une tournée occupe encore le chauffeur. */
const TOURNEE_OUVERTE = ['EN_ATTENTE', 'VALIDEE_DEPART', 'EN_COURS', 'RETOUR_DEPOT'] as const;

export interface DriverDto {
  id: string;
  driverCode: string;
  vehicleType: string;
  licensePlate: string | null;
  cashCeiling: number;
  currentBalance: number;
  rating: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Présence mobile : dernier battement reçu (UTC ISO). Null = jamais vu. */
  lastSeenAt: string | null;
  /** En ligne = vu dans la fenêtre `DRIVER_PRESENCE_TIMEOUT_SECONDS` (déf. 180 s). */
  isOnline: boolean;
  /** Compte rattaché, s'il existe. Une fiche peut précéder la création du compte. */
  user: { id: string; fullName: string; email: string; phone: string; isActive: boolean } | null;
  deposit: { id: string; name: string } | null;
  /** Tournée ouverte la plus récente, s'il y en a une. */
  currentAssignment: { runsheetNumber: string; status: string; tourDate: string } | null;
}

export interface DriverQuery {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

const DRIVER_SELECT = {
  id: true,
  userId: true,
  driverCode: true,
  vehicleType: true,
  licensePlate: true,
  cashCeiling: true,
  currentBalance: true,
  rating: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      isActive: true,
      deposit: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.DriverSelect;

type DriverRecord = Prisma.DriverGetPayload<{ select: typeof DRIVER_SELECT }>;

function toDto(d: DriverRecord, affectation: DriverDto['currentAssignment'] = null): DriverDto {
  return {
    id: d.id,
    driverCode: d.driverCode,
    vehicleType: d.vehicleType,
    licensePlate: d.licensePlate,
    cashCeiling: Number(d.cashCeiling),
    currentBalance: Number(d.currentBalance),
    rating: d.rating === null ? null : Number(d.rating),
    isActive: d.isActive,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    // Présence : exposée en lecture seule (aperçu admin), jamais de jeton.
    lastSeenAt: (d as { lastSeenAt?: Date | null }).lastSeenAt?.toISOString() ?? null,
    isOnline: isDriverOnline((d as { lastSeenAt?: Date | null }).lastSeenAt ?? null),
    user: d.user
      ? {
          id: d.user.id,
          fullName: d.user.fullName,
          email: d.user.email,
          phone: d.user.phone,
          isActive: d.user.isActive,
        }
      : null,
    deposit: d.user?.deposit ?? null,
    currentAssignment: affectation,
  };
}

export class DriversService {
  async findAll(query: DriverQuery): Promise<{ items: DriverDto[]; total: number; page: number; limit: number }> {
    const prisma = getPrisma();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

    const where: Prisma.DriverWhereInput = { deletedAt: null };
    const termes = query.search?.trim();
    if (termes) {
      where.OR = [
        { driverCode: { contains: termes, mode: 'insensitive' } },
        { licensePlate: { contains: termes, mode: 'insensitive' } },
        { vehicleType: { contains: termes, mode: 'insensitive' } },
        { user: { fullName: { contains: termes, mode: 'insensitive' } } },
        { user: { email: { contains: termes, mode: 'insensitive' } } },
        { user: { phone: { contains: termes, mode: 'insensitive' } } },
      ];
    }
    if (query.status === 'actif') where.isActive = true;
    else if (query.status === 'inactif') where.isActive = false;

    const [records, total] = await Promise.all([
      prisma.driver.findMany({
        where,
        select: DRIVER_SELECT,
        orderBy: { driverCode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.driver.count({ where }),
    ]);

    const affectations = await this.affectationsCourantes(records.map((r) => r.id));
    return { items: records.map((r) => toDto(r, affectations.get(r.id) ?? null)), total, page, limit };
  }

  /**
   * Tournée ouverte de chaque chauffeur, en une requête groupée.
   *
   * On ne charge que les identifiants passés — jamais la table entière — et on
   * ne retient que la tournée la plus récente de chaque chauffeur.
   */
  private async affectationsCourantes(driverIds: string[]): Promise<Map<string, DriverDto['currentAssignment']>> {
    if (driverIds.length === 0) return new Map();
    const prisma = getPrisma();
    const rows = await prisma.runsheet.findMany({
      where: { driverId: { in: driverIds }, status: { in: [...TOURNEE_OUVERTE] } },
      select: { driverId: true, runsheetNumber: true, status: true, tourDate: true },
      orderBy: { tourDate: 'desc' },
    });
    const parChauffeur = new Map<string, DriverDto['currentAssignment']>();
    for (const r of rows) {
      // Le tri décroissant garantit que la première rencontre est la plus récente.
      if (parChauffeur.has(r.driverId)) continue;
      parChauffeur.set(r.driverId, {
        runsheetNumber: r.runsheetNumber,
        status: r.status,
        tourDate: r.tourDate.toISOString(),
      });
    }
    return parChauffeur;
  }

  async findById(id: string): Promise<DriverDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant livreur invalide.');

    const record = await prisma.driver.findFirst({ where: { id: uuid, deletedAt: null }, select: DRIVER_SELECT });
    if (!record) throw notFound('Livreur introuvable.');

    const affectations = await this.affectationsCourantes([uuid]);
    return toDto(record, affectations.get(uuid) ?? null);
  }

  /**
   * Crée une fiche chauffeur.
   *
   * Deux chemins sont possibles : rattacher un compte existant (`userId`), ou
   * créer le compte en même temps (`compte`). Dans les deux cas, l'unicité de
   * `Driver.userId` est vérifiée avant l'écriture.
   */
  async create(
    input: {
      driverCode: string;
      vehicleType: string;
      licensePlate?: string | null;
      cashCeiling?: number;
      userId?: string | null;
      depositId?: string | null;
      isActive?: boolean;
      compte?: { fullName: string; email: string; phone: string; password: string };
    },
    actor: ActorRef
  ): Promise<DriverDto> {
    const prisma = getPrisma();

    const driverCode = input.driverCode?.trim().toUpperCase();
    const vehicleType = input.vehicleType?.trim();
    if (!driverCode) throw badRequest('Le code livreur est obligatoire.');
    if (!vehicleType) throw badRequest('Le type de véhicule est obligatoire.');
    if (input.cashCeiling !== undefined && (Number.isNaN(Number(input.cashCeiling)) || Number(input.cashCeiling) < 0)) {
      throw badRequest('Le plafond de caisse doit être un montant positif.');
    }

    const pris = await prisma.driver.findUnique({ where: { driverCode } });
    if (pris) throw conflict('Ce code livreur est déjà utilisé.');

    // Le compte est créé d'abord s'il n'existe pas : la fiche a besoin de son
    // identifiant, et `userId` est obligatoire dans le schéma.
    let userId = input.userId ? asUuid(input.userId) : null;
    if (input.userId && !userId) throw badRequest('Identifiant utilisateur invalide.');

    if (!userId && input.compte) {
      const compte = await usersService.create(
        {
          fullName: input.compte.fullName,
          email: input.compte.email,
          phone: input.compte.phone,
          password: input.compte.password,
          role: 'LIVREUR',
          isActive: input.isActive !== false,
          depositId: input.depositId ?? null,
        },
        actor
      );
      userId = compte.id;
    }
    if (!userId) throw badRequest('Un livreur doit être rattaché à un compte utilisateur.');

    const compteExistant = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!compteExistant) throw notFound("Le compte utilisateur demandé n'existe pas.");

    // Unicité vérifiée explicitement : `Driver.userId` est `@unique`, mais laisser
    // la contrainte remonter produirait une 500 là où l'appelant attend un 409.
    const dejaPris = await prisma.driver.findFirst({ where: { userId, deletedAt: null } });
    if (dejaPris) throw conflict('Ce compte est déjà rattaché à une fiche livreur.');

    if (input.depositId) {
      const depUuid = asUuid(input.depositId);
      if (!depUuid) throw badRequest('Identifiant dépôt invalide.');
      const deposit = await prisma.deposit.findUnique({ where: { id: depUuid } });
      if (!deposit) throw badRequest("Le dépôt demandé n'existe pas.");
      if (compteExistant.depositId !== depUuid) {
        await prisma.user.update({ where: { id: userId }, data: { depositId: depUuid } });
      }
    }

    const created = await prisma.driver.create({
      data: {
        driverCode,
        vehicleType,
        licensePlate: input.licensePlate?.trim() || null,
        cashCeiling: input.cashCeiling !== undefined ? new Prisma.Decimal(input.cashCeiling) : undefined,
        isActive: input.isActive !== false,
        userId,
      },
      select: DRIVER_SELECT,
    });

    await auditService.record({
      entityType: 'DRIVER',
      entityId: created.id,
      action: 'DRIVER_CREE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: `Création du livreur ${created.driverCode} rattaché au compte ${compteExistant.email}.`,
      newValues: { driverCode, vehicleType, userId },
    });

    return this.findById(created.id);
  }

  async update(
    id: string,
    input: Partial<{
      vehicleType: string;
      licensePlate: string | null;
      cashCeiling: number;
      userId: string | null;
      depositId: string | null;
    }>,
    actor: ActorRef
  ): Promise<DriverDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant livreur invalide.');

    const actuel = await prisma.driver.findFirst({ where: { id: uuid, deletedAt: null }, select: DRIVER_SELECT });
    if (!actuel) throw notFound('Livreur introuvable.');

    const data: Prisma.DriverUpdateInput = {};
    if (input.vehicleType !== undefined) {
      const v = input.vehicleType.trim();
      if (!v) throw badRequest('Le type de véhicule ne peut pas être vide.');
      data.vehicleType = v;
    }
    if (input.licensePlate !== undefined) data.licensePlate = input.licensePlate?.trim() || null;
    if (input.cashCeiling !== undefined) {
      if (Number.isNaN(Number(input.cashCeiling)) || Number(input.cashCeiling) < 0) {
        throw badRequest('Le plafond de caisse doit être un montant positif.');
      }
      data.cashCeiling = new Prisma.Decimal(input.cashCeiling);
    }

    // Le dépôt vit sur le compte, pas sur la fiche : le changer ici met à jour
    // le compte rattaché, ce qui est ce que l'écran donne à comprendre.
    if (input.depositId !== undefined) {
      const depUuid = input.depositId ? asUuid(input.depositId) : null;
      if (input.depositId && !depUuid) throw badRequest('Identifiant dépôt invalide.');
      if (depUuid) {
        const deposit = await prisma.deposit.findUnique({ where: { id: depUuid } });
        if (!deposit) throw badRequest("Le dépôt demandé n'existe pas.");
      }
      if (actuel.user) await prisma.user.update({ where: { id: actuel.user.id }, data: { depositId: depUuid } });
    }

    // Changer le compte rattaché est l'opération sensible : elle déplace l'accès
    // d'un humain à un autre. On refuse tout doublon.
    let associationModifiee = false;
    if (input.userId !== undefined) {
      const uUuid = input.userId ? asUuid(input.userId) : null;
      if (input.userId && !uUuid) throw badRequest('Identifiant utilisateur invalide.');
      if (!uUuid) throw badRequest('Un livreur doit être rattaché à un compte utilisateur.');
      if (uUuid !== actuel.userId) {
        const compte = await prisma.user.findFirst({ where: { id: uUuid, deletedAt: null } });
        if (!compte) throw notFound("Le compte utilisateur demandé n'existe pas.");
        const dejaPris = await prisma.driver.findFirst({ where: { userId: uUuid, deletedAt: null, NOT: { id: uuid } } });
        if (dejaPris) throw conflict('Ce compte est déjà rattaché à une autre fiche livreur.');
        data.user = { connect: { id: uUuid } };
        associationModifiee = true;
      }
    }

    const updated = await prisma.driver.update({ where: { id: uuid }, data, select: DRIVER_SELECT });

    await auditService.record({
      entityType: 'DRIVER',
      entityId: uuid,
      action: 'DRIVER_MODIFIE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      previousValues: {
        vehicleType: actuel.vehicleType,
        licensePlate: actuel.licensePlate,
        cashCeiling: Number(actuel.cashCeiling),
      },
      newValues: {
        vehicleType: updated.vehicleType,
        licensePlate: updated.licensePlate,
        cashCeiling: Number(updated.cashCeiling),
      },
    });

    if (associationModifiee) {
      await auditService.record({
        entityType: 'DRIVER',
        entityId: uuid,
        action: 'USER_COMPTE_ASSOCIE',
        userId: actor.id ?? null,
        userIp: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        reason: `Fiche livreur ${updated.driverCode} rattachée à un autre compte.`,
        previousValues: { userId: actuel.userId },
        newValues: { userId: updated.userId },
      });
    }

    return this.findById(uuid);
  }

  async setStatus(id: string, isActive: boolean, reason: string | null, actor: ActorRef): Promise<DriverDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant livreur invalide.');

    const actuel = await prisma.driver.findFirst({ where: { id: uuid, deletedAt: null }, select: DRIVER_SELECT });
    if (!actuel) throw notFound('Livreur introuvable.');
    if (actuel.isActive === isActive) return this.findById(uuid);

    await prisma.driver.update({ where: { id: uuid }, data: { isActive } });

    await auditService.record({
      entityType: 'DRIVER',
      entityId: uuid,
      action: isActive ? 'DRIVER_ACTIVE' : 'DRIVER_DESACTIVE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: reason ?? (isActive ? 'Livreur réactivé.' : 'Livreur désactivé.'),
      previousValues: { isActive: actuel.isActive },
      newValues: { isActive },
    });

    return this.findById(uuid);
  }

  /** Comptes sans fiche livreur : candidats au rattachement depuis l'écran. */
  async comptesDisponibles(): Promise<Array<{ id: string; fullName: string; email: string; phone: string }>> {
    const prisma = getPrisma();
    const comptes = await prisma.user.findMany({
      where: { deletedAt: null, driverProfile: null },
      select: { id: true, fullName: true, email: true, phone: true },
      orderBy: { fullName: 'asc' },
      take: 200,
    });
    return comptes;
  }

}

export const driversService = new DriversService();
