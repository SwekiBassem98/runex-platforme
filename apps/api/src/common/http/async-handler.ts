import { toSafeHttpError } from '../errors/respond-error';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 ne capture pas les promesses rejetées par un handler asynchrone :
 * une exception produit une `unhandledRejection` (crash du process sur Node >= 15)
 * et laisse la requête pendante sans réponse.
 *
 * Ce wrapper forward l'erreur à la middleware d'erreur Express.
 */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Middleware terminal : transforme toute exception nonrattrapée en réponse JSON.
 * Évite de renvoyer une stack trace au client.
 */
export function errorHandler(
  error: any,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const safe = toSafeHttpError(error);
  if (safe.status >= 500) {
    console.error('[RUNEX API] Erreur non rattrapée :', error);
  } else {
    console.warn(`[RUNEX API] Requête refusée (${safe.status}) : ${safe.message}`);
  }

  res.status(safe.status).json({ success: false, message: safe.message });
}
