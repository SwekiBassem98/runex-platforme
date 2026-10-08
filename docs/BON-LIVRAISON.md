# Bon de livraison (étiquette colis)

Le bon de livraison est la feuille A4 imprimée et collée sur le colis. Sa mise
en page reprend le modèle utilisé par le client (bon ADEX) ; chaque valeur
vient de la base.

| Zone du bon | Valeur | Source |
|---|---|---|
| Logo | logo de la plateforme | `apps/web/public/brand/runex-logo.jpeg` |
| Bon de Livraison N° | numéro de suivi (`AAMMJJ` + séquence) | `Package.trackingNumber` |
| Date | date de création, `jj/mm/aaaa`, heure de Tunis | `Package.createdAt` |
| QR code | code de la pièce (celui scanné à l'acceptation) | `barcode`, ou `barcode-N` si plusieurs pièces |
| `LGR(1/1)` | taille abrégée (LGR / MOY / LRD / VOL) et pièce i/N | `sizeCategory`, `pieceCount` |
| `agence => agence` | agence de départ => agence qui livre | `originDeposit.name`, `destinationDeposit.name` |
| `=> gouvernorat/délégation` | zone de livraison | adresse du destinataire |
| Bloc expéditeur | nom commercial, téléphone, M.F., adresse | `Shipper.brandName`, `phone`, `taxId`, `governorate` + `address` |
| DESTINATAIRE | nom, adresse / gouvernorat, téléphone(s) | `Customer`, `CustomerAddress` |
| Remarque | instructions de l'expéditeur, sinon **R.A.S** (rien à signaler) | `Package.shipperNotes` |
| « Autorisation d'ouvrir le colis » | si l'ouverture est permise | `Package.allowOpen` |
| Tableau | Désignation, Qté, PU HT, TVA, MT TVA, MT TTC | voir ci-dessous |
| PRIX TOTAL | montant à encaisser, en DT, 3 décimales | `Package.totalPrice` |
| Transporteur / MF | raison sociale et matricule fiscal de la société | `Company.legalName`, `taxRegistration` |
| Code-barres | Code 128 du code de la pièce | idem QR |
| ☑ FRAGILE | case cochée si le colis est fragile | `Package.isFragile` (nouveau) |
| ☑ Autorisation d'ouverture | case cochée si l'ouverture est permise | `Package.allowOpen` |

**Lignes du tableau.** Le contre-remboursement n'est pas assujetti à la TVA
(TVA 0 %). Si les articles du colis sont chiffrés et que leur somme tombe
exactement sur le montant à encaisser, chaque article fait une ligne ; sinon une
seule ligne reprend le contenu déclaré, Qté 1, pour le montant total. Le bon
n'affiche donc jamais une somme différente de celle que le livreur encaisse.

**Pièces.** Un colis de N pièces imprime N pages : chacune porte `(i/N)` et son
propre code, celui que l'agence d'arrivée scanne pièce par pièce
(acceptation inter-dépôt).

## Où l'imprimer

- Portail expéditeur : fiche du colis → **Bon de livraison** ; liste → icône
  d'impression d'une ligne, ou **Bons de livraison (n)** pour la page affichée.
- Back-office : fiche du colis → **Bon de livraison**.

## API

- `GET /api/v1/colis/:identifiant/bon-livraison` — un bon (UUID, numéro de suivi ou code-barres).
- `POST /api/v1/colis/bons-livraison` `{ "identifiers": [...] }` — 200 bons au plus, dans l'ordre demandé.

Les deux respectent le périmètre du jeton (un expéditeur ne lit que ses colis,
un agent ceux de son dépôt). Test : `npm run qa:bon-livraison` (59 contrôles).
