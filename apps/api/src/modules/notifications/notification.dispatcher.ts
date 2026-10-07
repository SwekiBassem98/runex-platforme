/**
 * Diffusion des notifications.
 *
 * Un seul point d'entrée, appelé par les modules métier. Le service fait
 * toujours les mêmes choses dans le même ordre :
 *
 *   1. résoudre qui doit être prévenu ;
 *   2. écrire la notification en base, une ligne par destinataire ;
 *   3. confier chaque ligne aux canaux de diffusion, et consigner la tentative ;
 *   4. pousser sur le temps réel.
 *
 * L'écriture précède la diffusion, et jamais l'inverse. L'inverse donnerait un
 * compteur qui s'incrémente sans que rien n'ait été gardé : au rechargement de
 * la page, la notification disparaîtrait alors que le badge, lui, serait resté.
 */

import { getPrisma } from '../../common/database/prisma-context';
import {
  NotificationEvent,
  SOCKET_EVENTS,
  notificationCategoryOf,
  notificationRoute,
  type NotificationDto,
} from '@logixpress/types';
import { notificationAudience, type AudienceContext } from './audience';
import {
  NOTIFICATION_CHANNELS,
  getChannel,
  registeredChannels,
  type NotificationChannel,
} from './channels';
import { emitToUser } from './realtime.gateway';

export interface NotifyInput {
  event: NotificationEvent;
  title: string;
  content: string;
  /** Entité liée, pour « aller à l'objet » depuis le centre de notifications. */
  relatedEntity?: string | null;
  relatedEntityId?: string | null;
  /** Destinataires imposés. À défaut, l'audience est déduite de l'événement. */
  userIds?: string[];
  /** Entités servant à retrouver l'audience lorsque celle-ci n'est pas imposée. */
  packageId?: string | null;
  paymentId?: string | null;
  runsheetId?: string | null;
  pickupAppointmentId?: string | null;
  transferId?: string | null;
  /** Auteur du geste, exclu des destinataires. */
  actorUserId?: string | null;
}

export interface NotifyResult {
  /** Destinataires ayant réellement reçu la ligne. */
  notified: number;
  /** Destinataires que l'audience a désignés mais qui ont été écartés. */
  skipped: number;
}

