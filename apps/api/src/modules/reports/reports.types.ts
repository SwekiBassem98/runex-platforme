/**
 * Contrats des rapports.
 *
 * Ils sont définis une seule fois, dans les types partagés : l'API les produit
 * et l'interface les consomme, et deux copies divergeraient au premier champ
 * ajouté d'un côté seulement — sans que rien ne le dise, jusqu'à ce qu'un
 * montant s'affiche `undefined` à l'écran.
 */
export type {
  DomaineRapport,
  EnteteRapport,
  FiltresRapport,
  Montant,
  Rapport,
  RapportColis,
  RapportDepots,
  RapportExpediteurs,
  RapportFinance,
  RapportLivreurs,
  SerieJour,
} from '@logixpress/types';
