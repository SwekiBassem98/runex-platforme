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
   **Bon de livraison :** il porte deux codes — en **premier, tout en haut**, le **code JAX** en code-barres
   (sans mention « JAX »), que le livreur JAX scanne ; puis le code RUNEX (QR et code-barres de chaque pièce). La création
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
   **Envoi unique automatique** : à la première mise en service de cette version, l'API envoie elle-même ces
   colis à JAX une minute après son démarrage, une seule fois (bilan dans le journal d'audit :
   « Colis restés chez Runex envoyés à JAX »). `JAX_RATTRAPAGE_AUTO=0` pour s'en abstenir.
3. **Enlèvement** — onglet « Enlèvements » : une demande par agence, avec ses codes EAN (seulement les
   colis déjà reçus en agence : JAX ne doit pas venir chercher un colis encore chez l'expéditeur).
4. **Suivi** — les statuts JAX de **tous** les colis chez JAX (y compris ceux encore « En préparation » dans
   RUNEX) sont relus automatiquement (`JAX_SYNC_MINUTES`, défaut 10 min) et à la demande. **Le statut RUNEX du
   colis suit celui de JAX** (rubriques de l'application JAX, liste du client du 10/11) :

   | Rubrique JAX | Statut JAX | Statut RUNEX |
   |---|---|---|
   | En préparation | en attente | En préparation (Créé) |
   | Au dépôt | reçu à l'entrepôt | Reçu au dépôt |
   | Inter dépôt | en cours de préparation au transfert à une autre agence | En lot inter-dépôt |
   | En livraison | en cours de livraison | En cours de livraison |
   | Reportés | reçu à l'entrepôt (après une sortie en livraison) | Reporté |
   | En retour | annulé | Retour au dépôt |
   | Retour expéditeur | en cours de préparation au retour vers l'expéditeur | En retour fournisseur |
   | — | livré | Livré (montant encaissé par JAX, à reverser) |

   La correspondance est proposée d'après le libellé et se corrige dans **Paramètres › Statuts JAX → statuts
   Runex** (colonne « Statut du colis »). Un colis livré, retourné ou annulé ne change plus. Un colis chez JAX
   n'est dans le stock d'aucune agence RUNEX et ne peut entrer ni dans une tournée, ni dans un inter-dépôt, ni
   être livré par un livreur RUNEX. « Retour JAX reçu » le remet en **Retour au dépôt** à l'agence, et il suit
   le circuit habituel des retours.
   **L'expéditeur ne voit jamais JAX** : ni pastille, ni encart, ni mention dans la chronologie, l'historique
   ou les notifications — seulement le statut RUNEX de son colis.
5. **Encaissement** — JAX encaisse le montant des colis qu'il livre. L'onglet « Encaissements JAX » liste
   ce qui est à recevoir ; un colis livré par JAX n'entre dans un bordereau expéditeur qu'une fois son
   montant marqué « reçu de JAX ».

**Reprendre** un colis est possible tant que JAX ne l'a pas enlevé ; l'API JAX n'ayant pas d'annulation,
il faut aussi annuler le code EAN auprès de JAX.

## Tests

`qa/mock-jax-server.mjs` imite l'API JAX (port 4010, jeton `test-jax`) ; `qa/qa-sous-traitance-jax-45.mjs`
parcourt tout le flux (API et écrans). Les formes de réponse JAX n'étant pas documentées, le client les lit
avec tolérance ; à la première connexion réelle, vérifier les référentiels et un premier envoi.
