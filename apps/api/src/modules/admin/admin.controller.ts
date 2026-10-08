/**
 * Contrôleurs d'administration : comptes, expéditeurs, livreurs.
 *
 * Le contrôleur ne contient aucune règle métier. Il fait trois choses : lire la
 * requête, répondre avec le bon code HTTP, et laisser le service lever l'erreur.
 * Les erreurs sont levées (`badRequest`, `conflict`, `notFound`) et non
 * retournées : c'est le gestionnaire global qui les traduit, exactement comme
 * dans le reste de l'API.
 *
 * L'autorisation n'est pas ici : elle est portée par `requirePermissions` dans le
 * routeur. Un contrôleur qui vérifierait les droits lui-même créerait un second
 * point de décision, et le jour où l'un des deux diverge, c'est le plus permissif
 * qui gagne.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { badRequest } from '../../common/errors/api-error';
import { usersService, ROLES_SCHEMA, type RoleSchema } from './users.service';
import { shippersService } from './shippers.service';
import { driversService } from './drivers.service';
import { getPrisma } from '../../common/database/prisma-context';

/** Lit un paramètre de requête en chaîne, ou `undefined`. Jamais un tableau. */
function param(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && valeur.trim() !== '' ? valeur : undefined;
}

/** Lit un entier de pagination. Une valeur illisible retombe sur le défaut. */
function entier(valeur: unknown): number | undefined {
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** Lit un booléen de corps de requête en tolérant les chaînes « true »/« false ». */
function booleen(valeur: unknown): boolean | undefined {
  if (typeof valeur === 'boolean') return valeur;
  if (valeur === 'true') return true;
  if (valeur === 'false') return false;
  return undefined;
}

function acteur(req: AuthenticatedRequest) {
  return { id: req.user?.id ?? null };
}

export class UsersController {
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const resultat = await usersService.findAll({
      search: param(req.query.search),
      role: param(req.query.role),
      status: param(req.query.status),
      page: entier(req.query.page),
      limit: entier(req.query.limit),
    });
    res.json({ success: true, data: resultat.items, meta: { total: resultat.total, page: resultat.page, limit: resultat.limit } });
  }

  /** Référentiels nécessaires aux formulaires : rôles et expéditeurs rattachables. */
  async referentiels(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const [roles, expediteurs, depots] = await Promise.all([
      usersService.rolesDisponibles(),
      shippersService.findAll({ status: 'actif', limit: 100 }),
      driversService.comptesDisponibles(),
    ]);
    const listeDepots = await getPrisma().deposit.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({
      success: true,
      data: {
        roles,
        expediteurs: expediteurs.items.map((e) => ({ id: e.id, code: e.code, companyName: e.companyName })),
        depots: listeDepots,
        comptesSansLivreur: depots,
      },
    });
  }

  async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await usersService.findById(req.params.id!);
    res.json({ success: true, data: user });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.body ?? {};
    const role = body.role as RoleSchema | undefined;
    if (!role || !(ROLES_SCHEMA as readonly string[]).includes(role)) {
      throw badRequest(`Le rôle est obligatoire. Valeurs acceptées : ${ROLES_SCHEMA.join(', ')}.`);
    }
    const user = await usersService.create(
      {
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        password: body.password,
        role,
        isActive: booleen(body.isActive),
        shipperId: body.shipperId ?? null,
        driverId: body.driverId ?? null,
        depositId: body.depositId ?? null,
      },
      acteur(req)
    );
    res.status(201).json({ success: true, data: user, message: `Compte « ${user.fullName} » créé.` });
  }

  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.body ?? {};
    const user = await usersService.update(
      req.params.id!,
      {
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.password !== undefined ? { password: body.password } : {}),
        ...(body.role !== undefined ? { role: body.role as RoleSchema } : {}),
        ...(body.shipperId !== undefined ? { shipperId: body.shipperId } : {}),
        ...(body.driverId !== undefined ? { driverId: body.driverId } : {}),
        ...(body.depositId !== undefined ? { depositId: body.depositId } : {}),
      },
      acteur(req)
    );
    res.json({ success: true, data: user, message: `Compte « ${user.fullName} » mis à jour.` });
  }

  async setStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const isActive = booleen(req.body?.isActive);
    if (isActive === undefined) throw badRequest('Le champ « isActive » est obligatoire (true ou false).');
    const user = await usersService.setStatus(req.params.id!, isActive, param(req.body?.reason) ?? null, acteur(req));
    res.json({
      success: true,
      data: user,
      message: isActive ? `Compte « ${user.fullName} » activé.` : `Compte « ${user.fullName} » désactivé.`,
    });
  }
}

