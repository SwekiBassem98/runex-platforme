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

  const status =
    typeof error?.status === 'number' && error.status >= 400 && error.status < 600
      ? error.status
      : 500;

  // Un 4xx est un résultat attendu d'une règle métier (colis déjà livré,
  // ressource absente) : le consigner comme une « erreur non rattrapée »
  // noierait les vraies pannes sous des dizaines de lignes attendues.
  if (status >= 500) {
    console.error('[RUNEX API] Erreur non rattrapée :', error);
  } else {
    console.warn(
      `[RUNEX API] Requête refusée (${status}) : ${error?.message ?? 'raison inconnue'}`
    );
  }

  res.status(status).json({
    success: false,
    message:
      status === 500
        ? 'Erreur interne du serveur.'
        : error?.message || 'Requête invalide.',
    ...(process.env.NODE_ENV !== 'production' && status === 500 && error?.message
      ? { detail: String(error.message) }
      : {}),
  });
}
