/**
 * Administration des expéditeurs (fiches entreprise).
 *
 * Une fiche expéditeur n'est pas un compte : c'est l'entreprise. Les comptes qui
 * s'y rattachent vivent dans `ShipperUser`. Les deux sont administrés ici, mais
 * séparément — confondre la fiche et le compte ferait croire qu'on peut créer
 * une entreprise en créant un utilisateur.
 *
 * ## Statistiques
 *
 * Le nombre de colis est demandé sur la liste. Le calculer par ligne avec un
 * `_count` déclenche une sous-requête par fiche ; sur un écran paginé à 25 lignes
 * cela reste acceptable, mais la consigne est de ne pas payer ce prix sans
 * raison. On fait donc **une** requête groupée bornée aux identifiants de la
 * page courante, et jamais sur toute la table.
 *
 * `ShipperConfig.secretPaymentCode` n'est jamais sérialisé : c'est le code qui
 * débloque un décaissement en caisse.
 */

import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { badRequest, conflict, notFound, asUuid } from '../../common/errors/api-error';
import { usersService, type ActorRef, type RoleSchema } from './users.service';

export interface ShipperDto {
  id: string;
  code: string;
  companyName: string;
  brandName: string | null;
  taxId: string | null;
  phone: string;
  phoneSecondary: string | null;
  email: string;
  governorate: string;
  address: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Nombre de colis — présent sur la liste comme sur le détail. */
  packagesCount?: number;
  /**
   * Dernière activité constatée, ou `null` quand il n'y en a jamais eu.
   *
   * Un expéditeur sans activité renvoie `null` et non `0` ni une date inventée :
   * l'écran affiche « aucune activité » plutôt qu'un chiffre faux.
   */
  lastActivityAt?: string | null;
  /** Comptes rattachés. Absent de la liste : ce n'est pas une donnée de tableau. */
  users?: Array<{ id: string; fullName: string; email: string; isActive: boolean; role: RoleSchema | null }>;
}

