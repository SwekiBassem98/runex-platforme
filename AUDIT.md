# RUNEX — Full Project Audit

Repository: `https://github.com/SwekiBassem98/runex-web.git`
Cloned to: `/home/user/runex-web`
State at audit: branch `main`, **1 commit** (`183b8a8 Initial commit`), **clean working tree**, in sync with `origin/main`.
Size: 256 tracked files, ~69k lines of tracked source (4.4 MB).

No prior coding-agent work is present — there is nothing to reconcile with. `git status --short --branch` returns only `## main...origin/main`.

---

## 1. What was verified by running it

| Command | Result |
| --- | --- |
| `npm install` | 270 packages, exit 0 |
| `npx prisma validate` | `The schema at prisma/schema.prisma is valid` |
| `npx prisma generate` | Prisma Client v6.19.3 generated |
| `npm run build:packages` | `@logixpress/types` + `@logixpress/config` compile, exit 0 |
| `npm run typecheck` | **All 5 workspaces clean** (api, web, config, types, ui) |
| `npm run build:api` | `tsc` emits `apps/api/dist`, exit 0 |
| `npm run build:web` | Next.js 16.3.7 (Turbopack), compiled in 14.9s, **35 routes**, 0 errors |
| `node apps/api/dist/main.js` | Boots without Postgres/Redis, serves `/api/v1/health` |

The API boot was a real execution, not a compile check. `/api/v1/health` returned:

```json
{"status":"degraded","services":{"api":{"status":"up"},
 "database":{"status":"down","message":"Can't reach database server at `localhost:5432`"},
 "redis":{"status":"down","required":false},"realtime":{"status":"up","sockets":0}}}
```

`/api/v1/nope` → `{"success":false,"message":"Ressource introuvable."}` (global 404 works).
`GET /api/v1/colis` unauthenticated → **401** (auth guard works).

**Not verified:** anything requiring PostgreSQL. There is no Postgres in this sandbox (`/usr/lib/postgresql` absent, Docker absent). So **no migration was applied, no seed ran, no QA script was executed, and no login was performed.** Every runtime claim below about business behaviour comes from reading code, not from executing it.

---

## 2. Architecture as actually implemented

npm-workspaces monorepo. Workspaces are `apps/*` and `packages/*` **only**.

```
apps/api      Express 4 + Prisma 6 + PostgreSQL 16 + Redis 7 (optional) + Socket.IO
apps/web      Next.js 16 App Router + React 19 + Tailwind 4 + recharts
packages/types    domain enums, DTOs, package state machine, notification & audit catalogues
packages/config   APP_CONFIG: currency TND, timezone Africa/Tunis, 24 governorates, ports
packages/ui       design system, shipped as SOURCE (main: ./src/index.ts), not compiled
packages/tsconfig base / api (CommonJS) / nextjs (bundler)
prisma/       schema.prisma (33 models, 14 enums) + 14 migrations + seed.ts
legacy/vite-app   archived — has NO package.json, so it is not a workspace and is never built
docker/       postgres/01-audit-owner.sql (creates NOLOGIN role audit_owner)
scripts/      10 shell + 11 node verification harnesses wired to npm run qa:*
```

The README is unusually accurate — it already documents the role/enum divergence, the permission gap on `postpone`/`partial-delivery`/`exchange`, the unfiltered `GET /payments/vouchers`, and the zeroed `livreurs.horsLigne`. Those are real and I confirmed each in code.

### Three experiences — all present and correctly separated

| Experience | Entry | Shell | Guard |
| --- | --- | --- | --- |
| Admin / exploitation | `/connexion` | `components/AppLayout.tsx` → `AppShell` | `RequireAuth` in `app/(app)/layout.tsx` |
| Expéditeur | `/expediteur/login` | `features/expediteur/shell/CoquillePortail.tsx` | `RequireExpediteur` + `I18nProvider` in `app/expediteur/(portail)/layout.tsx` |
| Livreur | no web UI | — | API only: `driverId` scoping, `RAMASSAGE_DRIVER_ACTIVE`, `requireRoles(LIVREUR)` |

`/expediteur` is **not** in the admin sidebar (`NAV_ROUTES` in `AppLayout.tsx`, documented as deliberate at line 38). There is no fake "Portail Expéditeur" button in the live admin nav.

### Layout safety — currently correct

The documented regression class (duplicated/nested sidebars) is not present. `CoquillePortail` instantiates **exactly one** `Sidebar` and explains why in a comment (lines 127–146): the component renders either an in-flow `<aside>` (`hidden lg:flex`) or an overlay (`lg:hidden`), so it must never be instantiated twice. The root is `flex`, the sidebar is the first in-flow child, content is `flex-1 min-w-0`, and there is **no** `lg:pl-64`. `<main>` has `overflow-y-auto overflow-x-hidden` with a comment on why both axes must be set. A `matchMedia('(min-width: 1024px)')` listener resets `menuOuvert` so overlay and desktop state cannot desync. Preserve all of this.

