# Localisation FR/AR et RTL — portail Expéditeur

**Périmètre :** stabilisation et complétion de l'existant. Aucune refonte, aucune
nouvelle couche d'i18n, aucun composant d'architecture remplacé.

**Résultat :** 16 fichiers modifiés, +248 / −40 lignes. `typecheck` (5 workspaces)
et `build:web` verts. 24 contrôles d'exécution au vert. **Une réserve majeure :
aucun navigateur n'était disponible dans cet environnement, donc le contrôle
visuel et responsive exigé n'a pas été fait** — voir section 11.

---

## 1. Ce qui a été inspecté avant d'écrire la moindre ligne

Le système i18n existant a été lu en entier avant toute modification, conformément
à la consigne. Il est sain et a été **réutilisé tel quel** :

| Fichier | Rôle |
|---|---|
| `apps/web/src/i18n/config.ts` | `LANGUES`, `DIR_PAR_LANGUE`, `LOCALE_PAR_LANGUE` (`fr-TN`/`ar-TN`), `CLE_LANGUE`, `SURFACES_I18N` |
| `apps/web/src/i18n/I18nProvider.tsx` | contexte, `t()`, `traduireValeur()`, pose `lang`/`dir` sur `<html>` |
| `apps/web/src/i18n/premier-rendu.ts` | script anti-miroitement exécuté dans `<head>` |
| `apps/web/src/i18n/dictionnaires/{fr,ar}.ts` | les dictionnaires |
| `packages/ui/src/i18n/` | `LibellesUIProvider`, `interpoler` |

**Constat qui contredit l'hypothèse de départ :** les dictionnaires n'étaient
**pas** incomplets. La parité est garantie à la compilation (`ar: Dictionnaire`
avec `Dictionnaire = Record<Cle, string>`) et mesurée à **549/549 clés, 0
manquante, 0 superflue, 0 vide**. Les 14 écrans Expéditeur appelaient déjà
`useI18n()`. Réécrire les dictionnaires ou ajouter une couche aurait été une
régression, pas une amélioration.

Aucune de ces choses n'a été faite : pas de `next-intl`, pas de `react-i18next`,
pas de Zustand/Redux, pas de route AR dupliquée, `features/ExpediteurPortal.tsx`
non touché, `AppLayout` non touché, auth/base/migrations non touchées.

---

## 2. Lacunes réelles de données de domaine (corrigées, FR **et** AR)

Trouvées par exécution, pas par lecture : un script compare chaque famille de
valeurs à sa source de vérité.

| Famille | Avant | Après |
|---|---|---|
| `moyenPaiement` | 2/6 | **6/6** — ajout de `VIREMENT`, `TRAITE`, `CARTE_BANCAIRE`, `PAIEMENT_EN_LIGNE` |
| `gou` | 13/24, dont **2 fausses** | **24/24** |

Les deux clés fausses sont le vrai défaut : `Manouba` et `Medenine` ne
correspondront jamais à `La Manouba` / `Médenine` dans `APP_CONFIG.governorates`.
Invisible en français (le repli rend le même mot), mais l'interface arabe
affichait des noms de gouvernorats **en français**.

Les anciennes valeurs restent traduites même si seuls `ESPECE`/`CHEQUE` sont dans
`PAYMENT_METHOD_REGISTRY` : d'anciens bordereaux peuvent porter les autres.

---

## 3. Terminologie arabe

La consigne donnait un glossaire indicatif. **Le dictionnaire existant a primé**,
comme demandé (« use consistent terminology throughout the entire portal »). Deux
divergences assumées :

| Terme | Glossaire indicatif | Retenu (déjà dans `ar.ts`) |
|---|---|---|
| bordereau | سند | **بوليصة / البوالص** |
| encaissement | — | **تحصيل** |

Reste aligné sur l'existant : طرد (colis), توصيل (livraison), استلام (ramassage),
جولة (tournée), تتبّع (suivi), استبدال (échange), إرجاع (retour), المرسل
(expéditeur). Registre logistique tunisien, pas de traduction littérale.

---

## 4. RTL : propriétés logiques plutôt que remplacement gauche/droite

Aucun remplacement global `left`→`right`. Chaque classe a été convertie en
propriété logique Tailwind, **identique sous `dir=ltr`** — donc zéro risque de
régression admin.

