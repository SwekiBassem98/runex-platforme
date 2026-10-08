/**
 * Sessions persistées (table `Session`).
 *
 * Une session = un appareil connecté. Elle porte le condensat SHA-256 du
 * refresh token courant (jamais le jeton en clair), son échéance et sa date de
 * révocation. Les jetons d'accès et de rafraîchissement portent l'identifiant
 * de session (`sid`) : chaque requête authentifiée vérifie que la session est
 * toujours ouverte et que le compte est toujours actif.
 *
 * Conséquences :
 *  - un redémarrage de l'API ne déconnecte personne ;
 *  - plusieurs instances de l'API partagent les mêmes sessions ;
 *  - la déconnexion ne touche que la session de l'appelant ;
 *  - désactiver un compte, un livreur ou un expéditeur coupe l'accès sur-le-champ.
 */
import crypto from 'node:crypto';
import { getPrisma } from '../database/prisma-context';
import { hashToken } from './jwt.util';

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export type SessionCheck =
  | { ok: true }
  | { ok: false; reason: 'session' | 'account' | 'driver' | 'shipper' };

export class SessionService {
  private get prisma() {
    return getPrisma();
  }

  newSessionId(): string {
    return crypto.randomUUID();
  }

  async create(
    sid: string,
    userId: string,
    refreshToken: string,
    expiresAt: Date,
    meta: SessionMeta = {}
  ): Promise<void> {
    await this.prisma.session.create({
      data: {
        id: sid,
        userId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt,
        ipAddress: meta.ip?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
      },
    });
  }

  /**
   * Remplace le refresh token d'une session, de façon atomique.
   *
   * La condition porte sur l'ancien condensat : si deux rafraîchissements
   * concurrents présentent le même jeton, un seul réussit. La session (et donc
   * le `sid` des jetons d'accès déjà émis) est conservée, ce qui évite de
   * déconnecter une application mobile dont une requête était en vol.
   */
  async rotate(
    sid: string,
    oldRefreshToken: string,
    newRefreshToken: string,
    expiresAt: Date
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: {
        id: sid,
        refreshTokenHash: hashToken(oldRefreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { refreshTokenHash: hashToken(newRefreshToken), expiresAt },
    });
    return result.count === 1;
  }

  /** Session correspondant à un refresh token présenté (ouverte ou non). */
  async findByRefreshToken(refreshToken: string) {
    return this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
    });
  }

  async revoke(sid: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Révoque toutes les sessions ouvertes d'un utilisateur (désactivation, changement de rôle, mot de passe). */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Révoque les sessions de tous les comptes rattachés à un expéditeur. */
  async revokeAllForShipper(shipperId: string): Promise<void> {
    const links = await this.prisma.shipperUser.findMany({
      where: { shipperId },
      select: { userId: true },
    });
    if (links.length === 0) return;
    await this.prisma.session.updateMany({
      where: { userId: { in: links.map((l) => l.userId) }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Vérifie, pour une requête authentifiée, que la session et le compte
   * sont toujours valides. Une seule requête indexée par appel.
   */
  async check(sid: string, userId: string): Promise<SessionCheck> {
    const session = await this.prisma.session.findUnique({
      where: { id: sid },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            isActive: true,
            deletedAt: true,
            driverProfile: { select: { isActive: true, deletedAt: true } },
            shipperUser: { select: { shipper: { select: { isActive: true, deletedAt: true } } } },
          },
        },
      },
    });
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date()) {
      return { ok: false, reason: 'session' };
    }
    const user = session.user;
    if (!user.isActive || user.deletedAt) return { ok: false, reason: 'account' };
    if (user.driverProfile && (!user.driverProfile.isActive || user.driverProfile.deletedAt)) {
      return { ok: false, reason: 'driver' };
    }
    const shipper = user.shipperUser?.shipper;
    if (shipper && (!shipper.isActive || shipper.deletedAt)) return { ok: false, reason: 'shipper' };
    return { ok: true };
  }

  /** Ménage : supprime les sessions expirées ou révoquées depuis plus de 30 jours. */
  async purgeStale(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 86400 * 1000);
    await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
  }
}

export const sessionService = new SessionService();
