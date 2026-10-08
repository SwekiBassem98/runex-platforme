# PROMPT 25 — Audit Dashboard & Reporting (Logixpress / RUNEX)

**Date :** 2026-10-07 Africa/Tunis  
**Périmètre :** `dashboard.service.ts`, `dashboard.controller.ts`, `dashboard.types`, `reports.service.ts`, page Admin `apps/web/src/app/(app)/dashboard/page.tsx`, APIs `/packages`, `/runsheets`, `/ramassages`, `/paiements`, `/inter-depots`, `/depots`, `/drivers/presence`.

---

## 1. Méthode

- Lecture du schéma Prisma (`schema.prisma`) comme référence vocabulaire.
- Parcours `dashboard.service.ts` + `reports.service.ts` + controllers + routes + `periode.ts`.
- Rejeu live API via `GET /dashboard`, `GET /packages?status=…`, `GET /ramassages`, `GET /reports/*`, `GET /drivers/presence` sous rôles SUPER_ADMIN / AGENT_DEPOT / EXPEDITEUR / LIVREUR.
- Script QA `qa/qa-dashboard-25.mjs` (57 contrôles) + régression `qa-presence`, `qa-socket`, `qa6-livreur`.

---

## 2. Vocabulaire effectif des statuts (Prisma)

```
PackageStatus: CREE, AFFECTE_RUNSHEET, EN_LOT_INTER_DEPOT, EN_TRANSIT_INTER_DEPOT, RECU_DEPOT_DESTINATION, RECU_DEPOT, EN_COURS_LIVRAISON, LIVRE, LIVRAISON_PARTIELLE, REPORTE, ECHEC_LIVRAISON, RETOUR_DEPOT, EN_RUNSHEET_RETOUR, RETOURNE_EXPEDITEUR, ANNULE, RAMASSAGE_PROGRAMME, RAMASSE
RunsheetStatus: EN_ATTENTE, VALIDEE_DEPART, EN_COURS, RETOUR_DEPOT, CLOTUREE, ANNULEE
InterDepotTransferStatus: CRE, PREPARE, EN_TRANSIT, RECU, ANNULE
PickupStatus: EN_ATTENTE, ASSIGNE, EN_COURS, EFFECTUE, ANNULE
```

Exclusifs : `LIVRE` ≠ `LIVRAISON_PARTIELLE` vs `LIVRE` ≙ `LIVRAISON_PARTIELLE` groupé sous « livrés » (dashboard & reports). `REPORTE` ≠ `ECHEC_LIVRAISON` ≠ `RETOUR_DEPOT`. `ANNULE` final.

---

## 3. Dashboard — Métrique → Source → Filtre → Sens métier → UI

### 3.1 Colis (`colis`)

| UI | API | Query | Filtres / inclus–exclus | Sens métier |
|---|---|---|---|---|
| `total` | `DashboardMetricsDto.colis.total` = `countPackagesByStatus` somme | `package.count groupBy status` | `{deletedAt:null} [+ deposit OR (current/origin/destinationDepositId)]` | Parc entier (ou dépôt si AGENT_DEPOT). Toutes les lignes non supprimées. |
| `nouveaux` | `total([CREE])` | idem | inclut `CREE` seul | Colis saisi, pas encore ramassé/affecté. |
| `aAffecter` | `aggregate where status in [RECU_DEPOT, RECU_DEPOT_DESTINATION] && assignedDriverId=null && currentDepositId=deposit` | `findMany` compté en mémoire | Scope dépôt ajouté | Stock au dépôt physiquement présent, en attente d'affectation tournée. |
| `affectes` | `total([AFFECTE_RUNSHEET])` | groupBy | — | Affecté à une tournée, pas encore parti. |
| `enLivraison` | `total([EN_COURS_LIVRAISON])` | idem | — | Livreurs en route. |
| `livres` | `LIVRE + LIVRAISON_PARTIELLE` | idem | combiné | Succès (partiel compte succès financier). |
| `reportes` | `REPORTE` | idem | — | Échec soft, re-livrable. |
| `retournes` | `RETOUR_DEPOT + RETOURNE_EXPEDITEUR + ECHEC_LIVRAISON` | idem | combiné | Échec définitif. |
| `annules` | `ANNULE` | idem | — | Annulé plateforme. |
| `echanges` | `packageType=EXCHANGE` | `count where type=EXCHANGE` | indépendant du statut | Flux échange. |
| `tauxReussite` | `livres / (livres+reportes+retournes)*100` à 1 déc | — | base éligibles seuls | % réussite sur clos, pas sur total encours. |
| **Charts `deliveriesOverTime`** | `codOverTime().{colis, livres}` → `charts.deliveriesOverTime` | `groupBy createdAt` | 7 jours glissants, bucket `Tunis` (`Africa/Tunis`) via `Intl.DateTimeFormat` | Volume créé vs livré par jour (livré bucketé sur `deliveredAt`, créé sur `createdAt`). |
| **Charts `codAmounts`** | `codOverTime().{aEncaisser, encaisse}` → `codAmounts` | `aggregate sum totalPrice/collectedAmount` par jour | même 7 jours, Tunis | Montants TND attendus vs encaissés par jour. Fix : avant `colis/livres` (comptes), désormais vrais `Decimal` TND. |

