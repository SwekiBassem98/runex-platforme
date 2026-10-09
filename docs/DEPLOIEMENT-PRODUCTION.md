# RUNEX — mise en production gratuite (Vercel + Koyeb + Neon + APK)

Ce guide met en ligne toute la plateforme sans nom de domaine et sans abonnement :

```
 Navigateurs (téléphones des agents, bureau)        Téléphones des livreurs (APK)
            │ https://<projet>.vercel.app                     │
            ▼                                                 │
   Vercel — web Next.js (apps/web)                            │
            │ appels API + websocket (https / wss)            │
            ▼                                                 ▼
   Koyeb — API Express + Socket.IO (apps/api/Dockerfile) — https://<service>.koyeb.app/api/v1
            │ TLS
            ▼
   Neon — PostgreSQL (Frankfurt)
```

Les trois services fournissent HTTPS automatiquement sur leur sous-domaine
(`*.vercel.app`, `*.koyeb.app`, `*.neon.tech`) : aucun domaine n'est nécessaire.

## 1. Pourquoi ces services

| Besoin | Choix | Offre gratuite (octobre 2026) | Points d'attention |
|---|---|---|---|
| Web | **Vercel** (Hobby) | Next.js natif, HTTPS, déploiement à chaque push | Usage non commercial selon les conditions Hobby : passer en Pro (20 $/mois) quand l'activité le justifie |
| API | **Koyeb** (instance `free`) | 1 service web, 512 Mo RAM, 0,1 vCPU, Frankfurt ou Washington | **Carte bancaire demandée** à l'inscription (anti-fraude, empreinte de 29 $ libérée ; jamais débitée pour l'instance gratuite). Mise en veille après **1 h** sans trafic, réveil en 1 à 5 s. Un websocket ouvert (web) garde l'API éveillée |
| Base | **Neon** (Free) | 100 h de calcul/mois, 1 Go de stockage, 5 Go de transfert, pas d'expiration | Veille après 5 min d'inactivité (réveil < 1 s). Restauration possible sur 6 h seulement : faire des sauvegardes (§ 8) |
| APK | **EAS Build** (Expo, gratuit) | Builds Android dans le cloud, clé de signature conservée | File d'attente de quelques minutes sur l'offre gratuite |

**Alternative sans carte bancaire : Render** pour l'API (même Dockerfile, même
variables), en gardant **Neon** pour la base. Inconvénients : mise en veille
après 15 min et **≈ 1 minute** de réveil (le livreur voit « Impossible de
contacter le serveur » puis réussit au second essai) ; la base gratuite de
Render, elle, est supprimée au bout de 30 jours — ne pas l'utiliser.

Pas de Redis : l'API fonctionne sans (`REDIS_REQUIRED=false`). Une seule
instance d'API : la limitation de débit et les salles Socket.IO sont en mémoire.

## 2. Base de données — Neon

