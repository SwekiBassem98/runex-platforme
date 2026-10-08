# Suites de non-régression (prompts 24 → 26)

Toutes s'exécutent contre une API locale (`http://127.0.0.1:4000/api/v1`) et une
base fraîchement seedée (`npm run prisma:deploy && npm run prisma:seed`).

| Suite | Portée | Prérequis |
|---|---|---|
| `../qa-security-26.mjs` | sécurité : sessions, RBAC, IDOR, limitation de débit, erreurs | API seule (dernier bloc déclenche la limitation de débit) |
| `../qa-interdepot-26.mjs` | inter-dépôts au scan (livraison, retours, pièces) | API seule |
| `../qa-interdepot-ui-26.mjs` | écrans inter-dépôts + organiser un ramassage | web + navigateur |
| `../qa-bon-livraison-27.mjs` | bon de livraison : contenu, périmètre, impression, QR décodé, PDF A4 | web + navigateur (+ `JSQR`, `PNGJS` pour décoder le QR) |
| `../qa-scan-mobile-27.mjs` | scan mobile : `/scan`, relations, actions, codes de refus, étiquettes de pièce partout | API seule |
| `../qa-runsheet-ui-26.mjs` | cycle de tournée cliqué dans le back-office | web + navigateur |
| `../qa-colis-ui-26.mjs` | « Nouveau colis » de l'exploitation | web + navigateur |
| `qa-runsheet-flow-25-1`, `qa-dashboard-25`, `qa-integrated-25-5`, `qa-presence`, `qa6-livreur`, `qa7-push` | flux métier API | API seule (`qa-integrated` vieillit un colis via `psql`) |
| `qa-runsheet-crud-25-3`, `qa-inventory-exceptions-25-2` | CRUD tournées, inventaire | API + `DATABASE_URL` (Prisma) |
| `qa-socket` | temps réel | API |
| `qa2`, `qa3-admin`, `qa-expediteur` | écrans web | web servi avec `NEXT_PUBLIC_API_URL=/api/v1` et `API_PROXY_TARGET`, `puppeteer-core` |

Variables : `PUPPETEER_CORE` (chemin du module si non installé), `CHROME`
(binaire Chromium), `QA_BASE_URL`, `QA_WEB_URL`.
Lancer les suites API avec `RATE_LIMIT_DISABLED=true` côté API (hors production),
sauf `qa-security-26.mjs` qui vérifie justement la limitation.
