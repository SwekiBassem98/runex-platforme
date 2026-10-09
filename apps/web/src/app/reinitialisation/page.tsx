'use client';

/**
 * Réinitialisation du mot de passe — page ouverte depuis le courriel.
 *
 * `?token=` est le jeton signé par l'API (valable 15 minutes, à usage unique :
 * il porte l'empreinte du mot de passe courant). `?espace=` indique le type de
 * compte, pour proposer la bonne connexion ensuite — un livreur, lui, se
 * reconnecte dans l'application mobile.
 *
 * Le jeton est retiré de la barre d'adresse dès la lecture : il ne reste ni
 * dans l'historique ni dans une capture d'écran partagée.
 */

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Smartphone } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useFeedbackOn } from '@/lib/useFeedbackOn';
import { I18nProvider, useI18n } from '@/i18n';
import {
  CadrePublic,
  ChampMotDePasse,
  LONGUEUR_MIN,
  connexionPour,
  messageErreurMotDePasse,
} from '@/features/motdepasse/commun';

function Ecran() {
  const { t, traduireServeur } = useI18n();
  const params = useSearchParams();
  const [token] = React.useState(() => params.get('token') ?? '');
  const espace = params.get('espace');
  const connexion = connexionPour(espace);
  const oubli = `/mot-de-passe-oublie${espace === 'equipe' ? '?espace=equipe' : ''}`;

  const [nouveau, setNouveau] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const [termine, setTermine] = React.useState(false);
  const [lienMort, setLienMort] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  useFeedbackOn(erreur, 'error');
  useFeedbackOn(termine, 'success');

  // Le jeton quitte la barre d'adresse (l'espace reste, il n'a rien de secret).
  React.useEffect(() => {
    if (!params.get('token')) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [params]);

  async function enregistrer(event: React.FormEvent) {
    event.preventDefault();
    setErreur(null);
    if (nouveau.length < LONGUEUR_MIN) return setErreur(t('mdp.tropCourt'));
    if (nouveau !== confirmation) return setErreur(t('mdp.differents'));
    setEnCours(true);
    try {
      await authApi.confirmPasswordReset(token, nouveau);
      setTermine(true);
    } catch (err) {
      const message = messageErreurMotDePasse(err, t, traduireServeur);
      if (message === t('mdp.lienInvalide')) setLienMort(true);
      setErreur(message);
    } finally {
      setEnCours(false);
    }
  }

  if (!token || lienMort) {
    return (
      <CadrePublic titre={t('mdp.nouveauTitre')}>
        <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs" data-testid="lien-invalide">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{token ? t('mdp.lienInvalide') : t('mdp.lienAbsent')}</span>
        </div>
        <Link
          href={oubli}
          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs transition flex items-center justify-center gap-2"
        >
          <KeyRound className="w-4 h-4" />
          {t('mdp.demanderNouveau')}
        </Link>
      </CadrePublic>
    );
  }

  if (termine) {
    return (
      <CadrePublic titre={t('mdp.nouveauTitre')}>
        <div role="status" className="space-y-4 text-center" data-testid="mdp-reinitialise">
          <span className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            {connexion ? <CheckCircle2 className="w-6 h-6" /> : <Smartphone className="w-6 h-6" />}
          </span>
          <p className="text-sm text-slate-700 leading-relaxed">
            {connexion ? t('mdp.reinitialise') : t('mdp.reinitialiseLivreur')}
          </p>
          {connexion && (
            <Link
              href={connexion}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs transition flex items-center justify-center gap-2"
            >
              {t('mdp.seConnecter')}
            </Link>
          )}
        </div>
      </CadrePublic>
    );
  }

  return (
    <CadrePublic titre={t('mdp.nouveauTitre')} aide={t('mdp.nouveauAide')}>
      <form onSubmit={enregistrer} className="space-y-4" noValidate>
        {erreur && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{erreur}</span>
          </div>
        )}
        <ChampMotDePasse
          libelle={t('mdp.nouveau')}
          valeur={nouveau}
          onChange={setNouveau}
          autoComplete="new-password"
          jauge
          autoFocus
          testId="mdp-nouveau"
        />
        <ChampMotDePasse
          libelle={t('mdp.confirmation')}
          valeur={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          testId="mdp-confirmation"
        />
        <button
          type="submit"
          disabled={enCours}
          className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-md font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer"
        >
          {enCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          {enCours ? t('mdp.enregistrement') : t('mdp.enregistrer')}
        </button>
      </form>
    </CadrePublic>
  );
}

export default function ReinitialisationPage() {
  return (
    <I18nProvider>
      <Suspense fallback={null}>
        <Ecran />
      </Suspense>
    </I18nProvider>
  );
}