1. Créer un compte sur neon.com → **New project** : nom `runex`, PostgreSQL 17,
   région **AWS Europe Central 1 (Frankfurt)** (à côté de l'API Koyeb).
2. **Connect** → noter deux adresses du rôle propriétaire `neondb_owner` :
   - **directe** (décocher « Connection pooling ») : hôte `ep-xxx.eu-central-1.aws.neon.tech` → migrations ;
   - **poolée** (cocher « Connection pooling ») : hôte `ep-xxx-pooler.eu-central-1.aws.neon.tech` → API.

### 2.1 Migrations (GitHub Actions)

1. GitHub → dépôt `runex-platforme` → **Settings → Secrets and variables → Actions → New repository secret** :
   `PRODUCTION_DIRECT_DATABASE_URL` = adresse **directe** de `neondb_owner` (avec `?sslmode=require`).
2. **Actions → Migrations production → Run workflow**. Ensuite, chaque fusion sur
   `main` qui modifie `prisma/` relance les migrations automatiquement.

(Depuis un poste : `DATABASE_URL="<adresse directe>" npx prisma migrate deploy`.)

### 2.2 Rôle applicatif à droits réduits

L'API ne se connecte pas avec `neondb_owner` (qui peut tout modifier, y compris
désactiver la protection du journal d'audit). Sur le Mac, à la racine du dépôt,
après la première migration :

```bash
brew install libpq && brew link --force libpq        # fournit psql (une fois)
APP_PASSWORD="$(openssl rand -hex 24)"; echo "$APP_PASSWORD"   # à garder pour l'étape 3
DATABASE_URL="<adresse DIRECTE neondb_owner>" APP_PASSWORD="$APP_PASSWORD" npm run db:app-role
```

Le script crée `runex_app` (lecture/écriture des données, aucun droit de
structure, journal d'audit en ajout seul) et affiche un contrôle final : toutes
les colonnes `superuser`, `createrole`, `update_interdit_si_false`… doivent valoir `f`.
Créer ce rôle par SQL et non par la console Neon : la console ajoute `neon_superuser`.

Adresse de l'API (à mettre dans Koyeb) — hôte **poolé**, rôle `runex_app` :

```
postgresql://runex_app:<APP_PASSWORD>@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connection_limit=5&connect_timeout=15
```

### 2.3 Premier administrateur (sans données de démonstration)

```bash
npm ci   # si ce n'est pas déjà fait
DATABASE_URL="<adresse API ci-dessus>" \
ADMIN_EMAIL="direction@exemple.tn" ADMIN_PASSWORD='<12 caractères min., 3 types>' \
ADMIN_NAME="Prénom Nom" ADMIN_PHONE="2xxxxxxx" npm run db:bootstrap
```

Crée les rôles, la société, les agences et dépôts de référence et ce seul
compte administrateur. Rien d'autre : les expéditeurs, agents et livreurs se
créent ensuite depuis le web (Administration). Relançable sans effet ;
`BOOTSTRAP_RESET_ADMIN_PASSWORD=true` réécrit le mot de passe en cas de perte.
**Ne jamais lancer `npm run prisma:seed` sur cette base** (comptes aux mots de passe publics ; il refuse `NODE_ENV=production`).

## 3. API — Koyeb

1. koyeb.com → compte (carte demandée) → **Create Web Service → GitHub** → dépôt `runex-platforme`, branche `main`.
2. **Builder : Dockerfile** — Dockerfile location `apps/api/Dockerfile`, work directory : racine (vide).
3. **Instance : Free**, région **Frankfurt**.
4. **Ports** : 8000, HTTP, chemin public `/`. **Health check** : HTTP, port 8000, chemin `/api/v1/health/live`
   (cette route ne touche pas la base : elle ne consomme pas les heures Neon).
5. **Variables d'environnement** (type *Secret* pour celles marquées 🔒) :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` 🔒 | adresse API du § 2.2 (pooler + `runex_app`) |
| `JWT_ACCESS_SECRET` 🔒 | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` 🔒 | `openssl rand -hex 32` (différent du premier) |
| `CORS_ORIGIN` | `https://<projet>.vercel.app` (à compléter après l'étape 4 ; plusieurs origines séparées par des virgules) |
| `REDIS_REQUIRED` | `false` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` 🔒 | compte de service Firebase en base64 (§ 5.1) — sans lui, pas de notification sur les téléphones |
| `NODE_OPTIONS` | `--max-old-space-size=384` (instance de 512 Mo) |

   Koyeb fournit `PORT` (8000) ; l'API le lit en priorité. Derrière la passerelle
   Koyeb, 1 relais est approuvé par défaut en production (`TRUST_PROXY`), ce
   qui donne la vraie adresse du client à la limitation de débit et à l'audit.

6. **Deploy**. Le build prend quelques minutes. Contrôles :
   - `https://<service>.koyeb.app/api/v1/health` → `"status":"ok"`, `database: up` (`redis: down`, non requis, est normal) ;
   - `https://<service>.koyeb.app/api/v1/docs` → 404 (documentation masquée en production) ;
   - `https://<service>/api/v1/health/ip` dans un navigateur : le `verdict` doit être « OK ». Sinon, il indique la valeur de `TRUST_PROXY_HOPS` à mettre (Render place plusieurs relais devant l'API).

**Ne jamais définir en production** : `ENABLE_DEMO_ACCOUNTS`, `ENABLE_API_DOCS`,
`SEED_ALLOW_PRODUCTION`, `RATE_LIMIT_DISABLED`, `PASSWORD_RESET_LOG_TOKEN`.
L'API refuse de démarrer si un secret JWT fait moins de 32 caractères, reprend
la valeur d'exemple ou si les deux secrets sont identiques.

## 4. Web — Vercel

1. vercel.com → **Add New → Project** → importer `runex-platforme`.
2. **Root Directory : `apps/web`** (garder « Include files outside the root directory » activé).
   Framework : Next.js. Les commandes d'installation et de build viennent de `apps/web/vercel.json`.
3. **Environment Variables** (Production et Preview) :
   `NEXT_PUBLIC_API_URL` = `https://<service>.koyeb.app/api/v1`.
   Ne pas définir `API_PROXY_TARGET` : le relais de Next ne transporte pas le websocket des notifications.
   Le build échoue volontairement si l'adresse manque ou n'est pas en https.
4. **Deploy**, puis reporter l'adresse de production `https://<projet>.vercel.app` dans `CORS_ORIGIN` sur Koyeb (redéploiement automatique).
5. Ouvrir le site sur un téléphone, se connecter avec l'administrateur, créer agents, expéditeurs et livreurs.

Les déploiements de prévisualisation (URL différente à chaque branche) sont
bloqués par CORS : c'est voulu, seule l'adresse de production parle à l'API.

## 5. Application livreur — APK

Voir `README.md` du dépôt `runex-driver-app`, section « Générer l'APK » :
mettre `https://<service>.koyeb.app/api/v1` dans `eas.json`, puis
`npx eas-cli@latest build --platform android --profile preview` et distribuer
le fichier `.apk`. Le livreur se connecte avec le compte créé dans
Administration → Livreurs (téléphone, matricule, code livreur ou email).

### 5.1 Notifications sur le téléphone du livreur (Firebase)

Application fermée ou téléphone verrouillé, le livreur reçoit une notification
sonore (son « Alertes RUNEX », vibration) quand :

| Événement | Notification |
|---|---|
| Tournée créée pour lui, ou réaffectée à lui | « Nouvelle tournée » |
| Tournée confiée à un autre livreur | « Tournée retirée » |
| Colis ajouté / retiré de sa tournée | « Colis ajouté à votre tournée » / « Colis retiré de votre tournée » |
| Colis affecté, modifié (montant, quantité), retourné | selon l'événement |
| Ramassage affecté | « Ramassage à collecter » |
| Encaissement validé, transfert inter-dépôt reçu | selon l'événement |

Toucher la notification ouvre l'écran concerné ; application ouverte, les
écrans se rechargent seuls.

Mise en place (une fois) :
1. console.firebase.google.com → **Créer un projet** `runex` (Google Analytics inutile).
2. **Ajouter une application → Android** : nom du package `tn.runex.driver` →
   **Enregistrer** → télécharger `google-services.json` → le placer à la racine
   de `runex-driver-app` et le committer (identifiants publics, prévus pour être
   dans l'application).
3. ⚙ **Paramètres du projet → Comptes de service → Générer une nouvelle clé
   privée** : un fichier JSON se télécharge. **Secret** : jamais dans un dépôt.
4. Sur le Mac : `base64 -i ~/Downloads/<fichier>.json | pbcopy`, puis sur
   Render, variable `FIREBASE_SERVICE_ACCOUNT_JSON` = coller. **Supprimer
   `PUSH_ENABLED`** si elle vaut `false`. Après redéploiement, le journal
   affiche `[Push] FCM initialisé (project: runex-…)`.
5. Recompiler l'APK (`versionCode` déjà augmenté) et le réinstaller ; à la
   connexion, accepter « Autoriser RUNEX Driver à envoyer des notifications ».

## 6. Mises à jour

| Changement | Action |
|---|---|
| Code web | fusion sur `main` → Vercel redéploie |
| Code API | fusion sur `main` → Koyeb reconstruit et redéploie (arrêt propre : websockets fermés, 10 s max) |
| Schéma (`prisma/migrations`) | le workflow « Migrations production » s'exécute à la fusion ; vérifier qu'il est vert **avant** d'utiliser les nouveaux écrans |
| Application livreur | `versionCode` + 1 dans `app.json`, nouveau build EAS, distribuer l'APK (il s'installe par-dessus l'ancien) |
| Rotation des secrets JWT | changer les deux variables sur Koyeb : toutes les sessions sont fermées, chacun se reconnecte |

## 7. Liste de contrôle finale

- [ ] `/api/v1/health` : ok, base `up`
- [ ] `/api/v1/docs` et `/api/v1/auth/demo-users` : 404 / liste vide
- [ ] `runex_app` sans `superuser` / `createrole` / `neon_superuser` (sortie de `db:app-role`)
- [ ] connexion administrateur depuis `https://<projet>.vercel.app` sur téléphone ; cloche de notifications active
- [ ] 10 mauvais mots de passe → 429 (limitation de débit active)
- [ ] livreur : installation de l'APK, connexion, tournée, scan, livraison
- [ ] secrets saisis uniquement dans Koyeb / GitHub Secrets, jamais dans le dépôt

## 8. Sauvegardes et limites

- **Sauvegarde hebdomadaire** (le gratuit Neon ne restaure que 6 h en arrière) :
  `pg_dump "<adresse directe neondb_owner>" -Fc -f runex-$(date +%F).dump`, à conserver hors de Neon.
- Quotas gratuits : 100 h de calcul Neon par mois suffisent à une journée de
  travail de ~8 h sur 22 jours ouvrés avec la veille automatique ; surveiller
  le tableau de bord Neon. Le passage aux offres payantes (Neon Launch, Koyeb
  Eco, Vercel Pro) ne demande aucune modification du code.
- E-mail de réinitialisation du mot de passe non branché : un administrateur
  réinitialise le mot de passe depuis Administration → Utilisateurs.
- Notifications sur les téléphones : uniquement avec `FIREBASE_SERVICE_ACCOUNT_JSON`
  (§ 5.1). Certains fabricants (Xiaomi, Huawei, Oppo…) retardent les applications
  en arrière-plan : réglages du téléphone → Batterie → RUNEX Driver → « Aucune restriction ».

## 9. Audit de sécurité final (octobre 2026)

### Corrigé dans cette version

| Gravité | Constat | Correction |
|---|---|---|
| Élevée | Derrière un hébergeur, toute l'API voyait l'adresse du relais : limitation de débit globale et audit inutilisable | 1 relais approuvé par défaut en production ; contrôle par `GET /health/network` (admin) |
| Élevée | Aucun moyen sûr d'initialiser la production (le seed crée des comptes aux mots de passe publics) | `npm run db:bootstrap` : un administrateur choisi, mot de passe robuste exigé |
| Élevée | Next.js 16.3.7 vulnérable (avis de sécurité élevé) | 16.3.8 |
| Élevée | Web : websocket impossible en mode relais, et la socket n'était plus jamais reconnectée après expiration du jeton (15 min) | URL absolue imposée au build ; jeton relu à chaque connexion, rotation + reconnexion automatiques |
| Élevée | APK sans adresse d'API visait une adresse de développement ; http accepté | HTTPS obligatoire dans un build de production, message bloquant sinon |
| Moyenne | PBKDF2 synchrone (100 000 itérations) bloquait l'API pendant chaque connexion | Calcul asynchrone, 210 000 itérations, ré-hachage transparent des anciens mots de passe |
| Moyenne | Pas de verrouillage par compte (seulement par adresse) | Verrouillage temporaire après échecs répétés sur un même identifiant |
| Moyenne | Adresse d'audit lue dans `X-Forwarded-For` (falsifiable) | `req.ip`, qui applique le nombre de relais approuvés |
| Moyenne | `PORT` des hébergeurs ignoré | `PORT` prioritaire sur `API_PORT` |
| Moyenne | API connectée avec le rôle propriétaire du schéma | Rôle `runex_app` sans DDL, journal d'audit en ajout seul |
| Moyenne | Un livreur ou un agent web déconnecté à la moindre coupure réseau pendant le renouvellement du jeton | Déconnexion seulement si l'API refuse la session |
| Moyenne | Écran `_dev/components` et données de démonstration accessibles dans l'APK | Désactivés hors développement |
| Faible | Réutilisation d'un jeton de rafraîchissement sans révocation de la session | Session révoquée (hors fenêtre de 60 s des requêtes concurrentes) |
| Faible | Agent de dépôt pouvant lire la tournée active d'un livreur d'un autre dépôt | Filtré par dépôt |
| Faible | Jeton websocket accepté dans l'URL (journaux d'accès) | `auth.token` uniquement |
| Faible | Arrêt bloqué par les websockets ouverts (redéploiement lent) | Fermeture ordonnée, arrêt forcé à 10 s |
| Faible | Sessions expirées jamais purgées | Purge au démarrage puis quotidienne |
| Faible | Lien de suivi mal encodé → erreur 500 au scan | Refus propre « étiquette illisible » |
| Faible | Comparaison en temps constant pouvant lever une exception | Longueurs vérifiées avant comparaison |
| Info | `/health` exposait la durée de fonctionnement et le nombre de connexions | Masqués en production ; `/health/live` sans base |
| Info | Pas de `connect-src` dans la CSP du web | `connect-src` limité à l'API déclarée |
| Info | Contexte Docker sans `.dockerignore` (risque d'embarquer un `.env`) | `.dockerignore` |
| Info | APK : sauvegarde Android et permissions inutiles | `allowBackup: false`, micro/stockage/superposition bloqués |

### Risques acceptés

- Jetons du web dans `localStorage` (pas de cookie) : un XSS pourrait les lire.
  Atténué par React (échappement), `connect-src` limité à l'API, jeton d'accès de 15 min.
- Dépendances signalées par `npm audit` restantes : CLI Prisma (`effect`,
  `deepmerge-ts`, utilisée seulement au build et aux migrations) et
  `firebase-admin` → `uuid` (fonction concernée non utilisée). Correctifs
  uniquement par rétrogradation majeure : à revoir à la prochaine version.
- Une seule instance d'API (état en mémoire) : adapté à l'offre gratuite.

### Vérifications effectuées

API lancée en `NODE_ENV=production`, rôle `runex_app`, base migrée par un rôle
propriétaire distinct, sans Redis :
`qa:security` 116/116 (limitation de débit active), `qa:scan` 51/51,
`qa:interdepot` 84/84, `qa:sounds` 22/22, socket temps réel 3/3,
parcours web en production (origine distincte, CSP sans violation, socket
reconnectée après expiration du jeton), e2e de l'application livreur 70/70,
`db:bootstrap` (refus d'un mot de passe faible, création, idempotence).
Non vérifiable dans l'environnement de test : la construction de l'image Docker
(registre Docker Hub inaccessible) — elle est faite par Koyeb au premier déploiement.