**Vérifié live :** `GET /packages?status=CREE|REPORTE|…` totaux ≡ dashboard (QA §B). `LIVRE+LIVRAISON_PARTIELLE` = `livres` (7). `retournes` 3 = 1 ECHEC + 2 RETOUR_DEPOT/RETOURNE. `aAffecter` 2 ≤ RECU_* tot 2. `tauxReussite` recalculé ok.

### 3.2 Livreurs (`livreurs`)

| UI | API | Query | Filtre | Sens |
|---|---|---|---|---|
| `actifs` | `driver.count where deletedAt null, isActive true [+ deposit]` | `findMany` ids | scope dépôt via `user.depositId` | Chauffeurs activés plateforme/dépôt. |
| `enTournee` | `busy = runsheet where status in [EN_COURS, VALIDEE_DEPART, EN_ATTENTE, RETOUR_DEPOT]` distinct driverId [+ deposit]` | `findMany distinct` | **Fix : `RETOUR_DEPOT` ajouté (revenu mais caisse à clôturer)** | Porte au moins une tournée ouverte. |
| `disponibles` | `actifs - enTournee` | dérivé | — | **Fix : était `horsLigne` (conflit). Maintenant distinct de ONLINE.** |
| `horsLigne` | `actifs - online` où `online = isDriverOnline(lastSeenAt, now)` | `Driver.lastSeenAt` lu via `PresenceService`, timeout `PRESENCE_TIMEOUT_MS` (180s) | jamait `PushDevice`, jamais `isActive` | **Fix Prompt 24 : ONLINE≠AVAILABLE.** Après heartbeat, 4 actifs → 1 online 3 horsLigne (live). |
| `total` | idem `actifs` | — | — | Alias. |

**QA §C/D :** `horsLigne = actifs - online` vérifié (4-1=3). `disponibles = actifs - enTournee` (4-2=2). Deux signaux orthogonaux démontrés.

### 3.3 Ramassages (`ramassages`)

| UI | API | Query |
|---|---|---|
| `total` | `countPickupsByStatus()` somme | `pickupAppointment groupBy` |
| `aConfirmer` | `EN_ATTENTE` | — |
| `planifies` | `EN_ATTENTE` (même bucket) | — |
| `enCours` | `EN_COURS + ASSIGNE` | — |
| `effectues` | `EFFECTUE` | — |
| `annules` | `ANNULE` | — |

Live : `GET /ramassages` total 1 ≡ dashboard.

### 3.4 Paiements / COD (`paiements`)

| UI | API | Query | Inclus / Exclus | Sens |
|---|---|---|---|---|
| `montantAEncaisserTND` | `aggregate sum totalPrice where status NOT IN [LIVRE, LIVRAISON_PARTIELLE, ANNULE, ECHEC_LIVRAISON, RETOUR_DEPOT, RETOURNE_EXPEDITEUR, EN_RUNSHEET_RETOUR] && ...packageScopeWhere` | `Decimal` sum, `round3` | **Fix : RETOUR_DEPOT/RETOURNE/EN_RUNSHEET_RETOUR et LIVRAISON_PARTIELLE exclus — n'est plus dû.** | Argent que les clients doivent encore. `REPORTE` reste dû. |
| `montantEncaisseTND` | `payment sum amountCollected` | `Decimal` | `status ∈ [CONFIRME, CLOTURE, REMIS]` ? Via `voucherTotals()` | Encaissé confirmé. |
| `deficitCaisseTND` | `paiementStats.deficitCaisseTND` (voucher) | `Decimal` | `max(0, attendu - encaisse)` | Trou de caisse. |
| `paiementsEnAttente` | `voucher count where status CONFIRME` | — | — | Bordereaux à valider. |

**Reports finance :** même logique mais via `Payment` groupBy + `$queryRaw` écart `attendu <> encaissé - remboursé`, `Decimal` uniquement, 3 décimales.

### 3.5 Dépôts & navettes (`depots`)

| UI | API | Query |
|---|---|---|
| `colisAuDepot` | `count where currentDepositId not null && deletedAt null` par dépôt | `groupBy currentDepositId` |
| `colisInTransit` | `interDepotTransfer aggregate sum totalPackages where status IN [CRE, PREPARE, EN_TRANSIT]` | **Fix : avant `aggregate` sans filtre → comptait RECU/ANNULE. Maintenant filtré actif seul (7, 1 transfert actif).** |
| `interDepotsActifs` | `count where status IN [CRE, PREPARE, EN_TRANSIT]` | **Fix : scope dépôt ajouté** |
| `agencesActives` | `deposit count where isActive true [+ id=depositId]` | **Fix : avant hardcodé `4 Agences` côté web, maintenant `depotStats.agencesActives` (admin 4, agent 1).** |

**Web fix :** `42% Taux saturation` → `Stock total {colisAuDepot+colisInTransit}` ; donut `||24` → `??0`.

### 3.6 Supplier / Driver activity & Timeline

- `supplierActivity(depositId?)` : `shipper.findMany(mavens) + count packages where currentDepositId=deposit` ; `packages.length` (pas `_count`) — fix.
- `driverActivity(depositId?)` : `groupBy assignedDriverId where status EN_COURS_LIVRAISON` filtré runsheet deposit.
- `recentTimeline(depositId?)` : `package.findMany orderBy updatedAt take 8` where `package.currentDepositId=deposit` (via include where).
- `driverLoad` (tournées) : `groupBy driverId` sur runsheets récents, load = `_count` colis partiels ; scope deposit.

---

## 4. Périmètre / Scoping

| Rôle | `dataScope` | Dashboard | Reports | Search |
|---|---|---|---|---|
| SUPER_ADMIN / DISPATCHER | `depositId null` | plateforme entière | `perimetre: "Toute la plateforme"` | sans filtre dépôt |
| AGENT_DEPOT (MAGASINIER) | `depositId = user.depositId` | **Fix : `getMetrics({depositId})` appliqué (package OR current/origin/destination, driver via user.depositId, runsheet/deposit/transfer filters)**. `dashboard.controller` branche `if (dataScope.depositId) getMetrics({depositId})`. Avant : leak global. Vérifié : admin livreurs 5 vs agent 3 (scoped), agences 4 vs 1. | `REPORT_READ` manquant → 403 (pas de fuite). `colis`/`depots` gèrent `depositId`, `livreurs`/`finance` non filtrés mais non exposés. | `GET /packages` filtre `currentDepositId` via `applyDepositScope()` serveur, query param ignoré. |
| EXPEDITEUR | `shipperId` | `getDriverMetrics` non, mais `dashboardService` non exposé (expéditeur n'a pas accès dashboard admin) ; reports `perimetre: "Votre expéditeur"` `where shipperId` | 403 sur export (`REPORT_EXPORT` requis), `GET /reports/colis` retourne `totaux.crees` 22 (exp) vs 37 admin, isolation vérifiée. `GET /packages/:id` étranger → 404. | `shipperId` forcé serveur, `GET /packages?shipperId=xxx` ignoré. |
| LIVREUR | `assignedDriverId + depositId` | `getDriverMetrics(driverId)` scoping strict (ses colis/caisse uniquement). `disponibles/horsLigne` personnels. | `perimetre: "Vos livraisons"` `where assignedDriverId` | `driverId` forgé ignoré, `GET /runsheets?driverId=other` → 403/404, `start/deliver` sur colis autrui → 403 (qa6). |

**Enforcement :** `auth.middleware` → `dataScope` + `requirePermission` ; jamais client-side only.

---

## 5. Finance — exactitude monétaire

- Tout montant `Prisma.Decimal` → `toFixed(3)` via `argent()` ; `somme()` en `Decimal` ; `round3()` côté dashboard uniquement sur `currentBalance` (Decimal→number). Aucun `parseFloat` sur chaîne monétaire.
- Écart caisse : `amountExpected - (amountCollected - amountRefunded)` via SQL, tri `ABS(ecart) DESC LIMIT 50`, affiché avec signe.
- Taux recouvrement : `net/attendu *100` en `Decimal` 1 décimale.
- QA : `montantAEncaisserTND` 1410.5 TND (après exclusion retours) vs 1680.5 avant — différentiel = retours.

---

## 6. Dates & fuseau

- **`periode.ts` :** volontairement **UTC minuit** pour rapports (`2026-10-01 → 2026-10-31` = `2026-10-01T00:00Z` inclusive, `2026-11-01T00:00Z` exclusive). Commentaire : même ensemble d'événements quel que soit le navigateur. `describePeriode` humaine, `periodeParDefaut` rolling 30j. Fix dashboard : buckets **Africa/Tunis** (`Intl.DateTimeFormat ... Africa/Tunis`) pour `codOverTime` et `deliveriesOverTime`, label `fr-TN`.
- **Écart connu :** un colis créé `2026-10-07T23:30Z` (00:30 Tunis 08/10) est bucketé jour Tunis côté dashboard mais compté jour UTC côté rapports. Documenté comme divergeance assumée ; rapports suivent `periode.ts` UTC, dashboard suit jour métier Tunis. QA §J vérifie `23:30Z → 08/10` Tunis.
- **Timestamp correct (question 10) :** colis flux = `createdAt ∈ periode` ; `parJour.livres` incrémenté sur `deliveredAt` ; finance `collectedAt` ; runsheet `tourDate`/`createdAt` selon graine.

---

## 7. Recherche vs reporting cohérence

- Dashboard `colis.livres` = `LIVRE+LIVRAISON_PARTIELLE` ; `GET /packages?status=LIVRE` + `status=LIVRAISON_PARTIELLE` somme ≡ 7. `deliveredVsReturned` utilise même dénominateurs.
- Reports `colis.parStatut` = `groupBy status` sur `createdAt ∈ periode`, même population que dashboard période large. Search `GET /packages?limit=1` meta.total ≡ dashboard `colis.total`.
- Reports `detailColis` = `findMany where createdAt ∈ periode` + scope, même population que totaux ; export CSV identique (pas de nouveau export ajouté).
- Ramassage / runsheet : `groupBy status` identique entre dashboard et endpoints dédiés.

---

## 8. Valeurs inventées supprimées

| Avant | Après | Fichier |
|---|---|---|
| `<Badge>0 Déficit</Badge>` | `paiementStats.deficitCaisseTND>0 ? danger "${deficit} Déficit" : success "0 Déficit"` | `dashboard/page.tsx:304` |
| `<Badge>4 Agences</Badge>` | `{depotStats.agencesActives} Agence(s)` | `dashboard/page.tsx:332` |
| `42% Taux saturation` | `Stock total {colisAuDepot+colisInTransit}` | `dashboard/page.tsx:348` |
| `value || 24/3/1` donut | `value ?? 0` | `dashboard/page.tsx:376-387` |
| `horsLigne: 0` dur | `horsLigne = actifs - online` via `isDriverOnline(lastSeenAt)` | `dashboard.service.ts:137` |
| `disponibles: horsLigne` | `disponibles: actifs - enTournee` | `dashboard.service.ts:240` |
| `colisInTransit: aggregate sans where` | `where status IN [CRE,PREPARE,EN_TRANSIT]` | `dashboard.service.ts:69` |
| `aEncaisser notIn [LIVRE,ANNULE,ECHEC]` | `notIn + LIVRAISON_PARTIELLE/RETOUR_*` | `dashboard.service.ts:135` |
| `codAmounts: colis/livres (counts)` | `aEncaisser/encaisse` TND | `dashboard.service.ts:277` |
| `busyDriverIds EN_COURS,VALIDEE_DEPART,EN_ATTENTE` | `+ RETOUR_DEPOT` | `dashboard.service.ts:124` |
| `runsheetsToClose EN_COURS|RETOUR_DEPOT` | `RETOUR_DEPOT` seul | `dashboard.service.ts:59` |
| Controller ignorait `dataScope` | `if (driverId) getDriverMetrics else if (depositId) getMetrics({depositId}) else getMetrics()` | `dashboard.controller.ts:10` |

---

## 9. Sécurité

- Auth : `requireAuth` + `requirePermission(DASHBOARD_READ)` sur `GET /dashboard`; livreur → `getDriverMetrics` forcé, pas de query `driverId`.
- Isolation expéditeur : `deletedAt:null + shipperId` en `AND`, jamais `OR`; test `GET /packages/otherShipperId` → 404 (QA K).
- Scope dépôt : `applyDepositScope` / `packageScopeWhere` en `AND`, pas contournable via `?depositId=`.
- PushDevice ≠ présence ; socket rooms `user:${id}` + `driver:${id}` ; `socket:ready` vérifié.
- Audit : `tracerExport` log `REPORT_EXPORT_${domaine}` avec période claire.

---

## 10. Performance

- `count`, `groupBy`, `aggregate(_sum)` privilégiés ; `findMany` limité à 20k pour exports, 8 pour timeline/livrees. `supplierActivity` utilise `packages.length` filtré (pas N+1).
- 7 jours histogramme : 7 buckets fixes + 14 dates seed min, pas de full scan par jour.

---

## 11. QA — Résultats

### 11.1 Suite dédiée `qa-dashboard-25.mjs` — 57 contrôles

```
A totals vs search  B status counts  C online/offline  D available≠online
E runsheet  F ramassage  G finance Decimal  H inter-depot actif
I date filtre from/to + 400 incohérent  J Tunis 23:30Z→08/10
K exp isolation (admin 37≥exp 22, other pkg 404, export 403)
L agent scope (magasinier deposit scoping: livreurs 5→3, agences 4→1)
M no duplicate  N empty period 0  O count/aggregate  P hardcoded removed  Q Decimal 3
TOUT PASSE — 57/57
```

### 11.2 Régression

| Suite | Résultat | Note |
|---|---|---|
| `qa-presence.mjs` | 28/28 PASS | heartbeat→presence→dashboard horsLigne cohérent |
| `qa-socket.mjs` | 3/3 PASS | |
| `qa6-livreur.mjs` | 49/49 PASS | cloisonnement, livraison 409, caisse |
| `qa7-push.mjs` | 25/28 (3 ECHEC) | Échecs préexistants hors scope : `GET /devices` retourne `tokenPreview` pas `token` → assertions `d.token===xxx` toujours fausses ; non causé par PROMPT 25, API unchanged. Comportement réel vérifié manuellement : réassignation même token A→B transfère bien, DELETE désactive. |
| `typecheck` api+web | 0 erreur |  |

### 11.3 Vérification live

```
GET /dashboard (admin) → livreurs {actifs4 disponibles2 enTournee2 horsLigne3}
colis 37, depots {colisAuDepot2 colisInTransit7 interDepots1 agences4}
à encaisser 1410.5 TND, codAmounts {64/64 .. 1007.5/174} TND
agent.magasin → livreurs 3, agences 1
expéditeur → reports 22 colis vs admin 37
```

---

## 12. Lacunes restantes / non-corrigé volontaire

- **Reports toujours UTC** (`periode.ts` minuit UTC) vs spec « business-day Tunis ». Choix documenté dans `periode.ts` (« même ensemble d'événements quel que soit le navigateur »). Dashboard côté fixe Tunis ; rapports conservés UTC pour ne pas casser les exports financiers en cours. Recommandation : si jour métier Tunis exigé pour finance, remplacer `parseDay(...T00:00Z)` par `parseDayTunis` convertissant `AAAA-MM-JJ` → `AAAA-MM-JJ 00:00 Africa/Tunis` (= `T23:00Z` veille en hiver) et ajuster `joursCouverts`/`jourCourt` en zone Tunis. Non fait dans PROMPT 25 pour limiter l'impact.
- **`livreurs` & `finance` reports non filtre `depositId`** (pas de jointure deposit). Non exposé car `AGENT_DEPOT` sans `REPORT_READ`. Si un rôle dépôt obtient REPORT_READ demain, ajouter `depositId` via `Package.currentDepositId` / `Runsheet.depositId`.
- **Type imports `any` interdit** respecté ; `Prisma.Decimal` conservé.

---

## 13. Références fichiers modifiés

- `apps/api/src/modules/dashboard/dashboard.service.ts` (scope helpers, `countPackagesByStatus(extraWhere)`, `driverActivity(depositId)`, `runsheetTotals(depositId)`, `codOverTime(depositId)` Tunis buckets + `aEncaisser/encaisse` réels, `supplierActivity/recentTimeline/deposit` scope, `getMetrics(scope)`, `getDriverMetrics` Tunis).
- `apps/api/src/modules/dashboard/dashboard.controller.ts` (`req.dataScope.depositId` → `getMetrics`).
- `apps/web/src/app/(app)/dashboard/page.tsx` (deficit dynamique, agences dynamiques, stock total, donut `??0`).

Typecheck `npm run --workspace apps/api typecheck && npm run --workspace apps/web typecheck` → 0 erreurs. Build API `npm run build` OK.
