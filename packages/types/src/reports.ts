export type DomaineRapport = 'colis' | 'expediteurs' | 'livreurs' | 'finance' | 'depots';

/**
 * Contrats des rapports d'exploitation, partagés par l'API et l'interface.
 *
 * Les montants sont des chaînes à trois décimales : le dinar est un décimal en
 * base, et un rapport financier affiché en flottant finit par annoncer un
 * centime de trop après une addition.
 */

export type Montant = string;

export interface EnteteRapport {
  /** Bornes effectivement appliquées, en clair. */
  periode: string;
  /**
   * Domaine du rapport.
   *
   * Ce n'est pas décoratif : il rend l'union discriminée, donc vérifiable.
   * L'interface peut passer le rapport au bon composant sans `as` ni `any`, et
   * un jour où l'API renverrait la mauvaise forme sous le bon onglet, le
   * typage le signalerait au lieu qu'un composant affiche `undefined`.
   */
  domaine: DomaineRapport;
  from: string | null;
  to: string | null;
  /** Ce que l'appelant était autorisé à voir, en clair. */
  perimetre: string;
  genereLe: string;
}

export interface SerieJour {
  jour: string;
  libelle: string;
}

export interface RapportColis extends EnteteRapport {
  domaine: 'colis';
  totaux: {
    crees: number;
    livres: number;
    livraisonPartielle: number;
    reportes: number;
    echecs: number;
    retournes: number;
    annules: number;
    echanges: number;
    enCours: number;
  };
  taux: { livraison: number; incident: number };
  parJour: Array<SerieJour & { crees: number; livres: number; incidents: number }>;
  parStatut: Array<{ statut: string; libelle: string; count: number }>;
  parMotifIncident: Array<{ motif: string; count: number }>;
}

export interface RapportExpediteurs extends EnteteRapport {
  domaine: 'expediteurs';
  totaux: {
    colis: number;
    livres: number;
    incidents: number;
    tauxReussite: number;
    montantConfie: Montant;
    montantDu: Montant;
    montantEncaisse: Montant;
    nonEncaisse: Montant;
  };
  expediteurs: Array<{
    id: string;
    code: string;
    nom: string;
    colis: number;
    livres: number;
    incidents: number;
    tauxReussite: number;
    montantDu: Montant;
    montantEncaisse: Montant;
    nonEncaisse: Montant;
  }>;
  concentration: Array<{ nom: string; colis: number; montantConfie: Montant }>;
}

export interface RapportLivreurs extends EnteteRapport {
  domaine: 'livreurs';
  totaux: {
    livreurs: number;
    affectes: number;
    livres: number;
    echecs: number;
    retournes: number;
    enCours: number;
    montantEncaisse: Montant;
    tauxReussite: number;
    deficitDeclare: Montant;
  };
  livreurs: Array<{
    id: string;
    code: string;
    nom: string;
    vehicule: string;
    affectes: number;
    livres: number;
    echecs: number;
    retournes: number;
    enCours: number;
    tauxReussite: number;
    montantEncaisse: Montant;
    deficitDeclare: Montant;
    soldeEspeces: Montant;
    tentatives: number;
    dernierTour: string | null;
  }>;
  parMotifEchec: Array<{ motif: string; count: number }>;
}

export interface RapportFinance extends EnteteRapport {
  domaine: 'finance';
  totaux: {
    attendu: Montant;
    encaisse: Montant;
    manquant: Montant;
    tauxRecouvrement: number;
    valide: Montant;
    enAttente: Montant;
    ecart: Montant;
    nbEcarts: number;
    nbRejets: number;
  };
  parStatut: Array<{
    statut: string;
    libelle: string;
    count: number;
    attendu: Montant;
    encaisse: Montant;
    rembourse: Montant;
  }>;
  parMoyen: Array<{
    moyen: string;
    libelle: string;
    count: number;
    attendu: Montant;
    encaisse: Montant;
  }>;
  ecarts: Array<{
    id: string;
    numero: string;
    livreur: string;
    expediteur: string;
    attendu: Montant;
    encaisse: Montant;
    ecart: Montant;
    statut: string;
    motif: string | null;
    collecteLe: string;
  }>;
  parJour: Array<SerieJour & { attendu: Montant; encaisse: Montant; nb: number }>;
}

export interface RapportDepots extends EnteteRapport {
  domaine: 'depots';
  totaux: {
    depots: number;
    recus: number;
    livres: number;
    retournes: number;
    transferes: number;
    recusTransfert: number;
    stockActuel: number;
  };
  depots: Array<{
    id: string;
    code: string;
    nom: string;
    ville: string;
    actif: boolean;
    recus: number;
    livres: number;
    retournes: number;
    stock: number;
    enTransfert: number;
    enTransit: number;
  }>;
  transferts: Array<{
    id: string;
    numero: string;
    source: string;
    destination: string;
    colisAttendus: number;
    colisRecus: number;
    ecart: number;
    statut: string;
    libelleStatut: string;
    expedieLe: string | null;
    recuLe: string | null;
  }>;
  stockImmobile: Array<{
    depot: string;
    colis: number;
    plusAncienJours: number;
    montant: Montant;
  }>;
}

export interface FiltresRapport {
  from?: string | null;
  to?: string | null;
}

export type Rapport =
  | RapportColis
  | RapportExpediteurs
  | RapportLivreurs
  | RapportFinance
  | RapportDepots;
