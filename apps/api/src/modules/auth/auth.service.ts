/**
 * Service d'authentification.
 *
 * Les comptes sont lus dans PostgreSQL via Prisma : le jeton porte donc les
 * identifiants réels (UUID d'expéditeur, de livreur, de dépôt), ce qui permet
 * aux modules métier d'opérer directement sur la base.
 *
 * Le rôle est celui du modèle d'autorisation de l'API (`RoleType`), obtenu par
 * correspondance avec les rôles du schéma (`prisma`).
 */

import { Prisma } from '@prisma/client';
import { RoleType } from '@logixpress/types';
import type { AuthUser, LoginResponse } from '@logixpress/types';
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  verifyRefreshToken,
} from '../../common/auth/jwt.util';
import { getPermissionsForRole } from '../../common/auth/permissions.map';
import { getPrisma } from '../../common/database/prisma-context';
import crypto from 'node:crypto';

interface PasswordResetRequest {
  email: string;
  token: string;
  expiresAt: number;
}

/**
 * Rôles du schéma relationnel et rôle d'autorisation de l'API.
 *
 * Point de conversion central : le schéma distingue huit rôles là où l'API en
 * connaît six. Ce mapping est le seul endroit où la correspondance est décidée.
 */
const PRISMA_ROLE_TO_API_ROLE: Record<string, RoleType> = {
  SUPER_ADMIN: RoleType.ADMIN,
  ADMIN_GENERAL: RoleType.ADMIN,
  DISPATCHER: RoleType.GESTIONNAIRE,
  MAGASINIER: RoleType.AGENT_DEPOT,
  CAISSIER: RoleType.FINANCE,
  EXPEDITEUR_ADMIN: RoleType.EXPEDITEUR,
  EXPEDITEUR_USER: RoleType.EXPEDITEUR,
  LIVREUR: RoleType.LIVREUR,
};

