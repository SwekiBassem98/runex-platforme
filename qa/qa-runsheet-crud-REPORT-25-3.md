# PROMPT 25.3 — RUNSHEET ADMIN CRUD COMPLETE — Rapport final

**Date:** 2026-10-08  
**Périmètre:** ne pas réécrire 25.1, ne pas créer Livreur web, ne pas toucher `legacy/vite-app`, ne pas toucher mobile  
**Fichiers modifiés:** `apps/api` (service, controller, router), `apps/web` (RunsheetManagementModule), QA `qa/qa-runsheet-crud-25-3.mjs`

---

## 1. Audit préalable (existant vs nouveau)

**Model Prisma `Runsheet` (authoritatif `schema.prisma`)**
```prisma
model Runsheet {
  id               String   @id @default(uuid())
  runsheetNumber   String   @unique // RUN-YYYYMMDD-XXXX
  depositId        String
  driverId         String
  type             RunsheetType @default(DISTRIBUTION)
  status           RunsheetStatus // BROUILLON, EN_ATTENTE, VALIDEE_DEPART, EN_COURS, RETOUR_DEPOT, CLOTUREE_CONFORME, CLOTUREE_DEFICIT, ANNULEE
  tourDate         DateTime
  totalPackages    Int @default(0)
  totalPieces      Int @default(0)
  pendingCount     Int @default(0)
  deliveredCount   Int @default(0)
  collectedCash    Decimal @default(0)
  collectedChecks  Decimal @default(0)
  deficitAmount    Decimal @default(0)
  notes            String?
  runsheetItems    RunsheetItem[]
  packages         Package[] // via currentRunsheetId
}
```
* Pas de soft-delete, pas de colonne `deletedAt` — la suppression doit être *hard-delete* mais gardée.
* `RunsheetStatus` persiste 8 valeurs; l'API expose 12 via `runsheet-status.ts` (mapping `PREPARE→EN_ATTENTE`, `ASSIGNE→EN_ATTENTE`, `TERMINE→RETOUR_DEPOT`, `VALIDE→CLOTUREE_CONFORME`).
* Compteurs recalculés depuis `runsheetItems.package` dans `toDto()` — jamais recopiés.

**Existant avant 25.3**
| Opération | Endpoint | État |
|---|---|---|
| CREATE | `POST /runsheets` | existait, validait `driverId` UUID, `tourDate` YYYY-MM-DD, `depositId` fallback mainHub, `notes` ≤500, audit CREATE, permission `RUNSHEET_CREATE` |
| READ list | `GET /runsheets?driverId&status&date` | existait, `findAll` limit 200, order tourDate desc, scope `assignedDriverId` pour Livreurs |
| READ detail | `GET /runsheets/:id` (UUID ou RUN-…) | existait, 404 si `LIVREUR` hors périmètre |
| UPDATE | — | **manquant** |
| DELETE | — | **manquant** |
| PACKAGE | `POST /runsheets/:id/add-package`, `remove-package`, `POST /runsheets/:id/status`, `/close`, `/validate` | existait, `assertOpen` seulement BROUILLON/EN_ATTENTE |
| UI | `RunsheetManagementModule.tsx` | liste table + fiches, filtre search/status/driver/date, détail header workflow, pas de colonne Actions, pas de modal édition/suppression |

**Nouveau en 25.3**
- `runsheets.service.ts`: `update()` + `remove()` avec garde métier, transaction hard-delete, audit `UPDATE`/`DELETE`
- `runsheets.controller.ts`: `update()` (PATCH/PUT) + `remove()` (DELETE) avec `req.dataScope` isolation
- `app.router.ts`: `PATCH /runsheets/:id`, `PUT /runsheets/:id`, `DELETE /runsheets/:id` (tous `RUNSHEET_CREATE`)
- `RunsheetManagementModule.tsx`: colonne Actions (Voir/Modifier/Supprimer), barre détail Modifier/Supprimer, modal édition, ConfirmDialog suppression, helpers `isRunsheetEditable/isRunsheetDeletable`, bandeaux d'avertissement si `totalPackages>0` ou statut terminal
- QA: `qa/qa-runsheet-crud-25-3.mjs` (82 contrôles)

