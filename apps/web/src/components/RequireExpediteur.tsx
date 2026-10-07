'use client';

/**
 * Garde du portail expéditeur.
 *
 * Elle contrôle deux choses, dans cet ordre : qu'une session existe, et que
 * cette session soit celle d'un expéditeur. Un utilisateur interne qui saisit
 * `/expediteur` dans la barre d'adresse n'est pas redirigé vers une page
 * porteuse de données — il reçoit un refus explicite et le chemin de retour vers
 * son propre espace. Le rendu est neutralisé avant toute requête : le composant
 * enfant n'est monté que pour un expéditeur authentifié.
 */

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { RoleType } from '@logixpress/types';
import { CHEMIN_CONNEXION, useAuth } from '@/lib/auth';

export function RequireExpediteur({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (!isLoading && !user) router.replace('/expediteur/login');
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          <p className="text-sm font-medium">Vérification de la session…</p>
        </div>
      </div>
    );
  }

  // Le rendu est neutralisé tant que la redirection n'a pas eu lieu.
  if (!user) return null;

  if (user.role !== RoleType.EXPEDITEUR) {
    return <AccesRefuse email={user.email} destination={CHEMIN_CONNEXION[user.role]} />;
  }

  return <>{children}</>;
}

/**
 * Refus affiché à un utilisateur authentifié dont le rôle n'est pas
 * expéditeur. Aucun identifiant de colis, de ramassage ni de bordereau n'est
 * demandé ni transmis : c'est une porte, pas une page.
 */
function AccesRefuse({ email, destination }: { email: string; destination: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-4">
        <div className="flex justify-center">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-amber-50 border border-amber-200">
            <ShieldAlert className="w-5 h-5 text-amber-700" aria-hidden="true" />
          </span>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-bold text-slate-900">Espace réservé aux expéditeurs</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Le compte <span className="font-mono text-slate-800">{email}</span> est un
            compte d&apos;exploitation. Le portail expéditeur ne lui est pas ouvert.
          </p>
        </div>
        <Link
          href={destination}
          className="inline-block w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold text-xs transition"
        >
          Revenir à mon espace
        </Link>
      </div>
    </div>
  );
}