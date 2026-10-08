# Inter-dépôts (livraison, retours) et rendez-vous ramassages

Repris du fonctionnement de la plateforme utilisée jusqu'ici par les agences
(vidéos de démonstration analysées image par image), adapté aux règles de
sécurité et d'intégrité de RUNEX.

## Routage des colis
- **Agence de destination** : celle qui livre l'adresse — zone de livraison
  (gouvernorat + délégation), sinon agence du même gouvernorat, sinon le hub.
- **Agence d'origine** : celle de l'expéditeur (gouvernorat de l'expéditeur).
  C'est vers elle que repartent ses retours.
- Calculées à la création du colis, recalculées si l'adresse change avant le
  départ. La migration `20261011000000_interdepot_scan_flow` corrige les colis existants.

## Inter-dépôt livraison / retours — même moteur, deux types
| Étape | Écran | Règle |
|---|---|---|
| 1. Bordereau | « Ajouter un inter dépôt » | agence (destination, ou *agence source* pour les retours), livreur → matricule repris automatiquement, date/heure, **Enregistrer** → « En attente », n° `ID-D-AAAAMMJJ-NNNN` / `ID-R-…` |
| 2. Chargement | champ code-barres + interrupteur **Ajouter ↔ Retirer** | le colis doit être au dépôt de départ, réceptionné, libre (ni tournée ni autre bordereau) ; **contrôle de destination** : un colis pour Nabeul est refusé dans un bordereau pour Sfax (vers le hub central, tout colis destiné à une autre agence est accepté). Retours : le colis doit être en *retour au dépôt* et appartenir à l'agence choisie. Le colis quitte le stock au scan. |
| 3. Acceptation | « Acceptation inter dépôt (retours) » à l'agence d'arrivée | **une étiquette par pièce** (`<code colis>-<n°>`) ; colis reçu quand toutes ses pièces le sont, « partiellement reçu » sinon ; le bordereau reste ouvert tant qu'une pièce manque. Ajouts, retraits, annulation et modification de l'en-tête deviennent impossibles dès la première pièce acceptée. |
| Liste | « Liste des inter dépôts (retours) » | 4 compteurs : envoyés en attente, envoyés reçus, pour réception, reçus ; type Envoi / Réception ; filtres par colonne ; impression du bordereau. |

États : `CRE` (En attente) → `RECU_PARTIEL` → `RECU` ; `ANNULE` tant que rien n'est
accepté (les colis reviennent en stock). Les anciennes étapes
`/prepare`, `/dispatch`, `/receive` répondent **410**.

Concurrence : chaque écriture verrouille la ligne du bordereau (`FOR UPDATE`) ;
une même pièce ne peut être comptée deux fois, un colis ne peut être chargé
dans deux bordereaux.

### API
| Méthode | Route | Rôle |
|---|---|---|
| GET | `/inter-depots?type=&start=&end=&depositId=` | liste + `meta.stats` |
| GET | `/inter-depots/form-options` | agences, livreurs (agence, matricule) |
| POST | `/inter-depots` | en-tête `{type, destinationDepositId, transporterDriverId, vehiclePlate?, departureAt?}` |
| PATCH | `/inter-depots/:id` | en-tête (tant que « En attente ») |
| GET | `/inter-depots/:id/candidates` | colis proposés |
| POST | `/inter-depots/:id/scan` | `{code, mode: "add"|"remove"}` |
| POST | `/inter-depots/:id/cancel` | annulation |
| GET | `/inter-depots/acceptance?type=` | colis attendus, compteurs |
| POST | `/inter-depots/acceptance/scan` | `{code, type}` — une pièce |

## Étiquettes de pièces
La fiche colis imprimée ajoute une étiquette par pièce (colis de 2 pièces et
plus) avec son code-barres `<code colis>-<n°>`. Un colis d'une seule pièce
s'accepte avec son code habituel. Le nombre de pièces d'un colis en route ne
peut plus être modifié.

## Rendez-vous ramassages (vue agence)
« Organiser un ramassage » : date, créneau 7 h–21 h d'**une heure au minimum**,
expéditeur (adresse reprise), livreur, observation → rendez-vous confirmé et
affecté (« En attente »). Liste avec compteurs en attente / effectué / annulé,
actions **Effectuer** et **✕**. Un créneau qui chevauche un rendez-vous existant
du même expéditeur est refusé.

## Tests
`npm run qa:interdepot` (API, 84 contrôles), `node qa/qa-interdepot-ui-26.mjs`
(navigateur, 37 contrôles).
