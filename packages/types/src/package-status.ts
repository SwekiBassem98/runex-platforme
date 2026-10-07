/**
 * Énumérations du cycle de vie d'un colis.
 *
 * Elles vivent dans leur propre module, et non dans `index.ts`, parce que la
 * machine à états (`package-workflow.ts`) en a besoin. Les faire exporter par
 * `index.ts` créerait un cycle : selon le point d'entrée, `PackageStatus`
 * serait `undefined` au moment où la machine à états s'évalue, ce qui fait
 * échouer le rendu du frontend à la construction.
 */

export enum PackageType {
  NORMAL = 'NORMAL',
  EXCHANGE = 'EXCHANGE',
  REPORTED = 'REPORTED',
  RETURN = 'RETURN',
}

export enum PackageSize {
  LEGERE = 'LEGERE',
  MOYENNE = 'MOYENNE',
  LOURDE = 'LOURDE',
  VOLUMINEUSE = 'VOLUMINEUSE',
}

/**
 * Cycle de vie d'un colis.
 *
 * L'ordre reflète la progression normale du colis, du dépôt au client, puis
 * les voies d'exception (retour, annulation).
 */
export enum PackageStatus {
  CREE = 'CREE',
  RAMASSAGE_PROGRAMME = 'RAMASSAGE_PROGRAMME',
  RAMASSE = 'RAMASSE',
  RECU_DEPOT = 'RECU_DEPOT',
  EN_LOT_INTER_DEPOT = 'EN_LOT_INTER_DEPOT',
  EN_TRANSIT_INTER_DEPOT = 'EN_TRANSIT_INTER_DEPOT',
  RECU_DEPOT_DESTINATION = 'RECU_DEPOT_DESTINATION',
  AFFECTE_RUNSHEET = 'AFFECTE_RUNSHEET',
  EN_COURS_LIVRAISON = 'EN_COURS_LIVRAISON',
  LIVRE = 'LIVRE',
  LIVRAISON_PARTIELLE = 'LIVRAISON_PARTIELLE',
  REPORTE = 'REPORTE',
  ECHEC_LIVRAISON = 'ECHEC_LIVRAISON',
  RETOUR_DEPOT = 'RETOUR_DEPOT',
  EN_RUNSHEET_RETOUR = 'EN_RUNSHEET_RETOUR',
  RETOURNE_EXPEDITEUR = 'RETOURNE_EXPEDITEUR',
  ANNULE = 'ANNULE',
}

/**
 * Libellés français des statuts de colis.
 *
 * Volontairement sans style : ce sont des mots, pas des couleurs. La couche
 * d'habillage de l'interface en dérive (`PACKAGE_STATUS_MAP`), ce qui évite la
 * situation où un écran dit « En Cours de Livraison » et une notification
 * « En cours », pour la même chose.
 *
 * Les notifications en ont besoin côté API, où aucun composant d'interface
 * n'existe — or faire dépendre l'API d'un paquet d'habillage pour traduire un
 * mot serait une dépendance à l'envers.
 */
export const PACKAGE_STATUS_LABELS: Readonly<Record<PackageStatus, string>> = {
  CREE: 'Créé',
  RAMASSAGE_PROGRAMME: 'Ramassage prévu',
  RAMASSE: 'Ramassé',
  RECU_DEPOT: 'Reçu au dépôt',
  EN_LOT_INTER_DEPOT: 'En lot inter-dépôt',
  EN_TRANSIT_INTER_DEPOT: 'En transit inter-dépôt',
  RECU_DEPOT_DESTINATION: 'Arrivé en agence',
  AFFECTE_RUNSHEET: 'Affecté à une tournée',
  EN_COURS_LIVRAISON: 'En cours de livraison',
  LIVRE: 'Livré',
  LIVRAISON_PARTIELLE: 'Livraison partielle',
  REPORTE: 'Reporté',
  ECHEC_LIVRAISON: 'Échec ou refus',
  RETOUR_DEPOT: 'Retour au dépôt',
  EN_RUNSHEET_RETOUR: 'En retour fournisseur',
  RETOURNE_EXPEDITEUR: 'Retourné à l\'expéditeur',
  ANNULE: 'Annulé',
};

/** Libellé d'un statut, avec repli sur la valeur brute pour un statut inconnu. */
export function packageStatusLabel(status: string): string {
  return PACKAGE_STATUS_LABELS[status as PackageStatus] ?? status;
}
