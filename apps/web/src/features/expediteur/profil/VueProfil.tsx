'use client';

/**
 * Profil du compte expéditeur.
 *
 * L'écran est en lecture seule, et ce n'est pas un oubli : l'API n'expose pas
 * d'écriture sur le profil de l'utilisateur. `POST /auth/password-reset/request`
 * accepte un courriel et envoie un lien — un expéditeur peut donc réinitialiser
 * son mot de passe sans que le portail n'ait à le faire à sa place, et sans que
 * le formulaire du portail ne transforme une identité en champ éditable.
 *
 * `GET /auth/me` est rappelé à l'ouverture : la session en cours peut venir du
 * jeton de stockage, plus ancien que la fiche en base. L'écran montre ce que dit
 * le serveur maintenant, pas ce qu'était le jeton à sa délivrance.
 *
 * Les permissions affichées viennent de la même réponse. Elles décrivent ce que
 * la plateforme accorde à ce rôle, pas ce que l'écran sait faire — la nuance est
 * utile le jour où une capacité de l'API n'a pas d'interface.
 *
 * ## Langue
 *
 * Les intitulés de sections, les libellés de lignes et les messages de la
 * réinitialisation sont lus dans le dictionnaire. Ce qui reste en clair est une
 * donnée, pas un mot : nom de l'entreprise, nom complet, permissions renvoyées
 * par l'API — et l'adresse électronique et le téléphone, enfermés dans un
 * `dir="ltr"` pour rester lisibles de gauche à droite une fois la page en arabe.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, LogOut, Mail, Phone, ShieldCheck, User } from 'lucide-react';
import { RoleType, type AuthUser } from '@logixpress/types';
import { Card, ErrorBanner } from '@logixpress/ui';
import { requestData } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/i18n';

export function VueProfil() {
  const router = useRouter();
  const { user: session, logout, refresh } = useAuth();
  const { t, formatDateTime } = useI18n();

  const [profil, setProfil] = React.useState<AuthUser | null>(null);
  /** Instant de la lecture, pour dater l'affichage plutôt que l'instant présent. */
  const [verifieLe, setVerifieLe] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [copie, setCopie] = React.useState(false);
  const [reinitialisation, setReinitialisation] = React.useState<
    { enCours: boolean; message: string | null }
  >({ enCours: false, message: null });

  React.useEffect(() => {
    let annule = false;
    requestData<AuthUser>('/auth/me')
      .then((rep) => {
        if (annule) return;
        setProfil(rep);
        setVerifieLe(new Date().toISOString());
      })
      .catch((err: unknown) => {
        // La session en cours suffit à afficher l'écran : l'échec de
        // rafraîchissement ne doit pas rendre la page vide.
        if (!annule) setErreur(err instanceof Error ? err.message : t('profil.erreur'));
      });
    return () => {
      annule = true;
    };
    // `t` n'est pas une dépendance : la fiche se lit une fois, au premier
    // rendu, et la langue peut changer ensuite sans redemander `/auth/me`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const affiche = profil ?? session;

  const copierEmail = async () => {
    if (!affiche?.email) return;
    try {
      await navigator.clipboard.writeText(affiche.email);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      setErreur(t('profil.copieImpossible'));
    }
  };

  const demanderReinitialisation = async () => {
    if (!affiche?.email) return;
    setReinitialisation({ enCours: true, message: null });
    try {
      await requestData<{ message?: string }>('/auth/password-reset/request', {
        method: 'POST',
        body: { email: affiche.email },
      });
      setReinitialisation({
        enCours: false,
        message: t('profil.reinitialiserEnvoye', { email: affiche.email }),
      });
    } catch (err: unknown) {
      setReinitialisation({
        enCours: false,
        message: err instanceof Error ? err.message : t('profil.reinitialiserEchec'),
      });
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('profil.titre')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('profil.sous-titre')}</p>
      </div>

      {erreur && <ErrorBanner message={erreur} onDismiss={() => setErreur(null)} />}

      <Card>
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
            <User className="w-5 h-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">
              {affiche?.fullName ?? t('commun.inconnu')}
            </p>
            <p className="text-xs text-slate-500">
              {affiche?.shipperName ?? t('coque.roleExpediteur')} ·{' '}
              {affiche?.role === RoleType.EXPEDITEUR
                ? t('profil.compteExpediteur')
                : (affiche?.role ?? t('commun.inconnu'))}
            </p>
          </div>
        </div>

        <dl className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
          <Ligne libelle={t('profil.email')} icone={<Mail className="w-3.5 h-3.5" />}>
            {/* Une adresse ne se lit pas de droite à gauche : elle garde son sens. */}
            <span className="font-mono text-xs break-all" dir="ltr">
              {affiche?.email ?? t('commun.inconnu')}
            </span>
            <button
              type="button"
              onClick={() => void copierEmail()}
              className="ms-2 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 transition cursor-pointer"
              aria-label={`${t('commun.copier')} — ${t('profil.email')}`}
            >
              {copie ? (
                <>
                  <Check className="w-3 h-3" aria-hidden="true" />
                  {t('commun.copie')}
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" aria-hidden="true" />
                  {t('commun.copier')}
                </>
              )}
            </button>
          </Ligne>

          <Ligne libelle={t('profil.telephone')} icone={<Phone className="w-3.5 h-3.5" />}>
            {affiche?.phone ? (
              <span className="font-mono text-xs" dir="ltr">
                {affiche.phone}
              </span>
            ) : (
              <span className="text-xs">{t('profil.telephoneAbsent')}</span>
            )}
          </Ligne>

          <Ligne libelle={t('profil.role')} icone={<ShieldCheck className="w-3.5 h-3.5" />}>
            <span className="text-xs">
              {affiche?.role === RoleType.EXPEDITEUR
                ? t('profil.roleExpediteur')
                : (affiche?.role ?? t('commun.inconnu'))}
            </span>
          </Ligne>
        </dl>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-900">{t('profil.droits')}</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{t('profil.droitsAide')}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {(affiche?.permissions ?? []).map((permission) => (
            <li
              key={permission}
              className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[10px] text-slate-700"
            >
              {permission}
            </li>
          ))}
          {(affiche?.permissions?.length ?? 0) === 0 && (
            <li className="text-xs text-slate-400">{t('profil.aucunDroit')}</li>
          )}
        </ul>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-900">{t('profil.motDePasse')}</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{t('profil.motDePasseAide')}</p>
        <button
          type="button"
          onClick={() => void demanderReinitialisation()}
          disabled={reinitialisation.enCours || !affiche?.email}
          className="mt-3 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-md text-xs font-semibold text-slate-800 transition cursor-pointer"
        >
          {reinitialisation.enCours ? t('profil.reinitialiserEnvoi') : t('profil.reinitialiser')}
        </button>
        {reinitialisation.message && (
          <p className="mt-2 text-[11px] text-slate-600">{reinitialisation.message}</p>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-slate-900">{t('profil.session')}</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{t('profil.sessionAide')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void refresh().then(() => router.refresh());
            }}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 rounded-md text-xs font-semibold text-slate-800 transition cursor-pointer"
          >
            {t('profil.rafraichir')}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-semibold transition cursor-pointer"
          >
            {/* La sortie se fait vers la droite en français, vers la gauche en arabe. */}
            <LogOut className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden="true" />
            {t('profil.deconnexion')}
          </button>
        </div>
      </Card>

      {verifieLe && (
        <p className="text-[11px] text-slate-400">
          {t('profil.verifieLe', { date: formatDateTime(verifieLe) })}
        </p>
      )}
    </div>
  );
}

function Ligne({
  libelle,
  icone,
  children,
}: {
  libelle: string;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <dt className="text-xs text-slate-500 flex items-center gap-1.5 min-w-44">
        <span className="text-slate-400">{icone}</span>
        {libelle}
      </dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}