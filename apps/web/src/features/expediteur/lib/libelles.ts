'use client';

/**
 * Vocabulaire du portail expéditeur.
 *
 * Trois règles ont gouverné ce fichier.
 *
 * La première : aucun état qui n'existe pas dans le domaine. Statuts, types et
 * créneaux viennent des énumérations partagées, qui reflètent la base. Un
 * libellé inventé pour désigner une étape qui n'existe pas serait le pire des
 * mensonges — il afficherait à un expéditeur une phase qu'aucun livreur ne peut
 * produire.
 *
 * La deuxième : quand le backend ne permet pas d'afficher une information, on
 * l'écrit. Un vide expliqué vaut mieux qu'un chiffre plausible.
 *
 * La troisième, la plus importante depuis l'arabe : ce fichier ne contient plus
 * aucun mot affiché. Il décrit *quel* libellé montrer — par sa clé — et laisse
 * `useVocabulaire` le traduire. Un `Record<PackageType, string>` fige le
 * français dans une constante de module : le portail bascule en arabe, la
 * constante reste française, et le mot anglais s'affiche à côté de l'arabe
 * sans qu'aucune erreur ne le signale.
 *
 * ## Pourquoi un hook plutôt qu'une fonction
 *
 * La langue vient d'un contexte React. Une fonction de module ne peut pas y lire,
 * et recevoir la langue en paramètre obligerait chaque écran à la faire circuler
 * jusque dans ses utilitaires. Le hook renvoie donc des fonctions *liées* à la
 * langue courante : un écran appelle `voc.statutColis(colis.status)` et obtient
 * la couleur et le bon mot, sans rien savoir du dictionnaire.
 */

import {
  PackageSize,
  PackageStatus,
  PackageType,
  PaymentVoucherStatus,
  PickupStatus,
  packageStatusLabel,
} from '@logixpress/types';
import { PACKAGE_STATUS_MAP, type BadgeVariant } from '@logixpress/ui';
import { useI18n, type FamilleValeur } from '@/i18n';

/** Étape du cycle de vie d'un colis, telle qu'affichée au tableau de bord. */
export interface EtapeColis {
  /** Suffixe de la clé `etape.<cle>` ; jamais écrit en clair. */
  cle: string;
  /** Statuts lus sur le serveur pour compter cette étape. */
  statuts: PackageStatus[];
}

/**
 * Compteurs du tableau de bord.
 *
 * Chaque ligne est un décompte réel : `GET /colis` est appelé avec le filtre
 * correspondant, et `meta.total` fait foi. Aucun compteur n'est estimé, aucun
 * n'est écrit en dur dans un composant.
 *
 * `cle` n'est pas un libellé : c'est le suffixe des clés `etape.<cle>` et
 * `etape.<cle>.aide`, que le dictionnaire traduit dans les deux langues.
 */
export const ETAPES_COLIS: EtapeColis[] = [
  { cle: 'preparation', statuts: [PackageStatus.CREE] },
  { cle: 'attente-ramassage', statuts: [PackageStatus.RAMASSAGE_PROGRAMME] },
  { cle: 'ramasse', statuts: [PackageStatus.RAMASSE] },
  { cle: 'en-livraison', statuts: [PackageStatus.EN_COURS_LIVRAISON] },
  { cle: 'livre', statuts: [PackageStatus.LIVRE] },
  { cle: 'reporte', statuts: [PackageStatus.REPORTE] },
  { cle: 'echec', statuts: [PackageStatus.ECHEC_LIVRAISON] },
];

/**
 * Statuts qui décrivent un colis revenant vers l'expéditeur.
 *
 * Ils servent au tableau de bord et à la section « Bons de retour ». La liste
 * est celle du domaine, pas une sélection de confort.
 */
export const STATUTS_RETOUR: PackageStatus[] = [
  PackageStatus.LIVRAISON_PARTIELLE,
  PackageStatus.RETOUR_DEPOT,
  PackageStatus.EN_RUNSHEET_RETOUR,
  PackageStatus.RETOURNE_EXPEDITEUR,
];

/**
 * Créneaux de collecte proposés.
 *
 * L'API ne connaît que deux entiers, `timeSlotStartHour` et `timeSlotEndHour` :
 * une plage horaire entière. Les couples ci-dessous sont donc des plages, pas
 * des créneaux que le serveur validerait — les inventer lui donnerait une
 * disponibilité qu'il ne consulte pas.
 *
 * Les heures ne sont pas traduites : `10h` s'écrit pareil dans les deux
 * langues, et `h` est l'unité officielle du pays.
 */
export const CRENEAUX_RAMASSAGE = [
  { libelle: '10h — 13h', debut: 10, fin: 13 },
  { libelle: '14h — 17h', debut: 14, fin: 17 },
  { libelle: '17h — 19h', debut: 17, fin: 19 },
] as const;

export const VARIANTE_TYPE: Record<PackageType, BadgeVariant> = {
  [PackageType.NORMAL]: 'default',
  [PackageType.EXCHANGE]: 'warning',
  [PackageType.REPORTED]: 'secondary',
  [PackageType.RETURN]: 'secondary',
};

export const VARIANTE_STATUT_RDV: Record<PickupStatus, BadgeVariant> = {
  [PickupStatus.A_CONFIRMER]: 'warning',
  [PickupStatus.EN_ATTENTE]: 'warning',
  [PickupStatus.ASSIGNE]: 'default',
  [PickupStatus.EN_COURS]: 'primary',
  [PickupStatus.EFFECTUE]: 'success',
  [PickupStatus.ANNULE]: 'danger',
};

