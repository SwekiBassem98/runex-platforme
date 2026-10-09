'use client';

/**
 * Briques communes aux écrans de mot de passe : champ masquable avec jauge de
 * robustesse, traduction des erreurs de l'API, cadre des pages publiques
 * (mot de passe oublié, réinitialisation).
 */

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { SelecteurLangue, useI18n, type Cle } from '@/i18n';

export const LONGUEUR_MIN = 8;

/** 0 à 3 : vide, faible, moyen, solide. */
export function robustesse(motDePasse: string): 0 | 1 | 2 | 3 {
  if (!motDePasse) return 0;
  let score = 0;
  if (motDePasse.length >= LONGUEUR_MIN) score += 1;
  if (motDePasse.length >= 12) score += 1;
  if (/[a-z]/.test(motDePasse) && /[A-Z]/.test(motDePasse)) score += 1;
  if (/\d/.test(motDePasse)) score += 1;
  if (/[^A-Za-z0-9]/.test(motDePasse)) score += 1;
  if (motDePasse.length < LONGUEUR_MIN || score <= 2) return 1;
  return score === 3 ? 2 : 3;
}

/** Message affichable pour une erreur de l'API, dans la langue de l'écran. */
export function messageErreurMotDePasse(
  err: unknown,
  t: (cle: Cle, valeurs?: Record<string, string | number>) => string,
  traduireServeur: (texte: string) => string
): string {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return t('erreur.reseau');
    if (err.status === 429) return t('mdp.tropDeTentatives');
    const m = err.message;
    if (/jeton de réinitialisation/i.test(m)) return t('mdp.lienInvalide');
    if (/mot de passe actuel est incorrect/i.test(m)) return t('mdp.actuelIncorrect');
    if (/différent de l'actuel/i.test(m)) return t('mdp.identique');
    if (/au moins 8 caractères/i.test(m)) return t('mdp.tropCourt');
    return traduireServeur(m) || t('mdp.erreur');
  }
  return t('mdp.erreur');
}

export function ChampMotDePasse({
  libelle,
  valeur,
  onChange,
  autoComplete,
  jauge = false,
  testId,
  autoFocus = false,
}: {
  libelle: string;
  valeur: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  jauge?: boolean;
  testId?: string;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = React.useState(false);
  const niveau = robustesse(valeur);
  const couleurs = ['bg-slate-200', 'bg-red-500', 'bg-amber-500', 'bg-emerald-500'];
  const libellesNiveau: Cle[] = ['mdp.force.faible', 'mdp.force.faible', 'mdp.force.moyen', 'mdp.force.fort'];
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">{libelle}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          required
          minLength={autoComplete === 'new-password' ? LONGUEUR_MIN : undefined}
          maxLength={128}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
          dir="ltr"
          className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 pe-10"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('connexion.masquerMotDePasse') : t('connexion.afficherMotDePasse')}
          className="absolute end-3 top-3 text-slate-400 hover:text-slate-700 cursor-pointer"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {jauge && valeur.length > 0 && (
        <div className="flex items-center gap-2" aria-live="polite">
          <div className="flex-1 grid grid-cols-3 gap-1">
            {[1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-colors duration-300 ${i <= niveau ? couleurs[niveau] : 'bg-slate-200'}`}
              />
            ))}
          </div>
          <span className="text-[11px] text-slate-500 shrink-0">
            {t('mdp.force', { niveau: t(libellesNiveau[niveau]!) })}
          </span>
        </div>
      )}
    </label>
  );
}

/** Cadre des pages publiques : logo, sélecteur de langue, carte centrée. */
export function CadrePublic({ titre, aide, children }: { titre: string; aide?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-4 py-10 text-slate-900">
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
            className="w-32 h-auto mx-auto rounded-lg"
          />
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{titre}</h1>
          {aide && <p className="text-xs text-slate-500 leading-relaxed">{aide}</p>}
        </div>
        <div className="px-8 py-6 space-y-5">{children}</div>
      </div>
    </div>
  );
}

/** Destination de connexion selon l'espace du compte (paramètre `espace`). */
export function connexionPour(espace: string | null): string | null {
  if (espace === 'equipe') return '/connexion';
  if (espace === 'livreur') return null;
  return '/expediteur/login';
}