export interface ShipperQuery {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

const SHIPPER_SELECT = {
  id: true,
  code: true,
  companyName: true,
  brandName: true,
  taxId: true,
  phone: true,
  phoneSecondary: true,
  email: true,
  governorate: true,
  address: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ShipperSelect;

type ShipperRecord = Prisma.ShipperGetPayload<{ select: typeof SHIPPER_SELECT }>;

function toDto(s: ShipperRecord): ShipperDto {
  return {
    id: s.id,
    code: s.code,
    companyName: s.companyName,
    brandName: s.brandName,
    taxId: s.taxId,
    phone: s.phone,
    phoneSecondary: s.phoneSecondary,
    email: s.email,
    governorate: s.governorate,
    address: s.address,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class ShippersService {
  async findAll(query: ShipperQuery): Promise<{ items: ShipperDto[]; total: number; page: number; limit: number }> {
    const prisma = getPrisma();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

    const where: Prisma.ShipperWhereInput = { deletedAt: null };
    const termes = query.search?.trim();
    if (termes) {
      where.OR = [
        { companyName: { contains: termes, mode: 'insensitive' } },
        { brandName: { contains: termes, mode: 'insensitive' } },
        { code: { contains: termes, mode: 'insensitive' } },
        { email: { contains: termes, mode: 'insensitive' } },
        { phone: { contains: termes, mode: 'insensitive' } },
      ];
    }
    if (query.status === 'actif') where.isActive = true;
    else if (query.status === 'inactif') where.isActive = false;

    const [records, total] = await Promise.all([
      prisma.shipper.findMany({
        where,
        select: SHIPPER_SELECT,
        orderBy: { companyName: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.shipper.count({ where }),
    ]);

    // Un seul aller-retour pour les compteurs de toute la page.
    const ids = records.map((r) => r.id);
    const compteurs = ids.length
      ? await prisma.package.groupBy({ by: ['shipperId'], where: { shipperId: { in: ids } }, _count: { _all: true } })
      : [];
    const parId = new Map(compteurs.map((c) => [c.shipperId, c._count._all]));

    return {
      items: records.map((r) => ({ ...toDto(r), packagesCount: parId.get(r.id) ?? 0 })),
      total,
      page,
      limit,
    };
  }

  /** Détail complet : fiche, comptes rattachés, compteurs et dernière activité. */
  async findById(id: string): Promise<ShipperDto & { lastActivityAt: string | null }> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant expéditeur invalide.');

    const record = await prisma.shipper.findFirst({ where: { id: uuid, deletedAt: null }, select: SHIPPER_SELECT });
    if (!record) throw notFound('Expéditeur introuvable.');

    const [compte, comptes, dernier] = await Promise.all([
      prisma.package.count({ where: { shipperId: uuid } }),
      prisma.shipperUser.findMany({
        where: { shipperId: uuid },
        include: { user: { include: { userRoles: { include: { role: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.package.findFirst({
        where: { shipperId: uuid },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      ...toDto(record),
      packagesCount: compte,
      lastActivityAt: dernier?.createdAt.toISOString() ?? null,
      users: comptes.map((su) => ({
        id: su.user.id,
        fullName: su.user.fullName,
        email: su.user.email,
        isActive: su.user.isActive,
        role: (su.user.userRoles[0]?.role.name as RoleSchema | undefined) ?? null,
      })),
    };
  }

  async create(
    input: {
      code: string;
      companyName: string;
      brandName?: string | null;
      taxId?: string | null;
      phone: string;
      phoneSecondary?: string | null;
      email: string;
      governorate: string;
      address: string;
      isActive?: boolean;
    },
    actor: ActorRef
  ): Promise<ShipperDto> {
    const prisma = getPrisma();

    const code = input.code?.trim().toUpperCase();
    const companyName = input.companyName?.trim();
    const email = input.email?.trim().toLowerCase();
    const phone = input.phone?.trim();

    if (!code) throw badRequest('Le code expéditeur est obligatoire.');
    if (!companyName) throw badRequest('La raison sociale est obligatoire.');
    if (!phone) throw badRequest('Le téléphone est obligatoire.');
    if (!email || !EMAIL_PATTERN.test(email)) throw badRequest('Adresse e-mail invalide.');
    if (!input.governorate?.trim()) throw badRequest('Le gouvernorat est obligatoire.');
    if (!input.address?.trim()) throw badRequest("L'adresse est obligatoire.");

    const pris = await prisma.shipper.findUnique({ where: { code } });
    if (pris) throw conflict('Ce code expéditeur est déjà utilisé.');

    const created = await prisma.shipper.create({
      data: {
        code,
        companyName,
        brandName: input.brandName?.trim() || null,
        taxId: input.taxId?.trim() || null,
        phone,
        phoneSecondary: input.phoneSecondary?.trim() || null,
        email,
        governorate: input.governorate.trim(),
        address: input.address.trim(),
        isActive: input.isActive !== false,
      },
      select: SHIPPER_SELECT,
    });

    await auditService.record({
      entityType: 'SHIPPER',
      entityId: created.id,
      action: 'SHIPPER_CREE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: `Création de l'expéditeur ${created.companyName} (${created.code}).`,
      newValues: { code: created.code, companyName: created.companyName, email },
    });

    return toDto(created);
  }

  async update(
    id: string,
    input: Partial<{
      companyName: string;
      brandName: string | null;
      taxId: string | null;
      phone: string;
      phoneSecondary: string | null;
      email: string;
      governorate: string;
      address: string;
    }>,
    actor: ActorRef
  ): Promise<ShipperDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant expéditeur invalide.');

    const actuel = await prisma.shipper.findFirst({ where: { id: uuid, deletedAt: null }, select: SHIPPER_SELECT });
    if (!actuel) throw notFound('Expéditeur introuvable.');

    const data: Prisma.ShipperUpdateInput = {};
    for (const champ of ['companyName', 'brandName', 'taxId', 'phone', 'phoneSecondary', 'email', 'governorate', 'address'] as const) {
      const valeur = input[champ];
      if (valeur === undefined) continue;
      if (valeur === null) {
        // Seuls les champs réellement facultatifs peuvent être vidés.
        if (champ === 'companyName' || champ === 'phone' || champ === 'email' || champ === 'governorate' || champ === 'address') {
          throw badRequest(`Le champ « ${champ} » est obligatoire.`);
        }
        (data as Record<string, unknown>)[champ] = null;
        continue;
      }
      const v = valeur.trim();
      if (champ === 'email' && !EMAIL_PATTERN.test(v)) throw badRequest('Adresse e-mail invalide.');
      (data as Record<string, unknown>)[champ] = champ === 'email' ? v.toLowerCase() : v;
    }

    const updated = await prisma.shipper.update({ where: { id: uuid }, data, select: SHIPPER_SELECT });
    const apres = toDto(updated);

    await auditService.record({
      entityType: 'SHIPPER',
      entityId: uuid,
      action: 'SHIPPER_MODIFIE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      previousValues: toDto(actuel),
      newValues: apres,
    });

    return apres;
  }

  async setStatus(id: string, isActive: boolean, reason: string | null, actor: ActorRef): Promise<ShipperDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant expéditeur invalide.');

    const actuel = await prisma.shipper.findFirst({ where: { id: uuid, deletedAt: null }, select: SHIPPER_SELECT });
    if (!actuel) throw notFound('Expéditeur introuvable.');
    if (actuel.isActive === isActive) return toDto(actuel);

    const updated = await prisma.shipper.update({
      where: { id: uuid },
      data: { isActive },
      select: SHIPPER_SELECT,
    });

    await auditService.record({
      entityType: 'SHIPPER',
      entityId: uuid,
      action: isActive ? 'SHIPPER_ACTIVE' : 'SHIPPER_DESACTIVE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: reason ?? (isActive ? 'Expéditeur réactivé.' : 'Expéditeur désactivé.'),
      previousValues: { isActive: actuel.isActive },
      newValues: { isActive },
    });

    return toDto(updated);
  }

  /**
   * Rattache un compte existant à cet expéditeur.
   *
   * `ShipperUser.userId` est unique : un compte ne peut appartenir qu'à une seule
   * entreprise. Tenter de le déplacer ailleurs est refusé explicitement plutôt
   * que silencieusement écrasé — un rattachement involontaire donnerait à un
   * expéditeur l'accès aux colis d'un autre.
   */
  async rattacherCompte(shipperId: string, userId: string, actor: ActorRef): Promise<ShipperDto> {
    const prisma = getPrisma();
    const sUuid = asUuid(shipperId);
    const uUuid = asUuid(userId);
    if (!sUuid) throw badRequest('Identifiant expéditeur invalide.');
    if (!uUuid) throw badRequest('Identifiant utilisateur invalide.');

    const shipper = await prisma.shipper.findFirst({ where: { id: sUuid, deletedAt: null }, select: SHIPPER_SELECT });
    if (!shipper) throw notFound('Expéditeur introuvable.');
    const user = await prisma.user.findFirst({ where: { id: uUuid, deletedAt: null } });
    if (!user) throw notFound('Utilisateur introuvable.');

    const deja = await prisma.shipperUser.findUnique({ where: { userId: uUuid } });
    if (deja && deja.shipperId !== sUuid) {
      throw conflict('Ce compte est déjà rattaché à un autre expéditeur.');
    }

    await prisma.shipperUser.upsert({
      where: { userId: uUuid },
      create: { shipperId: sUuid, userId: uUuid },
      update: { shipperId: sUuid },
    });

    await auditService.record({
      entityType: 'SHIPPER',
      entityId: sUuid,
      action: 'USER_COMPTE_ASSOCIE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: `Compte ${user.email} rattaché à l'expéditeur ${shipper.companyName}.`,
      newValues: { userId: uUuid, shipperId: sUuid },
    });

    return this.findById(sUuid);
  }

  /** Détache un compte de cet expéditeur. */
  async detacherCompte(shipperId: string, userId: string, actor: ActorRef): Promise<ShipperDto> {
    const prisma = getPrisma();
    const sUuid = asUuid(shipperId);
    const uUuid = asUuid(userId);
    if (!sUuid) throw badRequest('Identifiant expéditeur invalide.');
    if (!uUuid) throw badRequest('Identifiant utilisateur invalide.');

    const lien = await prisma.shipperUser.findUnique({ where: { userId: uUuid } });
    if (!lien) throw notFound("Ce compte n'est pas rattaché à un expéditeur.");
    // Vérifier le rattachement demandé empêche de détacher un compte d'une
    // entreprise à laquelle il n'appartient pas via un identifiant deviné.
    if (lien.shipperId !== sUuid) throw notFound("Ce compte n'est pas rattaché à cet expéditeur.");

    await prisma.shipperUser.delete({ where: { userId: uUuid } });

    await auditService.record({
      entityType: 'SHIPPER',
      entityId: sUuid,
      action: 'USER_COMPTE_ASSOCIE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: `Compte ${uUuid} détaché de l'expéditeur.`,
      previousValues: { userId: uUuid, shipperId: sUuid },
      newValues: { userId: uUuid, shipperId: null },
    });

    return this.findById(sUuid);
  }

  /** Crée l'entreprise et son premier compte en une seule opération. */
  async creerAvecCompte(
    input: {
      code: string;
      companyName: string;
      brandName?: string | null;
      taxId?: string | null;
      phone: string;
      phoneSecondary?: string | null;
      email: string;
      governorate: string;
      address: string;
      isActive?: boolean;
      compte?: { fullName: string; email: string; phone: string; password: string; role?: RoleSchema };
    },
    actor: ActorRef
  ): Promise<ShipperDto> {
    const shipper = await this.create(input, actor);
    if (input.compte) {
      await usersService.create(
        {
          fullName: input.compte.fullName,
          email: input.compte.email,
          phone: input.compte.phone,
          password: input.compte.password,
          role: input.compte.role ?? 'EXPEDITEUR_USER',
          isActive: input.isActive !== false,
          shipperId: shipper.id,
        },
        actor
      );
    }
    return this.findById(shipper.id);
  }
}

export const shippersService = new ShippersService();
