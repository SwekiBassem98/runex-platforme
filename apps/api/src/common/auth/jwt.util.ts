import crypto from 'node:crypto';
import type { AuthUser } from '@logixpress/types';

/**
 * Lit un secret depuis l'environnement.
 *
 * En production, l'absence de variable est une erreur fatale : on ne tolère pas
 * un secret de repli en dur. En développement, un secret explicite et marqué
 * comme non sécurisé permet de démarrer sans configuration.
 */
function readSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.trim().length > 0) {
    // En production, un secret court ou recopié de .env.example permettrait
    // de forger des jetons : l'API refuse de démarrer plutôt que de l'accepter.
    if (process.env.NODE_ENV === 'production' && (value.trim().length < 32 || /change_me|dev_only|^dev_/i.test(value))) {
      throw new Error(
        `[Config] ${name} est trop faible pour la production (32 caractères aléatoires minimum, ` +
          'jamais la valeur de .env.example).'
      );
    }
    return value;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[Config] Variable d'environnement obligatoire manquante : ${name}. ` +
        'Copiez .env.example vers .env et renseignez un secret aléatoire.'
    );
  }

  console.warn(`[Config] ${name} absente : utilisation d'un secret de développement.`);
  return devFallback;
}

/**
 * Convertit une durée "15m", "7d", "900s", "3600" en secondes.
 */
function parseDurationToSeconds(value: string | undefined, fallbackSeconds: number): number {
  if (!value) return fallbackSeconds;
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!match) return fallbackSeconds;

  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  const seconds = Math.round(amount * (multipliers[unit] ?? 1));
  return seconds > 0 ? seconds : fallbackSeconds;
}

const ACCESS_SECRET = readSecret(
  'JWT_ACCESS_SECRET',
  'dev_only_insecure_jwt_access_secret_do_not_use_in_production'
);
const REFRESH_SECRET = readSecret(
  'JWT_REFRESH_SECRET',
  'dev_only_insecure_jwt_refresh_secret_do_not_use_in_production'
);
const ACCESS_TTL_SECONDS = parseDurationToSeconds(process.env.JWT_ACCESS_EXPIRES_IN, 15 * 60);
if (process.env.NODE_ENV === 'production' && ACCESS_SECRET === REFRESH_SECRET) {
  throw new Error('[Config] JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent être différents.');
}
const REFRESH_TTL_SECONDS = parseDurationToSeconds(process.env.JWT_REFRESH_EXPIRES_IN, 7 * 86400);

interface TokenPayload {
  [key: string]: unknown;
  sub: string; // User ID
  email: string;
  fullName?: string;
  role: string;
  shipperId?: string;
  shipperName?: string;
  driverId?: string;
  driverName?: string;
  depositId?: string;
  /**
   * Identifiant de la session (`Session.id`) à laquelle le jeton appartient.
   *
   * Le jeton seul ne suffit plus : chaque requête vérifie que la session existe,
   * n'est pas révoquée et que le compte est toujours actif. C'est ce qui rend
   * la déconnexion et la désactivation d'un compte effectives immédiatement.
   */
  sid?: string;
  /** Usage du jeton : absent = accès/rafraîchissement, `pwd-reset` = réinitialisation. */
  purpose?: string;
  /** Empreinte du hash de mot de passe : rend un lien de réinitialisation à usage unique. */
  pwh?: string;
  exp: number; // Expiration en secondes
  iat: number;
  /**
   * Identifiant unique du jeton.
   *
   * `iat` est exprimé en secondes : deux jetons produits dans la même seconde
   * seraient strictement identiques, ce qui rendrait la rotation du refresh
   * token inopérante (l'ancien jeton resterait valide). `jti` garantit
   * l'unicité du jeton indépendamment de l'horodatage.
   */
  jti: string;
}

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = 'sha512';

/**
 * Hash un mot de passe avec PBKDF2 et un sel aléatoire.
 * Format stocké : `<sel hex>:<hash hex>`.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    .toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Vérifie un mot de passe contre son hash.
 *
 * `timingSafeEqual` lève une exception si les deux buffers n'ont pas la même
 * longueur : un hash corrompu en base provoquerait donc une 500 au lieu d'un
 * simple refus d'authentification. On compare les longueurs au préalable.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;

  const expected = Buffer.from(originalHash, 'hex');
  if (expected.length !== PBKDF2_KEY_LENGTH) return false;

  const actual = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
  return crypto.timingSafeEqual(actual, expected);
}

/** Comparaison à temps constant de deux chaînes de même taille. */
function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Encode en base64url pour JWT RFC 7519
 */
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Décode base64url
 */
