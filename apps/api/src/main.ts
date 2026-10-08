// L'ordre des imports est important : `config/env` doit être évalué avant
// tout module qui lit `process.env` au niveau module (secrets JWT, ports, Prisma, Redis).
import './config/env';

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { APP_CONFIG } from '@logixpress/config';
import { auditContextMiddleware } from './common/audit/audit-context.middleware';
import { createApiRouter } from './app.router';
import { errorHandler } from './common/http/async-handler';
import { securityHeaders } from './common/http/rate-limit';
import { rejectNullBytes } from './common/http/input-guard';
import { prismaService } from './database/prisma.service';
import { sessionService } from './common/auth/session.service';
import { redisService } from './redis/redis.service';
import { inAppChannel, registerChannel, socketChannel } from './modules/notifications/channels';
import { pushChannel } from './modules/notifications/push.channel';
import { initPush, pushInitStatus } from './modules/notifications/push.service';
import { notificationDispatcher } from './modules/notifications/notification.dispatcher';
import { closeRealtime, initialiseRealtime } from './modules/notifications/realtime.gateway';

function resolveAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * CORS de développement.
 *
 * L'authentification repose sur un jeton JWT transporté dans l'en-tête
 * `Authorization` (pas de cookie), donc aucune_origine n'est nécessaire.
 * L'origine est echoingée uniquement si elle figure dans `CORS_ORIGIN` :
 * aucune réponse ne renvoie `*` lorsque l'authentification est requise.
 */
function corsMiddleware(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    );
    // `X-Export-Rows` doit être exposé comme `Content-Disposition` : sans lui,
    // un navigateur ne peut pas lire le nombre de lignes exportées, et le
    // message de confirmation annonce « 0 ligne » après un export réussi.
    res.header('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Rows');
    res.header('Access-Control-Max-Age', '600');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(corsMiddleware(resolveAllowedOrigins()));
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(rejectNullBytes);

  // Derrière un proxy — load balancer, reverse proxy, passerelle — l'adresse
  // de connexion est celle du proxy, pas celle de l'utilisateur. Le journal
  // d'audit s'y trompe et devient inutilisable pour remonter à une machine.
  // `TRUST_PROXY` est donc une décision de déploiement, explicite : la prudence
  // d'Express par défaut est justement de ne croire personne.
  //
  // En production, l'API est toujours derrière la passerelle de l'hébergeur
  // (Koyeb, Render…) : 1 relais est supposé sauf `TRUST_PROXY=false` explicite.
  // Vérifier le réglage avec GET /api/v1/health/network (compte admin).
  const trustProxy =
    process.env.TRUST_PROXY === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY !== 'false');
  if (trustProxy) {
    // Nombre de proxys de confiance devant l'API (1 par défaut). `true`
    // ferait confiance à n'importe quel X-Forwarded-For envoyé par le client,
    // ce qui permettrait de contourner la limitation de débit.
    app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  }
  app.use((req, res, next) => auditContextMiddleware(req, res, next, trustProxy));

  app.use('/api/v1', createApiRouter());

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: 'Ressource introuvable.',
    });
  });

  // Doit être monté en DERNIER : Express ne le considère comme middleware
  // d'erreur que s'il possède les 4 arguments.
  app.use(errorHandler);

  return app;
}

/**
 * Connexion à l'infrastructure avant l'ouverture du port d'écoute.
 *
 * PostgreSQL est critique : s'il est injoignable, l'API démarre quand même mais le
 * signale clairement et `/api/v1/health` renvoie 503. Redis est optionnel.
 */
