# Scan mobile — contrat pour l'application livreur

Le livreur scanne le **QR code** (ou le code-barres) du bon de livraison ; l'API
renvoie le colis correspondant, la pièce lue et ce qu'il peut en faire.

## 1. Ce que contient le QR

Le QR et le code 128 du bon portent **le même texte brut** (pas d'URL) :

| Colis | Contenu | Exemple |
|---|---|---|
| 1 pièce | code-barres du colis (15 chiffres, clé de contrôle) | `261008000000012` |
| N pièces | code-barres + `-` + n° de pièce (une page par pièce) | `261008000000012-2` |

Texte brut, parce que les pistolets du dépôt « tapent » le code au clavier :
une URL y serait inutilisable. L'API accepte quand même un lien dont le
dernier segment est un code (`https://…/t/261008000000012-2`), et la saisie
manuelle du numéro de suivi (14 chiffres) ou d'un code avec espaces.

L'application **n'a pas à analyser le code** : elle l'envoie tel quel.

## 2. Appel

```
GET  /api/v1/scan/{code}          (code encodé avec encodeURIComponent)
POST /api/v1/scan   { "code": "<contenu du QR>" }      ← recommandé
Authorization: Bearer <accessToken>
```

### Réponse 200

```jsonc
{
  "success": true,
  "data": {
    "code": "261008000000012-2",
    "kind": "piece",                       // barcode | piece | business-number | uuid
    "piece": { "number": 2, "count": 2 },  // null pour un code de colis
    "relation": "DELIVERY",                // voir § 3
    "pickup": null,                        // { referenceNumber, status, attached } si PICKUP
    "nextStatuses": ["EN_COURS_LIVRAISON", "LIVRE", "..."],
    "actions": [
      { "key": "start",   "label": "Démarrer la livraison", "method": "POST", "path": "/colis/26100800000001/start" },
      { "key": "deliver", "label": "Livré",                 "method": "POST", "path": "/colis/26100800000001/deliver" }
    ],
    "package": { /* PackageDto complet : destinataire, téléphone, adresse,
                    montant, statut, tournée, chronologie, tentatives… */ }
  }
}
```

`actions[].path` est relatif à `/api/v1`. Pour le ramassage, `body` est fourni
et s'envoie tel quel. Les corps des actions de livraison sont ceux déjà
utilisés par l'application (`/deliver`, `/partial-delivery`, `/exchange`,
`/postpone`, `/failed-attempt`, `/return`).

### Refus — `{ "success": false, "code": "...", "message": "..." }`

| HTTP | `code` | Signification | Réflexe dans l'app |
|---|---|---|---|
| 400 | `INVALID_CODE` | ni code-barres, ni numéro, ni étiquette (ou clé de contrôle fausse) | « Étiquette illisible », rescanner |
| 404 | `UNKNOWN_CODE` | code bien formé, aucun colis | « Colis inconnu » |
| 409 | `PIECE_NOT_FOUND` | pièce n° > nombre de pièces du colis | « Bon à réimprimer » |
| 403 | `NOT_ASSIGNED` | livreur : ni dans sa tournée, ni à ramasser pour lui | « Ce colis ne vous est pas affecté » (aucun détail renvoyé) |
| 403 | `OUT_OF_SCOPE` | agent de dépôt : colis d'un autre dépôt | — |
| 401 | — | jeton expiré | `POST /auth/refresh`, puis rejouer |

Se fier à `code`, jamais au texte de `message` (qui peut changer).

## 3. Relations

| `relation` | Qui | Quand | Actions |
|---|---|---|---|
| `DELIVERY` | livreur | `package.assignedDriverId` = son `driverId` | démarrer / livré / partielle / échange (colis EXCHANGE) / reporter / échec / retour, selon le statut |
| `PICKUP` | livreur | colis à collecter (CREE, RAMASSAGE_PROGRAMME, RAMASSE) chez l'expéditeur d'un ramassage qui lui est affecté (ASSIGNE / EN_COURS), ou déjà rattaché à l'un d'eux | `pickup-attach` ou `pickup-detach` (`PATCH /ramassages/{ref}/packages`) |
| `SHIPPER` | expéditeur | son colis | — |
| `DEPOT` | agent de dépôt | colis présent ou attendu dans son dépôt | — |
| `BACK_OFFICE` | admin, gestion, finance | tout colis | actions de livraison si un livreur est affecté (admin, gestion) |

## 4. Les autres endpoints acceptent aussi le code scanné

Le code lu sur le bon (y compris `…-2`) vaut identifiant partout :

- `GET /colis/{code}` et toutes les actions `/colis/{code}/…` ;
- `PATCH /ramassages/{ref}/packages` `{ "attach": ["<code scanné>"] }` (UUID toujours accepté) ;
- tournée : ajout / retrait d'un colis ; réception dépôt ; acceptation inter-dépôt.

## 5. Connexion et profil du livreur

- `POST /auth/login { identifier, password }` — `identifier` : email, **téléphone**
  (`50123456`, `+216 50 123 456`), **code livreur** (`LIV-BEN-001`) ou **matricule
  du véhicule** (`214 TUN 4512`, espaces et casse ignorés). `{ email, password }`
  reste accepté. Un téléphone ou un matricule partagé par plusieurs comptes ne
  connecte personne. Les échecs sont limités par identifiant et adresse IP.
- Jeton d'accès 15 min ; `POST /auth/refresh { refreshToken }` le renouvelle
  (le jeton de rafraîchissement change à chaque fois : garder le nouveau).
- `GET /drivers/me` (livreur) : code livreur, véhicule, matricule, agence, caisse.
- `GET /ramassages/driver/active` : ramassages à faire, plus ceux effectués aujourd'hui.

## 6. Parcours type

1. Connexion `POST /auth/login` → `accessToken`, `refreshToken` ; `GET /drivers/me`.
2. Tournée du jour : `GET /runsheets/driver/active` ; ramassages : `GET /ramassages/driver/active`.
3. Scan → `POST /scan` → afficher `package` (+ `piece`, `relation`) et un bouton par `actions[]`.
4. Bouton → appel `method` + `path` (+ `body`) → rescanner ou rafraîchir.

Test de contrat : `npm run qa:scan` (38 contrôles).