### Authoritative state machine

`packages/types/src/package-workflow.ts` is the single source of truth, enforced server-side by `apps/api/src/modules/colis/package-workflow.service.ts`, which is the **only** writer of `Package.status`. It holds three invariants in one transaction: legality (`PACKAGE_STATUS_TRANSITIONS`, 409 with the list of allowed exits), justification (`PACKAGE_TRANSITION_REQUIREMENTS`, 400 naming what is missing), traceability (status + `PackageTimeline` + `AuditLog` written together).

17 package statuses — more than a simple `CREE→…→LIVRE` chain: `RAMASSAGE_PROGRAMME`, `RAMASSE`, `EN_LOT_INTER_DEPOT`, `EN_TRANSIT_INTER_DEPOT`, `RECU_DEPOT_DESTINATION`, `LIVRAISON_PARTIELLE`, `REPORTE`, `ECHEC_LIVRAISON`, `RETOUR_DEPOT`, `EN_RUNSHEET_RETOUR`, `RETOURNE_EXPEDITEUR` are all live. `canTransition` gates every one.

### Authorisation — genuinely backend-enforced

- `authenticateToken` derives `req.dataScope` from the JWT: `EXPEDITEUR`→`{shipperId}` (**403 if the token has no shipperId**, rather than an unfiltered query), `LIVREUR`→`{assignedDriverId}`, `AGENT_DEPOT`→`{depositId}`, else `{}`.
- Scoping is applied inside `ColisService.buildWhere`, not in the controller — a query-string `shipperId` cannot widen it.
- `features/expediteur/lib/client.ts` deliberately omits `shipperId` from its filter type so no screen is tempted to send one.
- `assertDriverOwnsPackage` / `assertShipperOwnsPickup` re-check ownership at write time; `/colis/:id/audit` resolves through `findById(scope)` first so a foreign tracking number yields an indistinguishable 404.
- Cash aggregates require `PAYMENT_CASH_READ` (not `PAYMENT_READ`), so an expéditeur keeps its own vouchers but cannot see platform treasury.

### API surface

All under `/api/v1`. Canonical + historical alias for each business route (`/colis`≡`/packages`, `/ramassages`≡`/pickups`, `/inter-depots`≡`/inter-depot`, `/depots`≡`/deposits`), both mapped to the same controllers. OpenAPI is served at `/docs` and `/docs/json`. No duplicate endpoint implementations were found.

### Ramassages — already correct on the point you flagged

`actualPickedCount` is **recomputed server-side** from `prisma.package.count({ pickupAppointmentId })` in `syncPackages`; `packageEstimate` is never overwritten. `PickupAppointment.packages` is a real relation (`Package.pickupAppointmentId`), and `syncPackages` refuses foreign-shipper packages, deleted packages, and packages already attached to another pickup. Transition table: `A_CONFIRMER→EN_ATTENTE→ASSIGNE→EN_COURS→EFFECTUE`, `ANNULE` reachable until closure, `EFFECTUE`/`ANNULE` terminal. Overlap validation on the slot exists in `create`.

### i18n — one system, correctly scoped

`fr` default, `ar` true RTL via `document.documentElement.dir`. Applied **only** to `/expediteur` (`SURFACES_I18N`), including its login, so the French-only back-office is never mirrored. A pre-paint inline script (`i18n/premier-rendu.ts`, generated by interpolating `config.ts`) sets `lang`/`dir` before first paint to avoid a mirror flash. Arabic uses `ar-TN-u-nu-latn` so amounts stay in Latin digits. No database value is translated; statuses go through `PACKAGE_STATUS_LABELS`.

### Money

`Decimal(10,3)`/`(12,3)` in Postgres; `round3` before write so the partial-delivery closure constraint holds; `troisDecimales` in `packages/ui` formats from the string without a float round-trip; `Money = string` for payment DTOs. `58.5 − 40.1` is handled.

### Audit immutability

DB-level, not just app-level: `20261003120000_audit_immutability` installs a `BEFORE UPDATE OR DELETE` trigger raising `restrict_violation`, revokes `UPDATE,DELETE` from the app role, and adds non-blank CHECKs. `docker/postgres/01-audit-owner.sql` creates a `NOLOGIN` `audit_owner` role; `scripts/audit-ownership.sql` completes the ownership transfer.

---

## 3. Findings

Reported, not fixed — none of these block an ordinary feature task, and fixing them is your call.

