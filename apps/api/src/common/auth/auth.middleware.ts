import { identifyAuditActor } from '../audit/audit-context';
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './jwt.util';
import { sessionService } from './session.service';
import { getPrisma } from '../database/prisma-context';
import { isUuid } from '../errors/api-error';
import { getPermissionsForRole } from './permissions.map';
import { RoleType, PermissionCode } from '@logixpress/types';

// Extension de l'interface Request Express pour transporter l'utilisateur et son périmètre
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    fullName: string;
    role: RoleType;
    permissions: PermissionCode[];
    shipperId?: string;
    shipperName?: string;
    driverId?: string;
    driverName?: string;
    depositId?: string;
    /** Session (`Session.id`) du jeton présenté. */
    sessionId?: string;
  };
  dataScope?: {
    shipperId?: string;
    assignedDriverId?: string;
    depositId?: string;
  };
}

/**
 * Middleware d'authentification par JWT Bearer Token.
 *
 * Le jeton seul ne suffit pas : la session qu'il désigne (`sid`) doit être
 * ouverte, et le compte (ainsi que la fiche livreur ou l'expéditeur rattaché)
 * toujours actif. Une déconnexion ou une désactivation prend donc effet à la
 * requête suivante, sans attendre l'expiration du jeton d'accès.
 */
export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({
      success: false,
      message: 'Authentification requise : Jeton d\'accès (Bearer Token) manquant',
    });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload || !payload.sid) {
    res.status(401).json({
      success: false,
      message: 'Session expirée ou jeton invalide. Veuillez vous reconnecter.',
    });
    return;
  }

  let check;
  try {
    check = await sessionService.check(payload.sid, payload.sub);
  } catch (error) {
    next(error);
    return;
  }
  if (!check.ok) {
    res.status(401).json({
      success: false,
      message:
        check.reason === 'session'
          ? 'Session expirée ou fermée. Veuillez vous reconnecter.'
          : 'Votre compte est désactivé. Veuillez contacter l\'administrateur.',
    });
    return;
  }

  const role = payload.role as RoleType;
  const permissions = getPermissionsForRole(role);
  if (permissions.length === 0) {
    res.status(403).json({ success: false, message: 'Rôle inconnu : accès refusé.' });
    return;
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    fullName: payload.fullName || 'Utilisateur',
    role,
    permissions,
    shipperId: payload.shipperId,
    shipperName: payload.shipperName,
    driverId: payload.driverId,
    driverName: payload.driverName,
    depositId: payload.depositId,
    sessionId: payload.sid,
  };

  // Le journal d'audit doit nommer l'auteur. L'identité est ouverte à ce
  // moment-là, pas avant : une requête refusée reste une requête, et son
  // adresse doit pouvoir être relevée même sans session.
  identifyAuditActor({ id: payload.sub, fullName: req.user.fullName, role });

  // Périmètre d'isolation des données (Data Scoping)
  //
  // Un rôle « cantonné » (expéditeur, livreur, magasinier) n'existe que par
  // rapport à son entreprise, sa fiche chauffeur ou son dépôt. Sans cet
  // identifiant il n'a rien à quoi se comparer : la réponse est un refus,
  // jamais une requête sans filtre. Les services écrivent leurs filtres
  // `if (scope?.x)`, où un périmètre absent se lirait « tout le parc ».
  if (role === RoleType.EXPEDITEUR) {
    if (!payload.shipperId) {
      res.status(403).json({
        success: false,
        message:
          "Aucun expéditeur n'est associé à votre compte. Contactez l'administrateur RUNEX.",
      });
      return;
    }
    req.dataScope = { shipperId: payload.shipperId };
  } else if (role === RoleType.LIVREUR) {
    if (!payload.driverId) {
      res.status(403).json({
        success: false,
        message:
          "Votre compte livreur n'est rattaché à aucune fiche chauffeur. Contactez l'administrateur RUNEX.",
      });
      return;
    }
    req.dataScope = { assignedDriverId: payload.driverId };
  } else if (role === RoleType.AGENT_DEPOT) {
    if (!payload.depositId) {
      res.status(403).json({
        success: false,
        message: "Aucun dépôt n'est rattaché à votre compte. Contactez l'administrateur RUNEX.",
      });
      return;
    }
    req.dataScope = { depositId: payload.depositId };
  } else {
    req.dataScope = {}; // Accès global pour ADMIN, GESTIONNAIRE et FINANCE
  }

  next();
}

/**
 * Gardien de rôle (Role-Based Access Control)
 */
export function requireRoles(...allowedRoles: RoleType[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        message: 'Accès refusé : votre profil ne permet pas cette action.',
      });
      return;
    }

    next();
  };
}

/**
 * Gardien de permission granulaire (Permission-Based Access Control)
 */
export function requirePermissions(...requiredPermissions: PermissionCode[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }

    // Si ADMIN, permission accordée d'office
    if (req.user.role === RoleType.ADMIN) {
      next();
      return;
    }

    const hasAll = requiredPermissions.every((perm) => req.user?.permissions.includes(perm));
    if (!hasAll) {
      res.status(403).json({
        success: false,
        message: `Accès refusé. Permissions requises : [${requiredPermissions.join(', ')}]`,
      });
      return;
    }

    next();
  };
}

/**
 * Gardien « au moins une des permissions » .
 *
 * Utilisé pour les opérations que deux profils différents doivent pouvoir
 * effectuer, chacun au titre de son propre rôle : le livreur qui livre les
 * colis qui lui sont affectés (COLIS_DELIVER) et le rôle d'exploitation qui
 * enregistre une livraison depuis le back-office (COLIS_UPDATE). Exiger les
 * deux permissions priverait l'un des deux profils de l'opération.
 */
export function requireAnyPermission(...acceptedPermissions: PermissionCode[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }

    if (req.user.role === RoleType.ADMIN) {
      next();
      return;
    }

    const hasOne = acceptedPermissions.some((perm) => req.user?.permissions.includes(perm));
    if (!hasOne) {
      res.status(403).json({
        success: false,
        message: `Accès refusé. Permissions acceptées : [${acceptedPermissions.join(' ou ')}]`,
      });
      return;
    }

    next();
  };
}

/**
 * Dépôt effectif d'une opération de magasin.
 *
 * Un magasinier (périmètre `depositId`) opère dans SON dépôt : un autre dépôt
 * existant demandé dans le corps ou l'URL est refusé (403). Une valeur mal
 * formée ou inconnue est transmise telle quelle au service, qui répond 400
 * « dépôt invalide » comme pour tout autre profil. Les profils globaux peuvent
 * choisir le dépôt, à défaut celui de leur compte.
 */
export async function resolveOperatingDeposit(
  req: AuthenticatedRequest,
  requested: unknown
): Promise<string | null> {
  const wanted = typeof requested === 'string' && requested.trim() ? requested.trim() : null;
  const scoped = req.dataScope?.depositId;
  if (scoped) {
    if (wanted && wanted !== scoped && isUuid(wanted)) {
      const exists = await getPrisma().deposit.findUnique({ where: { id: wanted }, select: { id: true } });
      if (exists) {
        const err = new Error('Vous ne pouvez opérer que dans votre propre dépôt.') as Error & { status: number };
        err.status = 403;
        throw err;
      }
    }
    return wanted ?? scoped;
  }
  return wanted ?? req.user?.depositId ?? null;
}
