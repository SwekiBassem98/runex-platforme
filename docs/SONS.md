# Retour sonore (web et application livreur)

Sept sons courts, synthétisés pour RUNEX (`scripts/sounds/generate-sounds.py`,
aucun échantillon tiers), identiques sur le web (`apps/web/public/sounds`) et
dans l'application livreur (`assets/sounds`).

| Son | Quand | Exemple |
|---|---|---|
| `scan` | un code a été lu | colis chargé dans un inter-dépôt, pièce reçue, aperçu en réception |
| `success` | action enregistrée | colis reçu au dépôt, colis complet à l'acceptation, compte créé, toute notification « succès » |
| `complete` | opération majeure terminée | tournée créée, caisse clôturée, bordereau inter-dépôt entièrement reçu, ramassage effectué, paiement validé |
| `error` | refus | code illisible ou inconnu, mauvais mot de passe, action refusée, toute notification « erreur » |
| `warning` | à vérifier | colis déjà reçu, toute notification « avertissement » |
| `notify` | nouvelle notification en temps réel | cloche |
| `remove` | élément retiré | colis retiré d'un transfert ou d'une tournée, ramassage annulé |

## Web

- `apps/web/src/lib/feedback.ts` : moteur (Web Audio, préchargé au premier geste —
  obligatoire sur téléphone), vibration Android, réglages par appareil.
- Toutes les notifications (`addToast`) jouent le son de leur type ; un écran peut
  choisir un autre son (`sound: 'complete'`) ou le taire (`sound: false`).
- Messages d'écran : `useFeedbackOn(message, 'success')`.
- Réglage : icône haut-parleur dans la barre supérieure (exploitation et portail
  expéditeur) — son, volume, vibration, essai.
- iPhone : le bouton « silencieux » coupe les sons du navigateur.

## Application livreur

`src/services/feedback.ts` (expo-audio + expo-haptics) : mêmes sons, vibration
native, jouée même téléphone en mode silencieux (iOS) et mélangée à la musique
en cours. Réglage dans Profil.

Tests : `npm run qa:sounds` (web), `npm run qa:responsive-phones` (tous les écrans
de 320 à 768 px).
