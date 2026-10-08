/**
 * Passerelle temps réel des notifications.
 *
 * Une notification est d'abord écrite en base — c'est elle qui fait foi, et
 * elle survit à la fermeture de tous les onglets. Le socket n'est qu'un canal
 * de garden : il accélère l'affichage, il n'est pas la source de vérité. Un
 * utilisateur hors ligne n'a rien perdu, il trouvera sa notification au
 * rechargement suivant.
 *
 * Chaque connexion rejoint une salle nommée par son identifiant. Aucun
 * destinataire n'est énuméré dans le message : le serveur sait à qui il parle,
 * et un client ne peut pas s'abonner aux notifications d'un autre.
 */

import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { verifyAccessToken } from '../../common/auth/jwt.util';
import { sessionService } from '../../common/auth/session.service';
import { SOCKET_EVENTS, SOCKET_SYSTEM_EVENTS } from '@logixpress/types';

/** Salle privée d'un utilisateur. */
const userRoom = (userId: string): string => `user:${userId}`;

interface SocketUser {
  id: string;
  fullName: string;
  role?: string;
  exp?: number;
}

let io: Server | null = null;

/**
 * Marque la connexion comme authentifiée.
 *
 * Le jeton est lu dans la requête de liaison, pas dans un message ultérieur :
 * une socket non authentifiée n'entre pas dans une salle et ne reçoit rien.
 * `allowRequest` rejette avant même l'ouverture, ce qui évite d'avoir à
 * déconnecter une connexion non autorisée déjà établie.
 */
async function authenticate(socket: Socket): Promise<boolean> {
  // Uniquement `auth.token` : un jeton passé dans l'URL (`?token=`) finirait
  // dans les journaux d'accès de l'hébergeur et des relais.
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token || typeof token !== 'string') return false;
  const payload = verifyAccessToken(token);
  if (!payload?.sub || !payload.sid) return false;
  const check = await sessionService.check(payload.sid, payload.sub).catch(() => ({ ok: false as const }));
  if (!check.ok) return false;
  const user: SocketUser = {
    id: payload.sub,
    fullName: payload.fullName ?? '',
    role: payload.role,
    exp: payload.exp,
  };
  (socket.data as { user?: SocketUser }).user = user;
  socket.join(userRoom(user.id));
  return true;
}

/** Origines autorisées pour le navigateur ; un client sans `Origin` (mobile) est accepté. */
function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

declare module 'socket.io' {
  interface SocketData {
    user?: SocketUser;
  }
}

export function initialiseRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    // La diffusion part du serveur ; le client n'a qu'à se connecter. Le
    // chemin est distinct de l'API REST pour qu'un proxy n'ait pas à gérer
    // les deux protocoles sur la même route.
    path: '/socket.io',
    serveClient: false,
    cors: {
      // Navigateurs : seules les origines de CORS_ORIGIN. Un client sans en-tête
      // Origin (application mobile) reste accepté ; le jeton fait le contrôle.
      origin: (origin, callback) => {
        if (!origin || allowedOrigins().includes(origin)) callback(null, true);
        else callback(null, false);
      },
      credentials: false,
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    void authenticate(socket).then((authenticated) => {
      if (authenticated) {
        next();
        return;
      }
      const err = new Error('Jeton absent ou invalide.');
      // Code 4401 : catégorie 4xx = refus du client, contrairement à
      // 5000 qui signale une panne du serveur et que le client retenterait.
      (err as Error & { data?: { code: string } }).data = { code: '4401' };
      next(err);
    });
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (!user) return;

    // La connexion ne survit pas au jeton qui l'a ouverte : à son échéance, le
    // client doit se reconnecter avec un jeton rafraîchi.
    if (user.exp) {
      const remainingMs = user.exp * 1000 - Date.now();
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, remainingMs));
      timer.unref?.();
      socket.on('disconnect', () => clearTimeout(timer));
    }

    // Présence livreur : la connexion socket peut rafraîchir `lastSeenAt`,
    // mais n'est jamais l'unique source — le battement REST reste canonique.
    // On ne bloque jamais la connexion et on ignore silencieusement l'absence
    // de profil livreur (admin/gestionnaire) ou toute erreur DB.
    if (user.role === 'LIVREUR') {
      void import('../../modules/presence/presence.service')
        .then(({ presenceService: svc }) => svc.heartbeatByUserId(user.id))
        .catch(() => {});
    }

    socket.emit(SOCKET_SYSTEM_EVENTS.READY, { userId: user.id, at: new Date().toISOString() });

    // À la reconnexion, le compteur de non-lus est redemandé : entre la perte
    // de la socket et son rétablissement, des notifications ont pu être
    // écrites, et le badge doit repartir juste.
    socket.on(SOCKET_EVENTS.READ_SYNC, () => {
      socket.emit(SOCKET_SYSTEM_EVENTS.READY, { userId: user.id });
    });
  });

  return io;
}

export function realtimeReady(): boolean {
  return io !== null;
}

/** Ce destinataire a-t-il au moins un écran ouvert ? */
export function isConnected(userId: string): boolean {
  if (!io) return false;
  // `allSockets` est la seule interrogation fiable de l'appartenance à une
  // salle : l'instance ne tient pas de compteur par salle, et compter les
  // sockets ne distinguerait pas un utilisateur de deux onglets du même.
  const room = io.sockets.adapter.rooms.get(userRoom(userId));
  return (room?.size ?? 0) > 0;
}

/** Alias de lecture, plus naturel chez l'appelant. */
export const hasRealtime = realtimeReady;

/**
 * Envoie une notification aux écrans connectés d'un utilisateur.
 *
 * Ne lève jamais : l'appelant est une opération métier qui a déjà abouti, et
 * une coupure réseau ne doit pas la faire échouer.
 */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!io) return;
  try {
    io.to(userRoom(userId)).emit(event, payload);
  } catch (error) {
    console.error('[Temps réel] Diffusion impossible :', error);
  }
}

/** Compte des connexions ouvertes, pour le suivi et les tests. */
export function connectedSockets(): number {
  return io ? io.engine.clientsCount : 0;
}

/** Ferme la passerelle. Appelé à l'arrêt du serveur. */
export async function closeRealtime(): Promise<void> {
  if (!io) return;
  const current = io;
  io = null;
  await current.close();
}