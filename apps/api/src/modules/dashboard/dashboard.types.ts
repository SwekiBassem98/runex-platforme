/**
 * Forme du tableau de bord, partagée par le service et ses consommateurs.
 *
 * Isolée du service pour que la mise en page des graphiques puisse evolutionner
 * sans arrastrer la logique d'agrégation.
 */

export interface DashboardMetricsDto {
  colis: {
    total: number;
    nouveaux: number;
    aAffecter: number;
    affectes: number;
    enLivraison: number;
    livres: number;
    reportes: number;
    retournes: number;
    annules: number;
    echanges: number;
    /** Part des colis livrés sur les colis arrivés à terme de livraison. */
    tauxReussite: number;
  };
  livreurs: {
    actifs: number;
    disponibles: number;
    enTournee: number;
    horsLigne: number;
    total: number;
  };
  ramassages: {
    aConfirmer: number;
    planifies: number;
    enCours: number;
    effectues: number;
    annules: number;
    total: number;
  };
  paiements: {
    montantAEncaisserTND: number;
    montantEncaisseTND: number;
    paiementsEnAttenteTND: number;
    paiementsValidesTND: number;
    retoursFinanciersTND: number;
    deficitCaisseTND: number;
  };
  depots: {
    colisAuDepot: number;
    colisInTransit: number;
    interDepotsActifs: number;
    agencesActives: number;
  };
  charts: {
    deliveriesOverTime: { label: string; colis: number; livres: number }[];
    deliveredVsReturned: { name: string; value: number; color: string }[];
    codAmounts: { name: string; aEncaisser: number; encaisse: number }[];
    driverActivity: { name: string; livraisons: number; echecs: number }[];
    supplierActivity: { name: string; colis: number; montantTND: number }[];
  };
  alerts: {
    id: string;
    type: 'danger' | 'warning' | 'info';
    category: string;
    title: string;
    count: number;
    message: string;
    actionLabel: string;
    actionUrl: string;
  }[];
  recentActivity: {
    id: string;
    timestamp: string;
    type: 'SCAN' | 'DELIVERY' | 'RUNSHEET' | 'PAYMENT' | 'PICKUP';
    title: string;
    description: string;
    actor: string;
    badge?: string;
  }[];
}
