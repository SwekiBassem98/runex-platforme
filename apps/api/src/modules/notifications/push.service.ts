/**
 * Service d'envoi poussé (FCM).
 *
 * Une notification est d'abord écrite en base (`Notification`) : c'est elle qui
 * fait foi. Le poussé n'est qu'un réveil : si le téléphone est éteint, la
 * notification reste dans la boîte de réception. Un échec FCM ne doit donc
 * jamais faire échouer l'opération métier qui a déclenché l'événement.
 *
 * Le service est volontairement tolérant :
 * - si `firebase-admin` n'est pas installé ou si les identifiants sont absents,
 *   l'envoi est ignoré (skipped) et loggé une seule fois ;
 * - chaque envoi est encapsulé dans un try/catch : une coupure réseau ne
 *   remonte jamais jusqu'à la transaction métier ;
 * - les jetons invalides sont désactivés, pas supprimés, pour garder la trace.
 */

import { getPrisma } from '../../common/database/prisma-context';
import type { NotificationDto } from '@logixpress/types';

let admin: any | null = null;
let initialised = false;
let enabled = false;
let initError: string | null = null;

/** Jeton invalide au sens FCM : le jeton doit être désactivé sans réessai. */
const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

function isInvalidTokenError(error: unknown): boolean {
  const code = (error as { code?: string; errorInfo?: { code?: string } })?.code
    ?? (error as { errorInfo?: { code?: string } })?.errorInfo?.code
    ?? '';
  return INVALID_TOKEN_CODES.has(code) || /not-registered|invalid.*token/i.test(String((error as Error)?.message ?? ''));
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

export function isPushEnabled(): boolean {
  return enabled && initialised && !!admin;
}

export function pushInitStatus(): { enabled: boolean; initialised: boolean; error: string | null } {
  return { enabled, initialised, error: initError };
}

/**
 * Initialise `firebase-admin` si les variables d'environnement fournissent une
 * configuration complète. Appelé une fois au démarrage du serveur (main.ts).
 *
 * Variables attendues :
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY (avec `\n` échappés, comme fourni par la console Firebase)
 * Optionnel :
 * - PUSH_ENABLED=false pour désactiver explicitement
 */
export async function initPush(): Promise<void> {
  if (initialised) return;
  initialised = true;

  const pushDisabled = env('PUSH_ENABLED') === 'false';
  if (pushDisabled) {
    enabled = false;
    initError = 'PUSH_ENABLED=false';
    console.info('[Push] Désactivé par PUSH_ENABLED=false');
    return;
  }

  const projectId = env('FIREBASE_PROJECT_ID');
  const clientEmail = env('FIREBASE_CLIENT_EMAIL');
  const privateKeyRaw = env('FIREBASE_PRIVATE_KEY');

  if (!projectId || !clientEmail || !privateKeyRaw) {
    enabled = false;
    initError = 'Identifiants Firebase manquants (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY)';
    console.info('[Push] Non configuré — les notifications poussées seront ignorées (skipped).', initError);
    return;
  }

  try {
    // Import dynamique : `firebase-admin` est optionnel en développement.
    // @ts-ignore — module optionnel, absent en dev sans credentials
    const mod: any = await import('firebase-admin').catch(() => null);
    if (!mod) {
      enabled = false;
      initError = 'firebase-admin non installé (npm install firebase-admin)';
      console.info('[Push] firebase-admin absent — push désactivé', initError);
      return;
    }
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
    if (mod.apps.length === 0) {
      mod.initializeApp({
        credential: mod.credential.cert({ projectId, clientEmail, privateKey }),
      });
    }
    admin = mod;
    enabled = true;
    initError = null;
    console.info('[Push] FCM initialisé (project:', projectId + ')');
  } catch (error) {
    enabled = false;
    initError = error instanceof Error ? error.message : String(error);
    console.warn('[Push] Initialisation FCM échouée :', initError);
  }
}

export interface PushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}

