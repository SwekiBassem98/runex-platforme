'use client';

/**
 * Contexte d'authentification du frontend.
 *
 * La session est délibérément gérée côté navigateur : les jetons sont conservés
 * dans `localStorage` et transmis en `Authorization: Bearer` par le client API.
 * Aucun succès n'est simulé — l'état `user` n'est renseigné qu'après un
 * `POST /auth/login` réellement accepté par l'API.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { RoleType, type AuthUser } from '@logixpress/types';
import { ApiError, authApi, setUnauthorizedHandler, tokenStorage } from './api';

/**
 * Écrans de connexion, par profil. Le portail expéditeur est un espace
 * distinct : il possède son propre point d'entrée et n'aboutit pas sur la même
 * destination que l'exploitation.
 */
export const CHEMIN_CONNEXION: Record<RoleType, string> = {
  [RoleType.EXPEDITEUR]: '/expediteur/login',
  [RoleType.ADMIN]: '/connexion',
  [RoleType.GESTIONNAIRE]: '/connexion',
  [RoleType.FINANCE]: '/connexion',
  [RoleType.AGENT_DEPOT]: '/connexion',
  [RoleType.LIVREUR]: '/connexion',
};

interface AuthContextValue {
  user: AuthUser | null;
  /** Vrai tant que la session existante n'a pas été vérifiée. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Jeton d'accès en cours, utile pour les modules qui construisent leurs en-têtes. */
  accessToken: string | null;
  /**
   * Authentifie auprès de `POST /auth/login`.
   *
   * `exigeRole` restreint l'écran à un profil : le jeton est alors validé puis
   * purgé si le compte obtenu relève d'un autre espace. Le serveur, lui,
   * n'a pas à connaître cette distinction — c'est une contrainte de surface.
   */
  login: (email: string, password: string, exigeRole?: RoleType) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /*
   * Rôle de la session en cours, hors du cycle de rendu.
   *
   * `logout` doit savoir vers quel écran revenir, et il est souvent appelé
   * juste après une connexion : à cet instant l'état `user` n'est pas encore
   * réinjecté, et une fermeture de fonction capturing `user` renverrait
   * systématiquement vers `/connexion`. La référence est donc mise à jour au
   * moment même où la session est posée.
   */
  const roleCourant = React.useRef<RoleType | null>(null);

  React.useEffect(() => {
    roleCourant.current = user?.role ?? null;
  }, [user]);

  // Restauration de session au chargement : on interroge l'API pour confirmer
  // que le jeton stocké est encore valide plutôt que de faire confiance au
  // contenu de `localStorage`.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!tokenStorage.getAccessToken()) {
        if (!cancelled) setIsLoading(false);
        return;
      }
      try {
        const current = await authApi.me();
        if (!cancelled) setUser(current);
      } catch {
        tokenStorage.clear();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Quand le client API épuise la rotation du jeton, on purge la session et on
  // ramène l'utilisateur vers l'écran de connexion de son espace : un
  // expéditeur qui se voit expulé revient au portail, pas à l'exploitation.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const destination = path.startsWith('/expediteur')
        ? '/expediteur/login'
        : path.startsWith('/connexion')
          ? path
          : '/connexion';
      setUser(null);
      setIsLoading(false);
      if (typeof window !== 'undefined' && path !== destination) {
        router.replace(destination);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  const login = useCallback(async (email: string, password: string, exigeRole?: RoleType) => {
    // Nettoyage préalable : évite de conserver une session échouée si
    // l'utilisateur recommence avec d'autres identifiants.
    tokenStorage.clear();
    setUser(null);

    const session = await authApi.login(email, password);

    if (exigeRole && session.user.role !== exigeRole) {
      // Les identifiants sont bons mais le compte relève d'un autre espace.
      // La session est détruite avant de refuser : un jeton d'exploitation ne
      // doit jamais rester dans le navigateur après un refus.
      try {
        await authApi.logout();
      } catch {
        // Purge locale ci-dessous, quoi qu'il arrive du réseau.
      }
      tokenStorage.clear();
      throw new ApiError(
        exigeRole === RoleType.EXPEDITEUR
          ? "Ce compte est un compte d'exploitation. Connectez-vous depuis l'accès de l'équipe RUNEX."
          : "Ce compte expéditeur doit utiliser l'Espace Expéditeur.",
        403
      );
    }

    tokenStorage.set(session.accessToken, session.refreshToken);
    // Avant `setUser` : c'est cette valeur que lira une déconnexion immédiate.
    roleCourant.current = session.user.role;
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    // Le profil est lu avant la purge : c'est lui qui désigne l'écran vers
    // lequel revenir.
    const retour = roleCourant.current ? CHEMIN_CONNEXION[roleCourant.current] : '/connexion';
    roleCourant.current = null;
    try {
      await authApi.logout();
    } catch {
      // La déconnexion locale doit aboutir même si l'API est injoignable.
    } finally {
      tokenStorage.clear();
      setUser(null);
      router.replace(retour);
    }
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const current = await authApi.me();
      setUser(current);
      return current;
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        tokenStorage.clear();
        setUser(null);
        return null;
      }
      throw error;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      accessToken: tokenStorage.getAccessToken(),
      login,
      logout,
      refresh,
    }),
    [user, isLoading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>.");
  }
  return context;
}

/**
 * Rôles disposant du droit de consulter le poste de commandement complet.
 */
export function canAccessDashboard(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.role !== RoleType.EXPEDITEUR && user.role !== RoleType.LIVREUR;
}