function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Signe un JWT HMAC-SHA256
 */
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64');
  const encodedSignature = signature.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${encodedSignature}`;
}

/**
 * Vérifie un JWT HMAC-SHA256
 */
function verifyJwt<T = TokenPayload>(token: string, secret: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const data = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (!safeCompare(encodedSignature, expectedSignature)) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as TokenPayload;
    const now = Math.floor(Date.now() / 1000);
    // Un jeton sans échéance n'est jamais émis par l'API : il est refusé.
    if (typeof payload.exp !== 'number' || payload.exp < now) {
      return null; // Expiré
    }
    return payload as unknown as T;
  } catch {
    return null;
  }
}

/**
 * Génère une paire de tokens d'accès et de rafraîchissement
 */
export function generateTokenPair(user: AuthUser, sid: string) {
  const now = Math.floor(Date.now() / 1000);
  const accessExpiresInSeconds = ACCESS_TTL_SECONDS;
  const refreshExpiresInSeconds = REFRESH_TTL_SECONDS;

  const accessPayload: TokenPayload = {
    jti: crypto.randomUUID(),
    sub: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    shipperId: user.shipperId,
    shipperName: user.shipperName,
    driverId: user.driverId,
    driverName: user.driverName,
    depositId: user.depositId,
    sid,
    iat: now,
    exp: now + accessExpiresInSeconds,
  };

  const refreshPayload: TokenPayload = {
    jti: crypto.randomUUID(),
    sub: user.id,
    email: user.email,
    role: user.role,
    sid,
    iat: now,
    exp: now + refreshExpiresInSeconds,
  };

  return {
    accessToken: signJwt(accessPayload, ACCESS_SECRET),
    refreshToken: signJwt(refreshPayload, REFRESH_SECRET),
    expiresIn: accessExpiresInSeconds,
    refreshExpiresAt: new Date((now + refreshExpiresInSeconds) * 1000),
  };
}

/** Condensat SHA-256 d'un jeton : seul ce condensat est stocké en base. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Empreinte courte d'un hash de mot de passe (jamais le hash lui-même). */
export function passwordFingerprint(passwordHash: string): string {
  return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 24);
}

const RESET_TTL_SECONDS = 15 * 60;
const RESET_SECRET_SUFFIX = ':pwd-reset';

/**
 * Jeton de réinitialisation de mot de passe, sans état serveur.
 *
 * Il porte l'empreinte du hash de mot de passe courant : dès que le mot de
 * passe change, l'empreinte ne correspond plus et le lien devient inutilisable.
 * C'est ce qui le rend à usage unique sans table dédiée.
 */
export function signPasswordResetToken(userId: string, passwordHash: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      jti: crypto.randomUUID(),
      sub: userId,
      purpose: 'pwd-reset',
      pwh: passwordFingerprint(passwordHash),
      iat: now,
      exp: now + RESET_TTL_SECONDS,
    },
    ACCESS_SECRET + RESET_SECRET_SUFFIX
  );
}

export function verifyPasswordResetToken(token: string): { sub: string; pwh: string } | null {
  const payload = verifyJwt<TokenPayload>(token, ACCESS_SECRET + RESET_SECRET_SUFFIX);
  if (!payload || payload.purpose !== 'pwd-reset' || !payload.sub || !payload.pwh) return null;
  return { sub: payload.sub, pwh: payload.pwh };
}

/**
 * Vérifie un token d'accès
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  const payload = verifyJwt<TokenPayload>(token, ACCESS_SECRET);
  if (!payload || payload.purpose || !payload.sid || !payload.sub) return null;
  return payload;
}

/**
 * Vérifie un token de rafraîchissement
 */
export function verifyRefreshToken(token: string): TokenPayload | null {
  const payload = verifyJwt<TokenPayload>(token, REFRESH_SECRET);
  if (!payload || payload.purpose || !payload.sid || !payload.sub) return null;
  return payload;
}
