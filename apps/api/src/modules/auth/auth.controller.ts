import { authService } from './auth.service';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../../common/auth/auth.middleware';

export class AuthController {
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({
          success: false,
          message: 'Veuillez renseigner votre email et votre mot de passe.',
        });
        return;
      }

      const result = await authService.login(email, password);
      res.json({
        success: true,
        data: result,
        message: 'Connexion réussie. Bienvenue sur RUNEX.',
      });
    } catch (err: any) {
      res.status(401).json({
        success: false,
        message: err.message || 'Échec de la connexion.',
      });
    }
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({
        success: false,
        message: 'Jeton de rafraîchissement manquant.',
      });
      return;
    }

    try {
      const result = await authService.refreshAccessToken(refreshToken);
      res.json({
        success: true,
        data: result,
        message: 'Jeton renouvelé avec succès.',
      });
    } catch (err: any) {
      res.status(401).json({
        success: false,
        message: err.message || 'Jeton de rafraîchissement invalide.',
      });
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    const { refreshToken } = req.body;
    const result = await authService.logout(refreshToken);
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
    res.json({
      success: true,
      data: profile,
    });
  }

  async getDemoUsers(req: Request, res: Response): Promise<void> {
    const demoAccounts = await authService.getDemoUsers();
    res.json({
      success: true,
      data: demoAccounts,
    });
  }

  async requestPasswordReset(req: Request, res: Response): Promise<void> {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ success: false, message: 'Email requis' });
      return;
    }
    const result = await authService.requestPasswordReset(email);
    res.json(result);
  }

  async confirmPasswordReset(req: Request, res: Response): Promise<void> {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        res.status(400).json({ success: false, message: 'Jeton et nouveau mot de passe requis' });
        return;
      }
      const result = await authService.confirmPasswordReset(token, newPassword);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({
        success: false,
        message: err.message || 'Échec de la réinitialisation du mot de passe.',
      });
    }
  }
}

export const authController = new AuthController();
