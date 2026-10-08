# Checklist manuelle — PROMPT 25.4 Expéditeur Package Printing

Date : 2026-10-08 — Tandis : Africa/Tunis
Base URL web : http://localhost:3000
API : http://localhost:4000/api/v1
Compte expéditeur : expediteur@bluestar.tn / Exp123!
Compte admin (contre-test) : admin@logixpress.tn / Admin123!

## Pré-requis
- API et web démarrés (`docker compose up` ou `npm run dev`)
- Le compte BlueStar possède ≥ 1 colis (vérifié : 86 colis, total 86)

## Parcours

### 1. Connexion expéditeur
- [ ] Ouvrir `/expediteur/login` — FR par défaut, bouton عربي active RTL
- [ ] Saisir expediteur@bluestar.tn / Exp123! → connexion réussie
- [ ] Coquille portail rouge/noir affichée, une seule sidebar, pas de nav admin

### 2. Liste — état initial
- [ ] Aller à `/expediteur/colis`
- [ ] Compteur `86 colis` visible, pagination page 1/5, tri Récent actif
- [ ] Bouton **Imprimer tous** présent à droite du tri + Bascule Fiches, label `Imprimer tous (86)` (ou `Imprimer tous`)
- [ ] Sur mobile (<640px) : vérifier que les fiches affichent le bouton **Imprimer** en bas de chaque carte

### 3. Impression — un seul colis (ligne tableau)
- [ ] Dans le tableau, survoler une ligne → bouton imprimante (icone Printer) à droite à côté de `Détails`
- [ ] Cliquer l'icone imprimante → fenêtre/onglet d'impression s'ouvre (popup ou iframe fallback)
- [ ] Vérifier le HTML d'impression :
  - [ ] Header RUNEX rouge + `RX` marque, sous-titre `Espace Expéditeur · BlueStar`
  - [ ] Titre `26100…` (tracking), sous-titre `Code-barres 26100… · Créé le …`
  - [ ] Boite code-barres centrée avec représentation visuelle (barres)
  - [ ] Grille 2 colonnes : Destinataire, Téléphone (mono, dir ltr), Gouvernorat, Délégation, Adresse exacte (pleine largeur), COD (formatTND `10,000 DT` etc), Frais, Statut (badge), Date, Type/Taille, Position actuelle, Contenu, Instructions
  - [ ] Chronologie (≤6 events) si existante
  - [ ] Footer date génération + `Page`
  - [ ] Aucune nav/sidebar/bouton dans l'aperçu print (CSS @page, .no-print)
  - [ ] CSS `@page { size:A4; margin:12mm 10mm }` — tester Aperçu navigateur → Format A4, marges correctes, saut de page propre
- [ ] Fermer l'aperçu → retour liste sans rechargement cassé

### 4. Impression — depuis fiche détail
- [ ] Cliquer `Détails` sur un colis → `/expediteur/colis/<id>`
- [ ] Header : tracking rouge, badge statut, bouton **Imprimer** à côté de `Modifier` / `Annuler` (toujours visible même si `verrouille`, flex-wrap)
- [ ] Cliquer **Imprimer** → même fiche A4 s'ouvre, champs identiques à la liste unitaire
- [ ] Vérifier que `Modifier` reste conditionné à `!verrouille` et `Annuler` à `annulable`, mais `Imprimer` jamais masqué

### 5. Impression — filtrée
- [ ] Retour liste, saisir recherche `261008` (appliquée après 350ms) → compteur passe à `30 colis` par ex
- [ ] Le bouton doit maintenant afficher `Imprimer les 30 colis filtrés` (FR) / `طباعة 30 طردًا` (AR)
- [ ] Cliquer → HTML d'impression :
  - [ ] Header `Colis filtrés` + sous-titre `30 colis filtrés sur 30 · recherche "261008"`
  - [ ] Tableau 6 colonnes : Suivi/Code-barres (mono rouge), Destinataire, Destination (gouvernorat + adresse tronquée), Montant (mono, align right), Type/Taille, Statut/Date
  - [ ] Pas de ligne d'un autre expéditeur (vérifier shipperName `BlueStar` partout)
  - [ ] Notice jaune si `total > 500` (non déclenchée ici, total 30 ≤500)
  - [ ] Étiquettes découpables en dessous : grille 2 colonnes, 12 max, code-barres visuel, montant
  - [ ] Footer `Affichés 30/30` si tronqué sinon `1/1`
- [ ] Essayer autres filtres : `Statut = CREE` (33), `Type = NORMAL`, `Gouvernorat = Tunis`, `Date = 2026-10-08` → chaque fois le label reflète le filtre et le tableau ne contient que ce statut

