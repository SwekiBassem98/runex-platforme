import type { NextFunction, Request, Response } from 'express';

/**
 * Refuse toute requête contenant un caractère NUL (U+0000).
 *
 * PostgreSQL rejette ce caractère dans un texte : sans ce garde, une simple
 * URL `/colis/%00` provoque une erreur de base de données au lieu d'un 400.
 */
function containsNul(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsNul(v, depth + 1));
  }
  return false;
}

export function rejectNullBytes(req: Request, res: Response, next: NextFunction): void {
  let path = req.path;
  try {
    path = decodeURIComponent(req.path);
  } catch {
    res.status(400).json({ success: false, message: 'URL invalide.' });
    return;
  }
  if (path.includes('\u0000') || containsNul(req.query) || containsNul(req.body)) {
    res.status(400).json({ success: false, message: 'Caractère invalide dans la requête.' });
    return;
  }
  next();
}
