/**
 * Dictionnaire français — source de vérité des clés.
 *
 * Ce fichier est le seul endroit où un mot existe en français. Tout le reste de
 * l'application y fait référence par clé : `ar.ts` doit fournir exactement les
 * mêmes clés, ce que le typage vérifie à la compilation. Une chaîne traduisible
 * écrite directement dans un composant est donc, par construction, un défaut —
 * et se repère d'un coup d'œil au grep.
 *
 * Trois catégories ne sont pas des clés, et n'en seront jamais :
 *
 *   - les valeurs de domaine envoyées au serveur (statuts, types, gouvernorats,
 *     modes de paiement) : ce sont des identifiants de protocole, pas des mots ;
 *   - les noms propres saisis par l'utilisateur (destinataire, adresse) ;
 *   - les montants, numéros de suivi et barcodes, qui sont des données.
 *
 * Les clés sont plates et nommées par domaine (`colis.liste.titre`), ce qui les
 * rend cherchables : `grep "colis\."` liste tout l'écran « colis ».
 */
export const fr = {
  // ---------------------------------------------------------------- commun
  'app.nom': 'RUNEX',
  'app.portail': 'Espace Expéditeur',
  'commun.annuler': 'Annuler',
  'commun.confirmer': 'Confirmer',
  'commun.fermer': 'Fermer',
  'commun.retour': 'Retour',
  'commun.enregistrer': 'Enregistrer',
  'commun.reessayer': 'Réessayer',
  'commun.oui': 'Oui',
  'commun.non': 'Non',
  'commun.voirTout': 'Tout voir',
  'commun.ouvrir': 'Ouvrir',
  'commun.ouvrirFiche': 'Ouvrir la fiche complète',
  'commun.details': 'Détails',
  'commun.revenir': 'Revenir',
  'commun.copier': 'copier',
  'commun.copie': 'copié',
  'commun.inconnu': '—',
  'commun.reinitialiserFiltres': 'Réinitialiser les filtres',
  'commun.chargement': 'Chargement…',
  'commun.piece': 'Pièce',
  'commun.pieces': 'Pièces',
  'commun.piecesAbregees': '{n} p.',
  'commun.libelleObligatoire': 'obligatoire',

  // ------------------------------------------------------------ navigation
  'nav.tableau-de-bord': 'Tableau de bord',
  'nav.colis': 'Colis',
  'nav.nouveau-colis': 'Nouveau colis',
  'nav.suivi': 'Suivi',
  'nav.ramassages': 'Ramassages',
  'nav.bordereaux': 'Bordereaux',
  'nav.echanges': 'Échanges',
  'nav.retours': 'Bons de retour',
  'nav.activites': 'Activités',
  'nav.notifications': 'Notifications',
  'nav.profil': 'Profil',

  // -------------------------------------------------------------- connexion
  'connexion.titre': 'Espace Expéditeur',
  'connexion.sous-titre': 'Suivi de vos expéditions',
  'connexion.description':
    "Accédez à vos colis, vos ramassages et vos bordereaux. Les identifiants sont ceux communiqués par RUNEX.",
  'connexion.email': 'Adresse email',
  'connexion.motDePasse': 'Mot de passe',
  'connexion.seSouvenir': 'Se souvenir de moi',
  'connexion.soumettre': 'Accéder à mon espace',
  'connexion.envoi': 'Connexion…',
  'connexion.verification': 'Vérification de la session…',
  'connexion.compteDemo': 'Compte de démonstration',
  'connexion.compteDemoAide':
    'Ces comptes sont publics et servent à la démonstration. N’entrez pas de données réelles.',
  'connexion.exploitation': 'Vous êtes l’équipe RUNEX ? Accès exploitation',
  'connexion.apiInjoignable':
    'Le serveur RUNEX ne répond pas. Vérifiez votre connexion, puis réessayez.',
  'connexion.apiInjoignableUrl':
    'Service indisponible ({url}). Réessayez dans un instant.',
  'connexion.afficherMotDePasse': 'Afficher le mot de passe',
  'connexion.masquerMotDePasse': 'Masquer le mot de passe',
  'connexion.remplirAvec': 'Remplir avec {email}',
  'connexion.erreurInattendue': 'Une erreur inattendue est survenue.',
  'connexion.identifiantsInvalides': 'Adresse email ou mot de passe incorrect.',
  'connexion.sessionExpiree': 'Votre session a expiré. Reconnectez-vous.',
  'connexion.accesRefuse': 'Espace réservé aux expéditeurs',
  'connexion.accesRefuseAide':
    'Ce compte est un compte d’exploitation. Le portail expéditeur ne lui est pas ouvert.',
  'connexion.retourEspace': 'Revenir à mon espace',
  'connexion.langue': 'Langue',

  // ----------------------------------------------------------------- coque
  'coque.sautContenu': 'Aller au contenu principal',
  'coque.ouvrirMenu': 'Ouvrir le menu',
  'coque.fermerMenu': 'Fermer le menu',
  'coque.rechercherColis': 'Rechercher un colis',
  'coque.notifications': 'Notifications',
  'coque.notificationsNonLues': 'Notifications, {n} non lues',
  'coque.nouveauColis': 'Nouveau colis',
  'coque.pied': "RUNEX — Espace Expéditeur. Les données affichées sont celles de votre entreprise uniquement.",
  'coque.deconnexion': 'Se déconnecter',
  'coque.entreprise': 'Entreprise',
  'coque.roleExpediteur': 'Expéditeur',

  // -------------------------------------------------------------- tableau de bord
  'dashboard.titre': 'Tableau de bord',
  'dashboard.sous-titre': "L'état de vos expéditions, à l'heure.",
  'dashboard.rechercher': 'Rechercher un colis',
  'dashboard.rechercherAide':
    'N° de suivi, code-barres, nom ou téléphone du destinataire',
  'dashboard.bonjour': 'Bonjour {nom}',
  'dashboard.votreEntreprise': 'votre entreprise',
  'dashboard.porteeCompteurs': 'Sur les {n} derniers colis affichés',
  'dashboard.bordereauxEnAttente': '{n} bordereaux en attente de règlement',
  'dashboard.dejaRegle': 'RUNEX vous a déjà réglé {montant} sur vos bordereaux confirmés.',
  'dashboard.etatColis': 'État de vos colis',
  'dashboard.aideCompteurs':
    'Tous les compteurs portent sur les colis de votre entreprise, délimités par votre session.',
  'dashboard.montantsEncaisser': 'Montants à encaisser',
  'dashboard.aideMontants': 'Montants constatés par les livreurs',
  'dashboard.aEncaisser': 'À encaisser sur l’ensemble',
  'dashboard.dejaEncaisse': 'Déjà encaissé',
  'dashboard.bordereauxARegler': 'Bordereaux à régler',
  'dashboard.derniersBordereaux': 'Derniers bordereaux',
  'dashboard.aucunBordereau': 'Aucun bordereau',
  'dashboard.aideBordereaux':
    'Les bordereaux de paiement apparaîtront ici après vos premières livraisons.',
  'dashboard.activiteRecente': 'Activité récente',
  'dashboard.derniersColis': 'Derniers colis',
  'dashboard.aucunColisTitre': "Aucun colis pour l'instant",
  'dashboard.aidePremierColis':
    'Déclarez votre premier colis pour le suivre de la collecte à la livraison.',
  'dashboard.aucunEvenement': 'Rien de neuf',
  'dashboard.aideEvenements':
    "Les événements de vos colis s'afficheront ici dès qu'il y en aura.",
  'dashboard.declarerColis': 'Déclarer un colis',

  // ------------------------------------------------------------------ colis
  'colis.liste.titre': 'Mes colis',
  'colis.liste.compte': '{n} colis',
  'colis.liste.categories': 'Catégories de colis',
  'colis.liste.categorie.tous': 'Tous',
  'colis.liste.categorie.livres': 'Livrés',
  'colis.liste.categorie.reportes': 'Reportés',
  'colis.liste.categorie.retours': 'Retours',
  'colis.liste.colonne.suivi': 'Suivi',
  'colis.liste.colonne.destinataire': 'Destinataire',
  'colis.liste.colonne.destination': 'Destination',
  'colis.liste.colonne.type': 'Type',
  'colis.liste.colonne.montant': 'Montant à encaisser',
  'colis.liste.colonne.statut': 'Statut',
  'colis.liste.colonne.fiche': 'Fiche',
  'colis.liste.chargement': 'Chargement des colis',
  'colis.liste.videTitre': "Vous n'avez pas encore de colis",
  'colis.liste.videDescription':
    'Déclarez un colis pour le suivre de la collecte jusqu\'à la livraison.',
  'colis.liste.videFiltreTitre': 'Aucun colis ne correspond',
  'colis.liste.videFiltreDescription':
    'Aucun colis de votre entreprise ne correspond à ces critères.',
  'colis.liste.tri.recent': 'Plus récents d’abord',
  'colis.liste.tri.ancien': 'Plus anciens d’abord',
  'colis.liste.tri.montant': 'Montant décroissant',
  'colis.liste.triAide': 'Trie les colis affichés sur cette page',
  'colis.liste.erreur': 'Vos colis n\'ont pas pu être chargés.',
  'colis.liste.recherche': 'Rechercher un colis',
  'colis.liste.rechercheAide': 'N° de suivi, code-barres, destinataire, téléphone…',
  'colis.liste.creesLe': 'Créés le',
  'colis.liste.libelle': 'colis',
  'colis.liste.imprimer': 'Imprimer',
  'colis.liste.imprimerColis': 'Imprimer le colis',
  'colis.liste.imprimerTous': 'Imprimer tous les colis',
  'colis.liste.imprimerFiltres': 'Imprimer les {n} colis filtrés',
  'colis.liste.impressionEnCours': 'Préparation de l’impression…',
  'colis.liste.impressionVide': 'Aucun colis à imprimer avec ces filtres.',
  'colis.liste.impressionLimite': 'Limite d’impression : {max} colis affichés sur {total}. Affinez vos filtres pour le reste.',
  'colis.liste.impressionErreur': 'L’impression n’a pas pu être préparée.',
  'colis.detail.imprimer': 'Imprimer',

  'colis.formulaire.titre': 'Nouveau colis',
  'colis.formulaire.declareAuNom': 'Déclaré au nom de {entreprise}',
  'colis.formulaire.declareAuNom.valeurParDefaut': 'votre entreprise',
  'colis.formulaire.retourListe': 'Retour à la liste des colis',
  'colis.formulaire.groupe.destinataire': 'Destinataire',
  'colis.formulaire.groupe.destination': 'Destination',
  'colis.formulaire.groupe.colis': 'Colis et montant',
  'colis.formulaire.nom': 'Nom complet',
  'colis.formulaire.nomAide': 'Mohamed Ben Salah',
  'colis.formulaire.telephone': 'Téléphone',
  'colis.formulaire.telephoneAide':
    'Format tunisien : 8 chiffres, par exemple 20123456',
  'colis.formulaire.telephoneErreur': 'Erreur de saisie sur le destinataire',
  'colis.formulaire.telephoneErreurAide': 'Exemple : erreur de saisie, destinataire inconnu',
  'colis.formulaire.gouvernorat': 'Gouvernorat',
  'colis.formulaire.delegation': 'Délégation',
  'colis.formulaire.delegationAide': 'La délégation exacte, pour le livreur',
  'colis.formulaire.adresse': 'Adresse exacte',
  'colis.formulaire.adresseAide': '12, rue des Écoles, 1001',
  'colis.formulaire.montant': 'Montant à encaisser',
  'colis.formulaire.nombrePieces': 'Nombre de pièces',
  'colis.formulaire.nombrePiecesAide':
    'Colis multi-pièces : indiquez le nombre total',
  'colis.formulaire.taille': 'Taille',
  'colis.formulaire.type': "Type d'expédition",
  'colis.formulaire.description': 'Description du contenu',
  'colis.formulaire.descriptionAide': 'Visible par l\'exploitation et le livreur',
  'colis.formulaire.descriptionAide2': 'Vêtements, deux cartons',
  'colis.formulaire.ouvrirAutorise': 'Le client peut ouvrir le colis avant de payer',
  'colis.formulaire.instructions': 'Instructions pour le livreur',
  'colis.formulaire.instructionsAide':
    'Appeler avant 14 h. Ne pas exposer au soleil.',
  'colis.formulaire.instructionsAide2':
    'Consignes de remise, fragilité, punto de rendez-vous…',
  'colis.formulaire.soumettre': 'Déclarer le colis',
  'colis.formulaire.envoi': 'Envoi en cours…',
  'colis.formulaire.avertissement':
    'Le numéro de suivi et le code-barres sont générés par RUNEX. Les frais de livraison sont appliqués automatiquement selon le contrat de votre entreprise. Le colis démarre à l’état « En préparation » et pourra être rattaché à un ramassage.',
  'colis.formulaire.erreurGenerique':
    'Le colis n\'a pas pu être créé. Réessayez.',

  'colis.detail.titre': 'Colis',
  'colis.detail.chargement': 'Chargement de la fiche…',
  'colis.detail.indisponible': 'Colis indisponible',
  'colis.detail.retourListe': 'Retour à mes colis',
  'colis.detail.colonne.libelle': 'Colis',
  'colis.detail.colonne.destinataire': 'Destinataire',
  'colis.detail.colonne.destination': 'Destination',
  'colis.detail.colonne.livraison': 'Livraison',
  'colis.detail.colonne.montants': 'Montants',
  'colis.detail.colonne.vosInstructions': 'Vos instructions',

  'colis.detail.montants': 'Montants',
  'colis.detail.colis': 'Colis',
  'colis.detail.livraison': 'Livraison',
  'colis.detail.champ.nomComplet': 'Nom complet',
  'colis.detail.champ.telephone': 'Téléphone',
  'colis.detail.champ.gouvernorat': 'Gouvernorat',
  'colis.detail.champ.delegation': 'Délégation',
  'colis.detail.champ.adresse': 'Adresse exacte',
  'colis.detail.champ.type': 'Type',
  'colis.detail.champ.taille': 'Taille',
  'colis.detail.champ.nombrePieces': 'Nombre de pièces',
  'colis.detail.champ.ouverture': 'Ouverture',
  'colis.detail.champ.ouvertureAutorisee': 'Autorisée',
  'colis.detail.champ.ouvertureRefusee': 'Non autorisée',
  'colis.detail.champ.contenu': 'Contenu',
  'colis.detail.champ.statut': 'Statut',
  'colis.detail.champ.livreur': 'Livreur',
  'colis.detail.champ.tournee': 'Tournée',
  'colis.detail.champ.positionActuelle': 'Position actuelle',
  'colis.detail.champ.livraisonPrevue': 'Livraison prévue le',
  'colis.detail.livraisonRemisee': 'Colis livré : le montant a été transmis à la caisse.',
  'colis.detail.livraisonNonRemisee': "Les montants sont ceux enregistrés par le livreur au passage.",
  'colis.detail.champ.montantEncaisser': 'Montant à encaisser',
  'colis.detail.champ.dejaEncaisse': 'Déjà encaissé',
  'colis.detail.champ.resteARassembler': 'Reste à collecter',
  'colis.detail.champ.fraisLivraison': 'Frais de livraison',
  'colis.detail.champ.ancienCodeBarres': 'Ancien code-barres',
  'colis.detail.champ.nouveauCodeBarres': 'Nouveau code-barres',
  'colis.detail.champ.articleRepris': 'Article repris',
  'colis.detail.champ.articleRemplace': 'Article de remplacement',
  'colis.detail.champ.differenceFinanciere': 'Différence financière',
  'colis.detail.champ.effectueLe': 'Effectué le',
  'colis.detail.champ.livre': 'Livré',
  'colis.detail.champ.retourne': 'Retourné',
  'colis.detail.champ.piecesLivrees': 'Pièces livrées',
  'colis.detail.champ.piecesRetournees': 'Pièces retournées',
  'colis.detail.champ.motif': 'Motif',
  'colis.detail.champ.depot': 'Dépôt',
  'colis.detail.champ.codeBarres': 'Code-barres',
  'colis.detail.champ.creeLe': 'Créé le',
  'colis.detail.adresse': 'Adresse exacte',
  'colis.detail.telephone': 'Téléphone',
  'colis.detail.delegation': 'Délégation',
  'colis.detail.gouvernorat': 'Gouvernorat',
  'colis.detail.nomComplet': 'Nom complet',
  'colis.detail.nombrePieces': 'Nombre de pièces',
  'colis.detail.montantAEncaisser': 'Montant à encaisser',
  'colis.detail.instructions': 'Instructions pour le livreur',
  'colis.detail.chronologie': 'Chronologie',
  'colis.detail.chronologieAide': 'Du premier au dernier événement',
  'colis.detail.aucunEvenement': 'Aucun événement enregistré.',
  'colis.detail.tentatives': 'Passages chez le destinataire',
  'colis.detail.livraisonPartielle': 'Livraison partielle',
  'colis.detail.retours': 'Retours',
  'colis.detail.echange': 'Échange',
  'colis.detail.historique': 'Historique des modifications',
  'colis.detail.historiqueAide': 'Les 50 derniers événements enregistrés sur ce colis',
  'colis.detail.modificationsTracees':
    'Les changements sont tracés dans l’historique ci-dessous.',
  'colis.detail.modifier': 'Modifier',
  'colis.detail.modifierTitre': 'Modifier le colis',
  'colis.detail.enregistrement': 'Enregistrement…',
  'colis.detail.motif': 'Motif',
  'colis.detail.motifAide': 'Motif de l’annulation',
  'colis.detail.motifPlaceholder': 'Ex. : erreur de saisie, destinataire inconnu',
  'colis.detail.annuler': 'Annuler le colis',
  'colis.detail.annulerConfirme': 'Annuler ce colis ?',
  'colis.detail.annulerAide':
    'Le colis passe à l’état « Annulé » et n’est plus distribué. Cette action est tracée.',
  'colis.detail.annule': 'Colis annulé',
  'colis.detail.modifie': 'Colis modifié',
  'colis.detail.champsModifies': 'Champs modifiés',
  'colis.detail.valeursAvantApres': 'Valeurs avant / après',
  'colis.detail.erreurEnregistrement': 'Les modifications n\'ont pas pu être enregistrées.',
  'colis.detail.erreurAnnulation': 'Le colis n\'a pas pu être annulé.',
  'colis.detail.terminal':
    'Ce colis est arrivé au terme de son parcours : ses données ne sont plus modifiables. L’historique reste consultable ci-dessous.',
  'colis.detail.paiementStatut': 'Statut du paiement',
  'colis.detail.attemptsEffectuees': '{n} tentative(s) effectuée(s)',
  'colis.detail.derniereTentative': 'Dernière tentative : {date}',
  'colis.detail.motifRefus': 'Motif : {motif}',
  'colis.detail.aucunRetour': 'Aucun retour enregistré pour ce colis.',
  'colis.detail.sauvegarde': 'Les nouvelles données sont enregistrées.',
  'colis.detail.sauvegardeTitre': 'Colis mis à jour',
  'colis.detail.annulationTitre': 'Colis annulé',
  'colis.detail.creerEchec': 'Ce colis n\'a pas pu être ouvert.',
  'colis.detail.modificationEchec': 'La modification a échoué.',
  'colis.detail.annulationEchec': "L'annulation a échoué.",
  'colis.detail.inexistant':
    "Ce colis n'existe pas ou n'appartient pas à votre entreprise. Le serveur ne distingue pas les deux cas, pour ne pas confirmer l'existence d'un colis étranger.",
  'colis.detail.echangeArticleRepris': 'Article repris',
  'colis.detail.echangeArticleRemplace': 'Article de remplacement',
  'colis.detail.echangeRealiseLe': 'Réalisé le',

  // ----------------------- tentatives de passage / motifs
  'tentative.livre': 'Colis remis au destinataire',
  'tentative.passageEffectue': 'Passage effectué',
  'tentative.tentative': 'Tentative',
  'tentative.motif': 'Motif',
  'motif.INJOIGNABLE': 'Destinataire injoignable',
  'motif.ADRESSE_INCORRECTE': 'Adresse incorrecte',
  'motif.PAS_D_ARGENT': 'Destinataire sans liquidités',
  'motif.REFUSEE': 'Refus du destinataire',

  'colis.categorie.recherche': 'Rechercher dans {titre}',
  'colis.categorie.libelle': 'colis',
  'colis.categorie.compte': '{n} colis',
  'colis.categorie.tousStatuts': 'Tous les statuts',
  'colis.categorie.tousStatutsCategorie': 'Tous les statuts de la catégorie',

  // ----------------------------------------------------------- suivi / recherche
  'suivi.titre': 'Suivi d\'un colis',
  'suivi.sous-titre':
    'N° de suivi, code-barres, nom du destinataire ou numéro de téléphone.',
  'suivi.terme': 'Terme de recherche',
  'suivi.termeAide': '26100400001234, Destinataire, 20123456…',
  'suivi.bouton': 'Rechercher',
  'suivi.aidePortee': 'La recherche porte sur vos colis uniquement. Deux caractères suffisent.',
  'suivi.videTitre': 'Recherchez un colis',
  'suivi.videDescription':
    'Saisissez un numéro de suivi, un code-barres, un nom ou un téléphone pour afficher la chronologie complète de l’expédition.',
  'suivi.aucunResultat': 'Aucun résultat',
  'suivi.aucunResultatDetail':
    'Aucun colis de votre entreprise ne correspond à « {terme} ».',
  'suivi.parcourir': 'Parcourir tous mes colis',
  'suivi.correspondances': '{n} correspondance(s)',
  'suivi.autresEvenements': 'et {n} autre(s) événement(s)',
  'suivi.chargement': 'Chargement du suivi',
  'suivi.erreur': 'Recherche impossible.',

  // -------------------------------------------------------------- ramassages
  'ramassages.titre': 'Ramassages',
  'ramassages.sous-titre': 'Collectes de vos colis chez vous',
  'ramassages.demander': 'Demander un ramassage',
  'ramassages.demanderAide': 'Demandez un rendez-vous de collecte et le livreur passera à l’adresse indiquée.',
  'ramassages.aucun': 'Aucun ramassage',
  'ramassages.aucunDescription':
    'Un véhicule de collecte passera à l’adresse que vous indiquerez.',
  'ramassages.historique': 'Historique',
  'ramassages.aVenir': 'À venir',
  'ramassages.chargement': 'Chargement des rendez-vous',
  'ramassages.colonne.reference': 'Référence',
  'ramassages.colonne.date': 'Date et créneau',
  'ramassages.colonne.adresse': 'Adresse de collecte',
  'ramassages.colonne.colis': 'Colis annoncés / collectés',
  'ramassages.colonne.chauffeur': 'Chauffeur',
  'ramassages.colonne.statut': 'Statut',
  'ramassages.colonne.action': 'Action',
  'ramassages.compte': '{n} rendez-vous',
  'ramassages.compteAVenir': '{n} rendez-vous en cours',
  'ramassages.comptePasses': '{n} rendez-vous passés',
  'ramassages.demandeLe': 'Demandé le',
  'ramassages.ecartManquants': '{n} manquants',
  'ramassages.annulationEchec': "L'annulation n'a pas abouti.",
  'ramassages.afficheChauffeur': 'Chauffeur affecté',
  'ramassages.afficheChauffeurAucun': 'Non attribué',
  'ramassages.afficheTelephone': 'Téléphone',
  'ramassages.afficheContact': 'Personne à joindre',
  'ramassages.afficheTelephoneAide':
    'Le livreur s’appelle en arrivant ; le numéro sert à le rappeler.',
  'ramassages.afficheNb': 'Nombre de colis annoncés',
  'ramassages.afficheNbAide':
    'Un engagement, pas un relevé : le nombre réellement collecté est saisi par le livreur.',
  'ramassages.afficheDetail': 'Précisions pour le livreur',
  'ramassages.afficheDetailAide': 'Quartier, étage, portail à code…',
  'ramassages.afficheAucunDetail': 'Aucune précision',
  'ramassages.afficheConfirme': 'Rendez-vous confirmé',
  'ramassages.afficheConfirmeAide':
    'RUNEX confirme, affecte un chauffeur et suit la collecte ; ces étapes vous sont notifiées.',
  'ramassages.formulaire.titre': 'Demander un ramassage',
  'ramassages.formulaire.date': 'Date souhaitée',
  'ramassages.formulaire.creneau': 'Créneau',
  'ramassages.formulaire.adresse': 'Adresse de collecte',
  'ramassages.formulaire.adresseAide': 'Zone industrielle Ben Arous, 2013',
  'ramassages.formulaire.adresseRappel':
    "Le livreur s'y rendra ; vos colis devront y être prêts.",
  'ramassages.formulaire.chevauchement':
    "Deux rendez-vous ne peuvent pas se chevaucher à la même date pour la même entreprise.",
  'ramassages.formulaire.contact': 'Personne à joindre',
  'ramassages.formulaire.contactAide': 'Karim Ben Youssef',
  'ramassages.formulaire.telephone': 'Téléphone',
  'ramassages.formulaire.telephoneAide': '20123456',
  'ramassages.formulaire.colis': 'Nombre de colis annoncés',
  'ramassages.formulaire.colisAide': 'Estimation : le livreur saisit le nombre réellement collecté.',
  'ramassages.formulaire.notes': 'Précisions pour le livreur',
  'ramassages.formulaire.notesAide': 'Quartier, étage, portail à code…',
  'ramassages.formulaire.soumettre': 'Demander ce ramassage',
  'ramassages.formulaire.envoi': 'Envoi en cours…',
  'ramassages.formulaire.succes': 'Demande enregistrée',
  'ramassages.formulaire.succesDetail':
    '{reference} — {date}, en attente de confirmation.',
  'ramassages.formulaire.erreur': 'La demande n\'a pas pu être enregistrée.',
  'ramassages.annuler': 'Annuler',
  'ramassages.annulerConfirme': 'Annuler ce rendez-vous ?',
  'ramassages.annulerAide':
    'La demande disparaît du planning de collecte. Si le rendez-vous est déjà confirmé, contactez le service client.',
  'ramassages.annule': 'Rendez-vous annulé',
  'ramassages.erreur': 'Les rendez-vous n\'ont pas pu être chargés.',

  // -------------------------------------------------------------- bordereaux
  'bordereaux.titre': 'Bordereaux',
  'bordereaux.sous-titre': 'Ce qui vous a été encaissé, et ce qui vous est payable.',
  'bordereaux.aucun': 'Aucun bordereau',
  'bordereaux.aucunDescription':
    'Les bordereaux apparaissent quand vos colis ont été livrés et encaissés.',
  'bordereaux.aucunCorrespond': 'Aucun bordereau ne correspond',
  'bordereaux.aucunCorrespondDescription':
    'Aucun bordereau de cette réponse ne correspond à ces critères.',
  'bordereaux.chargement': 'Chargement des bordereaux',
  'bordereaux.erreur': 'Vos bordereaux n\'ont pas pu être chargés.',
  'bordereaux.recherche': 'Rechercher un bordereau',
  'bordereaux.rechercheAide': 'N° de bordereau, moyen de paiement…',
  'bordereaux.recap.livres': 'Colis livrés',
  'bordereaux.recap.rendus': 'Colis rendus',
  'bordereaux.recap.net': 'Net payable',
  'bordereaux.montant.especes': 'Espèces',
  'bordereaux.montant.cheques': 'Chèques',
  'bordereaux.montant.fraisLivraison': 'Frais de livraison',
  'bordereaux.montant.fraisRetour': 'Frais de retour',
  'bordereaux.montant.retenue': 'Retenue à la source',
  'bordereaux.montant.net': 'Net payable',
  'bordereaux.payeLe': 'Payé le {date}',
  'bordereaux.creeLe': 'Créé le {date}',
  'bordereaux.plafondAtteint':
    'L’API plafonne cette liste à {n} bordereaux. Les plus récents sont affichés ; un historique plus long n’est pas exposé.',
  'bordereaux.listeComplete': '{n} bordereau(s) — la liste renvoyée par l’API est complète.',

  // ---------------------------------------------------------------- échanges
  'echanges.titre': 'Échanges',
  'echanges.sous-titre': 'articles repris et articles de remplacement',
  'echanges.aucun': 'Aucun échange enregistré',
  'echanges.aucunDescription':
    'Les échanges réalisés par les livreurs en tournée apparaîtront ici, avec l’article repris, l’article de remplacement et l’écart de prix.',
  'echanges.enCours':
    'Ce colis est de type « échange » mais aucun échange n’est encore enregistré. Il peut s’agir d’un échange en cours de tournée.',
  'echanges.articleRepris': 'Article repris',
  'echanges.articleRemplace': 'Article de remplacement',
  'echanges.ecart': 'Écart financier',
  'echanges.aPayer': 'À payer par le client : {montant}',
  'echanges.aRembourser': 'À rembourser : {montant}',
  'echanges.aucunEcart': 'Aucun écart de prix',
  'echanges.realiseLe': 'Réalisé le',
  'echanges.par': 'Par {nom}',

  // ----------------------------------------------------------------- retours
  'retours.titre': 'Ensembles de retours',
  'retours.ensemble.revenus': 'Revenus au dépôt',
  'retours.ensemble.revenusAide': 'colis de tout type ramenés par un livreur',
  'retours.ensemble.declares': 'Déclarés en retour',
  'retours.ensemble.declaresAide': 'colis annoncés comme retours dès le dépôt',
  'retours.sous-titre.revenus': 'colis ramenés par les livreurs',
  'retours.sous-titre.declares': 'annoncés comme retours dès la remise à RUNEX',
  'retours.statutsRetenus': 'statuts {statuts}',
  'retours.typeRetour': 'le type « retour »',
  'retours.aucunTitre.revenus': 'Aucun colis revenu au dépôt',
  'retours.aucunDescription.revenus':
    'Les refus de livraison, les échecs et les livraisons partielles apparaîtront ici avec leur motif.',
  'retours.aucunTitre.declares': 'Aucun retour déclaré',
  'retours.aucunDescription.declares':
    'Les colis que vous déclarez comme retours à la remise apparaîtront ici.',
  'retours.aucunPassage': 'Aucun passage en retour enregistré pour ce colis.',
  'retours.motif': 'Motif : {motif}',
  'retours.pieces': '{n} pièce(s)',
  'retours.montantRamene': 'Montant ramené : {montant}',
  'retours.montantInconnu': 'Montant non renseigné',
  'retours.aideFinal':
    'Un colis peut être présent dans les deux ensembles : déclaré en retour à la remise, puis ramené après une tentative de livraison.',
  'retours.suivre': 'Suivre un colis',

  // -------------------------------------------------------------- activités
  'activites.titre': 'Activités',
  'activites.sous-titre': 'Qui a fait quoi, sur quel colis, et à quelle heure.',
  'activites.choisirColis': 'Choisissez un colis',
  'activites.choisirColisAide':
    'Le journal d’activité est disponible colis par colis. Recherchez un numéro de suivi ou un destinataire pour consulter qui a modifié quoi.',
  'activites.rechercher': 'Colis dont on veut le journal',
  'activites.rechercherAide': 'N° de suivi, code-barres, destinataire…',
  'activites.bouton': 'Chercher',
  'activites.aucunColis': 'Aucun colis ne correspond à « {terme} ».',
  'activites.journalDe': 'Journal du colis {suivi}',
  'activites.ouvrirFiche': 'Ouvrir la fiche',
  'activites.chargement': 'Lecture du journal',
  'activites.erreur': "Journal d'audit inaccessible.",
  'activites.aucuneActivite': 'Aucune activité enregistrée',
  'activites.aucuneActiviteDescription':
    'Ce colis n’a fait l’objet d’aucune modification traçable depuis sa création.',
  'activites.auteurSysteme': 'Système',
  'activites.engagement': 'Engagement',
  'activites.motifManquant':
    'Cette opération exigeait un motif, aucun n’a été renseigné.',
  'activites.valeursAvantApres': 'Valeurs avant / après',
  'activites.aucuneValeur': 'Aucune valeur enregistrée.',
  'activites.plafond':
    'Seules les {n} entrées les plus récentes sont renvoyées par l’API. Un historique plus long existe mais n’est pas exposé.',

  // ----------------------------------------------------------- notifications
  'notifications.titre': 'Notifications',
  'notifications.sous-titre.tempsReel': 'Mises à jour en direct',
  'notifications.sous-titre.pertes': 'Connexion temps réel interrompue',
  'notifications.actualiser': 'Actualiser',
  'notifications.toutLu': 'Tout marquer comme lu',
  'notifications.filtres': 'Filtrer les notifications',
  'notifications.filtre.toutes': 'Toutes',
  'notifications.filtre.non-lues': 'Non lues',
  'notifications.aucuneNonLue': 'Aucune notification non lue',
  'notifications.aucuneFiltre': 'Aucun résultat pour ce filtre',
  'notifications.aucuneAide':
    'Les statuts de vos colis, les ramassages et les encaissements apparaîtront ici.',
  'notifications.nonLue': 'Non lue',
  'notifications.interne': 'interne à RUNEX',
  'notifications.erreur': 'Les notifications n\'ont pas pu être chargées.',

  // ----------------------------------------------------------------- profil
  'profil.titre': 'Profil',
  'profil.sous-titre': 'Les informations de votre compte et ce qu\'il est autorisé à faire.',
  'profil.compteExpediteur': 'Compte expéditeur',
  'profil.email': 'Adresse électronique',
  'profil.telephone': 'Téléphone',
  'profil.telephoneAbsent': 'Non renseigné',
  'profil.role': 'Rôle',
  'profil.roleExpediteur': 'Expéditeur — consultation et déclaration de vos colis',
  'profil.droits': 'Droits accordés',
  'profil.droitsAide':
    'Liste renvoyée par l’API pour ce compte. Elle décrit le rôle, pas les écrans de ce portail.',
  'profil.aucunDroit': 'Aucun droit retourné.',
  'profil.motDePasse': 'Mot de passe',
  'profil.motDePasseAide':
    'Le portail ne permet pas de changer un mot de passe. La réinitialisation passe par un lien envoyé par courriel — l’API ne propose rien d’autre.',
  'profil.reinitialiser': 'Envoyer un lien de réinitialisation',
  'profil.reinitialiserEnvoi': 'Envoi en cours…',
  'profil.reinitialiserEnvoye':
    'Si un compte existe pour {email}, un lien de réinitialisation vient d’être envoyé.',
  'profil.reinitialiserEchec': "La demande n'a pas pu être envoyée. Réessayez plus tard.",
  'profil.session': 'Session',
  'profil.sessionAide':
    'Vous êtes connecté avec ce compte. Les notifications et les colis affichés lui appartiennent : changer de compte change ce que l’écran montre.',
  'profil.rafraichir': 'Rafraîchir la session',
  'profil.deconnexion': 'Se déconnecter',
  'profil.verifieLe': 'Profil vérifié auprès de l’API le {date}.',
  'profil.erreur': 'Profil non actualisé.',
  'profil.copieImpossible':
    'Copie impossible dans ce navigateur. L’adresse reste visible ci-dessus.',

  // ----------------------------------------------------------------- filtres
  'filtre.statut': 'Statut',
  'filtre.type': 'Type',
  'filtre.gouvernorat': 'Gouvernorat',
  'filtre.tousStatuts': 'Tous les statuts',
  'filtre.tousTypes': 'Tous les types',
  'filtre.tousGouvernorats': 'Tous les gouvernorats',
  'filtre.libelle': 'colis',
  'filtre.categorie': 'catégorie {libelle}',
  'filtre.recherche': 'recherche « {terme} »',
  'filtre.terme': '« {terme} »',

  // ------------------------------------------------------------- vocabulaire
  'type.NORMAL': 'Livraison normale',
  'type.EXCHANGE': 'Échange',
  'type.REPORTED': 'Colis signalé',
  'type.RETURN': 'Retour expéditeur',
  'taille.LEGERE': 'Légère',
  'taille.MOYENNE': 'Moyenne',
  'taille.LOURDE': 'Lourde',
  'taille.VOLUMINEUSE': 'Volumineuse',
  'rdv.A_CONFIRMER': 'À confirmer',
  'rdv.EN_ATTENTE': 'En attente',
  'rdv.ASSIGNE': 'Chauffeur affecté',
  'rdv.EN_COURS': 'Collecte en cours',
  'rdv.EFFECTUE': 'Effectué',
  'rdv.ANNULE': 'Annulé',
  'bordereauStatut.EN_ATTENTE': 'En attente',
  'bordereauStatut.CONFIRME': 'Confirmé',
  'bordereauStatut.PAYE': 'Réglé',
  'bordereauStatut.ANNULE': 'Annulé',
  'moyenPaiement.ESPECE': 'Espèces',
  'moyenPaiement.CHEQUE': 'Chèque',
  /*
   * Les quatre moyens ci-dessous existent en base mais ne sont pas proposés à
   * la saisie (`PAYMENT_METHOD_REGISTRY` n'ouvre que espèces et chèque). Ils
   * restent traduits parce qu'un bordereau ancien peut en porter un : sans
   * libellé, l'écran afficherait `VIREMENT` en toutes capitales au milieu d'une
   * phrase française. Traduire une valeur que la saisie ne produit pas encore
   * coûte une ligne ; ne pas la traduire se voit le jour où elle apparaît.
   */
  'moyenPaiement.VIREMENT': 'Virement',
  'moyenPaiement.TRAITE': 'Traite',
  'moyenPaiement.CARTE_BANCAIRE': 'Carte bancaire',
  'moyenPaiement.PAIEMENT_EN_LIGNE': 'Paiement en ligne',
  'paiement.NON_REGLE': 'Non encaissé',
  'paiement.EN_BORDEREAU': 'En bordereau',
  'paiement.PAYE': 'Encaissé',
  'etape.preparation': 'En préparation',
  'etape.preparation.aide': 'Déclarés, pas encore confiés à un transporteur',
  'etape.attente-ramassage': 'En attente de ramassage',
  'etape.attente-ramassage.aide': 'Inclus dans un rendez-vous de collecte',
  'etape.ramasse': 'Collectés',
  'etape.ramasse.aide': 'Repris par le livreur collecteur',
  'etape.en-livraison': 'En livraison',
  'etape.en-livraison.aide': 'Confiés à un livreur, en cours de distribution',
  'etape.livre': 'Livrés',
  'etape.livre.aide': 'Livrés et encaissés',
  'etape.reporte': 'Reportés',
  'etape.reporte.aide': 'Livraison reportée à une date ultérieure',
  'etape.echec': 'Échecs de livraison',
  'etape.echec.aide': 'Refus ou destinataire injoignable',

  // --------------------------------------------------------------- statuts
  'statut.CREE': 'En préparation',
  'statut.RAMASSAGE_PROGRAMME': 'Ramassage programmé',
  'statut.RAMASSE': 'Collecté',
  'statut.RECU_DEPOT': 'Reçu au dépôt',
  'statut.EN_LOT_INTER_DEPOT': 'En lot inter-dépôts',
  'statut.EN_TRANSIT_INTER_DEPOT': 'En transit inter-dépôts',
  'statut.RECU_DEPOT_DESTINATION': 'Reçu au dépôt de destination',
  'statut.AFFECTE_RUNSHEET': 'Affecté à une tournée',
  'statut.EN_COURS_LIVRAISON': 'En cours de livraison',
  'statut.LIVRE': 'Livré',
  'statut.LIVRAISON_PARTIELLE': 'Livraison partielle',
  'statut.REPORTE': 'Reporté',
  'statut.ECHEC_LIVRAISON': 'Échec de livraison',
  'statut.RETOUR_DEPOT': 'Retour au dépôt',
  'statut.EN_RUNSHEET_RETOUR': 'En tournée de retour',
  'statut.RETOURNE_EXPEDITEUR': 'Retourné à l\'expéditeur',
  'statut.ANNULE': 'Annulé',

  // ------------------------------------------------------- notifications (API)
  'notif.categorie.colis': 'Colis',
  'notif.categorie.livraison': 'Livraison',
  'notif.categorie.finance': 'Finance',
  'notif.categorie.tournee': 'Tournées',
  'notif.categorie.transfert': 'Inter-dépôts',

  /*
   * Intitulés de notification.
   *
   * Le titre d'une notification est une phrase produite par l'API
   * (`notificationDispatcher.notify({ title: … })`) et stockée telle quelle en
   * base. Le corpus est fermé : dix-neuf intitulés, énumérés dans
   * `TITRES_NOTIFICATION` (`features/expediteur/lib/libelles.ts`), qui fait
   * correspondre la phrase du serveur à l'une de ces clés.
   *
   * Le corps (`content`), lui, n'est pas traduit : il embarque des numéros de
   * suivi, des noms et des montants assemblés côté serveur. Le reformuler ici
   * reviendrait à réécrire des données, avec le risque d'afficher autre chose
   * que ce qui s'est passé.
   *
   * Un intitulé inconnu — ajouté côté API sans mise à jour de cette table —
   * s'affiche tel quel : c'est le comportement actuel, et il vaut mieux une
   * phrase française qu'un trou.
   */
  'notif.titre.colisATraiter': 'Nouveau colis à traiter',
  'notif.titre.colisModifie': 'Colis modifié',
  'notif.titre.montantModifie': 'Montant modifié sur un colis',
  'notif.titre.piecesModifiees': 'Nombre de pièces modifié',
  'notif.titre.statutModifie': 'Statut de livraison modifié',
  'notif.titre.colisAffecte': 'Nouvelle livraison à effectuer',
  'notif.titre.colisDansTournee': 'Colis intégré à une tournée',
  'notif.titre.colisAjouteTournee': 'Colis ajouté à votre tournée',
  'notif.titre.colisLivre': 'Colis livré',
  'notif.titre.livraisonPartielle': 'Livraison partielle',
  'notif.titre.livraisonReportee': 'Livraison reportée',
  'notif.titre.colisRetourne': 'Colis restitué à l\'expéditeur',
  'notif.titre.ramassageDemande': 'Nouvelle demande de ramassage',
  'notif.titre.ramassageConfirme': 'Créneau de ramassage confirmé',
  'notif.titre.ramassageACollecter': 'Ramassage à collecter',
  'notif.titre.ramassageEffectue': 'Ramassage effectué',
  'notif.titre.ramassageAnnule': 'Ramassage annulé',
  'notif.titre.encaissementAValider': 'Encaissement à valider',
  'notif.titre.encaissementValide': 'Encaissement validé',

  // --------------------------------------------------------- gouvernorats
  /*
   * Gouvernorats — les clés sont les valeurs de `APP_CONFIG.governorates`,
   * caractère accentué compris.
   *
   * Ce n'est pas une liberté d'écriture : `traduireValeur('gou', …)` cherche
   * `${famille}.${valeur}` avec la chaîne venue du serveur. Une clé « Manouba »
   * ne rencontre jamais la valeur « La Manouba », et la recherche retombe sur la
   * valeur brute. En français le repli se confond avec le libellé — l'anomalie
   * est invisible — mais en arabe elle affiche le nom français au milieu d'un
   * écran arabe. Les 24 clés suivent donc la liste du référentiel, dans son
   * ordre, accents compris.
   */
  'gou.Ariana': 'Ariana',
  'gou.Béja': 'Béja',
  'gou.Ben Arous': 'Ben Arous',
  'gou.Bizerte': 'Bizerte',
  'gou.Gabès': 'Gabès',
  'gou.Gafsa': 'Gafsa',
  'gou.Jendouba': 'Jendouba',
  'gou.Kairouan': 'Kairouan',
  'gou.Kasserine': 'Kasserine',
  'gou.Kébili': 'Kébili',
  'gou.Le Kef': 'Le Kef',
  'gou.Mahdia': 'Mahdia',
  'gou.La Manouba': 'La Manouba',
  'gou.Médenine': 'Médenine',
  'gou.Monastir': 'Monastir',
  'gou.Nabeul': 'Nabeul',
  'gou.Sfax': 'Sfax',
  'gou.Sidi Bouzid': 'Sidi Bouzid',
  'gou.Siliana': 'Siliana',
  'gou.Sousse': 'Sousse',
  'gou.Tataouine': 'Tataouine',
  'gou.Tozeur': 'Tozeur',
  'gou.Tunis': 'Tunis',
  'gou.Zaghouan': 'Zaghouan',

  // ----------------------------------------------------------------- erreurs
  'erreur.titre': 'Une erreur est survenue',
  'erreur.generique': 'Impossible de charger les données. Veuillez vérifier votre connexion ou réessayer.',
  'erreur.sessionExpiree': 'Votre session a expiré. Reconnectez-vous pour continuer.',
  'erreur.accesRefuse': 'Accès refusé',
  'erreur.reseau': 'Le serveur ne répond pas. Vérifiez votre connexion.',
  'erreur.champRequis': 'Ce champ est obligatoire.',
  'erreur.validation': 'Certaines informations sont incorrectes. Vérifiez les champs signalés.',
} as const;

/*
 * `typeof fr` ne convient pas comme type de dictionnaire : `as const` fige
 * chaque valeur en littéral, et l'arabe serait alors obligé de répéter le
 * français. Ce qui doit coïncider entre les deux langues, c'est l'ensemble des
 * clés — la valeur est une chaîne, traduite ou non.
 */
export type Cle = keyof typeof fr;
export type Dictionnaire = Record<Cle, string>;