/**
 * Notifications.
 *
 * Service historique, sollicité par les modules métier à chaque événement
 * significatif : création d'un colis, affectation à un livreur, clôture de
 * tournée, décaissement.
 *
* Il a longtemps vécu dans le même fichier que le journal d'audit, par
 * simple voisinage de tiroir — deux services qui écrivent tous deux en base,
 * et rien de plus. La confusion coûtait cher : chercher « qui a annulé ce
 * colis » conduisait au service des notifications, et l'inverse. Séparés,
 * chacun se lit seul.
 */

import type { Prisma } from '@prisma/client';
import { LEGACY_NOTIFICATION_EVENTS, type NotificationEvent } from '@logixpress/types';
import { getPrisma } from '../database/prisma-context';
import { notificationDispatcher } from '../../modules/notifications/notification.dispatcher';

/** Rôles exemptés de la table des notifications. */
const NOTIFIED_ROLES = ['SUPER_ADMIN', 'ADMIN_GENERAL', 'DISPATCHER'] as const;

export interface NotificationInput {
  type: Prisma.NotificationCreateInput['type'];
  title: string;
  content: string;
  relatedEntity?: string;
  relatedEntityId?: string;
  /** Destinataires précis ; à défaut, tous les rôles d'exploitation. */
  userIds?: string[];
}

export class NotificationService {
  /**
   * Diffuse une notification aux rôles d'exploitation, ou aux utilisateurs
   * explicitement désignés.
   *
   * Point d'entrée historique conservé pour les modules qui appelaient
   * avant l'existence du centre de notifications. Il ne fait plus que
   * traduire vers le diffuseur unique : écrire lui-même dans `Notification`
   * produisait des lignes que personne ne voyait arriver — elles n'étaient ni
   * poussées en temps réel, ni consignées au registre de diffusion, et le
   * compteur du bandeau restait bloqué jusqu'au prochain rechargement. Les
   * destinataires sont donc résolus ici, comme avant, puis confiés au
   * diffuseur qui se charge de l'écriture et de la diffusion.
   *
   * Les notifications ne doivent jamais faire échouer l'opération métier qui
   * les déclenche : les erreurs sont journalisées puis ignorées.
   */
  async notify(input: NotificationInput): Promise<void> {
    try {
      const prisma = getPrisma();

      const recipients = input.userIds?.length
        ? await prisma.user.findMany({
            where: { id: { in: input.userIds }, isActive: true, deletedAt: null },
            select: { id: true },
          })
        : await prisma.user.findMany({
            where: {
              isActive: true,
              deletedAt: null,
              userRoles: { some: { role: { name: { in: [...NOTIFIED_ROLES] } } } },
            },
            select: { id: true },
          });

      if (recipients.length === 0) return;

      // Un nom d'événement ancien est traduit vers son équivalent moderne
      // lorsqu'il en existe un. Sinon il est conservé tel quel : c'est encore
      // une valeur de l'énumération `NotificationType`, et le catalogue lui
      // attribue une catégorie par défaut plutôt que de refuser la ligne.
      const mapped = LEGACY_NOTIFICATION_EVENTS[input.type];
      const event = (mapped ?? input.type) as NotificationEvent;

      await notificationDispatcher.notify({
        event,
        title: input.title,
        content: input.content,
        relatedEntity: input.relatedEntity ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        userIds: recipients.map((r) => r.id),
      });
    } catch (error) {
      console.error('[Notification] Diffusion impossible :', error);
    }
  }

  /** Notifications d'un utilisateur, les plus récentes d'abord. */
  async listForUser(userId: string, limit = 30) {
    const prisma = getPrisma();
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async countUnread(userId: string): Promise<number> {
    const prisma = getPrisma();
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    const prisma = getPrisma();
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count > 0;
  }

  async markAllRead(userId: string): Promise<number> {
    const prisma = getPrisma();
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }
}

export const notificationService = new NotificationService();