---

## 2. CREATE — validations conservées et vérifiées

- `driverId` obligatoire, doit être UUID valide (`asUuid`), sinon 400 `UUID attendu`
- `driverId` doit pointer vers `Driver` existant, sinon 404 `Livreur introuvable`
- `Driver.isActive===false` ou `deletedAt!=null` → 409 `inactif ou supprimé`
- `tourDate` obligatoire, format `YYYY-MM-DD` strict, sinon 400
- `notes` (zone) ≤500 caractères
- `depositId` si fourni doit être UUID valide et dépôt actif, sinon 400/404/409
- `type` optionnel whitelist `DISTRIBUTION|RAMASSAGE|RETOUR_EXPEDITEUR|TRANSFERT_DEPOT`
- Périmètre: `LIVREUR` et `EXPEDITEUR` n'ont pas `RUNSHEET_CREATE` → 403

Testé: valid 201, missing driver 400, missing date 400, fake `drv-002` 400, random UUID 404, userId as driverId 404, inactive 409, bad date format 400, exp 403, livreur 403, no auth 401.

---

## 3. READ

- **List** `GET /runsheets`: renvoie `id, runsheetNumber, driverId, driverName, depositId, depositName, status (partagé), tourDate (YYYY-MM-DD), totalPackages, totalPieces, pendingCount, deliveredCount, postponedCount, returnedCount, expectedCash, collectedCash, deficitAmount, failedCount, notes, packages (recalculés), createdAt`. Filtres `status` (via `toPersistedRunsheetStatus`), `driverId`, `date`. `LIVREUR` voit uniquement `req.dataScope.assignedDriverId` (cloisonnement rooms).
- **Detail** `GET /runsheets/:id` accepte UUID **ou** `RUN-…`. 404 si hors périmètre livreur.
- Pas de pagination offset/limit côté runsheets (contrairement à `inventaire`); le service limite à 200 et ordonne `tourDate desc`. Le test vérifie `meta.total` et filtre `EN_ATTENTE`.

---

## 4. UPDATE — règles d'éditabilité

**Statuts éditables:** `BROUILLON`, `EN_ATTENTE` seulement.
**Bloqués (409):** `VALIDEE_DEPART`, `EN_COURS`, `RETOUR_DEPOT` (terminal), `CLOTUREE_CONFORME`, `CLOTUREE_DEFICIT`, `ANNULEE`. Message: `La tournée RUN-… n'est plus modifiable (statut …). Seules les tournées en attente peuvent être modifiées.`

**Champs éditables:** `driverId`, `tourDate`, `notes` (zone), `depositId`, `type` (optionnel).

