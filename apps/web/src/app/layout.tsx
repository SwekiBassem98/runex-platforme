import type { Metadata } from 'next';
import { FeedbackToastProvider } from '@/components/FeedbackToastProvider';
import { AuthProvider } from '@/lib/auth';
import { SCRIPT_PREMIER_RENDU } from '@/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'RUNEX - Plateforme Logistique & Livraison',
  description:
    'Plateforme moderne de gestion logistique et de livraison express en Tunisie : colis, runsheets, dépôts, inter-dépôts, ramassages et paiements.',
  openGraph: {
    title: 'RUNEX - Plateforme Logistique & Livraison',
    description:
      'RUNEX : poste de commandement opérationnel de la logistique et de la livraison express en Tunisie.',
    siteName: 'RUNEX',
    locale: 'fr_TN',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `lang` et `dir` valent pour le premier rendu : le serveur ne connaît pas la
    // préférence enregistrée, et le français de gauche à droite est la seule
    // valeur qu'il peut servir sans mentir. Le script ci-dessous reprend la main
    // avant la peinture, sur les seules surfaces traduites.
    <html lang="fr" dir="ltr" suppressHydrationWarning>
      <head>
        {/*
          Langue appliquée avant la première peinture, sur le portail expéditeur et
          la connexion seulement. Posée dans `<head>` pour que la direction soit
          correcte dès le premier rendu : la corriger plus tard ferait clignoter
          toute la page en miroir. Voir `i18n/premier-rendu.ts`.
        */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_PREMIER_RENDU }} />
      </head>
      <body className="bg-slate-50 text-slate-900 antialiased font-sans">
        <AuthProvider>
          <FeedbackToastProvider>{children}</FeedbackToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
