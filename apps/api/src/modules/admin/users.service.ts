/**
 * Administration des comptes utilisateurs.
 *
 * Trois règles ont gouverné ce service.
 *
 * La première, non négociable : **aucune réponse ne contient le hash**. Le DTO
 * est construit champ par champ à partir de l'enregistrement Prisma — jamais par
 * soustraction. Un `{ ...user, passwordHash: undefined }` sérialise correctement
 * en JSON, mais il suffit qu'un jour quelqu'un ajoute `JSON.stringify` dans un
 * journal ou un `res.json(user)` direct pour que le hash parte. Construire la
 * projection rend l'oubli impossible plutôt qu'improbable.
 *
 * La deuxième : le mot de passe passe par `hashPassword`, la même fonction PBKDF2
 * que l'authentification existante. Aucune seconde implémentation.
 *
 * La troisième : l'autorisation ne se délègue pas au client. Le rattachement à un
 * expéditeur est résolu depuis la base, et un `shipperId` fourni par le navigateur
 * n'est accepté que s'il désigne un expéditeur qui existe — l'identité de l'acteur
 * vient toujours du jeton.
 */

import { Prisma, NotificationType } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { hashPassword } from '../../common/auth/jwt.util';
import { auditService } from '../../common/audit/audit.service';
import { notificationService } from '../../common/notifications/notification.service';
import { badRequest, conflict, notFound, asUuid } from '../../common/errors/api-error';

/** Rôles tels que le schéma les stocke. Ce sont eux que l'API accepte en entrée. */
export const ROLES_SCHEMA = [
  'SUPER_ADMIN',
  'ADMIN_GENERAL',
  'DISPATCHER',
  'MAGASINIER',
  'CAISSIER',
  'EXPEDITEUR_ADMIN',
  'EXPEDITEUR_USER',
  'LIVREUR',
] as const;

export type RoleSchema = (typeof ROLES_SCHEMA)[number];

/**
 * Rôles qui exigent un rattachement à un expéditeur.
 *
 * La distinction entre `EXPEDITEUR_ADMIN` et `EXPEDITEUR_USER` est conservée :
 * le schéma les sépare, l'interface les propose séparément, et les fusionner
 * ici ferait perdre une information que la base porte déjà.
 */
const ROLES_EXPEDITEUR: readonly RoleSchema[] = ['EXPEDITEUR_ADMIN', 'EXPEDITEUR_USER'];
const ROLES_LIVREUR: readonly RoleSchema[] = ['LIVREUR'];

/** Ce qu'une réponse expose. `passwordHash` n'y figure pas, et ne peut pas y figurer. */
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roles: RoleSchema[];
  depositId: string | null;
  depositName: string | null;
  shipper: { id: string; companyName: string; code: string } | null;
  driver: { id: string; driverCode: string; vehicleType: string } | null;
}

export interface UserQuery {
  search?: string;
  role?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface ActorRef {
  id?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const USER_INCLUDE = {
  userRoles: { include: { role: true } },
  shipperUser: { include: { shipper: { select: { id: true, companyName: true, code: true } } } },
  driverProfile: { select: { id: true, driverCode: true, vehicleType: true } },
  deposit: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

type UserRecord = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

function toDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    isActive: user.isActive,
    avatarUrl: user.avatarUrl,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    // Les rôles sont rendus tels que la base les stocke : l'écran d'administration
    // doit pouvoir distinguer EXPEDITEUR_ADMIN de EXPEDITEUR_USER.
    roles: user.userRoles.map((a) => a.role.name as RoleSchema),
    depositId: user.depositId,
    depositName: user.deposit?.name ?? null,
    shipper: user.shipperUser
      ? {
          id: user.shipperUser.shipper.id,
          companyName: user.shipperUser.shipper.companyName,
          code: user.shipperUser.shipper.code,
        }
      : null,
    driver: user.driverProfile
      ? {
          id: user.driverProfile.id,
          driverCode: user.driverProfile.driverCode,
          vehicleType: user.driverProfile.vehicleType,
        }
      : null,
  };
}

/** Format d'adresse minimal : présence d'un « @ » et d'un domaine pointé. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function estRoleSchema(valeur: unknown): valeur is RoleSchema {
  return typeof valeur === 'string' && (ROLES_SCHEMA as readonly string[]).includes(valeur);
}

export class UsersService {
  /**
   * Liste paginée, filtrable et cherchable.
   *
   * Les comptes supprimés (`deletedAt`) sont exclus : ils ne sont plus
   * administrables, et les montrer ferait croire qu'on peut les réactiver.
   */
  async findAll(query: UserQuery): Promise<{ items: UserDto[]; total: number; page: number; limit: number }> {
    const prisma = getPrisma();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

    const where: Prisma.UserWhereInput = { deletedAt: null };
    const termes = query.search?.trim();
    if (termes) {
      where.OR = [
        { fullName: { contains: termes, mode: 'insensitive' } },
        { email: { contains: termes, mode: 'insensitive' } },
        { phone: { contains: termes, mode: 'insensitive' } },
      ];
    }
    if (query.role && estRoleSchema(query.role)) {
      where.userRoles = { some: { role: { name: { equals: query.role } } } };
    }
    if (query.status === 'actif') where.isActive = true;
    else if (query.status === 'inactif') where.isActive = false;

    const [records, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return { items: records.map(toDto), total, page, limit };
  }

  async findById(id: string): Promise<UserDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant utilisateur invalide.');

    const user = await prisma.user.findFirst({ where: { id: uuid, deletedAt: null }, include: USER_INCLUDE });
    if (!user) throw notFound('Utilisateur introuvable.');
    return toDto(user);
  }