### F1 — `features/ExpediteurPortal.tsx` (2244 lines) is dead code
Nothing imports it (`grep -rn "ExpediteurPortal" src/` matches only its own definition). The live portal is `app/expediteur/(portail)/*` + `features/expediteur/*`. It still contains the old single-page "Header Portail Expéditeur" tab UI at lines 692 and 735. Risk: a future agent greps for "expediteur", finds 2244 lines of plausible-looking code, and edits the wrong implementation. `ColisManagementModule` and `RunsheetManagementModule` in the same folder **are** live (mounted by `/colis` and `/runsheets`).

### F2 — Admin/GESTIONNAIRE "deliver from the back-office" looks broken (unverified)
`POST /colis/:id/deliver` is guarded by `requireAnyPermission(COLIS_DELIVER, COLIS_UPDATE)`, so ADMIN and GESTIONNAIRE reach `ColisService.markDelivered`. `assertDriverOwnsPackage` returns immediately for non-`LIVREUR`, so they pass every guard — then hit `colis.service.ts:1180`:

```ts
this.prisma.driver.update({ where: { id: user.driverId! }, ... })
```

An ADMIN/GESTIONNAIRE has no `driverId`, so `id` is `undefined`. Same shape at `:1306` and `:1316` (`validatedByDriverId: user.driverId!` in `markPartialDelivery`). The QA suite never reaches this: the three `$ADMIN` `/deliver` calls in `verify-package-workflow.sh` (lines 225, 406) and `api-smoke-test.sh:154` all assert **409**, i.e. they are rejected by the state machine before the driver write. **Not verified** — no database was available to execute it.

### F3 — The last migration drops five indexes that four earlier ones created
`20261006114135_init_local_run` issues `DROP INDEX` for:

| Index | Created by | In `schema.prisma`? |
| --- | --- | --- |
| `AuditLog_entity_timestamp_idx` | `20261003120000_audit_immutability` | no |
| `AuditLog_user_timestamp_idx` | `20261003120000_audit_immutability` | no |
| `Deposit_managerId_idx` | `20260929183500_depots_and_interdepot_lifecycle` | no |
| `Package_receivedByUserId_idx` | `20261003110000_depot_reception` | no |
| `Package_status_depot_idx` | `20261003100000_package_identity` | no |

None is declared in the Prisma schema, so `prisma migrate dev` treated them as drift and removed them. Net effect on a fresh `migrate deploy`: the indexes are created and then dropped — the audit screen's by-entity and by-actor filters, and the package status×deposit query, lose their intended coverage. This is schema drift between hand-written SQL and `schema.prisma`, and it will recur on the next `migrate dev` unless the indexes are either declared in the schema or the drop is reverted.

### F4 — `PACKAGE_STATUS_LABELS` is defined twice with different wording
Present in both `packages/types/src/package-status.ts` and `packages/types/src/package-workflow.ts`, e.g. `RECU_DEPOT_DESTINATION` → "Arrivé en agence" vs "Reçu au dépôt de destination"; `ECHEC_LIVRAISON` → "Échec ou refus" vs "Échec de livraison". It resolves deterministically (the explicit re-export at `index.ts:15` wins over `export * from './package-workflow'`), so nothing is broken today — but the duplicate is a trap for anyone editing labels.

### F5 — Two role vocabularies, deliberately unreconciled
API/token/permissions use `ADMIN, GESTIONNAIRE, EXPEDITEUR, LIVREUR, AGENT_DEPOT, FINANCE`. Prisma/`Role` table uses `SUPER_ADMIN, ADMIN_GENERAL, DISPATCHER, MAGASINIER, CAISSIER, EXPEDITEUR_ADMIN, EXPEDITEUR_USER, LIVREUR`. Only `LIVREUR` is common. `seed.ts` maps between them (`ROLE_MAP`), and `notifications/audience.ts` carries a long comment warning that mixing them silently notifies nobody. The README says the product decided to keep both. Do not "fix" this without an explicit decision.

### F6 — Known permission gap (already in the README, confirmed)
`/colis/:id/postpone`, `/partial-delivery` and `/exchange` are now `requireAnyPermission(COLIS_DELIVER, COLIS_UPDATE)`, which is what the router comment at line 210 says was done to make them usable from the field. `LIVREUR` holds `COLIS_DELIVER`, so the README's stated gap appears to have been closed for these three — the README is stale on this point. Worth a decision either way.

---

## 4. Conventions to follow when we start changing things

- **State changes** go through `packageWorkflowService.transition(...)` (or `annotate(...)` for an act with no status change). Never write `Package.status` directly.
- **Notifications** go through `notificationDispatcher.notify({ event: NotificationEvent.… })`. Never a second architecture. Legacy `NotificationType` values exist only for rows already in the DB — do not emit them.
- **Audit** via `auditService.record(...)`; it accepts an optional `Prisma.TransactionClient` to enlist in the caller's transaction.
- **Money** through `Prisma.Decimal` / `toDecimal` / `round3`; format with `formatTND`.
- **Routes**: add the canonical path, and add the alias to the existing array constant if the route already has one.
- **Types**: extend `packages/types`, then `npm run build:packages` before the API/web typecheck sees them.
- **Layouts**: one sidebar per shell. `CoquillePortail` is the only Expéditeur shell; `AppLayout` is the only admin shell.
- **Errors**: `BusinessRuleError` / `notFound` / `badRequest` / `conflict` / `forbidden` from `common/errors/api-error.ts`; `respondError` in controllers. Codes are already 400/401/403/404/409/500-correct.