/**
 * Construit le payload FCM à partir d'une notification persistée.
 *
 * Aucune donnée sensible n'est incluse : ni mot de passe, ni JWT, ni secret
 * de paiement, ni PII client au-delà du résumé déjà présent dans la notification.
 */
export function toPushPayload(dto: NotificationDto): PushPayload {
  return {
    title: dto.title?.slice(0, 80) ?? 'RUNEX',
    body: dto.content?.slice(0, 180) ?? '',
    data: {
      id: dto.id,
      type: dto.type,
      category: dto.category,
      relatedEntity: dto.relatedEntity ?? '',
      relatedEntityId: dto.relatedEntityId ?? '',
      href: dto.href ?? '/dashboard',
      createdAt: dto.createdAt,
    },
  };
}

export interface SendResult {
  succeeded: string[];
  failed: { token: string; error: string; invalid: boolean }[];
}

/**
 * Envoie une notification à une liste de jetons.
 *
 * Ne lève jamais. Un échec réseau ou d'authentification FCM est journalisé et
 * renvoyé dans `failed`, jamais propagé. La transaction métier a déjà abouti.
 */
export async function sendToTokens(
  tokens: string[],
  payload: PushPayload
): Promise<SendResult> {
  const succeeded: string[] = [];
  const failed: SendResult['failed'] = [];

  if (tokens.length === 0) return { succeeded, failed };
  if (!isPushEnabled() || !admin) {
    // Pas configuré : on considère l'envoi comme « ignoré », pas échoué — le
    // registre restera en `skipped` plutôt qu'en `failed` pour ne pas déclencher
    // de réessai inutile.
    return { succeeded: [], failed: [] };
  }

  // Envoi en lots de 500 (limite FCM multicast). Pour l'instant un seul lot suffit.
  for (const token of tokens) {
    try {
      const message = {
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: 'high' as const },
        apns: { payload: { aps: { sound: 'default' as const, badge: 1 } } },
      };
      const id = await admin.messaging().send(message);
      succeeded.push(token);
      void id; // externalId non exposé ici, géré par le canal
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const invalid = isInvalidTokenError(error);
      failed.push({ token, error: msg.slice(0, 400), invalid });
      if (invalid) {
        console.info('[Push] Jeton invalide détecté, désactivation prévue :', token.slice(0, 20) + '...');
      } else {
        console.warn('[Push] Échec d\'envoi FCM :', msg.slice(0, 300));
      }
    }
  }

  return { succeeded, failed };
}

/**
 * Résout les jetons actifs d'un utilisateur et envoie la notification.
 *
 * Lit `PushDevice` (multi-appareils) puis, en repli, `User.pushToken` si aucun
 * appareil n'existe — pour compatibilité avec les installations antérieures.
 */
export async function sendToUser(userId: string, dto: NotificationDto): Promise<SendResult> {
  const prisma = getPrisma();
  const devices = await prisma.pushDevice.findMany({
    where: { userId, isActive: true },
    select: { token: true },
  });
  let tokens = devices.map((d) => d.token).filter(Boolean);

  // Repli legacy : un utilisateur ancien peut n'avoir qu'un `User.pushToken`.
  if (tokens.length === 0) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true, pushEnabled: true },
    });
    if (user?.pushToken && user.pushEnabled !== false) {
      tokens = [user.pushToken];
    }
  }

  // Dédup + nettoyage léger
  tokens = [...new Set(tokens.map((t) => t.trim()).filter((t) => t.length >= 20))];

  if (tokens.length === 0) return { succeeded: [], failed: [] };

  const payload = toPushPayload(dto);
  const result = await sendToTokens(tokens, payload);

  // Nettoyage des jetons invalides : désactivation, pas suppression.
  for (const f of result.failed) {
    if (f.invalid) {
      try {
        await prisma.pushDevice.updateMany({
          where: { token: f.token },
          data: { isActive: false },
        });
        // Aussi User.pushToken legacy si c'était celui-là
        await prisma.user.updateMany({
          where: { pushToken: f.token },
          data: { pushToken: null, pushEnabled: false },
        });
      } catch {
        // Nettoyage best-effort
      }
    }
  }

  return result;
}