  /**
   * Crée un compte, son rôle et, selon le rôle, son rattachement métier.
   *
   * L'écriture est transactionnelle : un compte créé sans son rôle, ou un
   * expéditeur rattaché à un compte qui n'existe pas, seraient deux états
   * incohérents qu'aucun écran ne saurait réparer.
   */
  async create(
    input: {
      fullName: string;
      email: string;
      phone: string;
      password: string;
      role: RoleSchema;
      isActive?: boolean;
      shipperId?: string | null;
      driverId?: string | null;
      depositId?: string | null;
    },
    actor: ActorRef
  ): Promise<UserDto> {
    const prisma = getPrisma();

    const fullName = input.fullName?.trim();
    const email = input.email?.trim().toLowerCase();
    const phone = input.phone?.trim();

    if (!fullName) throw badRequest('Le nom complet est obligatoire.');
    if (!email || !EMAIL_PATTERN.test(email)) throw badRequest('Adresse e-mail invalide.');
    if (!phone) throw badRequest('Le téléphone est obligatoire.');
    if (!input.password || input.password.length < 8) {
      throw badRequest('Le mot de passe doit comporter au moins 8 caractères.');
    }
    if (!estRoleSchema(input.role)) {
      throw badRequest(`Rôle inconnu. Valeurs acceptées : ${ROLES_SCHEMA.join(', ')}.`);
    }

    // L'unicité est vérifiée avant l'insertion pour répondre 409 plutôt que de
    // laisser remonter une contrainte SQL en 500.
    const existant = await prisma.user.findUnique({ where: { email } });
    if (existant) throw conflict('Un compte existe déjà avec cette adresse e-mail.');

    const shipperId = await this.resoudreShipper(input.role, input.shipperId);
    const driverId = await this.resoudreDriver(input.role, input.driverId);
    const depositId = await this.resoudreDeposit(input.depositId);

    const roleRow = await prisma.role.findUnique({ where: { name: input.role } });
    if (!roleRow) throw badRequest(`Le rôle « ${input.role} » n'existe pas dans le référentiel.`);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          fullName,
          phone,
          passwordHash: hashPassword(input.password),
          isActive: input.isActive !== false,
          depositId,
          userRoles: { create: { roleId: roleRow.id } },
          ...(shipperId ? { shipperUser: { create: { shipperId } } } : {}),
          ...(driverId ? { driverProfile: { connect: { id: driverId } } } : {}),
        },
        include: USER_INCLUDE,
      });
      return user;
    });

    await auditService.record({
      entityType: 'USER',
      entityId: created.id,
      action: 'USER_CREE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: `Création du compte ${email} avec le rôle ${input.role}.`,
      newValues: { email, fullName, role: input.role, shipperId, driverId },
    });

    // Une seule notification, au titulaire : il découvre à sa première connexion
    // que le compte existe. Aucune notification n'est émise pour les
    // modifications de champ — ce serait du bruit.
    await notificationService
      .notify({
        type: NotificationType.ACCOUNT_CREATED,
        title: 'Votre compte a été créé',
        content: `Votre compte ${email} est actif. Contactez votre administrateur pour toute question.`,
        relatedEntity: 'USER',
        relatedEntityId: created.id,
        userIds: [created.id],
      })
      .catch(() => undefined);

    return toDto(created);
  }

  /**
   * Met à jour un compte.
   *
   * Un champ absent du corps n'est pas touché : `undefined` signifie « inchangé »,
   * là où `null` signifie « vider ». Confondre les deux effacerait un téléphone
   * dès qu'un écran n'envoie que le nom.
   */
  async update(
    id: string,
    input: {
      fullName?: string;
      email?: string;
      phone?: string;
      password?: string;
      role?: RoleSchema;
      isActive?: boolean;
      shipperId?: string | null;
      driverId?: string | null;
      depositId?: string | null;
    },
    actor: ActorRef
  ): Promise<UserDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant utilisateur invalide.');

    const actuel = await prisma.user.findFirst({ where: { id: uuid, deletedAt: null }, include: USER_INCLUDE });
    if (!actuel) throw notFound('Utilisateur introuvable.');

    const avant = toDto(actuel);
    const data: Prisma.UserUncheckedUpdateInput = {};

    if (input.fullName !== undefined) {
      const v = input.fullName.trim();
      if (!v) throw badRequest('Le nom complet ne peut pas être vide.');
      data.fullName = v;
    }
    if (input.phone !== undefined) {
      const v = input.phone.trim();
      if (!v) throw badRequest('Le téléphone ne peut pas être vide.');
      data.phone = v;
    }
    if (input.email !== undefined) {
      const v = input.email.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(v)) throw badRequest('Adresse e-mail invalide.');
      if (v !== actuel.email) {
        const pris = await prisma.user.findUnique({ where: { email: v } });
        if (pris) throw conflict('Un compte existe déjà avec cette adresse e-mail.');
        data.email = v;
      }
    }
    if (input.password !== undefined) {
      if (!input.password || input.password.length < 8) {
        throw badRequest('Le mot de passe doit comporter au moins 8 caractères.');
      }
      data.passwordHash = hashPassword(input.password);
    }
    if (input.depositId !== undefined) data.depositId = await this.resoudreDeposit(input.depositId);

    // Rôle, expéditeur et livreur sont traités ensemble : changer le rôle d'un
    // compte sans revoir son rattachement laisserait un expéditeur sans
    // entreprise, ce que l'écran ne saurait pas afficher.
    const prochainRole = input.role ?? avant.roles[0];
    if (input.role !== undefined && !estRoleSchema(input.role)) {
      throw badRequest(`Rôle inconnu. Valeurs acceptées : ${ROLES_SCHEMA.join(', ')}.`);
    }
    if (input.shipperId !== undefined || input.role !== undefined) {
      const shipperId = await this.resoudreShipper(prochainRole, input.shipperId ?? avant.shipper?.id ?? null);
      data.shipperUser = shipperId
        ? { upsert: { create: { shipperId }, update: { shipperId } } }
        : avant.shipper
          ? { delete: true }
          : undefined;
    }
    if (input.driverId !== undefined) {
      const driverId = await this.resoudreDriver(prochainRole, input.driverId);
      data.driverProfile = driverId ? { connect: { id: driverId } } : { disconnect: true };
    }
    if (input.role !== undefined && input.role !== avant.roles[0]) {
      const roleRow = await prisma.role.findUnique({ where: { name: input.role } });
      if (!roleRow) throw badRequest(`Le rôle « ${input.role} » n'existe pas dans le référentiel.`);
      // Un compte peut porter plusieurs rôles ; l'administration en fixe un seul,
      // explicitement. Les anciens sont retirés dans la même transaction.
      data.userRoles = { deleteMany: {}, create: { roleId: roleRow.id } };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: uuid }, data, include: USER_INCLUDE });
      return user;
    });
    const apres = toDto(updated);

    const champModifies = (['fullName', 'email', 'phone', 'depositId'] as const).filter(
      (c) => JSON.stringify(avant[c]) !== JSON.stringify(apres[c])
    );

    await auditService.record({
      entityType: 'USER',
      entityId: uuid,
      action: 'USER_MODIFIE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: input.password ? 'Mot de passe réinitialisé par un administrateur.' : null,
      previousValues: Object.fromEntries(champModifies.map((c) => [c, avant[c]])),
      newValues: Object.fromEntries(champModifies.map((c) => [c, apres[c]])),
    });

    // Le changement de rôle est l'acte qui modifie des droits : il a sa propre
    // trace, distincte d'une simple modification de fiche.
    if (input.role !== undefined && input.role !== avant.roles[0]) {
      await auditService.record({
        entityType: 'USER',
        entityId: uuid,
        action: 'USER_ROLE_MODIFIE',
        userId: actor.id ?? null,
        userIp: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        reason: `Rôle passé de ${avant.roles[0] ?? 'aucun'} à ${input.role}.`,
        previousValues: { role: avant.roles },
        newValues: { role: [input.role] },
      });
    }

    // Le rattachement à une fiche métier est tracé à part : c'est lui qui ouvre
    // l'accès aux colis d'une entreprise.
    if (JSON.stringify(avant.shipper?.id ?? null) !== JSON.stringify(apres.shipper?.id ?? null)) {
      await auditService.record({
        entityType: 'USER',
        entityId: uuid,
        action: 'USER_COMPTE_ASSOCIE',
        userId: actor.id ?? null,
        userIp: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        reason: apres.shipper
          ? `Compte rattaché à l'expéditeur ${apres.shipper.companyName}.`
          : 'Compte détaché de son expéditeur.',
        previousValues: { shipperId: avant.shipper?.id ?? null },
        newValues: { shipperId: apres.shipper?.id ?? null },
      });
    }

    return apres;
  }

  /** Active ou désactive un compte. Un compte désactivé ne peut plus s'authentifier. */
  async setStatus(id: string, isActive: boolean, reason: string | null, actor: ActorRef): Promise<UserDto> {
    const prisma = getPrisma();
    const uuid = asUuid(id);
    if (!uuid) throw badRequest('Identifiant utilisateur invalide.');

    const actuel = await prisma.user.findFirst({ where: { id: uuid, deletedAt: null } });
    if (!actuel) throw notFound('Utilisateur introuvable.');
    if (actuel.isActive === isActive) return this.findById(uuid);

    const updated = await prisma.user.update({
      where: { id: uuid },
      data: { isActive },
      include: USER_INCLUDE,
    });

    await auditService.record({
      entityType: 'USER',
      entityId: uuid,
      action: isActive ? 'USER_ACTIVE' : 'USER_DESACTIVE',
      userId: actor.id ?? null,
      userIp: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      reason: reason ?? (isActive ? 'Compte réactivé.' : 'Compte désactivé.'),
      previousValues: { isActive: actuel.isActive },
      newValues: { isActive },
    });

    return toDto(updated);
  }

  /**
   * Rattachement à un expéditeur.
   *
   * Pour un rôle expéditeur, l'absence de rattachement est refusée : un compte
   * expéditeur sans entreprise verrait un portail vide, et rien n'expliquerait
   * pourquoi. Pour un autre rôle, un rattachement est refusé aussi — un
   * gestionnaire rattaché à une entreprise serait un privilège déguisé.
   */
  private async resoudreShipper(role: RoleSchema | undefined, shipperId: string | null | undefined): Promise<string | null> {
    const exige = role ? ROLES_EXPEDITEUR.includes(role) : false;
    if (!shipperId) {
      if (exige) throw badRequest('Un expéditeur doit être rattaché à ce rôle.');
      return null;
    }
    const uuid = asUuid(shipperId);
    if (!uuid) throw badRequest('Identifiant expéditeur invalide.');
    const shipper = await getPrisma().shipper.findFirst({ where: { id: uuid, deletedAt: null } });
    if (!shipper) throw badRequest("L'expéditeur demandé n'existe pas.");
    if (!exige) throw badRequest("Seuls les rôles expéditeur peuvent être rattachés à une entreprise.");
    return uuid;
  }

  /**
   * Rattachement à une fiche livreur.
   *
   * `Driver.userId` est unique en base : la contrainte suffit à empêcher qu'un
   * compte porte deux fiches, ou qu'une fiche porte deux comptes. On vérifie
   * ici que la fiche visée n'est pas déjà prise, pour répondre 409 plutôt que
   * de laisser la contrainte remonter en 500.
   */
  private async resoudreDriver(role: RoleSchema | undefined, driverId: string | null | undefined): Promise<string | null> {
    const exige = role ? ROLES_LIVREUR.includes(role) : false;
    if (!driverId) {
      // Une fiche livreur peut être créée après le compte : on ne bloque pas.
      return null;
    }
    const uuid = asUuid(driverId);
    if (!uuid) throw badRequest('Identifiant livreur invalide.');
    const driver = await getPrisma().driver.findFirst({ where: { id: uuid, deletedAt: null } });
    if (!driver) throw badRequest('Le livreur demandé n\'existe pas.');
    if (driver.userId) throw conflict('Ce livreur est déjà rattaché à un compte.');
    if (!exige) throw badRequest('Seul un livreur peut être rattaché à une fiche chauffeur.');
    return uuid;
  }

  private async resoudreDeposit(depositId: string | null | undefined): Promise<string | null> {
    if (!depositId) return null;
    const uuid = asUuid(depositId);
    if (!uuid) throw badRequest('Identifiant dépôt invalide.');
    const deposit = await getPrisma().deposit.findUnique({ where: { id: uuid } });
    if (!deposit) throw badRequest("Le dépôt demandé n'existe pas.");
    return uuid;
  }

  /** Rôles proposés à l'écran, avec leur libellé lisible. */
  async rolesDisponibles(): Promise<Array<{ name: RoleSchema; displayName: string }>> {
    const prisma = getPrisma();
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    return roles
      .filter((r) => (ROLES_SCHEMA as readonly string[]).includes(r.name))
      .map((r) => ({ name: r.name as RoleSchema, displayName: r.displayName }));
  }
}

export const usersService = new UsersService();
