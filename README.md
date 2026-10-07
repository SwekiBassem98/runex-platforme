# RUNEX

Plateforme de gestion logistique et de livraison express en Tunisie : colis,
feuilles de route (runsheets), ramassages, transferts inter-dépôts, paiements,
tableaux de bord, authentification et gestion des rôles.

## Architecture

Monorepo **npm workspaces** :

```
logixpress-tunisie/
├── apps/
│   ├── api/          API REST modulaire (Express 4 + TypeScript)  -> port 4000
│   └── web/          Frontend Next.js (App Router + Tailwind 4)   -> port 3000
├── packages/
│   ├── types/        Types de domaine, énumérations, contrats d'API
│   ├── config/       Configuration métier partagée (ports, tarifs, gouvernorats)
│   ├── ui/           Design system React (composants, graphiques, helpers)
│   └── tsconfig/     Configurations TypeScript partagées (base / api / nextjs)
├── prisma/
│   └── schema.prisma Schéma relationnel PostgreSQL
├── legacy/
│   └── vite-app/     Application Vite d'origine, archivée (référence, non compilée)
└── docker-compose.yml  Infrastructure de développement : PostgreSQL + Redis
```

> Le backend est **Express 4** (et non NestJS) : `apps/api/src/app.router.ts`
> expose un `express.Router()` et les contrôleurs sont des classes simples
> `(req, res) => void`. Cette implémentation a été conservée telle quelle.

## Prérequis

- Node.js >= 20.9
- Docker (uniquement pour PostgreSQL et Redis)

## Installation

```bash
npm install
cp .env.example .env      # adapter si nécessaire
```

## Variables d'environnement

Toutes les variables lues par le code sont documentées dans `.env.example`.
Les valeurs par défaut sont **des valeurs de développement non secrètes**,
alignées sur `docker-compose.yml`.