/** Charge utilePrisma nécessaire à l'hydratation d'un utilisateur authentifié. */
const USER_INCLUDE = {
  userRoles: { include: { role: true } },
  shipperUser: { include: { shipper: true } },
  driverProfile: true,
  deposit: true,
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/** Libellé affiché pour chaque rôle, utilisé par l'écran de démonstration. */
const ROLE_DISPLAY_NAMES: Record<RoleType, string> = {
  ADMIN: 'Administrateur',
  GESTIONNAIRE: 'Gestionnaire',
  EXPEDITEUR: 'Expéditeur',
  LIVREUR: 'Livreur',
  AGENT_DEPOT: 'Agent Dépôt',
  FINANCE: 'Finance',
};

export class AuthService {
  /** Jetons de rafraîchissement actifs (le refresh token est à usage unique). */
  private activeRefreshTokens = new Set<string>();

  private resetTokens = new Map<string, PasswordResetRequest>();

  /**
   * Traduit un enregistrement Prisma en utilisateur authentifié.
   *
   * Les identifiants métier (expéditeur, livreur, dépôt) proviennent des
   * relations : ce sont les UUID réellement stockés en base.
   */
  private mapToAuthUser(user: UserWithRelations): AuthUser {
    // L'utilisateur peut porter plusieurs rôles : celui de plus haut niveau
    // d'habilitation l'emporte, dans l'ordre de priorité ci-dessous.
    const priority: RoleType[] = [
      RoleType.ADMIN,
      RoleType.GESTIONNAIRE,
      RoleType.FINANCE,
      RoleType.AGENT_DEPOT,
      RoleType.EXPEDITEUR,
      RoleType.LIVREUR,
    ];

    const roles = user.userRoles
      .map((assignment) => PRISMA_ROLE_TO_API_ROLE[assignment.role.name])
      .filter((role): role is RoleType => Boolean(role));

    const role =
      priority.find((candidate) => roles.includes(candidate)) ?? RoleType.LIVREUR;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role,
      permissions: getPermissionsForRole(role),
      shipperId: user.shipperUser?.shipperId,
      shipperName:
        user.shipperUser?.shipper.brandName ?? user.shipperUser?.shipper.companyName,
      driverId: user.driverProfile?.id,
      driverName: user.driverProfile ? user.fullName : undefined,
      depositId: user.depositId ?? undefined,
      depositName: user.deposit?.name,
    };
  }

  /**
   * Charge un utilisateur et ses relations depuis la base.
   */
  private async findUser(idOrEmail: string, byEmail = false): Promise<UserWithRelations | null> {
    const prisma = getPrisma();
    return byEmail
      ? prisma.user.findUnique({
          where: { email: idOrEmail.toLowerCase() },
          include: USER_INCLUDE,
        })
      : prisma.user.findUnique({ where: { id: idOrEmail }, include: USER_INCLUDE });
  }

  async login(email: string, passwordPlain: string): Promise<LoginResponse> {
    const user = await this.findUser(email, true);

    // Message volontairement identique que l'utilisateur n'existe pas ou que le
    // mot de passe est faux : ne pas révéler quelles adresses existent.
    const invalidCredentials = new Error(
      'Identifiants incorrects. Veuillez vérifier votre adresse email et votre mot de passe.'
    );

    if (!user) throw invalidCredentials;
    if (!user.isActive || user.deletedAt) {
      throw new Error("Votre compte est désactivé. Veuillez contacter l'administrateur.");
    }

    if (!verifyPassword(passwordPlain, user.passwordHash)) {
      throw invalidCredentials;
    }

    const authUser = this.mapToAuthUser(user);
    const tokens = generateTokenPair(authUser);
    this.activeRefreshTokens.add(tokens.refreshToken);

    // Trace la dernière connexion : exploitable par le tableau de bord.
    const prisma = getPrisma();
    void prisma.user
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: authUser,
    };
  }

  /**
   * Renouvellement du jeton d'accès via Refresh Token.
   *
   * Le refresh token est à usage unique : il est retiré de la liste active et
   * remplacé par la nouvelle paire. Toute réutilisation de l'ancien jeton est
   * donc rejetée.
   */
  async refreshAccessToken(refreshToken: string) {
    if (!refreshToken) {
      throw new Error('Jeton de rafraîchissement requis.');
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new Error('Jeton de rafraîchissement invalide ou expiré.');
    }

    if (!this.activeRefreshTokens.has(refreshToken)) {
      throw new Error('Jeton de rafraîchissement déjà utilisé ou révoqué.');
    }

    const user = await this.findUser(payload.sub);
    if (!user || !user.isActive) {
      this.activeRefreshTokens.delete(refreshToken);
      throw new Error('Compte introuvable ou désactivé.');
    }

    this.activeRefreshTokens.delete(refreshToken);

    const authUser = this.mapToAuthUser(user);
    const tokens = generateTokenPair(authUser);
    this.activeRefreshTokens.add(tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: authUser,
    };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      this.activeRefreshTokens.delete(refreshToken);
    } else {
      this.activeRefreshTokens.clear();
    }
  }

  /**
   * Demande de réinitialisation de mot de passe.
   *
   * La réponse reste identique que l'adresse existe ou non, afin de ne pas
   * énumérer les comptes enregistrés.
   */
  async requestPasswordReset(email: string) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000;

    this.resetTokens.set(token, { email: email.toLowerCase(), token, expiresAt });

    const user = await this.findUser(email, true);
    if (user) {
      // En production l'email serait envoyé ici ; on journalise l'événement
      // de sécurité sans exposer le jeton.
      console.log(`[Auth] Demande de réinitialisation pour ${user.email}.`);
    }

    return {
      message: 'Si un compte est associé à cette adresse, un lien de réinitialisation vient d\'être envoyé.',
    };
  }

  async confirmPasswordReset(token: string, newPasswordPlain: string) {
    const request = this.resetTokens.get(token);
    if (!request || request.expiresAt < Date.now()) {
      throw new Error('Jeton de réinitialisation invalide ou expiré.');
    }
    if (newPasswordPlain.length < 8) {
      throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
    }

    const prisma = getPrisma();
    const user = await prisma.user.update({
      where: { email: request.email },
      data: { passwordHash: hashPassword(newPasswordPlain) },
    });

    this.resetTokens.delete(token);
    // Toute session en cours devient caduque après un changement de mot de passe.
    this.activeRefreshTokens.clear();

    return { message: `Mot de passe mis à jour pour ${user.email}.` };
  }

  async getProfile(userId: string): Promise<AuthUser | null> {
    const user = await this.findUser(userId);
    if (!user || !user.isActive) return null;
    return this.mapToAuthUser(user);
  }

  /**
   * Comptes de démonstration, lus en base.
   *
   * Le mot de passe de démonstration n'est stocké nulle part : il est restitué
   * depuis une table locale, uniquement pour les comptes de démonstration.
   */
  async getDemoUsers(): Promise<
    { email: string; role: RoleType; name: string; passwordHint: string }[]
  > {
    const DEMO_PASSWORDS: Record<string, string> = {
      'admin@logixpress.tn': 'Admin123!',
      'gestionnaire@logixpress.tn': 'Gest123!',
      'expediteur@bluestar.tn': 'Exp123!',
      'livreur.hamza@logixpress.tn': 'Liv123!',
      'agent.magasin@logixpress.tn': 'Agent123!',
      'finance@logixpress.tn': 'Fin123!',
    };

    const prisma = getPrisma();
    const users = await prisma.user.findMany({
      where: { email: { in: Object.keys(DEMO_PASSWORDS) } },
      include: USER_INCLUDE,
    });

    return users.map((user) => {
      const apiRole = this.mapToAuthUser(user).role;
      return {
        email: user.email,
        role: apiRole,
        name: `${user.fullName} — ${ROLE_DISPLAY_NAMES[apiRole]}`,
        passwordHint: DEMO_PASSWORDS[user.email] ?? '',
      };
    });
  }
}

export const authService = new AuthService();
