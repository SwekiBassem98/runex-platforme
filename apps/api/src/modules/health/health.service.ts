import { prismaService } from '../../database/prisma.service';
import { redisService } from '../../redis/redis.service';
import { connectedSockets, realtimeReady } from '../notifications/realtime.gateway';
import type { HealthCheckResponse } from '@logixpress/types';

/**
 * Construit l'état de santé à partir de sondes réelles :
 * - `api`      : le processus répond (la route est en train de s'exécuter)
 * - `database` : `SELECT 1` via Prisma
 * - `redis`    : `PING` via ioredis, obligatoire seulement si REDIS_REQUIRED=true
 *
 * Le statut global est `ok` uniquement si toutes les dépendances obligatoires
 * répondent, `degraded` sinon.
 */
export class HealthService {
  async getHealthStatus(): Promise<HealthCheckResponse> {
    const [database, redis] = await Promise.all([
      prismaService.checkHealth(),
      redisService.checkHealth(),
    ]);

    const redisRequired = redisService.isRequired();
    const isHealthy = database.status === 'up' && (!redisRequired || redis.status === 'up');

    return {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: {
        api: { status: 'up' },
        database: {
          status: database.status,
          latencyMs: database.latencyMs,
          ...(database.message && process.env.NODE_ENV !== 'production' ? { message: database.message } : {}),
        },
        redis: {
          status: redis.status,
          latencyMs: redis.latencyMs,
          required: redisRequired,
          ...(redis.message && process.env.NODE_ENV !== 'production' ? { message: redis.message } : {}),
        },
        // Nombre d'écrans connectés au canal temps réel. Le signaler ici
        // évite de chercher bien longtemps pourquoi « les notifications
        // n'arrivent pas » alors qu'aucune socket n'est ouverte.
        realtime: {
          status: realtimeReady() ? 'up' : 'down',
          sockets: connectedSockets(),
        },
      },
      version: '1.0.0',
    };
  }
}

export const healthService = new HealthService();