async function bootstrap() {
  const [databaseReady, redisReady] = await Promise.all([
    prismaService.connect(),
    redisService.connect(),
  ]);

  if (!databaseReady) {
    console.error(
      '[RUNEX API] Démarrage SANS PostgreSQL : les routes dépendantes de la ' +
        'base échoueront. Démarrez-la avec `npm run infra:up` puis `npm run prisma:migrate`.'
    );
  }
  if (!redisReady && redisService.isRequired()) {
    console.error(
      '[RUNEX API] REDIS_REQUIRED=true mais Redis est injoignable : ' +
        'l\'API est annoncée comme dégradée.'
    );
  }

  // `PORT` est la variable imposée par les hébergeurs (Koyeb, Render, Railway…).
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? APP_CONFIG.ports.api);
  const host = process.env.API_HOST ?? '0.0.0.0';

  const allowedOrigins = resolveAllowedOrigins();
  if (process.env.NODE_ENV === 'production') {
    const insecure = allowedOrigins.filter((o) => !o.startsWith('https://'));
    if (allowedOrigins.length === 0 || insecure.length > 0) {
      console.warn(
        `[RUNEX API] CORS_ORIGIN doit lister l'origine HTTPS du frontend (ex. https://runex.vercel.app). ` +
          `Valeurs non HTTPS : [${insecure.join(', ') || 'vide'}].`
      );
    }
  } else if (!allowedOrigins.includes('http://localhost:3000')) {
    console.warn(
      `[RUNEX API] CORS_ORIGIN [${allowedOrigins.join(', ') || 'vide'}] n'inclut pas ` +
        'http://localhost:3000 : le frontend Next.js en développement sera bloqué par CORS.'
    );
  }

  const server = createApp().listen(port, host, () => {
    console.log(`[RUNEX API] En écoute sur ${host}:${port}`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[RUNEX API] Health Check : http://localhost:${port}/api/v1/health`);
      console.log(`[RUNEX API] Swagger Docs  : http://localhost:${port}/api/v1/docs`);
    }
  });

  // Derrière un relais (Next.js, nginx, load balancer), le relais réutilise ses
  // connexions keep-alive. Avec le délai Node par défaut (5 s), l'API ferme une
  // connexion au moment où le relais l'emploie : « socket hang up », servi en
  // 500 au navigateur. L'API doit garder ses connexions plus longtemps que le relais.
  server.keepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS ?? 65_000);
  server.headersTimeout = server.keepAliveTimeout + 1_000;

  // La passerelle temps réel se monte sur le même serveur HTTP qu'un chemin
  // distinct : une notification écrite après le démarrage de l'API doit
  // pouvoir être poussée, et non seulement retrouvée au rechargement.
  initialiseRealtime(server);

  // Les canaux de diffusion sont enregistrés une fois pour toutes.
  // `push` s'ajoute ici sans toucher aux modules métier qui produisent les événements.
  registerChannel(inAppChannel);
  registerChannel(socketChannel);
  notificationDispatcher.register(pushChannel);
  await initPush();
  const pushStatus = pushInitStatus();
  console.log(
    `[RUNEX API] Canaux de notification : in_app, socket, push${pushStatus.enabled ? '' : ' (désactivé: ' + (pushStatus.error ?? 'non configuré') + ')'}` 
  );

  // Ménage des sessions expirées : au démarrage puis chaque jour.
  const purge = () =>
    void sessionService.purgeStale().catch((error: unknown) => {
      console.warn('[RUNEX API] Ménage des sessions impossible :', String(error));
    });
  if (databaseReady) purge();
  setInterval(purge, 24 * 3600 * 1000).unref();

  // Arrêt propre (redéploiement) : les websockets ouverts empêcheraient
  // `server.close` de rendre la main ; ils sont fermés d'abord, puis les
  // connexions keep-alive. Au-delà de 10 s, l'arrêt est forcé.
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[RUNEX API] ${signal} reçu, arrêt en cours...`);
    setTimeout(() => process.exit(0), 10_000).unref();
    void closeRealtime()
      .catch(() => undefined)
      .finally(() => {
        server.close(async () => {
          await Promise.allSettled([prismaService.disconnect(), redisService.disconnect()]);
          process.exit(0);
        });
        server.closeIdleConnections();
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('[RUNEX API] Erreur fatale au démarrage :', error);
  process.exit(1);
});