### Useful commands

```bash
npm run typecheck          # all 5 workspaces           [verified green]
npm run build:api          # tsc -> apps/api/dist       [verified green]
npm run build:web          # next build, 35 routes      [verified green]
npx prisma validate        # schema                     [verified green]
npm run prisma:seed        # idempotent demo data       [NOT RUN — needs Postgres]
npm run qa                 # 16 harnesses end-to-end    [NOT RUN — needs Postgres]
npm run qa:formateurs      # tsx scripts/verify-formateurs.ts  [NOT RUN]
```

Demo accounts from `seed.ts`: `admin@logixpress.tn / Admin123!`, `gestionnaire@logixpress.tn / Gest123!`, `agent.magasin@logixpress.tn / Agent123!`, `finance@logixpress.tn / Fin123!`, `expediteur@bluestar.tn / Exp123!`, `livreur.hamza@logixpress.tn / Liv123!`.

---

## 5. Coverage — what I actually read

**Read in full:** `package.json`, `.env.example`, `README.md`, all three compose files, `prisma/schema.prisma` (all 1195 lines), `packages/types/{index,package-status,package-workflow}.ts`, `packages/config`, `packages/ui/src/index.ts`, `apps/api`: `main.ts`, `config/env.ts`, `app.router.ts`, `common/auth/*`, `modules/colis/*` (service 1839 lines + controller + workflow service), `common/database/mappers.ts`, `modules/ramassages/ramassages.service.ts`, `modules/notifications/{dispatcher,audience,channels}.ts`; `apps/web`: both layouts + root layout, `app/page.tsx`, `connexion`, `expediteur/login`, `expediteur/(portail)/{layout,page}`, `RequireExpediteur.tsx`, `AppLayout.tsx`, `lib/auth.tsx`, `features/expediteur/lib/client.ts`, `features/expediteur/shell/CoquillePortail.tsx`, `i18n/{config,index,premier-rendu}.ts`; migrations `20261003120000` and `20261006114135`, `docker/postgres/01-audit-owner.sql`.

**Read structurally** (every export, method signature and file-header contract, not every line): all remaining API services/controllers (`dashboard`, `inventory`, `reports`, `inter-depots`, `depots`, `depot/reception`, `search`, `runsheets`, `payments/cash`, `payments`, `audit`, `health`), all `common/*` infrastructure (`audit`, `csv`, `dates`, `errors`, `http`, `swagger`, `validation`, `prisma-context`, `redis`, `realtime.gateway`), all 11 `features/expediteur/*/Vue*.tsx` components, `prisma/seed.ts` role/user/shipper data, the 12 remaining migrations by name and the two that matter, and the QA scripts (grepped for `/deliver` coverage).

**Not read line-by-line:** the three large ported modules (`ColisManagementModule` 2342 lines, `RunsheetManagementModule` 1387, and the dead `ExpediteurPortal` 2244), `legacy/vite-app` (4 source files, archived, not built), `swagger.config.ts` (1184), the `fr`/`ar` dictionaries (674 + 644 — structure verified, keys not enumerated), the `(app)/*` admin page bodies, and the remaining migration SQL bodies.

So: **not literally every line of all 256 files.** Every file that decides architecture, permissions, state, data shape or layout — yes. The two largest UI modules and the archived Vite app — structural only. Say the word if you want those read in full before we start.

---

## 6. Repository state

No source file was modified. No migration was created, no schema touched, no test disabled.

Two tracked files were incidentally rewritten by the toolchain during verification and have been **reverted** (`git checkout --`):

- `package-lock.json` — `npm install` under npm 10.8.2 stripped 84 `"libc": ["glibc"]` entries that a newer npm had written on optional platform-specific packages. Cosmetic, no dependency change.
- `apps/web/next-env.d.ts` — `next build` rewrote the type-reference paths from `.next/dev/types/…` (written by `next dev`) to `.next/types/…`. Generated file; it will be rewritten again by whichever command runs next.

`git status --short --branch` now returns exactly:

```
## main...origin/main
?? AUDIT.md
```

`.env` (copied from `.env.example` so Prisma and the API could read config) and `node_modules/` are both gitignored and do not appear. `apps/api/dist` and `apps/web/.next` build output remain on disk, also gitignored.

**If you re-run `npm install` or `next build` on your own machine, expect those same two diffs.** They are environmental, not defects.