### 6. Cas catégorie `Retours` (4 statuts fusionnés)
- [ ] Cliquer onglet `Retours` (BADGE retours = LIVRAISON_PARTIELLE + RETOUR_DEPOT + EN_RUNSHEET_RETOUR + RETOURNE_EXPEDITEUR)
- [ ] Vérifier que la liste mélange les 4 statuts (fusion Map id)
- [ ] Cliquer **Imprimer les X filtrés** → le HTML doit contenir les mêmes 4 statuts, sans doublon, total = somme des 4 totaux serveur (vérifié en QA : 500 limit)

### 7. Impression — tous (sans filtre)
- [ ] Bouton `Réinitialiser` → filtres effacés, `vue=tous`, recherche vide
- [ ] Bouton redevient `Imprimer tous` (86)
- [ ] Cliquer → HTML `Tous les colis — 86 colis` + sous-titre `86 colis sur 86`
- [ ] Tableau complet, étiquettes 12/86, pas de troncature

### 8. Cas vide
- [ ] Recherche impossible `__VIDE_IMPOSSIBLE_987__` → EmptyState `Aucun colis` + bouton Réinitialiser
- [ ] Bouton **Imprimer** toujours présent mais `total === 0` → clic affiche toast `Aucun colis à imprimer` (info), aucune fenêtre print

### 9. Sécurité — non-régression
- [ ] Connecté expéditeur, copier l'id d'un colis Benhcine visible par admin (ex: `f52d4a31-…` tracking `261007900003`) → coller `/expediteur/colis/f52d4a31-…` → page `Colis indisponible` (404 indistinguable)
- [ ] Dans la liste, manipuler la requête réseau : `GET /colis?shipperId=03317f04-…` avec token expéditeur (via devtools Network → copy as fetch) → réponse ne contient que `shipperId 8902…` (BlueStar), aucun Benhcine
- [ ] Vérifier audit : `/colis/<étranger>/audit` → 404
- [ ] Vérifier que l'impression filtrée ne peut pas être contournée : appliquer filtre `?status=CREE&shipperId=03317f…` → toujours CREE de BlueStar uniquement

### 10. Langue / RTL
- [ ] Basculer en AR (icon langue) → refaire 3 → 8
- [ ] Vérifier `dir=rtl`, header `flex-direction: row-reverse`, `text-align:right`, `brand-mark RX` reste LTR, montants `DT` et téléphones `dir="ltr"` restent LTR, dates formatées `ar-TN`

### 11. Performance / mémoire
- [ ] Sur 86 colis, cliquer **Imprimer tous** → Network montre 1 appel `limit=100 page=1` (85 ≤86, boucle s'arrête après 1 page, pas de chargement 86×86)
- [ ] Sur un tenant à >500 colis (simuler via DB ou vérifier code) : l'UI affiche `Affichage limité à 500` + toast warning, pagination serveur boucle max 10 pages ×100 =1000 mais tronquée à 500 slice

### 12. Régression — édition formulaire (bug corrigé)
- [ ] Ouvrir un colis `CREE` non verrouillé → **Modifier** présent
- [ ] Cliquer **Modifier** → modal s'ouvre
- [ ] Champ **Gouvernorat** est désormais un `<select>` avec les 24 gouvernorats (même vocabulaire que la création), plus un `<input>` libre — vérifier que Tunis, Ben Arous, etc. sont traduits
- [ ] Modifier `Nom`, `Téléphone`, `Adresse`, `Montant 10 → 12,500` → message d'alerte amber `Montant 10,000 → 12,500. Alerte au livreur si en tournée` s'affiche dynamiquement
- [ ] Enregistrer → toast `Colis mis à jour`, fiche rechargée, `totalPrice` reflété, timeline `Modification par l'expéditeur` ajoutée
- [ ] Sur un colis `AFFECTE_RUNSHEET` / `RECU_DEPOT` : vérifier que `Modification restreinte` fonctionne (API autorise mais notifie chauffeur) et que `isLockedForEditing` masque bien Modifier sur `LIVRE`/`ANNULE`/`RETOURNE_EXPEDITEUR`

### 13. Typecheck & Build
- [ ] `npm run typecheck` → 0 erreur (vérifié 2026-10-08)
- [ ] `npm run build --workspace apps/web` → Compiled successfully, 38 pages (vérifié)

### Critères d'acceptation
- Tous les points 1-13 cochés sans 404/fuite cross-shipper, sans données admin dans l'impression, avec A4 propre et limite 500 documentée.
