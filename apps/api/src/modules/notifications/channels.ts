/**
 * Canaux de diffusion d'une notification.
 *
 * Une notification est écrite une fois en base, puis confiée à chacun des
 * canaux enregistrés. Chaque canal décide seul s'il peut servir, et journalise
 * sa tentative dans `NotificationDelivery`.
 *
 * L'intérêt est d'en avoir un seul : ajouter le canal « push » consistera à
 * écrire une classe qui implémente `NotificationChannel` et à l'enregistrer
 * dans `registerChannel`. Aucun appelant métier n'aura à changer, et le
 * registre dira toujours si l'utilisateur a réellement reçu quelque chose.
 */

import type { NotificationDto } from '@logixpress/types';
import { SOCKET_EVENTS } from '@logixpress/types';
import { emitToUser, hasRealtime, isConnected } from './realtime.gateway';

/** Identifiants des canaux. La liste est ouverte : `push` s'y ajoutera. */
export const NOTIFICATION_CHANNELS = {
  /** La notification est en base ; l'utilisateur la verra au prochain chargement. */
  IN_APP: 'in_app',
  /** Diffusion immédiate aux écrans connectés. */
  SOCKET: 'socket',
  /** Notification système du téléphone. Pas encore branché. */
  PUSH: 'push',
} as const;

export type NotificationChannelName =
  (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface ChannelResult {
  status: DeliveryStatus;
  /** Référence renvoyée par le fournisseur, pour un rejeu ultérieur. */
  externalId?: string | null;
  /** Raison d'un échec ou d'un renoncement, lue par l'exploitation. */
  error?: string | null;
}

export interface ChannelContext {
  /** Destinataire de la notification, résolu avant l'appel du canal. */
  userId: string;
  notification: NotificationDto;
}

/**
 * Un canal de diffusion.
 *
 * `deliver` ne doit jamais lever : une notification qui n'a pas pu partir
 * doit rester consultable dans l'application, et son échec se lire dans le
 * registre. Lever ici ferait échouer l'opération métier qui a déclenché
 * l'événement — on ne perd pas un colis parce qu'un téléphone est éteint.
 */
export interface NotificationChannel {
  readonly name: NotificationChannelName;
  /** `false` si le canal n'a rien à faire pour ce destinataire. */
  supports(ctx: ChannelContext): boolean;
  deliver(ctx: ChannelContext): Promise<ChannelResult>;
}

const channels = new Map<NotificationChannelName, NotificationChannel>();

export function registerChannel(channel: NotificationChannel): void {
  channels.set(channel.name, channel);
}

export function getChannel(name: NotificationChannelName): NotificationChannel | undefined {
  return channels.get(name);
}

export function registeredChannels(): NotificationChannel[] {
  return [...channels.values()];
}

/** Remet le registre à zéro. Réservé aux tests. */
export function resetChannels(): void {
  channels.clear();
}

/** Canal « in-app » : la ligne existe déjà en base, il n'y a rien à envoyer. */
export const inAppChannel: NotificationChannel = {
  name: NOTIFICATION_CHANNELS.IN_APP,
  supports: () => true,
  deliver: async () => ({ status: 'sent', error: null }),
};

/**
 * Canal « socket » : diffusion immédiate aux écrans connectés.
 *
 * Sans écran connecté, la notification reste en base et le compteur de non-lus
 * la prendra en compte à la prochaine ouverture. C'est un renoncement normal,
 * pas un échec — d'où `skipped` et non `failed`, pour que le registre ne fasse
 * pas crediter le push d'un défaut parce que le téléphone était éteint.
 */
export const socketChannel: NotificationChannel = {
  name: NOTIFICATION_CHANNELS.SOCKET,
  supports: (ctx) => hasRealtime() && isConnected(ctx.userId),
  deliver: async (ctx) => {
    try {
      emitToUser(ctx.userId, SOCKET_EVENTS.NOTIFICATION_NEW, ctx.notification);
      return { status: 'sent', error: null };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};