| Fichier | Corrections |
|---|---|
| `Sidebar.tsx` | `-mr-1`→`-me-1`, `text-left`→`text-start`, `ml-2`→`ms-2`, `right-1`→`end-1`, **`left-0`→`start-0`**, `border-r`→`border-e` |
| `SearchInput.tsx` | `left-3`→`start-3`, `pl-9 pr-8`→`ps-9 pe-8`, `right-2`→`end-2` |
| `Modal.tsx`, `Drawer.tsx` | `-mr-1.5`→`-me-1.5` |
| `Card.tsx` | `mr-0.5`→`me-0.5` (×3) |
| `Form.tsx` | `ml-0.5`→`ms-0.5` |
| `ErrorState.tsx` | `ml-2`→`ms-2` |
| `AppShell.tsx`, `CoquillePortail.tsx` | skip-link `focus:left-3`→`focus:start-3` |
| `TopNavigation.tsx` | 8 conversions (`-ms-1`, `start-0`, `text-start`, `end-1`, `end-0`, `ps-2 border-s`, `text-end`) |
| `Toast.tsx` | `sm:left-auto sm:right-4`→`sm:start-auto sm:end-4` |

**Le défaut RTL le plus visible** était `Sidebar.tsx` : le tiroir mobile était
épinglé à `left-0`. En arabe, la barre latérale doit être à droite ; le tiroir
s'ouvrait donc du côté opposé à son bouton. Corrigé par `start-0`.

**Correction d'une erreur que j'avais notée plus tôt :** le `Drawer` est ancré par
`flex justify-end`, il bascule donc déjà à gauche en RTL. Son `border-l` devait
devenir `border-s` ( = `border-left` en LTR, `border-right` en RTL). `border-e`,
comme je l'avais d'abord écrit, **aurait déplacé la bordure du mauvais côté dès le
français**. C'est `border-s` qui est en place.

Aucune marge négative, largeur fixe, position absolue ou `z-index` arbitraire
ajoutés. `Table.tsx` utilisait déjà `start-0` (documenté) : non touché.

---

## 5. Animations et sens d'écriture

`panel-in` translatait de `translateX(16px)` en dur : un panneau ancré au bord
final surgissait du bord opposé en arabe.

Plutôt que dupliquer les keyframes ou cibler les noms échappés générés par
Tailwind (`sm\:animate-panel-in`), le décalage passe par **une variable inversée
une seule fois** :

```css
:root { --panel-decalage: 16px; }
[dir='rtl'] { --panel-decalage: -16px; }
```

`panel-in` et `panel-out` la lisent. Le tiroir de navigation, ancré au bord
*initial*, déduit sa direction du même décalage pris à l'envers
(`calc(-1 * var(--panel-decalage))`) : rien de plus à maintenir si une troisième
langue arrive.

---

## 6. Intitulés de notification

`notificationDispatcher.notify({ title })` écrit une **phrase française en base**.
`VueNotifications.tsx` la rendait brute.

Stratégie : correspondance exacte phrase → clé, **sans réécrire la donnée**. La
notification en base reste française ; seul l'affichage change de langue.

- 19 clés `notif.titre.*` ajoutées en FR et AR.
- `TITRES_NOTIFICATION` dans `features/expediteur/lib/libelles.ts`.
- **Le type de valeur est `Extract<Cle, \`notif.titre.${string}\`>`** : ajouter une
  entrée pointant vers une clé absente est une **erreur de compilation**, pas un
  libellé vide découvert en production.
- Un intitulé inconnu est rendu **tel quel** : aucune notification ne disparaît ni
  ne s'affiche vide le jour où le backend émet un titre de plus.

**Vérification du corpus.** Un premier comptage m'avait donné 19 par un scan
étroit ; un second, plus large, n'en retrouvait que 11. J'ai tranché par
exécution : les 22 sites d'appel `.notify()` produisent exactement **19 titres
littéraux distincts, tous présents dans la table**. Les deux titres restants sont
des gabarits (`` `Transfert ${n} créé` ``) dont j'ai vérifié l'audience dans
`audience.ts` : `INTER_DEPOT_RECEIVED` → rôles DEPOT, EXPLOITATION, chauffeur,
gestionnaires de dépôt. **Aucun expéditeur** — ils n'atteignent jamais le portail.
En base, les 4 titres réellement livrés à des comptes `EXPEDITEUR_*` sont couverts.

Le **corps** (`content`) n'est volontairement **pas** traduit : il assemble numéros
de suivi, noms et montants côté serveur. Le reformuler côté client reviendrait à
réécrire des données.

---

## 7. Bascule de langue et persistance