export class ShippersController {
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const resultat = await shippersService.findAll({
      search: param(req.query.search),
      status: param(req.query.status),
      page: entier(req.query.page),
      limit: entier(req.query.limit),
    });
    res.json({ success: true, data: resultat.items, meta: { total: resultat.total, page: resultat.page, limit: resultat.limit } });
  }

  async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const shipper = await shippersService.findById(req.params.id!);
    res.json({ success: true, data: shipper });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.body ?? {};
    const shipper = await shippersService.creerAvecCompte(
      {
        code: body.code,
        companyName: body.companyName,
        brandName: body.brandName ?? null,
        taxId: body.taxId ?? null,
        phone: body.phone,
        phoneSecondary: body.phoneSecondary ?? null,
        email: body.email,
        governorate: body.governorate,
        address: body.address,
        isActive: booleen(body.isActive),
        ...(body.compte
          ? {
              compte: {
                fullName: body.compte.fullName,
                email: body.compte.email,
                phone: body.compte.phone,
                password: body.compte.password,
                role: body.compte.role as RoleSchema | undefined,
              },
            }
          : {}),
      },
      acteur(req)
    );
    res.status(201).json({ success: true, data: shipper, message: `Expéditeur « ${shipper.companyName} » créé.` });
  }

  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const shipper = await shippersService.update(req.params.id!, req.body ?? {}, acteur(req));
    res.json({ success: true, data: shipper, message: `Expéditeur « ${shipper.companyName} » mis à jour.` });
  }

  async setStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const isActive = booleen(req.body?.isActive);
    if (isActive === undefined) throw badRequest('Le champ « isActive » est obligatoire (true ou false).');
    const shipper = await shippersService.setStatus(req.params.id!, isActive, param(req.body?.reason) ?? null, acteur(req));
    res.json({
      success: true,
      data: shipper,
      message: isActive ? `Expéditeur « ${shipper.companyName} » activé.` : `Expéditeur « ${shipper.companyName} » désactivé.`,
    });
  }

  async rattacherCompte(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = param(req.body?.userId);
    if (!userId) throw badRequest('Le champ « userId » est obligatoire.');
    const shipper = await shippersService.rattacherCompte(req.params.id!, userId, acteur(req));
    res.json({ success: true, data: shipper, message: 'Compte rattaché.' });
  }

  async detacherCompte(req: AuthenticatedRequest, res: Response): Promise<void> {
    const shipper = await shippersService.detacherCompte(req.params.id!, req.params.userId!, acteur(req));
    res.json({ success: true, data: shipper, message: 'Compte détaché.' });
  }
}

export class DriversController {
  /** Comptes sans fiche livreur : alimente le sélecteur de rattachement. */
  async listComptesDisponibles(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const comptes = await driversService.comptesDisponibles();
    res.json({ success: true, data: comptes });
  }

  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const resultat = await driversService.findAll({
      search: param(req.query.search),
      status: param(req.query.status),
      page: entier(req.query.page),
      limit: entier(req.query.limit),
    });
    res.json({ success: true, data: resultat.items, meta: { total: resultat.total, page: resultat.page, limit: resultat.limit } });
  }

  async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const driver = await driversService.findById(req.params.id!);
    res.json({ success: true, data: driver });
  }

  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.body ?? {};
    const driver = await driversService.create(
      {
        driverCode: body.driverCode,
        vehicleType: body.vehicleType,
        licensePlate: body.licensePlate ?? null,
        cashCeiling: body.cashCeiling !== undefined ? Number(body.cashCeiling) : undefined,
        userId: body.userId ?? null,
        depositId: body.depositId ?? null,
        isActive: booleen(body.isActive),
        ...(body.compte
          ? {
              compte: {
                fullName: body.compte.fullName,
                email: body.compte.email,
                phone: body.compte.phone,
                password: body.compte.password,
              },
            }
          : {}),
      },
      acteur(req)
    );
    res.status(201).json({ success: true, data: driver, message: `Livreur « ${driver.driverCode} » créé.` });
  }

  async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const body = req.body ?? {};
    const driver = await driversService.update(
      req.params.id!,
      {
        ...(body.vehicleType !== undefined ? { vehicleType: body.vehicleType } : {}),
        ...(body.licensePlate !== undefined ? { licensePlate: body.licensePlate } : {}),
        ...(body.cashCeiling !== undefined ? { cashCeiling: Number(body.cashCeiling) } : {}),
        ...(body.userId !== undefined ? { userId: body.userId } : {}),
        ...(body.depositId !== undefined ? { depositId: body.depositId } : {}),
      },
      acteur(req)
    );
    res.json({ success: true, data: driver, message: `Livreur « ${driver.driverCode} » mis à jour.` });
  }

  async setStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const isActive = booleen(req.body?.isActive);
    if (isActive === undefined) throw badRequest('Le champ « isActive » est obligatoire (true ou false).');
    const driver = await driversService.setStatus(req.params.id!, isActive, param(req.body?.reason) ?? null, acteur(req));
    res.json({
      success: true,
      data: driver,
      message: isActive ? `Livreur « ${driver.driverCode} » activé.` : `Livreur « ${driver.driverCode} » désactivé.`,
    });
  }
}

export const usersController = new UsersController();
export const shippersController = new ShippersController();
export const driversController = new DriversController();
