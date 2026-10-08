/**
 * Machine à états du colis RUNEX.
 *
 * Source de vérité unique des transitions de statut et des règles
 * d'édition. Le backend s'en sert pour *valider* chaque transition, le frontend
 * pour n'afficher que les actions autorisées : les deux ne peuvent pas diverger.
 *
 * Toute évolution du cycle de vie d'un colis doit être décrite ici.
 */

import { PackageStatus, PackageType } from './package-status';

/** Statuts terminaux : le colis sort du cycle opérationnel. */
export const TERMINAL_PACKAGE_STATUSES: readonly PackageStatus[] = [
  PackageStatus.LIVRE,
  PackageStatus.RETOURNE_EXPEDITEUR,
  PackageStatus.ANNULE,
];

/**
 * Statuts où l'expéditeur est encore pleinement maître de son colis : il peut
 * modifier les informations (client, adresse, montant, pièces…) sans
 * conséquence opérationnelle, et l'annuler.
 */
export const SHIPPER_FULLY_EDITABLE: readonly PackageStatus[] = [
  PackageStatus.CREE,
  PackageStatus.RAMASSAGE_PROGRAMME,
  PackageStatus.RAMASSE,
];

/**
 * Statuts où la modification reste possible mais devient *restreinte* : le
 * colis est entré dans le processus logistique. Une modification de donnée
 * critique (montant, nombre de pièces) déclenche une notification au
 * chauffeur et une entrée d'audit.
 */
export const SHIPPER_RESTRICTED_EDITABLE: readonly PackageStatus[] = [
  PackageStatus.RECU_DEPOT,
  PackageStatus.EN_LOT_INTER_DEPOT,
  PackageStatus.EN_TRANSIT_INTER_DEPOT,
  PackageStatus.RECU_DEPOT_DESTINATION,
  PackageStatus.REPORTE,
  PackageStatus.AFFECTE_RUNSHEET,
  PackageStatus.EN_COURS_LIVRAISON,
];

/**
 * Statuts verrouillés : aucune modification n'est acceptée, quel que soit
 * l'acteur. Le cycle opérationnel du colis est clôturé ou pris en charge par
 * un processus de retour.
 */
export const PACKAGE_STATUSES_LOCKED: readonly PackageStatus[] = [
  PackageStatus.LIVRE,
  PackageStatus.LIVRAISON_PARTIELLE,
  PackageStatus.ECHEC_LIVRAISON,
  PackageStatus.RETOUR_DEPOT,
  PackageStatus.EN_RUNSHEET_RETOUR,
  PackageStatus.RETOURNE_EXPEDITEUR,
  PackageStatus.ANNULE,
];

/**
 * Transitions autorisées, exprimées comme une table.
 *
 * Toute transition absente de cette table est rejetée par l'API avec une
 * erreur 409. Les clés absentes signifient « statut d'arrivée » : aucune
 * transition sortante n'est possible.
 */
