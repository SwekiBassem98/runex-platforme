/**
 * Service d'authentification.
 *
 * Les comptes sont lus dans PostgreSQL via Prisma : le jeton porte donc les
 * identifiants réels (UUID d'expéditeur, de livreur, de dépôt), ce qui permet
 * aux modules métier d'opérer directement sur la base.
 *
 * Le rôle est celui du modèle d'autorisation de l'API (`RoleType`), obtenu par
 * correspondance avec les rôles du schéma (`prisma`).
 *
 * Les sessions sont persistées dans la table `Session` (voir
 * `common/auth/session.service.ts`) : un redémarrage ne déconnecte personne,
 * plusieurs instances partagent les sessions, et la déconnexion ne touche que
 * la session de l'appelant.
 */

import { Prisma } from '@prisma/client';
import { RoleType } from '@logixpress/types';
import type { AuthUser, LoginResponse } from '@logixpress/types';
import {
  hashPassword,
  verifyPasswordAsync,
  hashPasswordAsync,
  passwordNeedsRehash,
  generateTokenPair,
  verifyRefreshToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  passwordFingerprint,
  RESET_TTL_SECONDS,
} from '../../common/auth/jwt.util';
import { passwordResetEmail, sendMail, webAppUrl } from '../../common/mail/mail.service';
import { getPermissionsForRole } from '../../common/auth/permissions.map';
import { msSinceRotation, sessionService, type SessionMeta } from '../../common/auth/session.service';
import { getPrisma } from '../../common/database/prisma-context';
import { ApiError } from '../../common/errors/api-error';

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

/** Charge utile Prisma nécessaire à l'hydratation d'un utilisateur authentifié. */
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

/** Erreur d'authentification : toujours 401 sauf mention contraire. */
const ACCOUNT_LOCKED =
  'Trop de tentatives de connexion échouées pour ce compte. Réessayez dans 15 minutes.';
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MAX_FAILURES = Number(process.env.LOGIN_ACCOUNT_MAX_FAILURES ?? 10);
const failures = new Map<string, { count: number; first: number }>();

function accountLocked(userId: string): boolean {
  const f = failures.get(userId);
  if (!f) return false;
  if (Date.now() - f.first > LOCK_WINDOW_MS) {
    failures.delete(userId);
    return false;
  }
  return f.count >= LOCK_MAX_FAILURES;
}

function recordFailure(userId: string) {
  const f = failures.get(userId);
  if (!f || Date.now() - f.first > LOCK_WINDOW_MS) failures.set(userId, { count: 1, first: Date.now() });
  else f.count += 1;
}

function clearFailures(userId: string) {
  failures.delete(userId);
}

function authError(message: string, status = 401): ApiError {
  return new ApiError(message, status);
}

/**
 * Hash factice : un e-mail inconnu coûte le même calcul PBKDF2 qu'un e-mail
 * connu, pour que le temps de réponse ne révèle pas quelles adresses existent.
 */
const DUMMY_PASSWORD_HASH = hashPassword('runex-timing-equaliser');

const INVALID_CREDENTIALS =
  'Identifiants incorrects. Veuillez vérifier votre adresse email et votre mot de passe.';

/**
 * Comptes de démonstration : exposés uniquement quand l'exploitant l'a
 * explicitement demandé ET hors production.
 */
export function demoAccountsEnabled(): boolean {
  return process.env.ENABLE_DEMO_ACCOUNTS === 'true' && process.env.NODE_ENV !== 'production';
}

