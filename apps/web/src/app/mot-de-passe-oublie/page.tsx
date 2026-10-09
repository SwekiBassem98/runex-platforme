'use client';

/**
 * Mot de passe oublié — page publique.
 *
 * L'adresse saisie part à `POST /auth/password-reset/request`. La réponse est
 * la même que le compte existe ou non (pas d'énumération des comptes) : l'écran
 * affiche donc toujours le même message, avec l'adresse saisie.
 *
 * `?espace=expediteur|equipe` choisit le lien de retour ; `?email=` pré-remplit.
 */

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2, MailCheck, Send } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useFeedbackOn } from '@/lib/useFeedbackOn';
import { I18nProvider, useI18n } from '@/i18n';
import { CadrePublic, connexionPour, messageErreurMotDePasse } from '@/features/motdepasse/commun';

function Ecran() {
  const { t, traduireServeur } = useI18n();
  const params = useSearchParams();
  const espace = params.get('espace');
  const retour = connexionPour(espace) ?? '/expediteur/login';

  const [email, setEmail] = React.useState(params.get('email') ?? '');
  const [enCours, setEnCours] = React.useState(false);
  const [envoyeA, setEnvoyeA] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  useFeedbackOn(erreur, 'error');
  useFeedbackOn(envoyeA, 'success');

  async function envoyer(event: React.FormEvent) {
    event.preventDefault();
    const adresse = email.trim();
    if (!adresse) return;
    setErreur(null);
    setEnCours(true);
    try {
      await authApi.requestPasswordReset(adresse);
      setEnvoyeA(adresse);
    } catch (err) {
      setErreur(messageErreurMotDePasse(err, t, traduireServeur));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <CadrePublic titre={t('mdp.oublieTitre')} aide={t('mdp.oublieAide')}>
      {envoyeA ? (
        <div role="status" className="space-y-4 text-center" data-testid="lien-envoye">
          <span className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <MailCheck className="w-6 h-6" aria-hidden="true" />
          </span>
          <p className="text-sm text-slate-700 leading-relaxed">
            {t('mdp.lienEnvoye', { email: envoyeA })}
          </p>
          <button
            type="button"
            onClick={() => setEnvoyeA(null)}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
          >
            {t('mdp.renvoyer')}
          </button>
        </div>
      ) : (
        <form onSubmit={envoyer} className="space-y-4">
          {erreur && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{erreur}</span>
            </div>
          )}
          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
              {t('connexion.email')}
            </span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="username"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@votre-societe.tn"
              data-testid="email-oubli"
              className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
            />
          </label>
          <button
            type="submit"
            disabled={enCours}
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-md font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
          >
            {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 rtl:-scale-x-100" />}
            {enCours ? t('mdp.envoi') : t('mdp.envoyerLien')}
          </button>
        </form>
      )}
      <div className="pt-2 text-center">
        <Link href={retour} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition">
          <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
          {t('mdp.retourConnexion')}
        </Link>
      </div>
    </CadrePublic>
  );
}

export default function MotDePasseOubliePage() {
  return (
    <I18nProvider>
      <Suspense fallback={null}>
        <Ecran />
      </Suspense>
    </I18nProvider>
  );
}