export const PACKAGE_STATUS_TRANSITIONS: Readonly<Record<PackageStatus, readonly PackageStatus[]>> = {
  // --- Création et amont logistique ---
  [PackageStatus.CREE]: [
    PackageStatus.RAMASSAGE_PROGRAMME,
    PackageStatus.RECU_DEPOT,
    PackageStatus.AFFECTE_RUNSHEET,
    PackageStatus.ANNULE,
  ],
  [PackageStatus.RAMASSAGE_PROGRAMME]: [
    PackageStatus.RAMASSE,
    PackageStatus.RECU_DEPOT,
    PackageStatus.AFFECTE_RUNSHEET,
    PackageStatus.ANNULE,
  ],
  [PackageStatus.RAMASSE]: [
    PackageStatus.RECU_DEPOT,
    PackageStatus.AFFECTE_RUNSHEET,
    PackageStatus.ANNULE,
  ],

  // --- Dépôt et acheminement ---
  // Le chargement scanné d'un inter-dépôt fait partir le colis : il quitte le
  // stock du dépôt au scan (pas d'étape de lot intermédiaire).
  [PackageStatus.RECU_DEPOT]: [
    PackageStatus.EN_LOT_INTER_DEPOT,
    PackageStatus.EN_TRANSIT_INTER_DEPOT,
    PackageStatus.AFFECTE_RUNSHEET,
    PackageStatus.ANNULE,
  ],
  // Les deux sorties « retour au dépôt d'origine » sont les annulations de
  // transfert. Elles n'ont rien d'un détour : un lot annulé n'a jamais quitté le
  // dépôt, il y revient. Les déclarer ici, et seulement ici, évite que le
  // module inter-dépôts ait à contourner la table pour les écrire.
  [PackageStatus.EN_LOT_INTER_DEPOT]: [
    PackageStatus.EN_TRANSIT_INTER_DEPOT,
    PackageStatus.RECU_DEPOT,
  ],
  // Arrivée : à l'agence qui livre (RECU_DEPOT_DESTINATION), à un dépôt de
  // passage (RECU_DEPOT), ou, pour un retour, à l'agence de l'expéditeur
  // (RETOUR_DEPOT). Les mêmes sorties servent au retrait d'un colis du
  // bordereau, qui le remet dans son état d'avant chargement.
  [PackageStatus.EN_TRANSIT_INTER_DEPOT]: [
    PackageStatus.RECU_DEPOT_DESTINATION,
    PackageStatus.RECU_DEPOT,
    PackageStatus.RETOUR_DEPOT,
  ],
  // Un colis arrivé dans une agence peut encore repartir vers une autre
  // (passage par le hub de tri).
  [PackageStatus.RECU_DEPOT_DESTINATION]: [
    PackageStatus.AFFECTE_RUNSHEET,
    PackageStatus.EN_TRANSIT_INTER_DEPOT,
  ],

  // --- Dernier kilomètre ---
  [PackageStatus.AFFECTE_RUNSHEET]: [
    PackageStatus.EN_COURS_LIVRAISON,
    PackageStatus.LIVRE,
    PackageStatus.LIVRAISON_PARTIELLE,
    PackageStatus.REPORTE,
    PackageStatus.ECHEC_LIVRAISON,
    PackageStatus.RETOUR_DEPOT,
  ],
  [PackageStatus.EN_COURS_LIVRAISON]: [
    PackageStatus.LIVRE,
    PackageStatus.LIVRAISON_PARTIELLE,
    PackageStatus.REPORTE,
    PackageStatus.ECHEC_LIVRAISON,
    PackageStatus.RETOUR_DEPOT,
  ],

  // --- Reprises et échecs ---
  [PackageStatus.REPORTE]: [
    PackageStatus.AFFECTE_RUNSHEET,
    PackageStatus.EN_COURS_LIVRAISON,
    PackageStatus.LIVRE,
    PackageStatus.LIVRAISON_PARTIELLE,
    PackageStatus.ECHEC_LIVRAISON,
  ],
  [PackageStatus.ECHEC_LIVRAISON]: [
    PackageStatus.AFFECTE_RUNSHEET,
    PackageStatus.RETOUR_DEPOT,
  ],
  // Une livraison partielle se solde de deux façons : le client accepte de
  // ne pas payer le solde et le colis est considéré livré, ou il rend ce qui
  // reste et le colis repart au dépôt. Les deux issues sont normales ; choisir
  // entre elles ne doit pas être un blocage.
  [PackageStatus.LIVRAISON_PARTIELLE]: [
    PackageStatus.LIVRE,
    PackageStatus.RETOUR_DEPOT,
    PackageStatus.EN_RUNSHEET_RETOUR,
  ],

  // --- Retours ---
  [PackageStatus.RETOUR_DEPOT]: [
    PackageStatus.RECU_DEPOT,
    PackageStatus.EN_RUNSHEET_RETOUR,
    PackageStatus.RETOURNE_EXPEDITEUR,
    // Retour rendu à l'agence de l'expéditeur par inter-dépôt retours.
    PackageStatus.EN_TRANSIT_INTER_DEPOT,
  ],
  [PackageStatus.EN_RUNSHEET_RETOUR]: [PackageStatus.RETOURNE_EXPEDITEUR],

  // --- États terminaux ---
  [PackageStatus.LIVRE]: [],
  [PackageStatus.RETOURNE_EXPEDITEUR]: [],
  [PackageStatus.ANNULE]: [],
};

/** Statuts suivants possibles depuis un statut donné. */
export function allowedNextStatuses(status: PackageStatus): readonly PackageStatus[] {
  return PACKAGE_STATUS_TRANSITIONS[status] ?? [];
}

/**
 * Ce qu'une transition exige comme données, en plus de sa légitimité.
 *
 * Autoriser une transition sans exiger sa justification produit un historique
 * inexploitable : un « reporté » sans motif ne distingue pas un client absent
 * d'une adresse fausse, et c'est pourtant ce que l'on pilote par zone. Les
 * exigences sont donc déclarées ici, au même endroit que les transitions, pour
 * qu'ajouter un cas de la machine à états oblige à dire ce qu'il prouve.
 */