Mécanisme existant, vérifié **par exécution** et non par lecture : le script de
premier rendu *tel que servi par Next* a été extrait et joué contre un DOM simulé.

| Préférence | Route | `lang` | `dir` |
|---|---|---|---|
| `ar` | `/expediteur/tableau-de-bord` | `ar` | `rtl` |
| `ar` | `/expediteur` | `ar` | `rtl` |
| `ar` | `/expediteur/colis/abc-123` | `ar` | `rtl` |
| `ar` | `/expediteur/login` | `ar` | `rtl` |
| `fr` | `/expediteur/tableau-de-bord` | `fr` | `ltr` |
| `ar` | `/dashboard` | `fr` | `ltr` ← admin non traduit |
| `ar` | `/colis` | `fr` | `ltr` ← admin non traduit |
| *(absente)* | `/expediteur/…` | `fr` | `ltr` |
| `de` (inconnue) | `/expediteur/…` | `fr` | `ltr` |

**10/10.** Une seule source de vérité (`localStorage['runex.langue']`), lue par le
script anti-miroitement **et** le provider. Aucune route AR dupliquée.

---

## 8. Ce qui a été vérifié, et comment

| Contrôle | Commande | Résultat |
|---|---|---|
| Types, 5 workspaces | `npm run typecheck` | **0 erreur** |
| Build production | `npm run build:web` | **35/35 routes générées** |
| Parité + domaine + RTL | `npx tsx` sur les modules réels | **24/24 PASS** |
| Formateurs FR | `npm run qa:formateurs` | **0 échec** |
| SSR | `curl /expediteur/login` | HTTP 200, `<html lang="fr" dir="ltr">`, script présent |
| Données live | API + PostgreSQL | 22 notifications, 4 titres distincts, tous couverts |

**Le contrôle le plus important était celui-ci.** Tailwind n'émet que les
utilitaires qu'il voit utilisés : si `start-0` n'était pas dans le CSS compilé,
toute la correction RTL aurait été **inerte** tout en passant le typecheck.
Vérifié dans `apps/web/.next/static/chunks/*.css` :

```css
.start-0{inset-inline-start:calc(var(--spacing) * 0)}
.end-2{inset-inline-end:calc(var(--spacing) * 2)}
.ms-2{margin-inline-start:calc(var(--spacing) * 2)}
.ps-9{padding-inline-start:calc(var(--spacing) * 9)}
.border-s{border-inline-start-style:var(--tw-border-style);border-inline-start-width:1px}
.text-start{text-align:start}
:root{--panel-decalage:16px}
[dir=rtl]{--panel-decalage:-16px}
@keyframes panel-in{0%{transform:translateX(var(--panel-decalage)) scale(.985)}…}
```

Chaque utilitaire logique résout bien vers `inset-inline-*`, `margin-inline-*`,
`padding-inline-*`, `border-inline-*`, `text-align: start/end`.

Parité finale : **581/581 clés**, 0 manquante, 0 superflue, 0 vide. Les 2 valeurs
AR identiques au FR sont légitimes (`app.nom` = `RUNEX`, `filtre.terme` = `« {terme} »`).

---

## 9. Non-régression admin

Les propriétés logiques sont **strictement identiques sous `dir=ltr`** : `ms-2`
vaut `ml-2`, `start-0` vaut `left-0`. L'admin, qui reste en français et en LTR
(`SURFACES_I18N = ['/expediteur']`), est inchangé pixel pour pixel.

`TopNavigation.tsx:190` conserve `left-0 right-0` : c'est symétrique, donc déjà
correct en RTL — converti, il n'apporterait rien.

Seul changement visible hors portail : en RTL, une modale centrée glisse de 16 px
depuis l'autre côté (variable partagée). Purement cosmétique, et l'admin n'est de
toute façon jamais en RTL.

---

## 10. Identité visuelle et données non traduites

RUNEX conservé : rouge, barre latérale sombre, blanc/gris clair. Aucun thème
violet/bleu, aucun dégradé ajouté. Les composants existants sont réutilisés.

Ne sont **pas** traduits, comme exigé : chemins d'API, valeurs d'énumération
internes (`CREE`, `RECU_DEPOT`, `AFFECTE_RUNSHEET`, `EN_COURS_LIVRAISON`,
`LIVRE`), UUID, codes-barres, numéros de suivi, e-mails, téléphones, identifiants.
La traduction des statuts reste à la couche de présentation.

