/** @type {import('next').NextConfig} */

import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';

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

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').trim();
const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL ?? '').trim();

/**
 * Garde-fou de build : l'adresse de l'API est figée dans le JavaScript au
 * moment du build. Oubliée sur Vercel, le site publié viserait
 * `http://localhost:4000` — chaque navigateur chercherait l'API sur sa propre
 * machine. Le build échoue plutôt que de publier un site inutilisable.
 */
function assertApiUrl(phase) {
  if (phase !== PHASE_PRODUCTION_BUILD) return;
  if (!API_URL && !API_PROXY_TARGET) {
    throw new Error(
      '[RUNEX] NEXT_PUBLIC_API_URL manquante : renseignez l’URL publique de l’API ' +
        '(ex. https://runex-api-xxx.koyeb.app/api/v1) dans les variables du projet.'
    );
  }
  if (process.env.VERCEL && !/^https:\/\//.test(API_URL)) {
    throw new Error(
      `[RUNEX] Sur Vercel, NEXT_PUBLIC_API_URL doit être une URL https absolue (reçu « ${API_URL || 'vide'} »). ` +
        'Le relais API_PROXY_TARGET ne transporte pas les websockets des notifications.'
    );
  }
}

/** Origines que la page peut joindre : elle-même, l'API (HTTP) et sa socket (WS). */
function connectSources() {
  const sources = new Set(["'self'"]);
  for (const raw of [API_URL, SOCKET_URL]) {
    try {
      const url = new URL(raw);
      sources.add(url.origin);
      sources.add(url.origin.replace(/^http/, 'ws'));
    } catch {
      /* URL relative ou absente : 'self' suffit */
    }
  }
  if (process.env.NODE_ENV !== 'production') sources.add('ws:').add('http://localhost:4000');
  return [...sources].join(' ');
}

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
  // `connect-src` limite fetch/WebSocket à l'API déclarée : un script injecté
  // ne pourrait pas exfiltrer les jetons vers un autre serveur. Les scripts
  // et styles ne sont pas restreints ici (Next injecte du code en ligne).
  {
    key: 'Content-Security-Policy',
    value: `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; connect-src ${connectSources()}`,
  },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig = (phase) => ({
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
});

export default (phase) => {
  assertApiUrl(phase);
  return nextConfig(phase);
};
