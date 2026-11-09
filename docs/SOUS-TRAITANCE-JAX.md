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
4. (Facultatif) Cocher les **zones** pour les colis créés avant la mise en service de JAX.

Sans jeton, la page l'indique et rien ne part chez JAX ; le reste de RUNEX fonctionne normalement.

## Flux d'un colis

1. **Créé dans RUNEX** (portail expéditeur ou exploitation) : RUNEX crée **automatiquement** le colis chez
   JAX, quelle que soit sa destination et **sans confirmation de l'administrateur** (en arrière-plan) :
   il est **visible chez JAX dès sa création**
   et son code EAN est gardé sur la fiche. Le colis reste « En préparation » dans RUNEX (ramassage, dépôt
   comme d'habitude), mais n'est plus modifiable ni annulable : JAX connaît déjà sa fiche.
   Création chez JAX : expéditeur **RUNEX**, `referenceExterne` = numéro de suivi RUNEX,
   description = contenu, pièces, expéditeur réel, instructions ; enlèvement à l'agence de départ du colis.
   Si le référentiel des gouvernorats JAX n'a pas été relu, il est relu automatiquement au premier envoi.
   En cas d'échec (JAX injoignable…), l'erreur est inscrite sur le colis, qui reste modifiable ; l'envoi est
   retenté automatiquement (à chaque relecture périodique, `JAX_SYNC_MINUTES`, et à la réception en agence).
2. **Reçu dans une agence RUNEX** (Acceptation Magasin ou inter-dépôt) → **« Confié au partenaire JAX »**
   (`SOUS_TRAITE`), sans le recréer chez JAX : plus de tournée, d'inter-dépôt ni de modification RUNEX.
   Les **zones** (Paramètres) ne servent plus qu'aux colis créés avant la mise en service de JAX : à leur
   réception, ceux d'une zone cochée partent chez JAX ; les autres peuvent être confiés à la main (« À confier »).
   « Reprendre » avant la réception abandonne la fiche JAX (code à annuler chez JAX) ; un colis repris
   n'est pas renvoyé automatiquement.
   **Bon de livraison :** il porte deux codes — le code RUNEX (QR et code-barres de chaque pièce) et le
   **code JAX** (bloc « CODE JAX », en code-barres) que le livreur JAX scanne à l'enlèvement. La création
   attend JAX quelques secondes (`JAX_ATTENTE_CREATION_MS`, défaut 8000) : le bon imprimé juste après porte
   donc le code JAX. Si JAX ne répondait pas, réimprimer le bon une fois le code reçu.
   Le code JAX contient l'identifiant du compte RUNEX chez JAX (ex. `TUN3762…`, compte 3762) : rien à configurer.
   **Colis restés chez Runex** (onglet « Restés chez Runex ») : colis créés avant la mise en service de JAX,
   ou dont l'envoi a échoué, ni livrés, ni retournés, ni annulés. « Envoyer les N colis à JAX » les crée tous
   chez JAX, par lots de 40 :
   - en agence (reçu, arrivé, reporté hors tournée) → *Confié au partenaire JAX* aussitôt ;
   - en préparation, en ramassage, en inter-dépôt → créés chez JAX, confiés à leur réception en agence
     (enlèvement prévu à l'agence d'arrivée pour un inter-dépôt) ;
   - en tournée (affecté, en cours de livraison, reporté) → retirés de la tournée (le livreur est prévenu et
     le rapporte au dépôt), puis confiés ; affectés à un livreur hors tournée → remis en stock, puis confiés ;
   - en échec ou refus de livraison → non concernés (circuit des retours) ; colis repris volontairement → non renvoyés.
   Un colis refusé (JAX indisponible…) reste dans la liste avec le motif, pour un nouvel essai.
3. **Enlèvement** — onglet « Enlèvements » : une demande par agence, avec ses codes EAN (seulement les
   colis déjà reçus en agence : JAX ne doit pas venir chercher un colis encore chez l'expéditeur).
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
