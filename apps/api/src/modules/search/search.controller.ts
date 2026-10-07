/**
 * Recherche opérationnelle transversale — point d'entrée HTTP.
 *
 * Un terme de moins de deux caractères ne déclenche aucune requête : taper la
 * première lettre d'un nom ne doit pas lancer cinq requêtes sur l'ensemble de
 * la plateforme.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { searchService } from './search.service';
import { respondError } from '../../common/errors/respond-error';

export class SearchController {
  async global(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié.' });
      return;
    }

    try {
      const q = (req.query.q ?? req.query.search) as string | undefined;
      const term = (q ?? '').trim();

      if (term.length < 2) {
        res.json({
          success: true,
          data: { colis: [], shippers: [], drivers: [], runsheets: [], deposits: [] },
          // `total` reste présent même à zéro : le client lit toujours le même
          // contrat, sans teste à chaque fois si la réponse est « cas court ».
          meta: { term, total: 0, tooShort: true },
        });
        return;
      }

      const results = await searchService.search(term, req.dataScope ?? {});
      res.json({
        success: true,
        data: results,
        meta: {
          term,
          total:
            results.colis.length +
            results.shippers.length +
            results.drivers.length +
            results.runsheets.length +
            results.deposits.length,
        },
      });
    } catch (err: unknown) {
      respondError(res, err, 'Recherche impossible.');
    }
  }
}

export const searchController = new SearchController();
