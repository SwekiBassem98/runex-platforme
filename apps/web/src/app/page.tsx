'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * Point d'entrée : renvoie vers le poste de commandement si une session est
 * ouverte, vers l'écran de connexion sinon.
 */
export default function HomePage() {
  const router = useRouter();
  const { isLoading, user } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/connexion');
      return;
    }
    router.replace(user.role === 'EXPEDITEUR' ? '/expediteur' : '/dashboard');
  }, [isLoading, user, router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-100">
      <div className="flex items-center justify-center bg-slate-950 rounded-xl px-4 py-3 shadow-sm">
        <img
          src="/brand/runex-logo.jpeg"
          alt="RUNEX"
          width={192}
          height={128}
          className="w-40 sm:w-48 h-auto"
        />
      </div>
      <p className="text-sm text-slate-500" role="status">
        Chargement de RUNEX…
      </p>
    </div>
  );
}