export const VARIANTE_STATUT_BORDEREAU: Record<PaymentVoucherStatus, BadgeVariant> = {
  EN_ATTENTE: 'warning',
  CONFIRME: 'secondary',
  PAYE: 'success',
  ANNULE: 'danger',
};

/**
 * Gouvernorats proposés à la saisie d'une destination.
 *
 * Ce sont les valeurs que l'API attend, en français : ce sont aussi les clés
 * `gou.<valeur>` du dictionnaire. Les construire ici, à partir de la liste des
 * clés du dictionnaire, évite d'avoir à les resynchroniser à la main le jour où
 * un gouvernorat change de nom côté serveur.
 */
export const GOUVERNORATS = [
  'Ariana',
  'Ben Arous',
  'Bizerte',
  'Kairouan',
  'Kasserine',
  'Manouba',
  'Medenine',
  'Monastir',
  'Nabeul',
  'Sfax',
  'Sidi Bouzid',
  'Siliana',
  'Sousse',
  'Tunis',
  'Zaghouan',
] as const;

/**
 * Un rendez-vous peut être annulé tant que la machine à états l'autorise.
 *
 * `EFFECTUE` et `ANNULE` sont terminaux. L'API refuserait de toute façon, mais
 * un bouton d'annulation sur un rendez-vous terminé serait un mensonge avant
 * d'être une erreur.
 */
export function peutAnnulerRdv(statut: PickupStatus): boolean {
  return (
    statut === PickupStatus.A_CONFIRMER ||
    statut === PickupStatus.EN_ATTENTE ||
    statut === PickupStatus.ASSIGNE ||
    statut === PickupStatus.EN_COURS
  );
}

/** Ce qu'un habillage de statut apporte à un écran. */
export interface HabillageStatut {
  label: string;
  bg: string;
  text: string;
  border: string;
}

/**
 * Vocabulaire traduit, lié à la langue courante.
 *
 * Chaque fonction prend la valeur brute du serveur et rend le mot affiché. Aucun
 * écran n'a plus à assembler un libellé, ni à savoir si le dictionnaire a une
 * entrée pour ce qu'il reçoit.
 */
export interface Vocabulaire {
  /** Étiquette et couleurs d'un statut de colis. */
  statutColis: (statut: string) => HabillageStatut;
  type: (valeur: PackageType | string) => string;
  taille: (valeur: PackageSize | string) => string;
  /** Statut d'un rendez-vous de collecte. */
  rdv: (valeur: PickupStatus | string) => string;
  /** Statut d'un bordereau de paiement. */
  bordereau: (valeur: PaymentVoucherStatus | string) => string;
  /** Statut du paiement d'un colis. */
  paiement: (valeur: string) => string;
  gouvernorat: (valeur: string) => string;
  /** Motif d'un échec de livraison, tel que renvoyé par l'API. */
  motif: (valeur: string) => string;
  /** Moyen de paiement (espèces, chèque…) d'un bordereau. */
  moyenPaiement: (valeur: string) => string;
  /**
   * Libellé d'une étape du tableau de bord, depuis la clé d'`ETAPES_COLIS`.
   * `etape('livre')` donne « Livrés », `etape('livre.aide')` son explication.
   */
  etape: (cle: string) => string;
}

/** Familles de valeurs, telles que le dictionnaire les range. */
const FAMILLES: Record<
  'type' | 'taille' | 'rdv' | 'bordereauStatut' | 'paiement' | 'gou' | 'etape' | 'motif' | 'moyenPaiement',
  FamilleValeur
> = {
  type: 'type',
  taille: 'taille',
  rdv: 'rdv',
  bordereauStatut: 'bordereauStatut',
  paiement: 'paiement',
  gou: 'gou',
  etape: 'etape',
  motif: 'motif',
  moyenPaiement: 'moyenPaiement',
};

export function useVocabulaire(): Vocabulaire {
  const { traduireValeur } = useI18n();
  return {
    statutColis: (statut) => ({
      ...(PACKAGE_STATUS_MAP[statut] ?? {
        label: packageStatusLabel(statut) || statut,
        bg: 'bg-slate-100',
        text: 'text-slate-800',
        border: 'border-slate-300',
      }),
      // La couleur vient de la table du design system, le mot du dictionnaire :
      // c'est le seul endroit où les deux peuvent être garantis d'accord.
      label: traduireValeur('statut', statut),
    }),
    type: (valeur) => traduireValeur(FAMILLES.type, valeur),
    taille: (valeur) => traduireValeur(FAMILLES.taille, valeur),
    rdv: (valeur) => traduireValeur(FAMILLES.rdv, valeur),
    bordereau: (valeur) => traduireValeur(FAMILLES.bordereauStatut, valeur),
    paiement: (valeur) => traduireValeur(FAMILLES.paiement, valeur),
    gouvernorat: (valeur) => traduireValeur(FAMILLES.gou, valeur),
    etape: (cle) => traduireValeur(FAMILLES.etape, cle),
  motif: (valeur) => traduireValeur(FAMILLES.motif, valeur),
  moyenPaiement: (valeur) => traduireValeur(FAMILLES.moyenPaiement, valeur),
};
}