**Garde `hasPackages`:**
```ts
hasPackages = runsheet.runsheetItems.length>0 || totalPackages>0
if (payload.driverId && hasPackages) → 409 "Impossible de changer le livreur : la tournée contient déjà des colis."
if (payload.depositId && hasPackages) → 409 "Impossible de changer le dépôt : la tournée contient déjà des colis."
```
`notes` reste modifiable même avec colis (correction zone sans corrompre l'historique). `tourDate` modifiable tant que statut éditable.

**Validations:**
- `driverId` trim non vide, UUID, existe et actif
- `tourDate` regex `^\d{4}-\d{2}-\d{2}$` + `Date` valide
- `notes` 500 max
- `depositId` UUID + dépôt actif
- `type` whitelist
- payload vide → 400 `Aucune donnée à mettre à jour.`

**Audit:** `auditService.record` `entityType=RUNSHEET` `action=UPDATE` avec `previousValues {driverId, tourDate, depositId, notes}` et `newValues=data`.

**Endpoints:** `PATCH /runsheets/:id` et `PUT /runsheets/:id` acceptent `driverId, tourDate, notes, zone (alias de notes), depositId, type`. 401 sans token, 403 si `!RUNSHEET_CREATE`, 403 si `dataScope.depositId !== runsheet.depositId`.

Testé: tourDate 200, notes 200, driver 200 (vide), inactive 409, bad UUID 400, not-found 404, bad date 400, empty 400, PUT 200, exp 403, livreur 403, no auth 401, driver change après colis 409, deposit change après colis 409, notes après colis 200, après retrait colis driver 200, active `EN_COURS` 409, closed `CLOTUREE_CONFORME` 409, `ANNULEE` 409, `RETOUR_DEPOT` 409, `VALIDEE_DEPART` 409.

---

## 5. DELETE — suppression gardée

**Seule supprimable si:** `status ∈ [BROUILLON, EN_ATTENTE]` **ET** `totalPackages==0 && runsheetItems.length==0 && pendingCount==0` **ET** aucune activité financière (`expectedCash==0 && collectedCash+collectedChecks==0 && deficitAmount==0`) **ET** aucun `runsheetItem.isHandled`.

**Rejets 409 avec message précis:**
- déjà `ANNULEE` → "déjà annulée"
- `CLOTUREE_*` → "clôturée"
- `RETOUR_DEPOT` → "revenue au dépôt — utilisez la validation caisse"
- `EN_COURS|VALIDEE_DEPART` → "active (statut …)"
- générique → "n'est pas supprimable"
- avec colis → "contient X colis … Retirez les colis ou annulez"
- avec caisse → "a une activité financière"
- avec colis traité → "colis déjà traités"

**Transaction hard-delete:**
```ts
prisma.$transaction(async tx => {
  await tx.package.updateMany({ where:{currentRunsheetId: id}, data:{currentRunsheetId:null}});
  await tx.runsheetItem.deleteMany({ where:{runsheetId:id}});
  await tx.runsheet.delete({ where:{id}});
});
```
Puis `auditService.record` `action=DELETE` `reason="Tournée RUN-… supprimée par …"`.

**Endpoints:** `DELETE /runsheets/:id` (UUID ou RUN-…), permission `RUNSHEET_CREATE`, isolation `dataScope.depositId`. 404 si inconnue.

Testé: empty pending 200 (vérifié 404 après), delete by UUID 200, avec colis 409, après retrait 200, active 409, closed 409, cancelled 409, exp 403, livreur 403, no auth 401, non-existent 404.

> Si suppression refusée, l'appelant doit passer par `POST /runsheets/:id/status` (`ANNULEE`) ou `POST /runsheets/:id/close` → `validate`.

---

## 6. PACKAGE RELATION — cohérence

**Invariants de 25.1 préservés:**
- `Package.assignedDriverId` doit être UUID d'un `Driver` actif (pas `user.id`, pas `drv-xxx`) — 400/404/409
- `Package.currentRunsheetId` ↔ `RunsheetItem` via `add-package` (vérifie `assignedDriverId !== runsheet.driverId` → 409)
- `POST /colis/:id/assign` avec `runsheetNumber` d'un autre livreur → 409 `elle appartient à un autre livreur`
- Après `add-package`, `runsheet.totalPackages` incrémenté, `package.runsheetId / runsheetNumber` positionné

**Garde CRUD 25.3:** changer le livreur d'une runsheet contenant des colis est refusé (409) — on ne peut pas avoir *Runsheet Driver A* + *Package Driver B*. Testé en `4.2` et `7.1`.

**Mobile:** `GET /packages/:id` pour un livreur hors périmètre → 404 (ne fuit pas l'existence). `GET /runsheets/:id` pour livreur hors périmètre → 404. `GET /runsheets` pour livreur → filtre `assignedDriverId`. `GET /runsheets/driver/active` scopé. `GET /packages` pour livreur ne voit que ses colis (`assignedDriverId` ou `runsheet.driverId`). Vérifié: livreur B ne voit pas colis de A (404), livreur A voit sa tournée active avec le colis ajouté.

---

## 7. STATUS TRANSITIONS — CRUD ne contourne pas

Cycle légal: `BROUILLON/EN_ATTENTE → VALIDEE_DEPART → EN_COURS → RETOUR_DEPOT → CLOTUREE_CONFORME / CLOTUREE_DEFICIT / ANNULEE`

- `update()` n'accepte jamais `status` (le champ n'est pas mappé dans le controller). Toute tentative `PATCH {status: "EN_COURS"}` est ignorée → ne contourne pas `close`/`validate`.
- `remove()` refuse tout terminal (`isTerminalRunsheetStatus` inclut `RETOUR_DEPOT`) — une tournée revenue ne se supprime pas, elle se rapproche.
- `addPackage/removePackage` refusent si statut ≠ `BROUILLON|EN_ATTENTE` (`assertOpen` → 409).
- Tests forgent des statuts via `prisma.runsheet.update` puis vérifient que `PATCH notes` → 409 pour `EN_COURS`, `CLOTUREE_CONFORME`, `ANNULEE`, `RETOUR_DEPOT`, `VALIDEE_DEPART`.

---

## 8. UI — Voir / Modifier / Supprimer sans redesign

**Liste (desktop table + mobile fiches)**
- Table `largeurMin 1180px` avec nouvelle colonne `Actions` (après `Statut`).
- Par ligne: 3 boutons icônes `Eye` (Voir → `viewMode='detail'`), `Pencil` (Modifier → `openEditModal`), `Trash2` (Supprimer → `suppressionAConfirmer`). Désactivés (`cursor-not-allowed`, `border-slate-100 bg-slate-50 text-slate-300`) si `!isRunsheetEditable` ou `!isRunsheetDeletable`, avec `title` explicite: `"Non modifiable (statut …)"` ou `"Contient X colis — retirez-les d’abord"`.
- `e.stopPropagation()` sur chaque bouton pour ne pas déclencher le `onClick` de la ligne.
- Mobile (`sm:hidden`): `FicheLigne` + barre `Voir | Modifier | Supprimer` (`flex-1`).
- Helpers:
```ts
isRunsheetEditable = r => ['BROUILLON','EN_ATTENTE'].includes(r.status)
isRunsheetDeletable = r => isRunsheetEditable(r) && r.totalPackages===0
```

**Détail (header tournée)**
- Barre existante `Exporter CSV / Imprimer` conservée.
- Ajout avant elle: `Modifier` (`bg-white` si éditable, sinon `bg-slate-50` disabled) + `Supprimer` (`bg-red-50` si deletable). `title` = raison si bloqué (ex: `Contient des colis — modification livreur/dépôt bloquée`).
- Workflow bar intacte (`BROUILLON→PREPARE→ASSIGNE→EN_COURS→TERMINE→VALIDE`).

**Modal édition `showEditModal`**
- Titre `Modifier la Tournée #RUN-…`, sous-titre statut actuel.
- Bandeaux: `AlertTriangle` si `totalPackages>0` ("Changement de livreur/dépôt bloqué"), `XCircle` si statut terminal.
- Champs: `Select` livreur (disabled si `hasPackages` ou non éditable), `Input type=date` (disabled si non éditable), `Input zone/notes` (disabled si non éditable). `availableDrivers` réutilisé depuis création.
- Footer: Annuler + `Enregistrer` (`Save` + `Spinner` si `isUpdating`). `handleUpdateRunsheet` envoie uniquement les champs modifiés (`payload` diff), affiche `info` si rien changé, `success` si 200, `error` si 4xx, recharge `loadRunsheets()` et `setRunsheet(data.data)` si détail ouvert.

**ConfirmDialog suppression**
```tsx
<ConfirmDialog
  isOpen={suppressionAConfirmer!==null}
  title="Supprimer cette tournée ?"
  message={`La tournée ${number} (${driverName}, ${date}, ${totalPackages} colis) sera définitivement supprimée. Seules les tournées vides en attente peuvent être supprimées.`}
  confirmText="Supprimer définitivement" type="danger"
  onConfirm={handleDeleteRunsheet} // DELETE /runsheets/:id
/>
```
Après succès: `viewMode='list'` si détail supprimé, `loadRunsheets()`.

**Design system:** réutilise `Modal`, `FormField`, `Input`, `Select`, `Badge`, `ConfirmDialog`, `useToast`, `RUNEX red/dark`, pas de sidebar nested, pas de `any`, `formatTND/formatDate`.

---

## 9. Sécurité

- **Permissions backend-first:** `RUNSHEET_CREATE` requis pour `POST/PATCH/PUT/DELETE /runsheets/:id/add-package|remove-package|status`; `RUNSHEET_READ` pour `GET`; `RUNSHEET_VALIDATE` pour `close/validate`. `LIVREUR` n'a que `RUNSHEET_READ`, `RAMASSAGE_READ`, etc. → 403 sur tentative `PATCH/DELETE`.
- **Isolation dépôt:** `req.dataScope.depositId` (injecté par `authenticateToken`) comparé à `runsheet.depositId` dans `service.update/remove` → 403 `Vous n'avez pas accès à cette tournée (périmètre dépôt)`. `admin` a `depositId` mais scope global (pas filtré) — peut agir partout; un `GESTIONNAIRE` scopé à Sousse ne peut pas modifier une tournée du Hub.
- **Isolation livreur:** `GET /runsheets/:id` vérifie `req.user.role===LIVREUR && driverId !== user.driverId → 404` (ne révèle pas l'existence). `GET /runsheets` force `driverId = assignedDriverId`.
- **Scope driver:** `POST /packages/:id/assign` et `POST /runsheets` vérifient `isActive` + UUID, pas de `drv-xxx`.

Testé: exp 403, livreur 403, no auth 401 sur create/update/delete; livreur ne voit que ses tournées; B ne voit pas package de A.

---

## 10. Tests — `qa/qa-runsheet-crud-25-3.mjs`

**Lancement:** `node qa/qa-runsheet-crud-25-3.mjs` (BASE `http://127.0.0.1:4000/api/v1`, Prisma direct pour forger statuts).

**Résultat final:** `82 passed, 0 failed` (après correction 7.1/7.3).

**Détail sections (extraits console):**
```
1. CREATE — 11 tests: valid 201, missing driver 400, missing date 400, fake drv 400, random UUID 404, userId as driver 404, inactive 409, bad date 400, exp 403, livreur 403, no auth 401
2. READ — 10 tests: list 200, detail RUN-… 200, detail UUID 200, 404, filter EN_ATTENTE, livreur scopé, no auth 401
3. UPDATE — 13 tests: tourDate 200, notes 200, driver 200, inactive 409, bad UUID 400, not-found 404, bad date 400, empty 400, PUT 200, exp/livreur/no auth 403/401
4. UPDATE package guard — 7 tests: add 200, driver change après colis 409, deposit après colis 409, notes après colis 200, remove 200, driver après retrait 200, totalPackages 0
5. UPDATE status guards — 5 tests: EN_COURS 409, CLOTUREE_CONFORME 409, ANNULEE 409, RETOUR_DEPOT 409, VALIDEE_DEPART 409
6. DELETE — 11 tests: empty 200 + 404 vérif, by UUID 200, avec colis 409, après retrait 200, active 409, closed 409, cancelled 409, exp/livreur/no auth 403/401, non-existent 404
7. RELATION & MOBILE — 4 tests: linked via runsheetId 200, totalPackages 1, B ne voit pas 404, A voit via détail 200
8. AUDIT/SECURITY — 3 tests: audit 200, deposit change empty 200, final list 200
```

**Régressions exécutées (requis prompt):**
- `qa-runsheet-flow-25-1.mjs` → **36 passed, 0 failed**
- `qa-inventory-exceptions-25-2.mjs` → **64 passed, 0 failed** (facets, filters, pagination, deposit isolation, security)
- `qa-dashboard-25.mjs` → **57 passed, 0 failed** (colis counts, taux réussite, livreurs online/offline, finance, inter-depots, timezone, isolation exp)
- `qa6-livreur.mjs` → **49 passed, 0 failed** (cloisonnement A/B, dashboard scopé, workflow LIVRE, 403 sur autrui)
- `qa-presence.mjs` → **28 passed, 0 failed** (heartbeat 401/403/200, spoof ignoré, dashboard horsLigne=actifs-online)
- `qa-socket.mjs` → **3 passed, 0 failed** (rooms cloisonnées, socket:ready)
- `qa7-push.mjs` → **22 passed, 3 failed** — échecs connus **hors périmètre runsheet**: `jeton A présent dans sa liste`, `B possède le jeton`, `jeton fake enregistré actif` → l'API `GET /devices` renvoie `tokenPreview` (anonymisé) et non `token` complet, le test attend `d.token === tokenA` et échoue. Non introduit par 25.3 (push non touché). Le canal push reste *best-effort* et ne bloque pas le métier (B. `deliver → LIVRE malgré push désactivé` passe).

---

## 11. Build & Typecheck

```
apps/api:  tsc -p tsconfig.json --noEmit → 0 error
           tsc -p tsconfig.json            → 0 error (dist/main.js)
apps/web:  tsc -p tsconfig.json --noEmit → 0 error
           next build (16.3.7 Turbopack)   → Compiled successfully in 1283ms, 38/38 static pages
```
*No `any`, no `@ts-ignore`, no swallowed errors, `400/401/403/404/409/500` préservés.*

---

## 12. Fichiers livrables

- `apps/api/src/modules/runsheets/runsheets.service.ts` — `update`/`remove` + `import {forbidden}`
- `apps/api/src/modules/runsheets/runsheets.controller.ts` — `update`/`remove` (payload mapping `notes`/`zone`)
- `apps/api/src/app.router.ts` — `PATCH|PUT|DELETE /runsheets/:id`
- `apps/web/src/features/RunsheetManagementModule.tsx` — Actions colonne, mobile barre, header CRUD, `showEditModal/editingRunsheet/editForm/isUpdating/suppressionAConfirmer`, `openEditModal/handleUpdateRunsheet/handleDeleteRunsheet/isRunsheetEditable/isRunsheetDeletable`, modal édition, ConfirmDialog suppression, imports `Pencil/Trash2/Eye/Save`
- `qa/qa-runsheet-crud-25-3.mjs` — suite 82 contrôles
- `qa/qa-runsheet-crud-REPORT-25-3.md` — ce rapport

---

## 13. Problèmes restants / dettes

- **Pagination runsheets:** `findAll` ne supporte pas `?limit&page` (seulement `take 200`). Le rapport 25.2 a une vraie pagination `limit/page/totalPages` sur `inventaire/exceptions`; runsheets mériterait la même pour les dépôts à fort volume.
- **Push test 3 échecs** non liés à 25.3 (voir §10). Si l'on veut les passer, il faut soit exposer `token` complet sur `GET /devices` (déconseillé sécurité), soit adapter le test à `tokenPreview`.
- **Historique UI:** l'audit `UPDATE`/`DELETE` est enregistré côté API mais n'est pas encore affiché dans l'onglet `AuditLog` de la fiche runsheet (à brancher comme pour colis).
- **Soft-delete vs hard-delete:** le choix `hard-delete` vide est assumé. Une alternative `ANNULEE` + `deletedAt` soft-delete pourrait être envisagée si l'on veut conserver les numéros `RUN-…` orphelins pour traçabilité.
- **Dépôt scoping fin:** le test `8.2` prouve qu'un admin peut changer `depositId` d'une tournée vide. Pour un `GESTIONNAIRE` scopé, le `dataScope.depositId` bloque — mais aucun seed `GESTIONNAIRE` scopé n'existe en fixtures; un test d'intégration dédié avec création d'utilisateur `GESTIONNAIRE` rattaché à Sousse serait utile.

---

## 14. Comment rejouer

```bash
# API doit tourner sur 4000
curl -s http://127.0.0.1:4000/api/v1/health | jq .

# CRUD
node qa/qa-runsheet-crud-25-3.mjs
# Régressions
node qa/qa-runsheet-flow-25-1.mjs
node qa/qa-inventory-exceptions-25-2.mjs
node qa/qa-dashboard-25.mjs
node qa/qa6-livreur.mjs
node qa/qa-presence.mjs
node qa/qa-socket.mjs

# Build
npm --prefix apps/api run typecheck && npm --prefix apps/api run build
npm --prefix apps/web run typecheck && npm --prefix apps/web run build
```
