# RUNEX — durcissement (Prompt 26) et mise en production

Ce document résume ce que la branche `fix/prompt-26-hardening` change, comment
déployer sans réintroduire les failles corrigées, et ce qui reste ouvert.

## 1. Ce qui a changé

### Authentification et sessions
- Chaque jeton porte un identifiant de session (`sid`) adossé à la table
  `Session`. Chaque requête HTTP **et** chaque connexion Socket.IO vérifie que la
  session existe, n'est pas révoquée, et que le compte (et son livreur /
  expéditeur) est toujours actif. Déconnexion, désactivation, changement de rôle
  ou de mot de passe prennent effet immédiatement.
- Le rafraîchissement fait tourner le refresh token sur la même session
  (compatible avec l'application mobile : `driverId = Driver.id` inchangé).
- Réinitialisation de mot de passe par lien signé à usage unique ; aucun jeton
  n'est journalisé en production.
- Un compte sans rôle n'est plus promu `LIVREUR` par défaut ; un livreur sans
  fiche, un expéditeur sans société, un agent sans dépôt sont refusés (403).
- Comptes de démonstration : liste vide sauf `ENABLE_DEMO_ACCOUNTS=true` hors
  production. Le seed refuse `NODE_ENV=production`.
- En production, l'API refuse de démarrer avec un secret JWT faible (< 32
  caractères, valeur de `.env.example`) ou deux secrets identiques.

### Autorisations (RBAC / périmètre)
- Actions de terrain (livrer, partielle, échange, report, retour, échec,
  démarrage) : livreur propriétaire du colis, ADMIN ou GESTIONNAIRE uniquement.
- Agent de dépôt limité à son dépôt (colis, réception, tournées, transferts côté
  source / destination). Livreur limité à ses transferts.
- Expéditeur limité à ses rapports (colis, expéditeurs, finance) ; l'IP et le
  navigateur du journal d'audit ne sont visibles qu'avec `AUDIT_READ`.
- Un administrateur ne peut ni changer son propre rôle ni se désactiver.

### Intégrité métier
- Écritures de statut colis atomiques (mise à jour conditionnelle) : deux
  opérations concurrentes ne peuvent pas réussir toutes deux (409).
- Dernier kilomètre (livraison, partielle, report, échec, retour) en une seule
  transaction : statut, tentative, encaissement. Les notifications partent après
  validation.
- Numéros séquentiels (PAY / RUN / RET / CLI) sous verrou consultatif.
- Tournées : cycle réel `BROUILLON → EN_ATTENTE → EN_COURS → RETOUR_DEPOT →
  CLOTUREE_*` (ou `ANNULEE`), départ atomique, clôture et validation de caisse.
- Transferts inter-dépôts : identifiants répétés refusés, réceptions
  concurrentes impossibles, colis en transit retirés du stock source.
- Index de performance restaurés (migration `20261010000000_restore_indexes`).

### Surface HTTP
- En-têtes de sécurité API (nosniff, DENY, CSP, HSTS en production, no-store
  sur `/auth`) et web (X-Frame-Options, CSP `frame-ancestors 'none'`, etc.).
- Limitation de débit : échecs de connexion (8 / 15 min par e-mail + IP),
  connexions par IP, rafraîchissement, réinitialisation, code secret des bordereaux.
- Erreurs : aucun détail interne (Prisma, SQL) ne sort en réponse ; entrées
  malformées (UUID, octets nuls, JSON invalide) → 400, jamais 500.
- Swagger masqué en production sauf `ENABLE_API_DOCS=true`.
- `keepAliveTimeout` de l'API (65 s) supérieur à celui des relais : supprime les
  500 « socket hang up » derrière Next.js / nginx.

### Web
- Adaptateur `createApiFetch` : en-têtes normalisés. Auparavant, chaque
  POST/PUT des écrans Tournées et Gestion des colis envoyait
  `Content-Type: application/json, application/json`, ignoré par l'API (400) :
  les étapes de tournée et la création de colis échouaient depuis l'interface.
- « Nouveau colis » de l'exploitation : choix obligatoire de l'expéditeur
  (l'API refusait toute création faute d'expéditeur).
- Garde d'accès par écran selon les permissions ; livreur et expéditeur
  redirigés hors du back-office.

## 2. Déploiement

```bash
cp .env.example .env    # puis renseigner de VRAIS secrets
export POSTGRES_PASSWORD=… JWT_ACCESS_SECRET=$(openssl rand -hex 32) \
       JWT_REFRESH_SECRET=$(openssl rand -hex 32) CORS_ORIGIN=https://ops.exemple.tn \
       NEXT_PUBLIC_API_URL=https://api.exemple.tn/api/v1
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Le service `migrate` applique `prisma migrate deploy` avant le démarrage de
l'API. L'image API tourne en utilisateur non-root avec un HEALTHCHECK.

Points à respecter :
1. **Rôle base de données non superutilisateur** pour l'API
   (`API_DATABASE_URL`). Un superutilisateur contourne les protections du
   journal d'audit (voir `docker/postgres/01-audit-owner.sql`,
   `scripts/audit-ownership.sql`).
2. Derrière un reverse proxy : `TRUST_PROXY=true` (et `TRUST_PROXY_HOPS`), sinon
   la limitation de débit voit l'IP du proxy.
3. Ne jamais définir en production : `ENABLE_DEMO_ACCOUNTS`,
   `PASSWORD_RESET_LOG_TOKEN`, `RATE_LIMIT_DISABLED`.
4. `NEXT_PUBLIC_API_URL` est figée au build du web.
5. Push mobile : `PUSH_ENABLED=true` + identifiants Firebase ; des identifiants
   invalides désactivent le canal sans bloquer l'API.

## 3. Vérification

| Commande | Contenu |
|---|---|
| `npm run qa:security` | 116 contrôles sécurité (API) |
| `npm run qa:interdepot` | transferts inter-dépôts |
| `npm run qa:runsheet-ui` / `qa:colis-ui` | parcours cliqués dans le back-office |
| `npm run qa` | suites historiques (API + écrans) |
| `qa/regression/*` | suites des prompts 24–25 (voir leur README) |

## 4. Limites connues

- Limitation de débit et passerelle temps réel **en mémoire** : correctes pour
  une instance ; plusieurs instances demandent un stockage partagé (Redis) et
  l'adaptateur Socket.IO Redis.
- L'e-mail de réinitialisation n'est pas branché (le lien est produit, pas envoyé).
- Réception inter-dépôts en écart : seul le nombre reçu est saisi, pas *quels*
  colis manquent ; tous les colis du lot sont placés au dépôt d'arrivée.
- Les bordereaux PDF serveur n'existent pas (impression navigateur uniquement).
- Le WebSocket n'est pas relayé quand le web utilise le relais `API_PROXY_TARGET`
  (`next start`) : servir le web avec une `NEXT_PUBLIC_API_URL` absolue, ou
  relayer `/socket.io` au niveau du reverse proxy.
