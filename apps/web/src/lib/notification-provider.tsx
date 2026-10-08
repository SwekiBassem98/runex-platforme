'use client';

/**
 * Centre de notifications — état et temps réel.
 *
 * Un contexte unique détient la connexion Socket.IO, la liste affichée et le
 * compteur de non-lus. Le badge de la barre supérieure et l'écran du centre
 * lisent la même source : sans cela, deux écrans ouverts pourraient afficher
 * deux comptes différents.
 *
 * Deux règles gouvernent la mise à jour :
 *
 *   - une notification reçue par le socket est insérée en tête de liste sans
 *     re-requêter. Le serveur l'écrit en base *avant* de pousser ; un
 *     rechargement ici ne ferait qu'effacer ce que l'utilisateur vient de voir
 *     apparaître ;
 *   - le compteur fait autorité. Il arrive par le socket et dans chaque
 *     réponse, et il est recalculé à la reconnexion : un compteur conservé en
 *     mémoire finit toujours par mentir.
 */

import { playFeedback } from './feedback';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS, type NotificationDto } from '@logixpress/types';
import { API_BASE_URL, tokenStorage } from './api';
import { notificationsApi } from './notification-api';

/** Nombre de notifications conservées pour l'aperçu de la barre supérieure. */
const PREVIEW_SIZE = 8;
/** Nombre de notifications tenues en mémoire pour l'écran du centre. */
const KEPT_SIZE = 60;

/**
 * Adresse du serveur temps réel.
 *
 * Les notifications voyagent hors du préfixe `/api/v1` : la socket est
 * attachée à la racine du serveur. On retire donc le préfixe plutôt que de
 * dupliquer l'adresse dans une variable d'environnement.
 */
function socketUrl(): string {
  return API_BASE_URL.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
}

interface NotificationState {
  items: NotificationDto[];
  unread: number;
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationState | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [list, count] = await Promise.all([
        notificationsApi.list({ limit: KEPT_SIZE }),
        notificationsApi.unreadCount(),
      ]);
      setItems(list.items);
      setUnread(count);
    } catch {
      setError('Notifications indisponibles.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = tokenStorage.getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }

    let active = true;

    void load();

    const socket = io(socketUrl(), {
      auth: { token },
      transports: ['websocket'],
      // Reprise automatique : une coupure réseau ne doit pas laisser
      // l'utilisateur avec un centre de notifications mort jusqu'au
      // rechargement de la page.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      if (!active) return;
      setIsConnected(true);
      // Après une coupure, le serveur a pu écrire des notifications pendant
      // que le client était absent : on redemande le compteur et on demande
      // une resynchronisation plutôt que de deviner l'état.
      socket.emit(SOCKET_EVENTS.READ_SYNC);
      void notificationsApi
        .unreadCount()
        .then((count) => {
          if (active) setUnread(count);
        })
        .catch(() => undefined);
    });

    socket.on('disconnect', () => {
      if (active) setIsConnected(false);
    });

    socket.on(SOCKET_EVENTS.NOTIFICATION_NEW, (payload: NotificationDto) => {
      if (!active || !payload?.id) return;
      setItems((current) => {
        // Le même événement peut arriver deux fois si la reconnexion rejoue
        // une émission : on ne duplique pas la ligne.
        if (current.some((n) => n.id === payload.id)) return current;
        return [payload, ...current].slice(0, KEPT_SIZE);
      });
      // Nouvelle notification en direct : cloche douce (une seule par événement).
      playFeedback('notify');
      // Le compteur arrive séparément ; on ne le devine pas ici.
    });

    socket.on(
      SOCKET_EVENTS.NOTIFICATION_UNREAD_COUNT,
      (payload: { count?: number }) => {
        if (!active) return;
        setUnread(Number(payload?.count ?? 0));
      }
    );

    socket.on(
      SOCKET_EVENTS.NOTIFICATION_READ,
      (payload: { id?: string; isRead?: boolean }) => {
        if (!active || !payload?.id) return;
        // Relecture faite depuis un autre onglet : la ligne est lue ici aussi,
        // sans que l'utilisateur ait à recharger.
        setItems((current) =>
          current.map((n) =>
            n.id === payload.id ? { ...n, isRead: true, readAt: n.readAt ?? new Date().toISOString() } : n
          )
        );
      }
    );

    return () => {
      active = false;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    // Mise à jour optimiste : la ligne passe lue immédiatement, le serveur
    // confirme. L'inverse ferait clignoter la pastille à chaque clic.
    setItems((current) =>
      current.map((n) =>
        n.id === id ? { ...n, isRead: true, readAt: n.readAt ?? new Date().toISOString() } : n
      )
    );
    setUnread((current) => Math.max(0, current - 1));

    try {
      await notificationsApi.markRead(id);
    } catch {
      await load();
    }
  }, [load]);

  const markAllRead = useCallback(async () => {
    const previous = items;
    setItems((current) =>
      current.map((n) => (n.isRead ? n : { ...n, isRead: true, readAt: new Date().toISOString() }))
    );
    setUnread(0);

    try {
      await notificationsApi.markAllRead();
    } catch {
      setItems(previous);
      await load();
    }
  }, [items, load]);

  const value = useMemo<NotificationState>(
    () => ({
      items,
      unread,
      isLoading,
      isConnected,
      error,
      markRead,
      markAllRead,
      refresh: load,
    }),
    [items, unread, isLoading, isConnected, error, markRead, markAllRead, load]
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

/**
 * Accès au centre de notifications.
 *
 * Hors du fournisseur, la fonction renvoie un état inerte plutôt que de lever :
 * un composant doit pouvoir s'afficher même si la coquille ne fournit pas le
 * contexte — un écran ne doit pas tomber parce qu'une pastille est absente.
 */
export function useNotifications(): NotificationState {
  const context = useContext(NotificationContext);
  const inert = useMemo<NotificationState>(
    () => ({
      items: [],
      unread: 0,
      isLoading: false,
      isConnected: false,
      error: null,
      markRead: async () => undefined,
      markAllRead: async () => undefined,
      refresh: async () => undefined,
    }),
    []
  );
  return context ?? inert;
}

export { PREVIEW_SIZE };