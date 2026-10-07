/**
 * Service de gestion du cache Redis (et des files d'attente BullMQ).
 *
 * Redis est **optionnel** dans l'architecture actuelle : aucun module métier ne
 * dépend d'un cache persistant, l'API démarre donc normalement s'il est absent.
 * Le statut réel est néanmoins remonté par `/api/v1/health`.
 *
 * Positionner `REDIS_REQUIRED=true` pour rendre Redis indispensable (le endpoint
 * de santé basculera alors en `degraded` s'il est injoignable).
 */
import Redis, { type RedisOptions } from 'ioredis';

const REDIS_GLOBAL_KEY = Symbol.for('logixpress.redis.client');

type RedisGlobalStore = { [REDIS_GLOBAL_KEY]?: Redis };

export function readRedisOptions(): RedisOptions {
  const options: RedisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    db: Number(process.env.REDIS_DB || 0),
    // Connexion explicite : on ne veut pas d'ouverture de socket à l'import du module.
    lazyConnect: true,
    // Échec rapide et franc si le serveur ne répond pas.
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 3000),
    enableOfflineQueue: false,
    // Pas de reconnexion automatique en boucle : `connect()` / `checkHealth()`
    // recréent le client à la demande, ce qui évite le bruit dans les logs.
    retryStrategy: () => null,
  };

  const password = process.env.REDIS_PASSWORD;
  if (password) options.password = password;

  return options;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class RedisService {
  private client: Redis | null = null;
  private connected = false;
  private lastError: string | null = null;

  constructor() {
    const globalStore = globalThis as unknown as RedisGlobalStore;
    if (globalStore[REDIS_GLOBAL_KEY]) {
      this.client = globalStore[REDIS_GLOBAL_KEY];
    }
  }

  private createClient(): Redis {
    const client = new Redis(readRedisOptions());
    client.on('error', (error: Error) => {
      this.connected = false;
      this.lastError = error.message;
    });
    client.on('end', () => {
      this.connected = false;
    });

    const globalStore = globalThis as unknown as RedisGlobalStore;
    globalStore[REDIS_GLOBAL_KEY] = client;

    return client;
  }

  /** Recrée le client s'il n'existe plus ou s'il s'est terminé. */
  private ensureClient(): Redis {
    if (!this.client || this.client.status === 'end') {
      this.client = this.createClient();
    }
    return this.client;
  }

  private async ensureConnection(): Promise<void> {
    const client = this.ensureClient();
    if (client.status === 'wait') {
      await client.connect();
    } else if (client.status === 'ready' || client.status === 'connect') {
      await client.ping();
    } else {
      // 'connecting' / 'reconnecting' : on repart d'un client neuf.
      this.resetClient();
      await this.ensureClient().connect();
    }
  }

  private resetClient(): void {
    const globalStore = globalThis as unknown as RedisGlobalStore;
    if (this.client) {
      this.client.disconnect();
      if (globalStore[REDIS_GLOBAL_KEY] === this.client) {
        delete globalStore[REDIS_GLOBAL_KEY];
      }
    }
    this.client = null;
  }

  /**
   * Connexion best-effort : n'interrompt jamais le démarrage de l'API.
   */
  async connect(): Promise<boolean> {
    try {
      await this.ensureConnection();
      this.connected = true;
      this.lastError = null;
      const { host, port } = readRedisOptions();
      console.log(`[Redis] Connexion établie sur ${host}:${port}.`);
      return true;
    } catch (error) {
      this.connected = false;
      this.lastError = describeError(error);
      this.resetClient();
      console.warn(`[Redis] Cache indisponible (${this.lastError}) - démarrage sans Redis.`);
      return false;
    }
  }

  /**
   * Sonde réelle : `PING` sur le serveur, avec chronométrage.
   * Ne renvoie jamais un succès simulé.
   */
  async checkHealth(): Promise<{
    status: 'up' | 'down';
    latencyMs: number;
    message?: string;
  }> {
    const start = Date.now();
    try {
      await this.ensureConnection();
      this.connected = true;
      this.lastError = null;
      return { status: 'up', latencyMs: Math.max(1, Date.now() - start) };
    } catch (error) {
      this.connected = false;
      this.lastError = describeError(error);
      this.resetClient();
      return { status: 'down', latencyMs: 0, message: this.lastError };
    }
  }

  async disconnect(): Promise<void> {
    this.resetClient();
  }

  /** Accès au client partagé (cache, files d'attente BullMQ). */
  getClient(): Redis {
    return this.ensureClient();
  }

  getConnectionState(): boolean {
    return this.connected;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /** Redis conditionne-t-il la disponibilité globale de l'API ? */
  isRequired(): boolean {
    return process.env.REDIS_REQUIRED === 'true';
  }
}

export const redisService = new RedisService();