| Groupe | Variables | Lues par |
| --- | --- | --- |
| API | `API_PORT`, `API_HOST`, `CORS_ORIGIN` | `apps/api/src/main.ts` |
| Frontend | `NEXT_PUBLIC_API_URL` | build Next.js |
| PostgreSQL | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Prisma + `docker-compose.yml` |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_REQUIRED` | `apps/api/src/redis/redis.service.ts` |
| JWT | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | `apps/api/src/common/auth/jwt.util.ts` |
| Métier | `DEFAULT_HUB_CODE`, `TIMEZONE`, `CURRENCY`, `CURRENCY_DECIMALS` | `packages/config/src/index.ts` |
| Debug | `PRISMA_LOG_QUERIES` | `apps/api/src/database/prisma.service.ts` |

En production, l'absence de `JWT_ACCESS_SECRET` ou `JWT_REFRESH_SECRET` lève une
erreur fatale au démarrage : aucun secret de repli n'est codé en dur.

## Infrastructure locale (Docker)

Docker ne fournit **que** PostgreSQL et Redis. Les processus Node tournent sur la
machine hôte.

```bash
docker compose up -d postgres redis
docker compose ps        # postgres et redis doivent être "healthy"
```

- **PostgreSQL 16** — crée automatiquement le rôle `logixpress_user` et la base
  `logixpress_db` au premier démarrage du volume.
- **Redis 7** — n'exige un mot de passe que si `REDIS_PASSWORD` est renseigné
  dans `.env` ; le healthcheck s'adapte automatiquement.

`docker-compose.override.yml` n'ajoute que des réglages de développement
(checksums PostgreSQL) et **ne définit aucun service `api`/`web`**.

Arrêter l'infrastructure : `npm run infra:down`.

### Si PostgreSQL ou Redis tournent déjà en local

`docker compose up` publie les conteneurs sur `5432` et `6379`. Si un
PostgreSQL ou un Redis est déjà installé sur la machine (Homebrew, Postgres.app,
un service déjà démarré…), la publication échoue sur `address already in use` —
et, sur macOS, PostgreSQL peut malgré tout démarrer, ce qui laisse **deux
serveurs se disputant le port 5432**. C'est une situation à résoudre, pas à
contourner : la base de données servie dépend alors de laquelle des deux
répond.

Vérifier ce qui occupe les ports avant de lancer Docker :

```bash
lsof -nP -iTCP:5432 -iTCP:6379 -sTCP:LISTEN
```

Deux issues acceptables : arrêter le service natif et laisser Docker gérer
l'infrastructure, ou conserver le service natif et ne pas lancer Docker. Dans
les deux cas l'API n'a besoin que des variables de `.env` (`DATABASE_URL`,
`REDIS_HOST`, `REDIS_PORT`) : ni le client, ni le schéma, ni le code applicatif
ne dépendent du mode d'exécution. Redis est facultatif — l'API démarre et
répond normalement sans lui tant que `REDIS_REQUIRED=false`.

## Démarrage en développement

Terminal 1 — infrastructure :

```bash
npm run infra:up          # docker compose up -d postgres redis
```

Terminal 2 — API :

```bash
npm run dev:api
```

Terminal 3 — frontend :

```bash
npm run dev:web
```

Ou les deux processus Node en une seule commande :

```bash
npm run dev
```

| Service | URL |
| --- | --- |
| Frontend Next.js | http://localhost:3000 |
| Health check API | http://localhost:4000/api/v1/health |
| Documentation Swagger | http://localhost:4000/api/v1/docs |
| Spécification OpenAPI | http://localhost:4000/api/v1/docs/json |

### Endpoint de santé

`GET /api/v1/health` exécute de vraies sondes : `SELECT 1` via Prisma et `PING`
via ioredis. Il répond `200` si toutes les dépendances obligatoires sont
joignables, `503` sinon.

```jsonc
{
  "status": "ok",                       // "degraded" si une dépendance est down
  "timestamp": "2026-09-29T11:47:04.673Z",
  "uptime": 83.296,
  "services": {
    "api":      { "status": "up" },
    "database": { "status": "up", "latencyMs": 2 },
    "redis":    { "status": "up", "latencyMs": 1, "required": false }
  },
  "version": "1.0.0"
}
```

Redis est **optionnel** par défaut : `REDIS_REQUIRED=false` laisse l'API en `ok`
si le cache est arrêté. Passez `REDIS_REQUIRED=true` pour le rendre obligatoire —
le statut global basculera alors en `degraded`.

L'API démarre même si PostgreSQL est injoignable, mais le signale dans la console
et `/api/v1/health` renvoie `503` avec le message d'erreur réel.


## Routes API

Toutes les routes sont préfixées par `/api/v1`. Chaque route métier existe sous
son **nom canonique** ; un **alias historique** est conservé pour les clients
existants. Les deux formes sont strictement équivalentes (mêmes contrôleurs,
mêmes permissions).

| Ressource | Route canonique | Alias historique | Méthodes |
| --- | --- | --- | --- |
| Santé | `/health` | — | `GET` |
| Authentification | `/auth` | — | `POST /login`, `POST /refresh`, `POST /password-reset/request`, `POST /password-reset/confirm`, `GET /me`, `POST /logout` |
| Comptes de démo | `/auth/demo-users` | — | `GET` |
| Colis | `/colis` | `/packages` | `GET`, `POST`, `GET /:identifier`, `PUT /:identifier` |
| Actions colis | `/colis/:identifier/{cancel,assign,deliver,partial-delivery,exchange,postpone,return}` | `/packages/:identifier/…` | `POST` |
| Scan magasin | `/warehouse/scan-accept` | — | `POST` |
| Runsheets | `/runsheets` | — | `GET`, `POST`, `GET /:id`, `GET /driver/active`, `POST /:id/{add-package,remove-package,status,close,validate}` |
| Ramassages | `/ramassages` | `/pickups` | `GET`, `POST`, `PATCH /:id/confirm` |
| Paiements | `/payments/vouchers` | — | `GET`, `POST /:voucherNumber/validate` |
| Inter-dépôts | `/inter-depots` | `/inter-depot` | `GET` |
| Tableau de bord | `/dashboard` | — | `GET` |

La spécification OpenAPI complète est servie sur `/api/v1/docs` (interface) et
`/api/v1/docs/json` (document). Elle est générée à partir des mêmes fichiers que
le routeur : les deux ne peuvent pas diverger.

### Autorisation

L'accès est contrôlé par permissions (`PermissionCode`), pas seulement par rôle :

- `requirePermissions(...)` exige **toutes** les permissions listées ;
- `requireAnyPermission(...)` en exige **au moins une** ;
- le rôle `ADMIN` est toujours accordé.

Le livreur est cantonné aux colis qui lui sont affectés : les actions
`deliver` et `return` vérifient que le colis porte bien son `driverId` et
refusent sinon l'opération. Les rôles d'exploitation (`GESTIONNAIRE`,
`FINANCE`, `AGENT_DEPOT`) ne sont pas soumis à ce cantonnement.

## Scripts

| Commande | Description |
| --- | --- |
| `npm run dev` | Lance l'API et le frontend en parallèle (watch) |
| `npm run dev:api` | API seule via `tsx watch` |
| `npm run dev:web` | Frontend seul via `next dev` |
| `npm run build` | Construit les packages partagés, l'API et le frontend |
| `npm run build:packages` | Compile `@logixpress/types` et `@logixpress/config` |
| `npm run build:api` | Compile l'API vers `apps/api/dist` |
| `npm run build:web` | Build Next.js |
| `npm start` | Démarre l'API compilée et le build Next.js |
| `npm run typecheck` | Vérification TypeScript de tous les workspaces |
| `npm run prisma:validate` | Vérifie la syntaxe de `prisma/schema.prisma` |
| `npm run prisma:generate` | Génère le client Prisma |
| `npm run prisma:migrate` | Crée/applique une migration en développement |
| `npm run prisma:deploy` | Applique les migrations existantes (CI, production) |
| `npm run prisma:status` | Affiche l'état des migrations vs la base |
| `npm run prisma:studio` | Ouvre Prisma Studio |
| `npm run prisma:seed` | Insère le jeu de données de démonstration (idempotent) |
| `bash scripts/api-smoke-test.sh` | Vérifie les 82 comportements de l'API sur une instance locale |
| `npm run infra:up` / `infra:down` / `infra:ps` | Lance / arrête / inspecte PostgreSQL et Redis |
| `npm run clean` | Supprime les artefacts de build |

## Base de données

Le schéma Prisma vit dans `prisma/schema.prisma` (PostgreSQL, clés UUID,
montants en `Decimal(10,3)` — dinar tunisien).

```bash
npm run prisma:validate     # schéma valide ?
npm run prisma:generate     # client TypeScript
npm run prisma:migrate      # crée + applique la migration en développement
npm run prisma:status       # la base est-elle à jour ?
npm run prisma:studio       # exploration des données
```

L'historique de migrations est versionné dans `prisma/migrations/`. La migration
initiale `20260929111459_init` crée l'intégralité du schéma.

> Ne jamais exécuter `prisma migrate reset` sur un environnement qui contient des
> données : il supprime la base. Utilisez `prisma migrate dev` en développement
> et `prisma migrate deploy` en déploiement.

Redis est fourni par Docker pour le cache et les files d'attente ; il est
optionnel pour le fonctionnement de l'API.

### Données initiales

`npm run prisma:seed` insère un jeu de données exploitable : 1 société,
4 agences, 4 dépôts, 8 rôles, 3 expéditeurs, 5 clients, 7 utilisateurs,
3 livreurs, 15 colis avec leur chronologie, des tentatives de livraison, une
tournée, un bordereau, un transfert inter-dépôts et un rendez-vous de ramassage.

Le seed est **idempotent** : il n'efface pas les données existantes et se limite
à compléter ce qui manque. Pour repartir d'une base vide, utiliser
`npx prisma migrate reset` (le seed est alors rejoué automatiquement).

Les mots de passe des comptes de démonstration sont hachés en PBKDF2-SHA512,
et les codes secrets de déblocage des bordereaux en PBKDF2-SHA256 avec un sel
court — format choisi pour tenir dans la colonne `VarChar(100)`.

## Frontend

`apps/web` est une application **Next.js 16 (App Router) + React 19 + Tailwind 4**
qui s'exécute **indépendamment de l'API** : le serveur de développement démarre
et sert l'interface même si le backend est arrêté (les écrans affichent alors un
état dégradé explicite plutôt que d'échouer).

| Rôle | Valeur |
| --- | --- |
| Frontend | http://localhost:3000 |
| Backend | http://localhost:4000 |
| Base de l'API | `NEXT_PUBLIC_API_URL` = http://localhost:4000/api/v1 |

### Couche client API

Toute communication passe par un module unique, `apps/web/src/lib/api.ts` :
aucune URL d'API n'est écrite en dur ailleurs. La base provient de
`NEXT_PUBLIC_API_URL` (inlinée au build) et le client :

- injecte automatiquement le jeton d'accès lu dans `localStorage` ;
- rafraîchit le jeton **une seule fois** sur un `401`, les requêtes simultanées
  partageant la même rotation (le refresh token est à usage unique) ;
- renvoie les messages d'erreur de l'API tels quels, pour un affichage en français ;
- distingue les cas réseau (`status 0`), `401`, `403` et `404`.

### Routage

| Route | Écran | Origine |
| --- | --- | --- |
| `/connexion` | Authentification de l'exploitation | Porté de l'application Vite |
| `/expediteur/login` | Authentification de l'Espace Expéditeur | Écrit pour la séparation des espaces |
| `/expediteur` | Portail expéditeur | Module `features/ExpediteurPortal` |
| `/dashboard` | Poste de commandement | Porté de l'application Vite |
| `/colis` | Gestion des colis | Module `features/ColisManagementModule` |
| `/runsheets` | Runsheets livreurs | Module `features/RunsheetManagementModule` |
| `/magasin` | Acceptation magasin | Porté de l'application Vite |
| `/ramassages` | Rendez-vous de ramassage | Porté de l'application Vite |
| `/paiements` | Bordereaux CRBT | Porté de l'application Vite |
| `/inter-depots` | Transferts inter-dépôts | Écrit d'après le contrat de l'API |
| `/design-system` | Catalogue de composants | Porté de l'application Vite |

#### Deux espaces d'authentification

Le portail expéditeur n'appartient pas à l'application d'exploitation :

- il ne figure dans aucune entrée de la barre latérale — ni sur poste, ni sur
  mobile, ni dans une configuration de navigation tierce ;
- il a son propre écran d'entrée, `/expediteur/login`, et son propre groupe de
  routes (`app/expediteur/(portail)`) qui ne porte ni la barre latérale ni la
  garde de simple présence de session ;
- `RequireExpediteur` n'accepte qu'une session `EXPEDITEUR` : un utilisateur
  interne qui saisit `/expediteur` reçoit un refus explicite, et une session
  absente est renvoyée vers `/expediteur/login` ;
- la déconnexion et l'expiration de jeton ramènent chacun vers l'écran de son
  propre espace (`CHEMIN_CONNEXION` dans `apps/web/src/lib/auth.tsx`) ;
- les identifiants sont refusés à la mauvaise porte : un compte d'exploitation
  saisi dans l'Espace Expéditeur est rejeté, un compte expéditeur saisi dans
  `/connexion` est renvoyé vers `/expediteur/login`.

Le serveur ne fait pas confiance à cette séparation : `authenticateToken` refuse
un expéditeur sans `shipperId` (403) plutôt que de répondre sans filtre, et le
périmètre de chaque requête provient du jeton — un `shipperId` envoyé dans un
corps de requête ou une chaîne de requête ne peut ni le remplacer ni l'élargir.

Les trois modules métier ont été repris **sans réécriture de leur logique** :
seuls leurs imports (`@logixpress/ui`, `@logixpress/types`) et l'origine des
requêtes ont changé. Le `fetch` local de chaque module est fourni par
`createApiFetch()`, qui route vers le client commun tout en conservant la
sémantique de `fetch` — ce qui évite de réécrire 5 800 lignes d'UI déjà
fonctionnelles.

### Vérification

```bash
node scripts/verify-frontend.mjs
```

Ouvre un Chrome sans interface, obtient une session réelle auprès de
`POST /auth/login`, injecte les jetons, puis contrôle que chacun des écrans se
rend **et** affiche les chiffres réellement servis par l'API. L'authentification
n'est jamais simulée : des identifiants erronés sont explicitement testés et
doivent être refusés par l'API.

Le cloisonnement entre les deux espaces a son propre contrôle :

```bash
npm run qa:expediteur
```

Il vérifie qu'aucun raccourci vers le portail ne subsiste dans la navigation
interne, qu'un expéditeur n'atteint ni le poste de commandement ni les modules
réservés à l'exploitation, et qu'il ne peut lire ni le colis ni son journal
d'audit chez un autre expéditeur — y compris en remplaçant l'identifiant dans
l'URL.

## Comptes de démonstration

L'API lit les utilisateurs de démonstration **en base**
(`apps/api/src/modules/auth/auth.service.ts`, table `User`). Les mots de passe
figurent dans le
payload de `POST /api/v1/auth/demo-users` — ne pas utiliser en production.

## Stack conteneurisée complète

`docker-compose.yml` ne fournit **que** l'infrastructure. Pour lancer aussi l'API
et le frontend en conteneurs :

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## État actuel

L'infrastructure et les modules métier sont branchés et vérifiés de bout en
bout. Les limites ci-dessous sont réelles et assumées ; la distinction entre ce
qui est opérationnel et ce qui reste à trancher est importante avant toute mise
en production.

### Opérationnel

- Monorepo npm workspaces : `packages`, `api` et `web` compilent sans erreur
  (`npm run build`, `npm run typecheck` : 0 erreur).
- PostgreSQL 16 et Redis sont joignables ; `GET /api/v1/health` sonde réellement
  les deux et répond `200`.
- Migration initiale `20260929111459_init` appliquée, complétée par
  `20260929125248_current_depot_nullable_for_interdepot_transit` qui rend
  `Package.currentDepositId` nullable — un colis en transfert inter-dépôts
  n'appartient plus à un dépôt. `prisma migrate status` indique un schéma à jour.
- `npm run prisma:seed` remplit la base d'un jeu de données cohérent
  (15 colis avec chronologie, tournée, bordereau, transfert, rendez-vous).
- 80 contrôles de bout en bout couvrent l'authentification, les permissions, la
  validation des entrées, les 8 groupes d'endpoints, le 404 global et le CORS
  (`bash scripts/api-smoke-test.sh`). La suite est relançable : elle résout ses
  identifiants auprès de l'API au lieu de figer des données de test.
- 20 contrôles vérifient le flux métier complet, de la création par
  l'expéditeur à l'encaissement, en passant par l'affectation et la livraison
  (`bash scripts/verify-business-flow.sh`) : statuts successifs, refus
  d'annulation après réception au dépôt, notifications, historique, audit et
  verrouillage d'un colis déjà livré.

### Limites connues

**Rôles et statuts divergents entre l'API et le schéma Prisma.** Les deux
modélisations coexistent et ne sont pas alignées :

| Sujet | API (`packages/types`, `ROLE_PERMISSIONS`) | Prisma (`prisma/schema.prisma`) |
| --- | --- | --- |
| Rôles | `ADMIN`, `GESTIONNAIRE`, `EXPEDITEUR`, `LIVREUR`, `AGENT_DEPOT`, `FINANCE` | `SUPER_ADMIN`, `ADMIN_GENERAL`, `DISPATCHER`, `MAGASINIER`, `CAISSIER`, `EXPEDITEUR_ADMIN`, `EXPEDITEUR_USER`, `LIVREUR` |
| Statuts de runsheet | `BROUILLON`, `PREPARE`, `ASSIGNE`, `EN_COURS`, `TERMINE`, `VALIDE`, `ANNULE`, `EN_ATTENTE`, `VALIDEE_DEPART`, `RETOUR_DEPOT`, `CLOTUREE_CONFORME`, `CLOTUREE_DEFICIT`, `ANNULEE` | `BROUILLON`, `EN_ATTENTE`, `VALIDEE_DEPART`, `EN_COURS`, `RETOUR_DEPOT`, `CLOTUREE_CONFORME`, `CLOTUREE_DEFICIT`, `ANNULEE` |

Seul `LIVREUR` est commun aux deux listes de rôles. Pour les statuts, Prisma
ignore `PREPARE`, `ASSIGNE`, `TERMINE`, `VALIDE` et `ANNULE`, et orthographie
`ANNULEE` là où l'API distingue `ANNULE` de `ANNULEE`.

**Aucun mapping n'a été inventé.** Le produit a tranché : les deux vocabulaires
sont conservés et traduits plutôt que fusionnés.

- Les rôles sont traduits à l'authentification, et les permissions appliquées
  le sont sur les codes métier usuels.
- Les statuts de tournée passent par une table de correspondance explicite
  (`apps/api/src/modules/runsheets/runsheet-status.ts`), qui convertit dans les
  deux sens et documente le rapprochement. L'alignement pourra être fait plus
  tard sans regret : la table est le seul point à modifier.

**Écart de permissions connu.** Les actions `/colis/:id/postpone`,
`/partial-delivery` et `/exchange` exigent `COLIS_UPDATE`, permission que le
rôle `LIVREUR` ne détient pas : un livreur ne peut donc pas enregistrer ces trois
gestes depuis l'API. `deliver` et `return` ont été corrigés (le livreur agit sur
ses seuls colis). Trancher : créer des permissions dédiées
(`COLIS_POSTPONE`, …) ou accorder `COLIS_UPDATE` au livreur.

**`GET /payments/vouchers` n'expose aucun filtre** : ni `status`, ni recherche,
ni pagination, contrairement à `GET /colis`. Les agrégats de `meta` sont
calculés sur la liste réellement renvoyée.

**Suivi de présence des livreurs absent.** Le tableau de bord expose
`livreurs.horsLigne` à 0 : aucun modèle ne permet de distinguer un livreur
injoignable d'un livreur simplement sans tournée. La valeur reste à zéro plutôt
qu'inventée.

**Dépendances.** `npm audit` signale 3 vulnérabilités « high » dans la chaîne
`prisma` → `@prisma/config` → `deepmerge-ts`. Elles ne concernent que l'outillage
de développement : l'API n'embarque pas `@prisma/client` lui-même dans cette
chaîne. Les corriger suppose de franchir une version majeure de Prisma, donc
d'attendre une migration dédiée plutôt qu'un `audit fix --force` à l'aveugle.

**Conteneurs non validés.** Docker n'étant pas installé sur la machine de
développement, `docker-compose.yml` et `docker-compose.override.yml` sont
fournis mais n'ont pas pu être exécutés ; PostgreSQL et Redis ont été validés via
des installations locales.

**Archive Vite.** L'application Vite historique reste consultable dans
`legacy/vite-app` comme référence. Ses écrans ont été repris dans
`apps/web/src/app` : les trois modules métier ont migré à l'identique, les
autres vues ont été réécrites en routes Next.js. Le fichier `App.tsx` d'origine
est conservé tel quel et n'est plus compilé.
