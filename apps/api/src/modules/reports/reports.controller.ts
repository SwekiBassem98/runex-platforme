/**
 * Contrôleur des rapports.
 *
 * Le contrôleur ne calcule rien : il lit les filtres de la requête, applique le
 * périmètre de l'appelant et rend. Deux règles qu'il porte :
 *
 * - le périmètre vient du middleware d'authentification, jamais d'un paramètre
 *   de requête : un expéditeur ne peut pas demander le rapport d'un autre en
 *   passant un identifiant ;
 * - l'export exige `REPORT_EXPORT` là où la lecture n'exige que `REPORT_READ`.
 *   Lire un chiffre chez soi et l'emporter sont deux actes distincts. La
 *   distinction est portée par le routeur, comme partout ailleurs : un
 *   contrôleur qui vérifie lui-même ses droits en oubliera un jour.
 */

import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { respondError } from '../../common/errors/respond-error';
import { reportsService } from './reports.service';
import { exporter } from './reports.export';
import type { DomaineRapport, FiltresRapport } from './reports.types';

/** Les domaines exposés. Une route qui en invente un autre ne rend rien. */
const DOMAINES: DomaineRapport[] = ['colis', 'expediteurs', 'livreurs', 'finance', 'depots'];

/** Les deux bornes de période, et rien d'autre : le reste est du bruit. */
function filtres(req: Request): FiltresRapport {
  const q = req.query as Record<string, string | undefined>;
  return { from: q.from ?? q.dateFrom ?? null, to: q.to ?? q.dateTo ?? null };
}

class ReportsController {
  /** Un domaine demandé, ou le refus de ce qui n'en a pas. */
  private domaine(req: Request): DomaineRapport | null {
    const demande = String(req.params.domaine ?? '');
    return DOMAINES.find((d) => d === demande) ?? null;
  }

  /**
   * Refuse une période qui ne peut pas exister : du 1er mai au 1er avril.
   *
   * Sans ce contrôle, la requête part, ne ramène rien, et rend un rapport vide
   * sous un en-tête « 1er mai → 1er avril ». L'utilisateur y lit une absence
   * d'activité, alors qu'il n'y a rien à compter. Une période incohérente est
   * une faute de saisie, pas un résultat : elle se dit.
   *
   * La lecture et l'export appliquent la même règle — un export qui silencieusement
   * vide ne vaut pas mieux que le rapport.
   */
  private refuserSiPeriodeIncoherente(filtres: FiltresRapport, res: Response): boolean {
    const debut = filtres.from?.trim();
    const fin = filtres.to?.trim();
    // Comparaison textuelle : les deux bornes sont attendues au format
    // `AAAA-MM-JJ`, où l'ordre lexicographique est l'ordre chronologique.
    if (debut && fin && debut > fin) {
      res.status(400).json({
        success: false,
        message: `Période incohérente : le début (${debut}) est postérieur à la fin (${fin}).`,
      });
      return true;
    }
    return false;
  }

  private refuserSi(connu: DomaineRapport | null, res: Response): boolean {
    if (connu) return false;
    res.status(404).json({ success: false, message: 'Rapport inconnu.' });
    return true;
  }

  /** `GET /reports/:domaine` — le rapport. */
  async lire(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentification requise.' });
      return;
    }
    const domaine = this.domaine(req);
    if (this.refuserSi(domaine, res)) return;
    const bornes = filtres(req);
    if (this.refuserSiPeriodeIncoherente(bornes, res)) return;
    try {
      const rapport = await reportsService.lire(domaine!, bornes, req.dataScope ?? {});
      res.json({ success: true, data: rapport });
    } catch (err: unknown) {
      respondError(res, err, 'Rapport indisponible.');
    }
  }

  /** `GET /reports/:domaine/export` — le même rapport, en CSV. */
  async exporterCsv(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentification requise.' });
      return;
    }
    const domaine = this.domaine(req);
    if (this.refuserSi(domaine, res)) return;
    const bornes = filtres(req);
    if (this.refuserSiPeriodeIncoherente(bornes, res)) return;
    try {
      const { csv, filename, rowCount } = await exporter(
        domaine!,
        bornes,
        req.dataScope ?? {},
        { id: req.user.id }
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Export-Rows', String(rowCount));
      res.send(csv);
    } catch (err: unknown) {
      respondError(res, err, 'Export impossible.');
    }
  }

  /** `GET /reports/domaines` — ce que l'écran peut proposer. */
  async domaines(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const libelles: Record<DomaineRapport, string> = {
      colis: 'Colis',
      expediteurs: 'Expéditeurs',
      livreurs: 'Livreurs',
      finance: 'Finance',
      depots: 'Dépôts',
    };
    res.json({
      success: true,
      data: DOMAINES.map((id) => ({ id, libelle: libelles[id] })),
    });
  }
}

export const reportsController = new ReportsController();