export interface TransitionRequirements {
  /** Un motif est obligatoire : sans lui, l'événement n'est pas interpretable. */
  reasonRequired: boolean;
  /** Le contenu livré doit être décrit (mesure la part réellement remise). */
  deliveredContentRequired: boolean;
  /** Le contenu repris doit être décrit (mesure la part qui repart). */
  returnedContentRequired: boolean;
  /** Le montant encaissé doit être indiqué explicitement. */
  collectedAmountRequired: boolean;
  /** Le montant non encaissé doit être indiqué explicitement. */
  returnedAmountRequired: boolean;
  /** Le lieu de l'événement est obligatoire : une livraison n'a pas d'ailleurs. */
  locationRequired: boolean;
}

const NO_REQUIREMENT: TransitionRequirements = {
  reasonRequired: false,
  deliveredContentRequired: false,
  returnedContentRequired: false,
  collectedAmountRequired: false,
  returnedAmountRequired: false,
  locationRequired: false,
};

/**
 * Exigences de données par statut d'arrivée.
 *
 * La convention : un statut qui *constate* un impayé, un refus ou un report
 * exige sa preuve. Un statut qui constate un simple mouvement physique
 * (conditionnement, transit, pointage) n'en exige aucune.
 */
export const PACKAGE_TRANSITION_REQUIREMENTS: Readonly<
  Record<PackageStatus, TransitionRequirements>
> = {
  // Mouvements physiques : la position suffit, rien à justifier.
  CREE: NO_REQUIREMENT,
  RAMASSAGE_PROGRAMME: NO_REQUIREMENT,
  RAMASSE: NO_REQUIREMENT,
  RECU_DEPOT: NO_REQUIREMENT,
  EN_LOT_INTER_DEPOT: NO_REQUIREMENT,
  EN_TRANSIT_INTER_DEPOT: NO_REQUIREMENT,
  RECU_DEPOT_DESTINATION: NO_REQUIREMENT,
  AFFECTE_RUNSHEET: NO_REQUIREMENT,
  EN_COURS_LIVRAISON: NO_REQUIREMENT,

  // Issues de tournée : chacune doit pouvoir être expliquée plus tard.
  LIVRE: { ...NO_REQUIREMENT, locationRequired: true },
  REPORTE: {
    ...NO_REQUIREMENT,
    reasonRequired: true,
    locationRequired: true,
  },
  ECHEC_LIVRAISON: {
    ...NO_REQUIREMENT,
    reasonRequired: true,
    locationRequired: true,
  },
  RETOUR_DEPOT: {
    ...NO_REQUIREMENT,
    reasonRequired: true,
    locationRequired: true,
  },
  // Une livraison partielle est le seul cas où l'on doit pouvoir dire, sans
  // rouvrir le dossier, ce qui a été remis, ce qui est reparti, et ce qui a
  // été payé. Les quatre données sont obligatoires : sans elles, l'écart
  // comptable entre le montant dû et le montant encaissé n'est pas traçable.
  LIVRAISON_PARTIELLE: {
    reasonRequired: true,
    deliveredContentRequired: true,
    returnedContentRequired: true,
    collectedAmountRequired: true,
    returnedAmountRequired: true,
    locationRequired: true,
  },

  // Retours et annulation.
  EN_RUNSHEET_RETOUR: NO_REQUIREMENT,
  RETOURNE_EXPEDITEUR: NO_REQUIREMENT,
  ANNULE: { ...NO_REQUIREMENT, reasonRequired: true },
};

/** Exigences d'un statut d'arrivée donné. */
export function transitionRequirements(to: PackageStatus): TransitionRequirements {
  return PACKAGE_TRANSITION_REQUIREMENTS[to] ?? NO_REQUIREMENT;
}

/** Données fournies pour justifier une transition. */
export interface TransitionInput {
  reason?: string | null;
  location?: string | null;
  deliveredContent?: string | null;
  returnedContent?: string | null;
  collectedAmount?: number | null;
  returnedAmount?: number | null;
}

/** Libellé français de chaque donnée manquante, pour un refus lisible. */
const INPUT_LABELS: Readonly<Record<keyof TransitionRequirements, string>> = {
  reasonRequired: 'un motif',
  deliveredContentRequired: 'la description du contenu livré',
  returnedContentRequired: 'la description du contenu repris',
  collectedAmountRequired: 'le montant encaissé',
  returnedAmountRequired: 'le montant non encaissé',
  locationRequired: 'le lieu de l\'événement',
};

/** Une valeur est-elle « fournie » au sens d'une justification ? */
function isProvided(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return value.trim().length > 0;
}

/**
 * Liste des données exigées par une transition et non fournies.
 *
 * Une liste vide signifie « la transition est documentée ». Les libellés
 * renvoyés sont directement utilisables dans un message d'erreur : le refus
 * doit dire ce qui manque, pas seulement qu'il y a un problème.
 */
