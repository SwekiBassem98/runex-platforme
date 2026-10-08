/**
 * Service central de présence livreur.
 *
 * Une seule source de vérité : `Driver.lastSeenAt`.
 * Aucun booléen `isOnline` stocké — l'état est dérivé de `lastSeenAt` et d'un
 * délai configurable, ce qui évite un état périmé (un livreur qui ferme
 * l'application sans prévenir resterait sinon « en ligne » indéfiniment).
 *
 * Distinction :
 * - ONLINE  = connectivité récente (réseau / application active)
 * - AVAILABLE = capacité à recevoir du travail (métier, non traité ici)
 *
 * Le service ne connaît pas l'AVAILABLE : il expose uniquement ONLINE/OFFLINE
 * et laisse les règles d'affectation (`assignDriver`) inchangées — un livreur
 * hors ligne peut rester affecté à une tournée, la présence est informative.
 */

import { getPrisma } from '../../common/database/prisma-context';

function presenceTimeoutSeconds(): number {
  const raw = process.env.DRIVER_PRESENCE_TIMEOUT_SECONDS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 30 && parsed <= 3600) return parsed;
  return 180; // 3 minutes par défaut — mobile heartbeat ~60s + marge réseau
}

export function driverPresenceTimeoutMs(): number {
  return presenceTimeoutSeconds() * 1000;
}

/**
 * Vrai si le livreur est considéré en ligne.
 *
 * Un `lastSeenAt` nul (jamais vu) → hors ligne.
 * Une date future (horloge décalée) → en ligne si dans la fenêtre.
 */
export function isDriverOnline(
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastSeenAt) return false;
  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return false;
  const elapsed = now.getTime() - seen.getTime();
  // Tolère une horloge légèrement en avance (5s) sans faire passer un
  // livreur vu dans le futur comme hors ligne.
  if (elapsed < -5000) return true;
  return elapsed <= driverPresenceTimeoutMs();
}

export interface PresenceView {
  driverId: string;
  lastSeenAt: string | null;
  online: boolean;
  isActive: boolean;
}

export class PresenceService {
  private get prisma() {
    return getPrisma();
  }

  /**
   * Battement d'activité : met à jour `Driver.lastSeenAt` à maintenant.
   *
   * - Authentifié JWT → driver résolu côté serveur, jamais via body.
   * - Seul un LIVREUR actif peut battre ; un admin qui appelle reçoit 403
   *   (géré au contrôleur).
   * - Aucun AuditLog, aucune Notification, aucun broadcast — appel fréquent,
   *   doit rester léger (1 UPDATE).
   */
  async heartbeatByUserId(userId: string): Promise<{ lastSeenAt: string; online: true }> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true, isActive: true, deletedAt: true },
    });
    if (!driver) {
      const err = new Error('Aucun profil livreur associé à cet utilisateur.');
      (err as Error & { status?: number }).status = 404;
      throw err;
    }
    if (!driver.isActive || driver.deletedAt) {
      const err = new Error('Ce livreur est désactivé.');
      (err as Error & { status?: number }).status = 403;
      throw err;
    }

    const now = new Date();
    await this.prisma.driver.update({
      where: { id: driver.id },
      data: { lastSeenAt: now },
    });

    // Pas d'événement temps réel à chaque battement : seul un changement
    // d'état ONLINE↔OFFLINE mérite une diffusion, et il est dérivé à la lecture.
    return { lastSeenAt: now.toISOString(), online: true as const };
  }

  /**
   * Présence d'un livreur par `driverId`.
   * Utilisé par l'admin et le tableau de bord (lecture seule).
   */
  async getForDriver(driverId: string): Promise<PresenceView | null> {
    const d = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, lastSeenAt: true, isActive: true, deletedAt: true },
    });
    if (!d) return null;
    return {
      driverId: d.id,
      lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
      online: !!d.isActive && !d.deletedAt && isDriverOnline(d.lastSeenAt),
      isActive: !!d.isActive && !d.deletedAt,
    };
  }

  /**
   * Présences de tous les livreurs actifs — pour le dashboard et l'écran admin.
   * Une seule requête, pas de N+1.
   */
  async listActive(now: Date = new Date()): Promise<{
    total: number;
    online: number;
    offline: number;
    items: PresenceView[];
  }> {
    const drivers = await this.prisma.driver.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, lastSeenAt: true, isActive: true, deletedAt: true },
    });
    const items: PresenceView[] = drivers.map((d) => ({
      driverId: d.id,
      lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
      online: isDriverOnline(d.lastSeenAt, now),
      isActive: true,
    }));
    const online = items.filter((i) => i.online).length;
    return { total: drivers.length, online, offline: drivers.length - online, items };
  }
}

export const presenceService = new PresenceService();