/** Convertit une ligne de base en objet transportable, une seule fois. */
export function toDto(row: {
  id: string;
  type: string;
  title: string;
  content: string;
  relatedEntity: string | null;
  relatedEntityId: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    relatedEntity: row.relatedEntity,
    relatedEntityId: row.relatedEntityId,
    href: notificationRoute(row.relatedEntity, row.relatedEntityId),
    category: notificationCategoryOf(row.type),
    isRead: row.isRead,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class NotificationDispatcher {
  /**
   * Enregistre un canal supplémentaire.
   *
   * Appelé au démarrage pour les canaux intégrés. Le canal « push »
   * s'enregistrera ici le jour où il existera, sans qu'aucun appelant métier n'ait à changer.
   */
  register(channel: NotificationChannel): void {
    this.extraChannels.push(channel);
  }

  private extraChannels: NotificationChannel[] = [];

  /** Tous les canaux actifs : le canal interne plus ceux enregistrés. */
  private channels(): NotificationChannel[] {
    const socket = getChannel(NOTIFICATION_CHANNELS.SOCKET);
    const inApp = getChannel(NOTIFICATION_CHANNELS.IN_APP);
    const list: NotificationChannel[] = [];
    if (inApp) list.push(inApp);
    if (socket) list.push(socket);
    list.push(...this.extraChannels);
    return list;
  }

  /**
   * Notifie les destinataires d'un événement.
   *
   * N'élève jamais d'exception. Une notification est un accessoire : le client
   * final a bien reçu son colis, et faire échouer cette livraison parce qu'une
   * boîte de réception est pleine serait l'inverse de ce qu'on veut. Les
   * erreurs sont journalisées, et l'opération métier se poursuit.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    try {
      const prisma = getPrisma();

      const audience: AudienceContext = {
        event: input.event,
        packageId: input.packageId,
        paymentId: input.paymentId,
        runsheetId: input.runsheetId,
        pickupAppointmentId: input.pickupAppointmentId,
        transferId: input.transferId,
        excludeUserId: input.actorUserId,
      };

      const recipients = input.userIds?.length
        ? input.userIds
        : await notificationAudience.recipients(audience);

      if (recipients.length === 0) {
        return { notified: 0, skipped: 0 };
      }

      // Une ligne par destinataire : chacun a son propre accusé de lecture, et
      // lire la sienne ne doit pas effacer celle du voisin. La création en bloc,
      // suivie d'un retour par identifiant, évite un aller-retour par destinataire.
      const created = await prisma.$transaction(async (tx) => {
        const rows = await tx.notification.createManyAndReturn({
          data: recipients.map((userId) => ({
            userId,
            type: input.event as never,
            title: input.title,
            content: input.content,
            relatedEntity: input.relatedEntity ?? null,
            relatedEntityId: input.relatedEntityId ?? null,
          })),
          select: {
            id: true,
            userId: true,
            type: true,
            title: true,
            content: true,
            relatedEntity: true,
            relatedEntityId: true,
            isRead: true,
            readAt: true,
            createdAt: true,
          },
        });
        return rows;
      });

      const channels = this.channels();

      for (const row of created) {
        const dto = toDto(row);
        // La notification part par les canaux — dont le canal « socket », qui se
        // charge de la pousser en temps réel. Le service ne l'envoie pas
        // lui-même : deux chemins pour le même message donneraient au client
        // deux alertes, et l'utilisateur se demanderait pourquoi.
        for (const channel of channels) {
          await this.dispatchOne(channel, row.userId, dto);
        }
      }

      // Le compteur est envoyé après les notifications : un badge qui s'affiche
      // avant l'alerte qu'il compte ferait clignoter une icône sans raison.
      const unread = await this.countUnreadFor(recipients);
      for (const userId of recipients) {
        emitToUser(userId, SOCKET_EVENTS.NOTIFICATION_UNREAD_COUNT, { count: unread.get(userId) ?? 0 });
      }

      return { notified: created.length, skipped: 0 };
    } catch (error) {
      console.error('[Notification] Diffusion impossible :', error);
      return { notified: 0, skipped: 0 };
    }
  }

  /**
   * Tente un canal et consigne la tentative.
   *
   * L'écriture du registre est aislée de l'envoi : si elle échoue, la
   * notification reste dans la boîte de réception, seule sa trace de diffusion
   * manque. L'inverse — un registre écrit pour un envoi qui n'a pas eu lieu —
   * serait pire qu'absent.
   */
  private async dispatchOne(
    channel: NotificationChannel,
    userId: string,
    notification: NotificationDto
  ): Promise<void> {
    const prisma = getPrisma();
    let status: 'sent' | 'failed' | 'skipped' = 'skipped';
    let error: string | null = null;
    let externalId: string | null = null;

    try {
      if (channel.supports({ userId, notification })) {
        const result = await channel.deliver({ userId, notification });
        status = result.status === 'pending' ? 'skipped' : result.status;
        error = result.error ?? null;
        externalId = result.externalId ?? null;
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }

    try {
      const now = new Date();
      await prisma.$transaction([
        prisma.notificationDelivery.upsert({
          where: { notificationId_channel: { notificationId: notification.id, channel: channel.name } },
          create: {
            notificationId: notification.id,
            channel: channel.name,
            status,
            externalId,
            attempts: 1,
            lastAttemptAt: now,
            deliveredAt: status === 'sent' ? now : null,
            lastError: error,
          },
          update: {
            status,
            externalId,
            attempts: { increment: 1 },
            lastAttemptAt: now,
            deliveredAt: status === 'sent' ? now : null,
            lastError: error,
          },
        }),
      ]);
    } catch (err) {
      console.error('[Notification] Registre de diffusion illisible :', err);
    }
  }

  /** Non-lus par destinataire, en une seule requête. */
  private async countUnreadFor(userIds: string[]): Promise<Map<string, number>> {
    const prisma = getPrisma();
    const grouped = await prisma.notification.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, isRead: false },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.userId, g._count._all]));
  }

  /** Canaux actuellement enregistrés — pour le diagnostic et les tests. */
  activeChannels(): string[] {
    return this.channels().map((c) => c.name);
  }
}

export const notificationDispatcher = new NotificationDispatcher();

/** Canaux enregistrés hors du service, utile aux tests. */
export function extraChannels(): NotificationChannel[] {
  return registeredChannels();
}