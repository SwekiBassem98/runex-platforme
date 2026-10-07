/**
 * Contrôleur du centre de notifications.
 *
 * Chaque utilisateur ne voit que ses propres notifications : l'identifiant du
 * destinataire provient toujours du jeton, jamais de la requête. Un client ne
 * peut donc pas demander les notifications d'un autre, et aucun paramètre
 * n'existe qui le lui permettrait.
 */

import type { Response } from 'express';
import { getPrisma } from '../../common/database/prisma-context';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { toDto } from './notification.dispatcher';
import {
  NOTIFICATION_EVENT_META,
  SOCKET_EVENTS,
  type NotificationCategory,
} from '@logixpress/types';
import { emitToUser } from './realtime.gateway';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/**
 * Analyse `?isRead=true|false`.
 *
 * Une valeur absente ne filtre rien — l'écran affiche alors tout. Seules les
 * deux littérales exactes sont acceptées : interpréter `?isRead=oui` comme vrai
 * ferait dépendre le résultat d'une faute de frappe, et un paramètre mal
 * orthographié ne doit pas se comporter comme un filtre absent.
 */
function parseIsRead(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = String(raw).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function parseIntParam(raw: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export class NotificationsController {
  /** Liste paginée et filtrable. */
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    const prisma = getPrisma();
    const q = req.query as Record<string, string | undefined>;

    const isRead = parseIsRead(q.isRead);
    const type = q.type?.trim() || undefined;
    const relatedEntity = q.relatedEntity?.trim() || undefined;
    const category = q.category?.trim() as NotificationCategory | undefined;

    // La catégorie est un regroupement du type, pas une colonne. La traduire
    // en types avant d'interroger est ce qui permet de filtrer dessus sans
    // dupliquer le classement côté client.
    const categoryTypes = category ? typesOfCategory(category) : undefined;

    // Filtre et catégorie se combinent en intersection. Les traiter comme deux
    // filtres indépendants sur la même colonne ferait que l'un des deux
    // l'emporterait silencieusement : demander « finance » et « livraison »
    // renverrait la finance en ignorant la demande, sans aucun signe.
    let typeFilter: { in: string[] } | string | undefined;
    if (categoryTypes) {
      typeFilter = type
        ? { in: categoryTypes.filter((t) => t === type) }
        : { in: categoryTypes };
    } else if (type) {
      typeFilter = type;
    }

    // Les autres filtres se combinent en ET : c'est le comportement attendu
    // d'une liste filtrée, et l'utilisateur peut ainsi resserrer
    // progressivement au lieu de perdre ses critères en changeant d'onglet.
    const where = {
      userId,
      ...(isRead === undefined ? {} : { isRead }),
      ...(typeFilter === undefined ? {} : { type: typeFilter as never }),
      ...(relatedEntity ? { relatedEntity } : {}),
    };

    const limit = parseIntParam(q.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parseIntParam(q.offset, 0, 100_000);

    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    res.json({
      success: true,
      data: rows.map(toDto),
      meta: {
        total,
        unread,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
    });
  }

  /**
   * Marque une notification comme lue.
   *
   * La mise à jour porte sur `{ id, userId }` : une notification d'autrui reste
   * introuvable, ce qui est la seule réponse correcte — ni 403, qui révélerait
   * l'existence de la ligne, ni 200, qui la marquerait pour de bon.
   */
  async markRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    const prisma = getPrisma();
    const id = req.params.id!;
    const now = new Date();

    const result = await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: now },
    });

    if (result.count === 0) {
      res.status(404).json({ success: false, message: 'Notification introuvable.' });
      return;
    }

    // Les autres onglets du même utilisateur doivent perdre la pastille
    // eux aussi, sans attendre un rechargement.
    const unread = await prisma.notification.count({ where: { userId, isRead: false } });
    emitToUser(userId, SOCKET_EVENTS.NOTIFICATION_READ, { id, isRead: true, unread });
    // Le compteur est également émis sur son propre canal. C'est celui que le
    // bandeau écoute, et il ne peut pas savoir qu'une lecture vient d'avoir
    // lieu autrement : sans cet envoi, un utilisateur qui lit une notification
    // depuis la liste voit la pastille rester jusqu'au rechargement, alors
    // même que le total est juste dans la réponse HTTP.
    emitToUser(userId, SOCKET_EVENTS.NOTIFICATION_UNREAD_COUNT, { count: unread });

    const row = await prisma.notification.findUnique({ where: { id } });
    res.json({
      success: true,
      data: row ? toDto(row) : null,
      meta: { unread },
      message: 'Notification marquée comme lue.',
    });
  }

  /**
   * Marque toutes les notifications comme lues.
   *
   * Le filtre `isRead: false` évite d'écrire inutilement les lignes déjà
   * lues : sans lui, cette action réécirait tout l'historique à chaque
   * clic, en écrasant le `readAt` qui dit depuis quand l'utilisateur avait
   * effectivement ouvert chaque notification.
   */
  async markAllRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    const prisma = getPrisma();
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    emitToUser(userId, SOCKET_EVENTS.NOTIFICATION_UNREAD_COUNT, { count: 0 });

    res.json({
      success: true,
      message:
        result.count === 0
          ? 'Aucune notification à marquer.'
          : `${result.count} notification(s) marquée(s) comme lue(s).`,
      meta: { updated: result.count, unread: 0 },
    });
  }

  /** Compteur seul, pour le badge au démarrage et après reconnexion. */
  async unreadCount(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    const prisma = getPrisma();
    const unread = await prisma.notification.count({ where: { userId, isRead: false } });
    res.json({ success: true, data: { unread } });
  }
}

/** Types d'un regroupement de catégorie. */
function typesOfCategory(category: NotificationCategory): string[] {
  return Object.entries(NOTIFICATION_EVENT_META)
    .filter(([, meta]) => meta.category === category)
    .map(([value]) => value);
}

export const notificationsController = new NotificationsController();