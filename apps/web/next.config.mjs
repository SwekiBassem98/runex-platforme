/** @type {import('next').NextConfig} */

/**
 * Cible du mandataire API, facultative.
 *
 * Le client appelle toujours une URL *relative* (`NEXT_PUBLIC_API_URL=/api/v1`)
 * et Next relaie vers le backend. Sans cela, un navigateur qui n'est pas sur la
 * machine du backend — aperçu hébergé, tunnel, poste distant — résoudrait
 * `localhost:4000` sur *sa propre* machine et n'atteindrait jamais l'API.
 *
 * Le relais est strictement optionnel : sans `API_PROXY_TARGET`, aucune règle
 * n'est ajoutée et le comportement en production reste inchangé.
 */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET;

/**
 * En-têtes de sécurité appliqués à toutes les pages du back-office.
 * `frame-ancestors 'none'` + X-Frame-Options empêchent le détournement de clic,
 * aucune page n'ayant vocation à être intégrée dans un cadre tiers.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // Les packages partagés sont publiés en source TypeScript : Next doit les compiler.
  transpilePackages: ['@logixpress/ui', '@logixpress/types', '@logixpress/config'],
  async rewrites() {
    const regles = [
      /*
       * Les navigateurs réclament `/favicon.ico` même quand la page déclare
       * `<link rel="icon">`. L'icône existe sous `icon.png` (convention de
       * fichier Next), mais rien ne répondait sur ce chemin : chaque ouverture
       * d'écran produisait un 404 dans la console. Le relais est interne et ne
       * change rien à ce que l'utilisateur voit.
       */
      { source: '/favicon.ico', destination: '/icon.png' },
    ];
    if (API_PROXY_TARGET) {
      regles.push({
        source: '/api/v1/:path*',
        destination: `${API_PROXY_TARGET.replace(/\/+$/, '')}/api/v1/:path*`,
      });
    }
    return regles;
  },
};

export default nextConfig;
