# Sous-traitance de la livraison — partenaire JAX

RUNEX peut confier la livraison d'un colis à JAX. L'intégration suit la
collection Postman fournie par JAX (`JAX Api`) : toutes les routes prennent le
jeton en paramètre `token`.

| Route JAX | Usage dans RUNEX |
|---|---|
| `POST /user/colis/add` | créer le colis chez JAX → code EAN gardé sur le colis |
| `POST /client/createByean` | demander l'enlèvement des colis d'une agence (liste d'EAN) |
| `GET /user/colis/getstatubyean/{ean}` | relire le statut (repli : `getstatut_uptated/{ref}`) |
| `GET /client/colisProbleme/{ref}` | problèmes signalés, affichés sur le colis |
| `GET /gouvernorats`, `GET /statuts/` | référentiels (identifiants JAX, libellés de statut) |
| `GET /user/colis/colisByean/{ean}` | fiche JAX (client prêt, non utilisé à l'écran) |
| `GET /user/colis/AllColisByean` | non utilisé : GET avec corps, la relecture se fait colis par colis |

## Mise en service

1. Koyeb → service API → **Environment** : `JAX_API_TOKEN` (type Secret) = le jeton JAX, puis redéployer.
   Variables facultatives : `JAX_API_URL`, `JAX_EXPEDITEUR_NOM`, `JAX_EXPEDITEUR_TEL`, `JAX_SYNC_MINUTES`.
2. RUNEX → **Sous-traitance JAX › Paramètres** → « Relire gouvernorats et statuts JAX ».
3. Vérifier la correspondance **statuts JAX → étapes RUNEX** (proposée d'après le libellé) et la corriger si besoin.
4. Cocher les **zones confiées automatiquement** (gouvernorats de destination livrés par JAX).

Sans jeton, la page l'indique et rien ne part chez JAX ; le reste de RUNEX fonctionne normalement.

## Flux d'un colis

1. **Reçu dans une agence RUNEX** (Acceptation Magasin ou inter-dépôt).
2. **Confié à JAX** — automatiquement si la destination est une zone JAX, sinon à la main
   (onglet « À confier » ou bouton « Confier à JAX » sur la fiche du colis).
   RUNEX crée le colis chez JAX : expéditeur **RUNEX**, `referenceExterne` = numéro de suivi RUNEX,
   description = contenu, pièces, expéditeur réel, instructions ; enlèvement à l'agence qui détient le colis.
   Le colis passe **« Confié au partenaire JAX »** (`SOUS_TRAITE`) : plus de tournée, d'inter-dépôt ni de
   modification RUNEX (JAX n'offre pas de modification par API).
3. **Enlèvement** — onglet « Enlèvements » : une demande par agence, avec ses codes EAN.
4. **Suivi** — les statuts JAX sont relus automatiquement (`JAX_SYNC_MINUTES`) et à la demande ;
   chaque changement s'inscrit dans la chronologie du colis, visible par l'exploitation et l'expéditeur.
   - enlevé / en dépôt JAX → *Pris en charge par JAX* (le colis sort du stock de l'agence) ;
   - en livraison, reporté, problème → *En cours de livraison par JAX* (+ problème affiché) ;
   - livré → le colis passe **Livré** ;
   - retour → *Retour en cours* ; à l'arrivée physique, « Retour JAX reçu » le met en **Retour au dépôt**
     et il suit le circuit habituel des retours ;
   - annulé chez JAX avant enlèvement → de nouveau en stock.
   Une relecture ne fait jamais reculer un colis.
5. **Encaissement** — JAX encaisse le montant des colis qu'il livre. L'onglet « Encaissements JAX » liste
   ce qui est à recevoir ; un colis livré par JAX n'entre dans un bordereau expéditeur qu'une fois son
   montant marqué « reçu de JAX ».

**Reprendre** un colis est possible tant que JAX ne l'a pas enlevé ; l'API JAX n'ayant pas d'annulation,
il faut aussi annuler le code EAN auprès de JAX.

## Tests

`qa/mock-jax-server.mjs` imite l'API JAX (port 4010, jeton `test-jax`) ; `qa/qa-sous-traitance-jax-45.mjs`
parcourt tout le flux (API et écrans). Les formes de réponse JAX n'étant pas documentées, le client les lit
avec tolérance ; à la première connexion réelle, vérifier les référentiels et un premier envoi.