export function missingTransitionInputs(
  to: PackageStatus,
  input: TransitionInput
): string[] {
  const req = transitionRequirements(to);
  const provided: Record<keyof TransitionRequirements, boolean> = {
    reasonRequired: isProvided(input.reason),
    deliveredContentRequired: isProvided(input.deliveredContent),
    returnedContentRequired: isProvided(input.returnedContent),
    collectedAmountRequired: isProvided(input.collectedAmount),
    returnedAmountRequired: isProvided(input.returnedAmount),
    locationRequired: isProvided(input.location),
  };
  return (Object.keys(req) as (keyof TransitionRequirements)[])
    .filter((key) => req[key] && !provided[key])
    .map((key) => INPUT_LABELS[key]);
}

/** Une transition est-elle autorisée par le modèle métier ? */
export function canTransition(from: PackageStatus, to: PackageStatus): boolean {
  return allowedNextStatuses(from).includes(to);
}

/** Le statut est-il terminal (plus aucune sortie possible) ? */
export function isTerminalStatus(status: PackageStatus): boolean {
  return TERMINAL_PACKAGE_STATUSES.includes(status);
}

/** Le colis est-il verrouillé contre toute modification ? */
export function isLockedForEditing(status: PackageStatus): boolean {
  return PACKAGE_STATUSES_LOCKED.includes(status);
}

/** L'expéditeur peut-il encore modifier le colis librement ? */
export function isFullyEditableByShipper(status: PackageStatus): boolean {
  return SHIPPER_FULLY_EDITABLE.includes(status);
}

/** La modification par l'expéditeur est-elle Possible mais restreinte ? */
export function isRestrictedForShipper(status: PackageStatus): boolean {
  return SHIPPER_RESTRICTED_EDITABLE.includes(status);
}

/**
 * L'expéditeur peut-il annuler ou supprimer ce colis ?
 *
 * Règle métier : oui tant que le colis n'est ni reçu au dépôt ni affecté à un
 * livreur. Passé ce cap, l'annulation relève de l'administration.
 */
export function canShipperCancelOrDelete(status: PackageStatus): boolean {
  return isFullyEditableByShipper(status);
}

/** Un colis est-il considéré comme « reçu dans le processus de livraison » ? */
export function isInDeliveryProcess(status: PackageStatus): boolean {
  return !isFullyEditableByShipper(status);
}

/**
 * Champs dont la modification, une fois le colis engagé, doit être signalée
 * au livreur et tracée dans le journal d'audit.
 */
export const CRITICAL_EDITABLE_FIELDS = ['totalPrice', 'pieceCount', 'contentSummary'] as const;

/** Libellé français d'un champ, utilisé dans les notifications et l'audit. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  totalPrice: 'Montant à encaisser (TND)',
  pieceCount: 'Nombre de pièces',
  contentSummary: 'Description du contenu',
  customerName: 'Nom du destinataire',
  customerPhone: 'Téléphone du destinataire',
  address: 'Adresse de livraison',
  sizeCategory: 'Catégorie de taille',
  packageType: 'Type de colis',
  allowOpen: 'Autorisation d\'ouverture',
};

/** Libellé français d'un statut de colis. */
export const PACKAGE_STATUS_LABELS: Readonly<Record<PackageStatus, string>> = {
  CREE: 'Créé',
  RAMASSAGE_PROGRAMME: 'Ramassage programmé',
  RAMASSE: 'Ramassé',
  RECU_DEPOT: 'Reçu au dépôt',
  EN_LOT_INTER_DEPOT: 'En lot inter-dépôt',
  EN_TRANSIT_INTER_DEPOT: 'En transit inter-dépôt',
  RECU_DEPOT_DESTINATION: 'Reçu au dépôt de destination',
  AFFECTE_RUNSHEET: 'Affecté à une tournée',
  EN_COURS_LIVRAISON: 'En cours de livraison',
  LIVRE: 'Livré',
  LIVRAISON_PARTIELLE: 'Livraison partielle',
  REPORTE: 'Reporté',
  ECHEC_LIVRAISON: 'Échec de livraison',
  RETOUR_DEPOT: 'Retourné au dépôt',
  EN_RUNSHEET_RETOUR: 'En cours de restitution',
  RETOURNE_EXPEDITEUR: 'Restitué à l\'expéditeur',
  ANNULE: 'Annulé',
};

/** Libellé français d'un type de colis. */
export const PACKAGE_TYPE_LABELS: Readonly<Record<PackageType, string>> = {
  NORMAL: 'Livraison normale',
  EXCHANGE: 'Échange',
  REPORTED: 'Colis signalé / manquant',
  RETURN: 'Retour expéditeur',
};
