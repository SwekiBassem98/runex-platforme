# Application Vite archivée

Ce dossier contient l'ancienne application **Vite + React** (héritée de Google AI
Studio) qui servait auparavant de frontend unique. Elle n'est **plus** l'architecture
de référence du projet : le frontend est désormais `apps/web` (Next.js App Router).

## Pourquoi l'archiver

La Vite app est mono-fichier côté UI et fonctionnait avec l'API embarquée dans le
`server.ts` racine (Express + Vite middleware). Elle entre en conflit avec le
monorepo npm workspaces (deux runners, deux résolutions d'alias, deux systèmes de
build). Le code est conservé **intact** pour servir de référence lors de la
migration des écrans vers `apps/web`.

## Contenu conservé

| Fichier | Contenu |
| --- | --- |
| `src/App.tsx` | Coquille applicative + écrans Tableau de bord / Administration |
| `src/components/ColisManagementModule.tsx` | Module de gestion des colis |
| `src/components/ExpediteurPortal.tsx` | Portail fournisseur |
| `src/components/RunsheetManagementModule.tsx` | Module de gestion des runsheets |
| `src/index.css` | Entrée Tailwind CSS |

Tous ces écrans consomment déjà `@logixpress/ui` et `@logixpress/types` : la migration
vers `apps/web` est surtout un travail de découpage en routes App Router
(`src/app/<module>/page.tsx`) et de remplacement des appels `fetch('/api/v1/...')`
par `NEXT_PUBLIC_API_URL`.

## Comment le lancer (optionnel)

Ce dossier est **hors workspace npm** : il n'est ni typé ni construit par les
scripts racine. Pour l'inspecter, il faut réinstaller ses dépendances localement :

```bash
cd legacy/vite-app
npm install react react-dom lucide-react
npm install -D vite @vitejs/plugin-react @tailwindcss/vite tailwindcss typescript @types/react @types/react-dom
npx vite
```