export class AuthService {
  /**
   * Traduit un enregistrement Prisma en utilisateur authentifié.
   *
   * Retourne `null` lorsque le compte ne porte aucun rôle connu : un compte
   * sans rôle n'a accès à rien (il ne devient plus « livreur » par défaut).
   */
  private mapToAuthUser(user: UserWithRelations): AuthUser | null {
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

    const role = priority.find((candidate) => roles.includes(candidate));
    if (!role) return null;

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
   * Vérifie qu'un compte est utilisable et retourne son identité.
   *
   * Les contrôles qui suivent la vérification du mot de passe peuvent révéler
   * l'état du compte : ils ne sont faits qu'une fois l'identité prouvée.
   */
  private assertUsable(user: UserWithRelations): AuthUser {
    if (!user.isActive || user.deletedAt) {
      throw authError("Votre compte est désactivé. Veuillez contacter l'administrateur.", 403);
    }
    const authUser = this.mapToAuthUser(user);
    if (!authUser) {
      throw authError("Aucun rôle n'est attribué à votre compte. Contactez l'administrateur RUNEX.", 403);
    }
    if (authUser.role === RoleType.LIVREUR) {
      const driver = user.driverProfile;
      if (!driver) {
        throw authError(
          "Votre compte livreur n'est rattaché à aucune fiche chauffeur. Contactez l'administrateur RUNEX.",
          403
        );
      }
      if (!driver.isActive || driver.deletedAt) {
        throw authError("Votre fiche livreur est désactivée. Veuillez contacter l'administrateur.", 403);
      }
    }
    if (authUser.role === RoleType.EXPEDITEUR) {
      const shipper = user.shipperUser?.shipper;
      if (!shipper) {
        throw authError("Aucun expéditeur n'est associé à votre compte. Contactez l'administrateur RUNEX.", 403);
      }
      if (!shipper.isActive || shipper.deletedAt) {
        throw authError("Le compte expéditeur de votre entreprise est désactivé.", 403);
      }
    }
    if (authUser.role === RoleType.AGENT_DEPOT && !authUser.depositId) {
      throw authError("Aucun dépôt n'est rattaché à votre compte magasinier. Contactez l'administrateur RUNEX.", 403);
    }
    return authUser;
  }

  private async findUser(idOrEmail: string, byEmail = false): Promise<UserWithRelations | null> {
    const prisma = getPrisma();
    if (byEmail) {
      return prisma.user.findUnique({
        where: { email: idOrEmail.trim().toLowerCase() },
        include: USER_INCLUDE,
      });
    }
    return prisma.user.findUnique({ where: { id: idOrEmail }, include: USER_INCLUDE });
  }

  private async openSession(authUser: AuthUser, meta: SessionMeta) {
    const sid = sessionService.newSessionId();
    const tokens = generateTokenPair(authUser, sid);
    await sessionService.create(sid, authUser.id, tokens.refreshToken, tokens.refreshExpiresAt, meta);
    return tokens;
  }

  /**
   * Identifiant de connexion : l'email pour tous ; pour un livreur, aussi son
   * code livreur (LIV-BEN-001), le matricule de son véhicule ou son numéro de téléphone — ce que l'appli
   * mobile lui demande. Un téléphone partagé par plusieurs comptes n'identifie
   * personne : il est traité comme un identifiant inconnu.
   */
  private async findUserForLogin(identifier: string): Promise<UserWithRelations | null> {
    const value = identifier.trim();
    if (!value) return null;
    if (value.includes('@')) return this.findUser(value, true);
    const prisma = getPrisma();
    const byCode = await prisma.driver.findFirst({
      where: { driverCode: { equals: value, mode: 'insensitive' }, deletedAt: null },
      select: { userId: true },
    });
    if (byCode) return this.findUser(byCode.userId);
    // Matricule du véhicule (« 6383 TUN 181 ») : espaces et casse ignorés.
    if (/[a-z]/i.test(value)) {
      const plate = value.replace(/\s+/g, '').toUpperCase();
      const rows = await prisma.$queryRaw<{ userId: string }[]>`
        SELECT "userId"::text FROM "Driver"
        WHERE "deletedAt" IS NULL AND upper(replace("licensePlate", ' ', '')) = ${plate}
        LIMIT 2`;
      return rows.length === 1 ? this.findUser(rows[0]!.userId) : null;
    }
    const digits = value.replace(/[\s.-]/g, '').replace(/^(\+216|00216)/, '');
    if (!/^\d{8}$/.test(digits)) return null;
    const byPhone = await prisma.user.findMany({
      where: { driverProfile: { isNot: null }, OR: [{ phone: digits }, { phone: `+216${digits}` }, { phone: `216${digits}` }] },
      select: { id: true },
      take: 2,
    });
    return byPhone.length === 1 ? this.findUser(byPhone[0]!.id) : null;
  }

  async login(email: string, passwordPlain: string, meta: SessionMeta = {}): Promise<LoginResponse> {
    const user = await this.findUserForLogin(String(email));

    // Le mot de passe est vérifié AVANT tout autre contrôle : un message
    // « compte désactivé » ne doit pas révéler qu'une adresse existe.
    // Verrou par compte, quel que soit l'identifiant employé (email,
    // téléphone sous toutes ses écritures, code livreur, matricule) : le
    // limiteur HTTP compte par identifiant saisi, ce verrou compte par compte.
    if (user && accountLocked(user.id)) {
      throw authError(ACCOUNT_LOCKED, 429);
    }
    const passwordOk = await verifyPasswordAsync(String(passwordPlain), user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      if (user) recordFailure(user.id);
      throw authError(INVALID_CREDENTIALS);
    }
    clearFailures(user.id);
    // Ancien condensat (moins d'itérations) : remplacé au coût actuel, sans
    // demander à personne de changer de mot de passe.
    if (passwordNeedsRehash(user.passwordHash)) {
      void hashPasswordAsync(String(passwordPlain))
        .then((passwordHash) => getPrisma().user.update({ where: { id: user.id }, data: { passwordHash } }))
        .catch(() => undefined);
    }

    const authUser = this.assertUsable(user);
    const tokens = await this.openSession(authUser, meta);

    // Trace la dernière connexion : exploitable par le tableau de bord.
    void getPrisma()
      .user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
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
   * Le refresh token est à usage unique : il est remplacé atomiquement dans
   * sa session. L'ancien jeton est donc refusé dès le premier usage.
   */
  async refreshAccessToken(refreshToken: string) {
    if (!refreshToken) throw authError('Jeton de rafraîchissement requis.', 400);

    const payload = verifyRefreshToken(refreshToken);
    if (!payload?.sid) throw authError('Jeton de rafraîchissement invalide ou expiré.');

    const session = await sessionService.findByRefreshToken(refreshToken);
    if (!session || session.id !== payload.sid || session.revokedAt || session.expiresAt <= new Date()) {
      // Jeton authentique mais déjà remplacé : rejoué plus d'une minute après
      // la rotation, c'est un vol probable — la session entière est fermée.
      // (Deux onglets qui rafraîchissent au même instant restent tolérés.)
      if (!session) {
        const elapsed = msSinceRotation(payload.sid);
        if (elapsed !== null && elapsed > 60_000) await sessionService.revoke(payload.sid);
      }
      throw authError('Jeton de rafraîchissement déjà utilisé ou révoqué.');
    }

    const user = await this.findUser(payload.sub);
    if (!user) {
      await sessionService.revoke(session.id);
      throw authError('Compte introuvable ou désactivé.');
    }
    let authUser: AuthUser;
    try {
      authUser = this.assertUsable(user);
    } catch (error) {
      await sessionService.revoke(session.id);
      throw authError(error instanceof Error ? error.message : 'Compte désactivé.');
    }

    const tokens = generateTokenPair(authUser, session.id);
    const rotated = await sessionService.rotate(
      session.id,
      refreshToken,
      tokens.refreshToken,
      tokens.refreshExpiresAt
    );
    if (!rotated) throw authError('Jeton de rafraîchissement déjà utilisé ou révoqué.');

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: authUser,
    };
  }

  /**
   * Déconnexion de l'appelant.
   *
   * - avec `refreshToken` : la session de ce jeton est fermée, à condition
   *   qu'elle appartienne bien à l'appelant ;
   * - sans corps : la session du jeton d'accès utilisé est fermée.
   *
   * Aucune autre session (autre appareil, autre utilisateur) n'est touchée.
   */
  async logout(caller: { id: string; sid?: string }, refreshToken?: string) {
    if (refreshToken) {
      const session = await sessionService.findByRefreshToken(String(refreshToken));
      if (session && session.userId === caller.id) await sessionService.revoke(session.id);
    }
    if (caller.sid) await sessionService.revoke(caller.sid);
    return { success: true, message: 'Déconnexion effectuée.' };
  }

  /**
   * Demande de réinitialisation de mot de passe.
   *
   * La réponse reste identique que l'adresse existe ou non, afin de ne pas
   * énumérer les comptes enregistrés. Le jeton est signé et sans état : aucun
   * stockage mémoire qui grossirait sans fin ni disparaîtrait au redémarrage.
   *
   * Le lien part par courriel (voir `common/mail/mail.service.ts`). L'envoi
   * n'est pas attendu : le temps de réponse ne trahit pas l'existence du compte.
   * En développement, `PASSWORD_RESET_LOG_TOKEN=true` écrit aussi le lien dans
   * le journal du serveur.
   */
  async requestPasswordReset(email: string) {
    const user = await this.findUser(String(email), true);
    if (user && user.isActive && !user.deletedAt) {
      const token = signPasswordResetToken(user.id, user.passwordHash);
      const isDriver = Boolean(user.driverProfile);
      const espace = user.shipperUser ? 'expediteur' : isDriver ? 'livreur' : 'equipe';
      const link = `${webAppUrl()}/reinitialisation?token=${encodeURIComponent(token)}&espace=${espace}`;
      if (process.env.NODE_ENV !== 'production' && process.env.PASSWORD_RESET_LOG_TOKEN === 'true') {
        console.info(`[Auth] Lien de réinitialisation (dev) : ${link}`);
      }
      const mail = passwordResetEmail({
        name: user.fullName,
        link,
        minutes: Math.round(RESET_TTL_SECONDS / 60),
        isDriver,
      });
      void sendMail({ to: { email: user.email, name: user.fullName }, ...mail }).catch(() => undefined);
    }
    return {
      success: true,
      message:
        "Si un compte est associé à cette adresse, un lien de réinitialisation vient d'être envoyé.",
    };
  }

  /**
   * Changement de mot de passe par l'utilisateur connecté.
   *
   * L'ancien mot de passe est exigé. Les autres sessions du compte sont
   * fermées ; celle qui fait la demande reste ouverte.
   */
  async changePassword(userId: string, sessionId: string | undefined, currentPassword: string, newPassword: string) {
    const next = String(newPassword);
    if (next.length < 8) throw authError('Le mot de passe doit contenir au moins 8 caractères.', 400);
    if (next.length > 128) throw authError('Le mot de passe est trop long (128 caractères au plus).', 400);
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.deletedAt) throw authError('Utilisateur introuvable.', 404);
    if (!(await verifyPasswordAsync(String(currentPassword), user.passwordHash))) {
      throw authError('Le mot de passe actuel est incorrect.', 400);
    }
    if (await verifyPasswordAsync(next, user.passwordHash)) {
      throw authError("Le nouveau mot de passe doit être différent de l'actuel.", 400);
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPasswordAsync(next) } });
    const closed = await sessionService.revokeOthersForUser(user.id, sessionId);
    return {
      success: true,
      message: 'Mot de passe modifié.',
      data: { otherSessionsClosed: closed },
    };
  }

  async confirmPasswordReset(token: string, newPasswordPlain: string) {
    const claims = verifyPasswordResetToken(String(token));
    if (!claims) throw authError('Jeton de réinitialisation invalide ou expiré.', 400);
    if (String(newPasswordPlain).length < 8) {
      throw authError('Le mot de passe doit contenir au moins 8 caractères.', 400);
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.isActive || user.deletedAt || passwordFingerprint(user.passwordHash) !== claims.pwh) {
      throw authError('Jeton de réinitialisation invalide ou expiré.', 400);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPasswordAsync(String(newPasswordPlain)) },
    });
    // Seules les sessions de CE compte sont fermées.
    await sessionService.revokeAllForUser(user.id);

    return { success: true, message: 'Mot de passe mis à jour. Veuillez vous reconnecter.' };
  }

  async getProfile(userId: string): Promise<AuthUser | null> {
    const user = await this.findUser(userId);
    if (!user || !user.isActive || user.deletedAt) return null;
    return this.mapToAuthUser(user);
  }

  /**
   * Comptes de démonstration (développement uniquement, voir `demoAccountsEnabled`).
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
      where: { email: { in: Object.keys(DEMO_PASSWORDS) }, isActive: true, deletedAt: null },
      include: USER_INCLUDE,
    });

    return users.flatMap((user) => {
      const mapped = this.mapToAuthUser(user);
      if (!mapped) return [];
      return [
        {
          email: user.email,
          role: mapped.role,
          name: `${user.fullName} — ${ROLE_DISPLAY_NAMES[mapped.role]}`,
          passwordHint: DEMO_PASSWORDS[user.email] ?? '',
        },
      ];
    });
  }
}

export const authService = new AuthService();
