'use client';

/**
 * Point d'entrée du portail expéditeur.
 *
 * Le portail est un espace d'authentification distinct de celui de
 * l'exploitation : un expéditeur n'a pas à passer par `/connexion`, qui
 * appartient à l'équipe interne. La session est réelle — `POST /auth/login`
 * décide, et le rôle retourné décide de l'accès : un compte interne saisi ici
 * est refusé, et un compte expéditeur saisi dans `/connexion` est renvoyé
 * vers cet écran.
 *
 * L'identité RUNEX est conservée, mais la présentation s'éloigne volontairement
 * de l'écran d'exploitation : fond clair, accents ardoise, aucune référence aux
 * outils internes. Un expéditeur ne doit pas se croire dans le poste de
 * commandement.
 *
 * ## Langue
 *
 * C'est la première page que voit un expéditeur, avant d'être connu de la
 * plateforme : la langue doit donc y être déjà choisie, sans session et sans
 * route qui l'ait préparée. Le `I18nProvider` est donc monté ici aussi, et non
 * seulement dans le groupe du portail — c'est la seule façon qu'un expéditeur
 * puisse passer son écran de connexion en arabe depuis celui-ci.
 *
 * Le sélecteur de langue est placé en haut de l'écran, à portée immédiate : sur
 * cette page il n'y a rien d'autre à faire, et un utilisateur qui ne lit pas le
 * français doit pouvoir se rendre la page lisible sans aidant.
 */

import { useFeedbackOn } from '@/lib/useFeedbackOn';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Package,
  ServerCrash,
} from 'lucide-react';
import { RoleType } from '@logixpress/types';
import { ApiError, API_BASE_URL, authApi, type DemoUser } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { I18nProvider, SelecteurLangue, useI18n } from '@/i18n';

/** Corps de l'écran, à l'intérieur du fournisseur de langue. */
function Ecran() {
  const { t } = useI18n();
  const router = useRouter();
  const { login, isLoading: isCheckingSession, user } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFeedbackOn(error, 'error');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  // Une session expéditeur déjà ouverte n'a rien à faire ici.
  useEffect(() => {
    if (user?.role === RoleType.EXPEDITEUR) router.replace('/expediteur');
  }, [user, router]);

  useEffect(() => {
    let cancelled = false;
    authApi
      .demoUsers()
      .then((list) => {
        if (!cancelled) {
          setApiReachable(true);
          // Seuls les comptes expéditeur ont leur place ici : proposer ceux de
          // l'exploitation sur cet écran nuirait à la séparation.
          setDemoUsers(list.filter((account) => account.role === RoleType.EXPEDITEUR));
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
      // `exigeRole` fait invalider et purger la session si les identifiants sont
      // valides mais appartiennent à l'exploitation.
      const loggedUser = await login(email.trim(), password, RoleType.EXPEDITEUR);

      if (loggedUser.role === RoleType.EXPEDITEUR) {
        router.replace('/expediteur');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        // 400 = champs invalides, 401 = identifiants refusés, 0 = API injoignable.
        setError(err.message);
        if (err.isNetworkError) setApiReachable(false);
      } else {
        setError(t('connexion.erreurInattendue'));
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" aria-label={t('connexion.verification')} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 py-10 text-slate-900">
      {/* Langue : hors de la carte, alignée à la fin. Elle doit être
          atteignable avant la connexion, sans compte et sans session. */}
      <div className="w-full max-w-md flex justify-end mb-3">
        <SelecteurLangue />
      </div>
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-8 pt-8 pb-6 text-center space-y-3 border-b border-slate-100">
          <img
            src="/brand/runex-logo.jpeg"
            alt="RUNEX"
            width={168}
            height={112}
            className="w-36 h-auto mx-auto rounded-lg"
          />
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
              {t('connexion.titre')}
            </p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {t('connexion.sous-titre')}
            </h1>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">{t('connexion.description')}</p>
        </div>

        <div className="px-8 py-6 space-y-5">
          {apiReachable === false && (
            <div
              role="status"
              className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs"
            >
              <ServerCrash className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{t('connexion.apiInjoignableUrl', { url: API_BASE_URL })}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t('connexion.email')}
              </span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@votre-societe.tn"
                className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t('connexion.motDePasse')}
              </span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 pe-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword ? t('connexion.masquerMotDePasse') : t('connexion.afficherMotDePasse')
                  }
                  className="absolute end-3 top-3 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>

            <div className="flex justify-end -mt-1">
              <Link
                href={`/mot-de-passe-oublie?espace=expediteur${email.trim() ? `&email=${encodeURIComponent(email.trim())}` : ''}`}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 underline-offset-2 hover:underline"
                data-testid="lien-mdp-oublie"
              >
                {t('mdp.oublie')}
              </Link>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-md font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('connexion.envoi')}
                </>
              ) : (
                <>
                  <Package className="w-4 h-4" />
                  {t('connexion.soumettre')}
                </>
              )}
            </button>
          </form>

          {demoUsers.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block text-center">
                {t('connexion.compteDemo')}
              </span>
              {demoUsers.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => useDemoAccount(account)}
                  title={t('connexion.remplirAvec', { email: account.email })}
                  className="w-full p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-start transition flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="font-semibold text-slate-800 truncate">{account.name}</span>
                  <span className="text-[11px] text-slate-500 font-mono shrink-0">
                    {account.passwordHint}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-8 py-4 bg-slate-50 border-t border-slate-100 text-center">
          <Link
            href="/connexion"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition"
          >
            {t('connexion.exploitation')}
            {/* En arabe, la flèche doit pointer dans le sens de la lecture du
                texte qui la suit : elle se retourne avec la page. */}
            <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ExpediteurLoginPage() {
  return (
    <I18nProvider>
      <Ecran />
    </I18nProvider>
  );
}