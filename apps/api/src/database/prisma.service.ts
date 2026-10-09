/**
 * Service d'accès aux données PostgreSQL via Prisma.
 *
 * - Une seule instance de `PrismaClient` est partagée par tout le processus
 *   (et survit au rechargement à chaud de `tsx watch` en développement).
 * - `connect()` n'interrompt jamais le démarrage de l'API : un échec est journalisé
 *   avec une action corrective, le endpoint `/api/v1/health` continue de répondre
 *   et reflète l'état réel de la base.
 */
import { PrismaClient } from '@prisma/client';

const PRISMA_GLOBAL_KEY = Symbol.for('logixpress.prisma.client');

type PrismaGlobalStore = { [PRISMA_GLOBAL_KEY]?: PrismaClient };

/**
 * Adresse de la base, complétée pour une base serverless.
 *
 * Neon met le calcul en veille après 5 minutes d'inactivité et ferme alors
 * les connexions ouvertes. Prisma gardait les siennes inactives jusqu'à
 * 300 s (`max_idle_connection_lifetime` par défaut) : la base les coupait
 * d'abord, et chaque veille écrivait une rafale de
 * « Error in PostgreSQL connection: Error { kind: Closed } » dans les journaux
 * (sans gravité : Prisma rouvre une connexion à la requête suivante). En les
 * fermant lui-même après 60 s, Prisma ne laisse plus rien à couper.
 * Un paramètre déjà présent dans DATABASE_URL est respecté.
 */
export function withServerlessDefaults(url: string | undefined): string | undefined {
  if (!url || !/^postgres(ql)?:\/\//.test(url)) return url;
  if (/[?&]max_idle_connection_lifetime=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}max_idle_connection_lifetime=60`;
}

/** Fermeture d'une connexion inactive par le serveur : prévue, pas une panne. */
function isIdleClose(message: string): boolean {
  return /Error in PostgreSQL connection/i.test(message) && /kind:\s*Closed/i.test(message);
}

function createClient(): PrismaClient {
  const url = withServerlessDefaults(process.env.DATABASE_URL);
  const client = new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    // Le log `query` est très bruyant : activé uniquement sur demande via
    // PRISMA_LOG_QUERIES=true pour.debuguer une requête précise.
    log: [
      ...(process.env.PRISMA_LOG_QUERIES === 'true' ? [{ emit: 'stdout' as const, level: 'query' as const }] : []),
      { emit: 'stdout' as const, level: 'warn' as const },
      { emit: 'event' as const, level: 'error' as const },
    ],
  });
  let lastIdleNotice = 0;
  client.$on('error', (event: { message: string }) => {
    if (isIdleClose(event.message)) {
      // Une ligne d'information au plus par minute, au lieu d'une erreur par connexion.
      if (Date.now() - lastIdleNotice > 60_000) {
        lastIdleNotice = Date.now();
        console.info('[Prisma] Connexion inactive fermée par la base (veille) — reconnexion automatique.');
      }
      return;
    }
    console.error(`prisma:error ${event.message || JSON.stringify(event)}`);
  });
  return client;
}

/**
 * Réduit le message d'erreur Prisma à sa ligne utile : les messages bruts
 * contiennent plusieurs paragraphes de contexte verbeux qui alourdissent
 * inutilement la réponse de `/api/v1/health`.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const lines = error.message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('Invalid `prisma.'));

  return (lines[0] ?? error.message).slice(0, 300);
}

export class PrismaService {
  readonly client: PrismaClient;

  private connected = false;
  private lastError: string | null = null;

  constructor() {
    const globalStore = globalThis as unknown as PrismaGlobalStore;
    this.client = globalStore[PRISMA_GLOBAL_KEY] ?? createClient();
    globalStore[PRISMA_GLOBAL_KEY] = this.client;
  }

  /**
   * Établit la connexion au serveur PostgreSQL.
   * @returns `true` si la base répond, `false` sinon (sans lever d'exception).
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;

    try {
      await this.client.$connect();
      this.connected = true;
      this.lastError = null;
      console.log('[Prisma] Connexion PostgreSQL établie.');
      return true;
    } catch (error) {
      this.connected = false;
      this.lastError = describeError(error);
      console.error(`[Prisma] Connexion PostgreSQL impossible : ${this.lastError}`);
      console.error(
        '[Prisma] Vérifiez que PostgreSQL est démarré (`npm run infra:up` ou ' +
          '`docker compose up -d postgres`) et que DATABASE_URL est correct dans .env.'
      );
      return false;
    }
  }

  /**
   * Ferme proprement le pool de connexions (arrêt du processus).
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.$disconnect();
    } catch {
      // Rien à faire : la connexion est déjà-close.
    }
    this.connected = false;
  }

  /**
   * Sonde réelle de la base : exécute un `SELECT 1` et chronomètre l'aller-retour.
   * Ne renvoie jamais un succès simulé.
   */
  async checkHealth(): Promise<{
    status: 'up' | 'down';
    latencyMs: number;
    message?: string;
  }> {
    const start = Date.now();
    try {
      await this.client.$queryRaw`SELECT 1`;
      this.connected = true;
      this.lastError = null;
      return { status: 'up', latencyMs: Math.max(1, Date.now() - start) };
    } catch (error) {
      this.connected = false;
      this.lastError = describeError(error);
      return { status: 'down', latencyMs: 0, message: this.lastError };
    }
  }

  getConnectionState(): boolean {
    return this.connected;
  }

  getLastError(): string | null {
    return this.lastError;
  }
}

export const prismaService = new PrismaService();
