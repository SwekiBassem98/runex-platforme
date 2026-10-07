'use client';

/**
 * Accès HTTP au centre de notifications.
 *
 * Le catalogue, les catégories et les chemins de navigation viennent du paquet
 * partagé : l'écran ne réinvente ni les noms d'événements ni les libellés, il
 * affiche ce que l'API a décidé.
 */

import { requestData, type ApiEnvelope, request } from './api';
import type { NotificationCategory, NotificationDto } from '@logixpress/types';

export interface NotificationListResult {
  items: NotificationDto[];
  meta: {
    total: number;
    unread: number;
    hasMore: boolean;
    page: number;
    limit: number;
  };
}

export interface NotificationListParams {
  page?: number;
  limit?: number;
  isRead?: boolean;
  category?: NotificationCategory;
  type?: string;
}

export const notificationsApi = {
  async list(params: NotificationListParams = {}): Promise<NotificationListResult> {
    const envelope = await request<NotificationDto[]>('/notifications', {
      query: {
        page: params.page,
        limit: params.limit,
        // Envoyé en toutes lettres plutôt qu'en booléen brut : `false` doit
        // survivre à la construction de la query string.
        isRead: params.isRead === undefined ? undefined : String(params.isRead),
        category: params.category,
        type: params.type,
      },
    });

    return {
      items: envelope.data ?? [],
      meta: {
        total: Number(envelope.meta?.total ?? 0),
        unread: Number(envelope.meta?.unread ?? 0),
        hasMore: Boolean(envelope.meta?.hasMore),
        page: Number(envelope.meta?.page ?? 1),
        limit: Number(envelope.meta?.limit ?? 20),
      },
    };
  },

  markRead(id: string): Promise<NotificationDto> {
    return requestData<NotificationDto>(`/notifications/${id}/read`, { method: 'POST' });
  },

  /**
   * Vide la boîte.
   *
   * L'endpoint ne renvoie aucun `data` — uniquement un compte dans `meta` — et
   * `requestData` lève sur une enveloppe sans données. On interroge donc
   * l'enveloppe entière.
   */
  async markAllRead(): Promise<number> {
    const envelope = await request<null>('/notifications/read-all', { method: 'POST' });
    return Number(envelope.meta?.updated ?? 0);
  },

  async unreadCount(): Promise<number> {
    const data = await requestData<{ unread: number }>('/notifications/unread-count');
    return Number(data?.unread ?? 0);
  },
};

export type { ApiEnvelope };