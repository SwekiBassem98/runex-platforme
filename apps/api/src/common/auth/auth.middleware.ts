import { identifyAuditActor } from '../audit/audit-context';
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './jwt.util';
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
  };
  dataScope?: {
    shipperId?: string;
    assignedDriverId?: string;
    depositId?: string;
  };
}

/**
 * Middleware d'authentification par JWT Bearer Token
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
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
  if (!payload) {
    res.status(401).json({
      success: false,
      message: 'Session expirée ou jeton invalide. Veuillez vous reconnecter.',
    });
    return;
  }

  const role = payload.role as RoleType;
  const permissions = getPermissionsForRole(role);

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
  };

  // Le journal d'audit doit nommer l'auteur. L'identité est ouverte à ce
  // moment-là, pas avant : une requête refusée reste une requête, et son
  // adresse doit pouvoir être relevée même sans session.
  identifyAuditActor({ id: payload.sub, fullName: req.user.fullName, role });

  // Périmètre d'isolation des données (Data Scoping)
  //
  // Un expéditeur n'existe que par rapport à une entreprise : sans `shipperId`,
  // il n'a rien à quoi se comparer. La réponse est donc un refus, jamais une
  // requête sans filtre. Les autres filtres de la chaîne `where` sont écrits
  // comme `if (scope?.shipperId)`, et un périmètre absent s'y lirait comme
  // « pas de contrainte » — c'est-à-dire « tout le parc ». Le refus est posé ici,
  // une seule fois, plutôt que dans chaque service.
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
    req.dataScope = { assignedDriverId: payload.driverId };
  } else if (role === RoleType.AGENT_DEPOT) {
    req.dataScope = { depositId: payload.depositId };
  } else {
    req.dataScope = {}; // Accès global pour ADMIN et GESTIONNAIRE
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
        message: `Accès refusé. Rôle requis : [${allowedRoles.join(', ')}]. Votre rôle : ${req.user.role}`,
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
