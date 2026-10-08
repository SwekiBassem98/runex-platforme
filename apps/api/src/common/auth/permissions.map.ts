import { RoleType, PermissionCode } from '@logixpress/types';

/**
 * Matrice de permissions par rôle par défaut (extensible)
 */
export const ROLE_PERMISSIONS: Record<RoleType, PermissionCode[]> = {
  [RoleType.ADMIN]: [
    // L'Admin dispose de toutes les permissions système
    PermissionCode.COLIS_READ,
    PermissionCode.COLIS_CREATE,
    PermissionCode.COLIS_UPDATE,
    PermissionCode.COLIS_CANCEL,
    PermissionCode.COLIS_ASSIGN,
    PermissionCode.COLIS_DELIVER,
    PermissionCode.COLIS_RETURN,
    PermissionCode.EXPEDITEUR_READ,
    PermissionCode.EXPEDITEUR_CREATE,
    PermissionCode.EXPEDITEUR_UPDATE,
    PermissionCode.LIVREUR_READ,
    PermissionCode.LIVREUR_CREATE,
    PermissionCode.LIVREUR_UPDATE,
    PermissionCode.PAYMENT_READ,
    PermissionCode.PAYMENT_VALIDATE,
    PermissionCode.PAYMENT_EXPORT,
    PermissionCode.PAYMENT_CASH_READ,
    PermissionCode.PAYMENT_CASH_VALIDATE,
    PermissionCode.RUNSHEET_READ,
    PermissionCode.RUNSHEET_CREATE,
    PermissionCode.RUNSHEET_VALIDATE,
    PermissionCode.REPORT_READ,
    PermissionCode.REPORT_EXPORT,
    PermissionCode.AUDIT_READ,
    PermissionCode.SEARCH_GLOBAL,
    PermissionCode.INVENTORY_READ,
    PermissionCode.INVENTORY_EXPORT,
    PermissionCode.DEPOT_SCAN,
    PermissionCode.DEPOT_READ,
    PermissionCode.DEPOT_MANAGE,
    PermissionCode.INTERDEPOT_READ,
    PermissionCode.INTERDEPOT_MANAGE,
    PermissionCode.RAMASSAGE_READ,
    PermissionCode.RAMASSAGE_DEMANDE,
    PermissionCode.RAMASSAGE_MANAGE,
    // Administration des comptes : réservée à l'Admin. Ni le gestionnaire ni la
    // caisse ne créent de comptes — sinon n'importe quel profil d'exploitation
    // pourrait s'ouvrir un accès administrateur.
    PermissionCode.USER_READ,
    PermissionCode.USER_CREATE,
    PermissionCode.USER_UPDATE,
  ],

  [RoleType.GESTIONNAIRE]: [
    // Exploitation quotidienne & dispatching
    PermissionCode.COLIS_READ,
    PermissionCode.COLIS_CREATE,
    PermissionCode.COLIS_UPDATE,
    PermissionCode.COLIS_CANCEL,
    PermissionCode.COLIS_ASSIGN,
    PermissionCode.COLIS_RETURN,
    PermissionCode.EXPEDITEUR_READ,
    PermissionCode.LIVREUR_READ,
    PermissionCode.RUNSHEET_READ,
    PermissionCode.RUNSHEET_CREATE,
    PermissionCode.RUNSHEET_VALIDATE,
    PermissionCode.DEPOT_SCAN,
    PermissionCode.DEPOT_READ,
    PermissionCode.DEPOT_MANAGE,
    PermissionCode.INTERDEPOT_READ,
    PermissionCode.INTERDEPOT_MANAGE,
    PermissionCode.RAMASSAGE_READ,
    PermissionCode.RAMASSAGE_DEMANDE,
    PermissionCode.RAMASSAGE_MANAGE,
    PermissionCode.REPORT_READ,
    PermissionCode.REPORT_EXPORT,
    PermissionCode.SEARCH_GLOBAL,
    PermissionCode.INVENTORY_READ,
    PermissionCode.INVENTORY_EXPORT,
  ],

  [RoleType.EXPEDITEUR]: [
    // Fournisseur : gestion de ses propres colis et bordereaux
    PermissionCode.COLIS_READ,
    PermissionCode.COLIS_CREATE,
    PermissionCode.COLIS_UPDATE,
    PermissionCode.COLIS_CANCEL,
    PermissionCode.PAYMENT_READ,
    PermissionCode.REPORT_READ,
    PermissionCode.RAMASSAGE_READ,
    PermissionCode.RAMASSAGE_DEMANDE,
  ],

  [RoleType.LIVREUR]: [
    // Chauffeur : exécution de tournée et livraison dernier km
    PermissionCode.COLIS_READ,
    PermissionCode.COLIS_DELIVER,
    PermissionCode.COLIS_RETURN,
    PermissionCode.RUNSHEET_READ,
    PermissionCode.RAMASSAGE_READ,
    PermissionCode.DEPOT_READ,
    PermissionCode.INTERDEPOT_READ,
  ],

  [RoleType.AGENT_DEPOT]: [
    // Magasinier : scan réception, préparation inter-dépôts et conformité retours
    PermissionCode.COLIS_READ,
    PermissionCode.DEPOT_SCAN,
    PermissionCode.DEPOT_READ,
    PermissionCode.INTERDEPOT_READ,
    PermissionCode.INTERDEPOT_MANAGE,
    PermissionCode.RUNSHEET_READ,
  ],

  [RoleType.FINANCE]: [
    // Caissier / Responsable comptable : rapprochement et décaissement
    PermissionCode.PAYMENT_READ,
    PermissionCode.PAYMENT_VALIDATE,
    PermissionCode.PAYMENT_EXPORT,
    PermissionCode.PAYMENT_CASH_READ,
    PermissionCode.PAYMENT_CASH_VALIDATE,
    PermissionCode.RUNSHEET_READ,
    PermissionCode.RUNSHEET_VALIDATE,
    PermissionCode.REPORT_READ,
    PermissionCode.AUDIT_READ,
    PermissionCode.INVENTORY_READ,
  ],
};

/**
 * Obtient la liste des permissions associées à un rôle
 */
export function getPermissionsForRole(role: RoleType): PermissionCode[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Vérifie si une liste de permissions contient une permission requise
 */
export function hasPermission(userPermissions: PermissionCode[], required: PermissionCode): boolean {
  return userPermissions.includes(required);
}

/**
 * Vérifie si l'utilisateur possède l'un des rôles autorisés
 */
export function hasAnyRole(userRole: RoleType, allowedRoles: RoleType[]): boolean {
  return allowedRoles.includes(userRole);
}
