'use client';

/**
 * Changement de mot de passe de l'utilisateur connecté
 * (`POST /auth/change-password`). Les autres sessions du compte sont fermées
 * par l'API ; celle-ci reste ouverte.
 */

import React from 'react';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useFeedbackOn } from '@/lib/useFeedbackOn';
import { useI18n } from '@/i18n';
import { ChampMotDePasse, LONGUEUR_MIN, messageErreurMotDePasse } from './commun';

export function FormulaireChangementMotDePasse({ onSucces }: { onSucces?: () => void }) {
  const { t, traduireServeur } = useI18n();
  const [actuel, setActuel] = React.useState('');
  const [nouveau, setNouveau] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [succes, setSucces] = React.useState<string | null>(null);
  useFeedbackOn(erreur, 'error');
  useFeedbackOn(succes, 'success');

  async function enregistrer(event: React.FormEvent) {
    event.preventDefault();
    setErreur(null);
    setSucces(null);
    if (!actuel) return setErreur(t('mdp.actuelIncorrect'));
    if (nouveau.length < LONGUEUR_MIN) return setErreur(t('mdp.tropCourt'));
    if (nouveau !== confirmation) return setErreur(t('mdp.differents'));
    if (nouveau === actuel) return setErreur(t('mdp.identique'));
    setEnCours(true);
    try {
      const rep = await authApi.changePassword(actuel, nouveau);
      const fermees = rep.data?.otherSessionsClosed ?? 0;
      setSucces(fermees > 0 ? t('mdp.changeSessions', { n: fermees }) : t('mdp.change'));
      setActuel('');
      setNouveau('');
      setConfirmation('');
      onSucces?.();
    } catch (err) {
      setErreur(messageErreurMotDePasse(err, t, traduireServeur));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form onSubmit={enregistrer} className="space-y-3" noValidate data-testid="form-changement-mdp">
      <ChampMotDePasse
        libelle={t('mdp.actuel')}
        valeur={actuel}
        onChange={setActuel}
        autoComplete="current-password"
        testId="mdp-actuel"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <ChampMotDePasse
          libelle={t('mdp.nouveau')}
          valeur={nouveau}
          onChange={setNouveau}
          autoComplete="new-password"
          jauge
          testId="mdp-nouveau"
        />
        <ChampMotDePasse
          libelle={t('mdp.confirmation')}
          valeur={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          testId="mdp-confirmation"
        />
      </div>
      {erreur && (
        <p role="alert" className="text-xs text-red-600">
          {erreur}
        </p>
      )}
      {succes && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-emerald-700" data-testid="mdp-change">
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          {succes}
        </p>
      )}
      <button
        type="submit"
        disabled={enCours}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-md text-xs font-semibold transition cursor-pointer"
      >
        {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
        {enCours ? t('mdp.enregistrement') : t('mdp.enregistrer')}
      </button>
    </form>
  );
}
