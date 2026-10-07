/**
 * Chargement anticipé des variables d'environnement.
 *
 * Ce module ne contient que des effets de bord : il doit être importé en
 * PREMIER dans `main.ts` afin que `process.env` soit peuplé avant
 * l'évaluation des modules qui lisent la configuration au niveau module
 * (ex. `common/auth/jwt.util.ts`).
 *
 * Le fichier `.env` est recherché à la racine du workspace courant puis à la
 * racine du monorepo, afin que le même code fonctionne en développement
 * (`npm run dev:api` depuis `apps/api`) et après compilation (`node dist/main.js`).
 */
import path from 'node:path';
import dotenv from 'dotenv';

const cwd = process.cwd();

dotenv.config({
  path: [path.resolve(cwd, '.env'), path.resolve(cwd, '../../.env')],
  quiet: true,
});
