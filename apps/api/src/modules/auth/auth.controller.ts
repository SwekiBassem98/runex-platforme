import { authService, demoAccountsEnabled } from './auth.service';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';
import { respondError } from '../../common/errors/respond-error';

function metaOf(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class AuthController {
  async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body ?? {};
    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      res.status(400).json({
        success: false,
        message: 'Veuillez renseigner votre email et votre mot de passe.',
      });
      return;
    }
    try {
      const result = await authService.login(email, password, metaOf(req));
      res.json({
        success: true,
        data: result,
        message: 'Connexion réussie. Bienvenue sur RUNEX.',
      });
    } catch (err: unknown) {
      respondError(res, err, 'Échec de la connexion.');
    }
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body ?? {};
    if (!isNonEmptyString(refreshToken)) {
      res.status(400).json({ success: false, message: 'Jeton de rafraîchissement manquant.' });
      return;
    }
    try {
      const result = await authService.refreshAccessToken(refreshToken);
      res.json({ success: true, data: result, message: 'Jeton renouvelé avec succès.' });
    } catch (err: unknown) {
      respondError(res, err, 'Jeton de rafraîchissement invalide.');
    }
  }

  async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }
    const refreshToken = isNonEmptyString(req.body?.refreshToken) ? req.body.refreshToken : undefined;
    const result = await authService.logout({ id: req.user.id, sid: req.user.sessionId }, refreshToken);
    res.json(result);
  }

  async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Non authentifié' });
      return;
    }
    const profile = await authService.getProfile(req.user.id);
    if (!profile) {
      res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
      return;
    }
    res.json({ success: true, data: profile });
  }

  /**
   * Comptes de démonstration : 404 sauf `ENABLE_DEMO_ACCOUNTS=true` hors production.
   * La route reste déclarée pour que l'écran de connexion sache qu'il n'y en a pas.
   */
  async getDemoUsers(_req: Request, res: Response): Promise<void> {
    if (!demoAccountsEnabled()) {
      res.status(404).json({ success: false, message: 'Ressource introuvable.' });
      return;
    }
    const demoAccounts = await authService.getDemoUsers();
    res.json({ success: true, data: demoAccounts });
  }

  async requestPasswordReset(req: Request, res: Response): Promise<void> {
    const { email } = req.body ?? {};
    if (!isNonEmptyString(email)) {
      res.status(400).json({ success: false, message: 'Email requis' });
      return;
    }
    const result = await authService.requestPasswordReset(email);
    res.json(result);
  }

  async confirmPasswordReset(req: Request, res: Response): Promise<void> {
    const { token, newPassword } = req.body ?? {};
    if (!isNonEmptyString(token) || !isNonEmptyString(newPassword)) {
      res.status(400).json({ success: false, message: 'Jeton et nouveau mot de passe requis' });
      return;
    }
    try {
      const result = await authService.confirmPasswordReset(token, newPassword);
      res.json(result);
    } catch (err: unknown) {
      respondError(res, err, 'Échec de la réinitialisation du mot de passe.');
    }
  }
}

export const authController = new AuthController();
