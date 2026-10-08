'use client';

/**
 * Écran de connexion de l'exploitation.
 *
 * L'authentification est réelle : les identifiants sont validés par
 * `POST /auth/login`. Aucun état de connexion n'est simulé — tant que l'API
 * n'a pas répondu 2xx, l'utilisateur reste sur cette page et le message
 * d'erreur affiché est celui renvoyé par le serveur.
 *
 * Cet écran est celui de l'équipe interne. Un compte expéditeur qui s'y présente
 * est renvoyé vers son propre point d'entrée : son portail est un espace
 * distinct, atteint par `/expediteur/login`.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, ServerCrash, ShieldCheck } from 'lucide-react';
import { RoleType } from '@logixpress/types';
import { ApiError, API_BASE_URL, authApi, type DemoUser } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { login, logout, isLoading: isCheckingSession, user } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  // Session déjà ouverte : on saute l'écran de connexion.
  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  // Comptes de démonstration fournis par l'API (endpoint public).
  useEffect(() => {
    let cancelled = false;
    authApi
      .demoUsers()
      .then((list) => {
        if (!cancelled) {
          setDemoUsers(list);
          setApiReachable(true);
        }
      })
      .catch((err: unknown) => {
        // 404 = comptes de démonstration désactivés (production) : l'API répond,
        // simplement sans liste. Seule une erreur réseau signale une API absente.
        if (!cancelled) setApiReachable(err instanceof ApiError && err.status !== 0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const loggedUser = await login(email.trim(), password);

      if (loggedUser.role === RoleType.LIVREUR) {
        // Le livreur travaille depuis l'application mobile : l'espace web
        // d'exploitation ne lui est pas ouvert.
        await logout();
        setError("L'espace livreur est disponible dans l'application mobile RUNEX.");
        return;
      }

      if (loggedUser.role === RoleType.EXPEDITEUR) {
        // Les identifiants sont justes, mais ce n'est pas la bonne porte. La
        // session est détruite puis l'utilisateur est conduit à l'entrée de son
        // propre espace, plutôt que de le laisser dans l'application interne.
        await logout();
        return;
      }

      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        // 400 = champs invalides, 401 = identifiants refusés, 0 = API injoignable.
        setError(err.message);
        if (err.isNetworkError) setApiReachable(false);
      } else {
        setError('Une erreur inattendue est survenue.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function useDemoAccount(account: DemoUser) {
    setEmail(account.email);
    setPassword(account.passwordHint);
    setError(null);
  }

  if (isCheckingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 text-slate-100">
      <div className="w-full max-w-md bg-[#161B22] border border-slate-800 rounded-xl p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          {/* Logo officiel RUNEX, aux proportions d'origine. L'écran est sombre
              et le logo a un fond noir : il s'y pose sans plaque ni décor. */}
          <img
            src="/brand/runex-logo.jpeg"
            alt="RUNEX"
            width={168}
            height={112}
            className="w-40 sm:w-48 h-auto mx-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight text-white">RUNEX</h1>
          <p className="text-xs text-slate-500">
            Système de gestion logistique & poste de commandement opérationnel
          </p>
        </div>

        {apiReachable === false && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
            <ServerCrash className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              API injoignable ({API_BASE_URL}). Démarrez le backend avec{' '}
              <code className="font-mono">npm run dev:api</code> puis réessayez.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-red-200 text-xs"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              Email Professionnel
            </span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nom@logixpress.tn"
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              Mot de Passe
            </span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute right-3 top-3 text-slate-500 hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-md font-semibold text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Authentification…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Se Connecter
              </>
            )}
          </button>
        </form>

        {demoUsers.length > 0 && (
          <div className="pt-4 border-t border-slate-800 space-y-2">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block text-center">
              Comptes Démonstration (issus de l'API)
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {demoUsers.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => useDemoAccount(account)}
                  title={`Remplir avec ${account.email}`}
                  className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-red-600/50 rounded-md text-left transition flex flex-col justify-between cursor-pointer"
                >
                  <span className="font-bold text-white truncate block">{account.name}</span>
                  <span className="text-[11px] text-red-400 font-mono block mt-0.5">
                    {account.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-slate-800 text-center">
          <Link
            href="/expediteur/login"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-100 transition"
          >
            Vous êtes expéditeur&nbsp;? Accéder à votre espace
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