Bonus vérifié : `LOCALE_PAR_LANGUE` change bien le rendu des montants —
`1 234 567,890 DT` en `fr-TN` contre `1.234.567,890 د.ت.` en `ar-TN` — tout en
gardant les **chiffres latins**, ce qui est correct pour des numéros de suivi et
des codes-barres. La pile de polices couvre déjà l'arabe (`Tahoma`, `Segoe UI
Arabic`, `Geeza Pro`, `Al Bayan`, `Arial Unicode MS`) et `[dir='rtl']` ajuste
hauteur de ligne et interlettrage.

---

## 11. Problèmes restants — et ce qui n'est pas vérifié

**À lire avant de considérer ce travail comme terminé.**

### 11.1 Le contrôle responsive exigé n'a pas été fait ⚠️

C'est la réserve principale. La consigne demandait un test à
desktop/laptop/tablette sans débordement horizontal. **Aucun navigateur n'existe
dans cet environnement** : ni `google-chrome`, ni `chromium`, ni Playwright, ni
Puppeteer installés. Les scripts QA du dépôt (`verify-responsive.mjs`,
`verify-console-errors.mjs`) pilotent Chrome via CDP mais **codent en dur un
chemin macOS** (`/Applications/Google Chrome.app/...`), inexploitable ici.

Ce qui est vérifié : que les classes sont présentes **et compilées** vers les
bonnes propriétés logiques. Ce qui ne l'est **pas** : le rendu réel, l'absence de
débordement horizontal à 1024/1280/1440 px, la taille des cibles tactiles, et
l'absence d'erreur console. **Ces quatre points restent à valider sur un poste
avec navigateur** — `npm run qa:responsive` et `npm run qa:console` une fois le
chemin Chrome adapté à la machine.

### 11.2 Le corps des notifications reste en français

Décision assumée (section 6), mais c'est bien une limite visible : en arabe, un
intitulé traduit surmonte un corps français. Le corriger proprement demande un
changement **côté backend** — stocker une clé et des paramètres plutôt qu'une
phrase composée — ce qui sort du périmètre de stabilisation et touche au modèle
`Notification`.

### 11.3 Cinq composants corrigés ne sont pas sur le chemin du portail

`Drawer`, `Toast`, `TopNavigation`, `Form`, `ErrorState` : 0 usage trouvé dans
`features/expediteur`. Convertis pour la cohérence du design system et sans
risque, mais **non exercés par le portail** — leurs corrections ne sont donc pas
couvertes par un test de rendu Expéditeur.

### 11.4 Non vérifié faute de navigateur

- Le rendu des polices arabes sur les trois OS (la pile est déclarée, pas
  embarquée : elle dépend des polices installées sur le poste).
- L'alignement réel des tableaux denses et des frises chronologiques en RTL.
- Le miroir des chevrons et flèches de retour — je n'ai audité que les classes de
  positionnement, pas chaque icône directionnelle ; celles rendues par `lucide`
  avec une classe `rotate`/`-scale-x` n'ont pas été passées en revue
  individuellement.

### 11.5 Ce qui n'a pas été exécuté

`npm run qa` complet : la majorité des scripts exigent un navigateur (voir 11.1)
ou un Redis volontairement absent (`[Redis] Cache indisponible` est attendu).
Seuls `qa:formateurs` et les vérifications par API/curl ont tourné.

### 11.6 Un écart de comptage que j'ai dû corriger en cours de route

Mon premier décompte des intitulés de notification (19) venait d'un scan trop
étroit ; un second n'en retrouvait que 11. L'écart venait de ma regex, pas du
code — mais je ne l'ai établi qu'en listant les 22 sites `.notify()` un par un.
Signalé parce que le chiffre « 19 » a circulé dans cette conversation avant
d'être réellement démontré.

---

## Fichiers modifiés

```
apps/web/src/app/globals.css                                   +32 −1
apps/web/src/features/expediteur/lib/libelles.ts               +66 −1
apps/web/src/features/expediteur/notifications/VueNotifications.tsx  +6 −1
apps/web/src/features/expediteur/shell/CoquillePortail.tsx      +2 −1
apps/web/src/i18n/dictionnaires/ar.ts                          +47 −1
apps/web/src/i18n/dictionnaires/fr.ts                          +75 −1
packages/ui/src/components/{Sidebar,SearchInput,Modal,Card,Form,
  ErrorState,AppShell,Drawer,Toast,TopNavigation}.tsx           +54 −27
```

16 fichiers, +248 / −40. `apps/web/next-env.d.ts` (réécrit par Next lui-même)
revenu à son état d'origine pour garder un diff propre.
