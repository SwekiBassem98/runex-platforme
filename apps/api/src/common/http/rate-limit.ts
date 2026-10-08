/**
 * Limitation de débit, sans dépendance.
 *
 * Fenêtre fixe par clé, en mémoire du processus. Suffisant pour une instance ;
 * derrière plusieurs instances, chaque instance applique sa propre limite (la
 * protection reste effective, plafond multiplié par le nombre d'instances).
 *
 * `countOnly` permet de ne compter que certaines réponses (ex. les échecs de
 * connexion) : un utilisateur légitime n'est jamais bloqué par ses succès.
 */
import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  name: string;
  windowMs: number;
  max: number;
  key: (req: Request) => string | null;
  /** Ne compter que les réponses dont le statut satisfait ce prédicat. */
  countOnly?: (status: number) => boolean;
  message?: string;
}

const stores = new Map<string, Map<string, Bucket>>();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [key, bucket] of store) if (bucket.resetAt <= now) store.delete(key);
  }
}, 60_000);
sweeper.unref?.();

export function rateLimitDisabled(): boolean {
  return process.env.RATE_LIMIT_DISABLED === 'true' && process.env.NODE_ENV !== 'production';
}

export function rateLimit(options: RateLimitOptions) {
  const store = new Map<string, Bucket>();
  stores.set(options.name, store);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (rateLimitDisabled()) {
      next();
      return;
    }
    const raw = options.key(req);
    if (!raw) {
      next();
      return;
    }
    const key = raw.toLowerCase();
    const now = Date.now();
    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      store.set(key, bucket);
    }

    if (bucket.count >= options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        message:
          options.message ??
          `Trop de tentatives. Réessayez dans ${Math.ceil(retryAfter / 60)} minute(s).`,
      });
      return;
    }

    if (options.countOnly) {
      const current = bucket;
      res.on('finish', () => {
        if (options.countOnly!(res.statusCode)) current.count += 1;
      });
    } else {
      bucket.count += 1;
    }
    next();
  };
}

const ip = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';
const bodyField = (req: Request, field: string): string =>
  typeof req.body?.[field] === 'string' ? String(req.body[field]).trim().slice(0, 254) : '';

const MIN = 60_000;
const failed = (status: number) => status === 401 || status === 403;

/** Échecs de connexion par compte et adresse : 8 par quart d'heure. */
export const loginFailuresLimiter = rateLimit({
  name: 'login-account',
  windowMs: 15 * MIN,
  max: Number(process.env.RATE_LIMIT_LOGIN_FAILURES ?? 8),
  key: (req) => {
    const email = bodyField(req, 'email');
    return email ? `${email}|${ip(req)}` : null;
  },
  countOnly: failed,
  message: 'Trop de tentatives de connexion échouées pour ce compte. Réessayez dans 15 minutes.',
});

/** Tentatives de connexion par adresse IP, tous comptes confondus. */
export const loginIpLimiter = rateLimit({
  name: 'login-ip',
  windowMs: 15 * MIN,
  max: Number(process.env.RATE_LIMIT_LOGIN_PER_IP ?? 300),
  key: ip,
});

export const refreshLimiter = rateLimit({
  name: 'refresh-ip',
  windowMs: MIN,
  max: Number(process.env.RATE_LIMIT_REFRESH_PER_IP ?? 120),
  key: ip,
});

export const passwordResetLimiter = rateLimit({
  name: 'password-reset-ip',
  windowMs: 15 * MIN,
  max: 10,
  key: ip,
});

/** Code secret de bordereau : 5 échecs par quart d'heure et par utilisateur. */
export const voucherSecretLimiter = rateLimit({
  name: 'voucher-secret',
  windowMs: 15 * MIN,
  max: 5,
  key: (req) => {
    const user = (req as Request & { user?: { id?: string } }).user;
    return user?.id ? `${user.id}|${String(req.params.voucherNumber ?? '')}` : ip(req);
  },
  countOnly: (status) => status >= 400 && status < 500,
  message: 'Trop de codes secrets erronés pour ce bordereau. Réessayez dans 15 minutes.',
});

/** En-têtes de sécurité de base pour une API JSON. */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (!req.path.startsWith('/api/v1/docs')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/v1/auth')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}
