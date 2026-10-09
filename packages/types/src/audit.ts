/**
 * Catalogue du journal d'audit.
 *
 * Le journal enregistre des codes d'action, pas des phrases : un code se
 * compare, se compte et se filtre, une phrase ne le peut pas. Mais un code nu
 * n'est lisible de personne, et l'historique se retrouve alors illisible — ou,
 * pire, oublié parce qu'il n'était pas déchiffrable.
 *
 * Ce module reconcile les deux : le code est la vérité stockée, le libellé
 * français est la vérité affichée. Il est partagé entre l'API et l'interface
 * pour qu'un filtre de l'écran et une requête du serveur ne puissent pas
 * diverger.
 *
 * Deux dispositions méritent d'être expliquées.
 *
 * **Les familles.** Une partie du code métier construit ses actions par
 * interpolation — `TRANSFERT_${statut}`, `PACKAGE_STATUS_${statut}` — parce que
 * la machine à états est la source de vérité et qu'énumérer chaque combinaison
 * la recopierait. Le catalogue décrit donc ces familles par motif, et non
 * action par action : ajouter un statut ne demande pas d'y toucher.
 *
 * **Les actions inconnues.** Le registre ne peut pas être exhaustif — du code
 * peut écrire une action plus tard, et la base contient déjà des lignes
 * écrites par des versions antérieures. Une action non reconnue n'est jamais
 * refusée ni masquée : elle est affichée telle quelle, et signalée comme telle.
 * Un journal qui disappears les entrées qu'il ne comprend pas n'est plus un
 * journal.
 */

/** Types d'entités suivi dans le journal. */
export const AUDIT_ENTITY_TYPES = {
  PACKAGE: 'Colis',
  RUNSHEET: 'Tournée',
  PAYMENT: 'Paiement',
  PAYMENT_VOUCHER: 'Bordereau de paiement',
  CASH_PAYMENT: 'Encaissement',
  SHIPPER: 'Expéditeur',
  DRIVER: 'Livreur',
  DEPOSIT: 'Dépôt',
  TRANSFER: 'Transfert inter-dépôts',
  PICKUP: 'Ramassage',
  USER: 'Utilisateur',
  CUSTOMER: 'Client',
  REPORT: 'Rapport',
} as const;

export type AuditEntityType = keyof typeof AUDIT_ENTITY_TYPES;

/** Familles d'actions, pour regrouper les filtres de l'écran d'historique. */
export const AUDIT_CATEGORIES = {
  COLIS: 'Colis',
  LIVRAISON: 'Livraison',
  TOURNEE: 'Tournée',
  FINANCE: 'Finance',
  DEPOT: 'Dépôt',
  TRANSFERT: 'Transfert',
  RAMASSAGE: 'Ramassage',
  PARAMETRAGE: 'Paramétrage',
  REFERENTIEL: 'Non répertoriée',
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

/**
 * Une action du catalogue.
 *
 * `critical` ne signifie pas « plus important » au sens d'un affichage : il
 * signifie que l'action engage de l'argent, un client ou une preuve de
 * livraison. Ce sont celles qu'on relit en premier quand un litige survient,
 * et celles dont la vérification d'écriture doit être la plus stricte.
 */
export interface AuditActionDefinition {
  label: string;
  category: AuditCategory;
  critical?: boolean;
  /** Le motif est obligatoire : une action sans justification n'est pas probante. */
  requiresReason?: boolean;
}

/**
 * Actions nommées une à une.
 *
 * Toute action écrite dans le code métier doit figurer ici, avec son libellé.
 * C'est cette exhaustivité qui permet à l'écran de proposer un filtre et à une
 * vérification de dire « l'action X n'est pas au catalogue ».
 */
export const AUDIT_ACTIONS: Readonly<Record<string, AuditActionDefinition>> = {
  // --- Colis -----------------------------------------------------------
  COLIS_CREE: { label: 'Colis créé', category: 'COLIS' },
  COLIS_MODIFIE: { label: 'Colis modifié', category: 'COLIS' },
  /**
   * Modification d'un champ engageant : montant, adresse, téléphone.
   *
   * `requiresReason` est vrai parce que ces champs fondent l'encaissement et
   * la livraison. Sans motif, on ne sait plus, des mois plus tard, pourquoi le
   * montant d'un colis a changé.
   */
  UPDATE_CRITICAL_FIELDS: {
    label: 'Montant ou information critique modifié',
    category: 'COLIS',
    critical: true,
    requiresReason: true,
  },
  CANCEL: { label: 'Colis annulé', category: 'COLIS', critical: true, requiresReason: true },
  SOFT_DELETE: {
    label: 'Colis supprimé',
    category: 'COLIS',
    critical: true,
    requiresReason: true,
  },
  ASSIGN_DRIVER: { label: 'Colis affecté à un livreur', category: 'COLIS', critical: true },

  // --- Réception au dépôt ---------------------------------------------
  PACKAGE_RECEIVED_AT_DEPOT: {
    label: 'Colis reçu au dépôt',
    category: 'DEPOT',
    critical: true,
  },
  COLIS_RAMASSE: { label: 'Colis ramassé', category: 'RAMASSAGE', critical: true },

  // --- Livraison -------------------------------------------------------
  DELIVERY_STARTED: { label: 'Livraison démarrée', category: 'LIVRAISON' },
  DELIVERY_DONE: {
    label: 'Livraison validée',
    category: 'LIVRAISON',
    critical: true,
    requiresReason: true,
  },
  DELIVERY_PARTIAL: {
    label: 'Livraison partielle validée',
    category: 'LIVRAISON',
    critical: true,
    requiresReason: true,
  },
  DELIVERY_POSTPONED: { label: 'Livraison reportée', category: 'LIVRAISON', requiresReason: true },
  DELIVERY_FAILED: { label: 'Échec de livraison', category: 'LIVRAISON', requiresReason: true },
  PACKAGE_EXCHANGE: {
    label: 'Colis échangé contre un autre',
    category: 'LIVRAISON',
    requiresReason: true,
  },
  PACKAGE_RETURNED: { label: 'Colis retourné au dépôt', category: 'LIVRAISON' },
  RESTORED_TO_SHIPPER: { label: 'Colis rendu à l\'expéditeur', category: 'LIVRAISON' },

  // --- Tournées --------------------------------------------------------
  RUNSHEET_CREE: { label: 'Tournée créée', category: 'TOURNEE' },
  PACKAGE_ADDED: { label: 'Colis affecté à la tournée', category: 'TOURNEE' },
  PACKAGE_REMOVED: { label: 'Colis retiré de la tournée', category: 'TOURNEE' },
  RUNSHEET_DEPARTURE: { label: 'Départ de la tournée', category: 'TOURNEE' },
  RUNSHEET_CLOSED: { label: 'Tournée clôturée', category: 'TOURNEE' },
  // Codes écrits par le service des tournées : sans entrée ici, la famille
  // RUNSHEET_* les « humanisait » en « Tournée : Package added ».
  RUNSHEET_PACKAGE_ADDED: { label: 'Colis intégré à une tournée', category: 'TOURNEE' },
  RUNSHEET_DEPART: { label: 'Départ en tournée', category: 'TOURNEE' },
  RUNSHEET_ANNULEE: { label: 'Tournée annulée', category: 'TOURNEE', critical: true },
  RUNSHEET_STATUT: { label: 'Statut de la tournée modifié', category: 'TOURNEE' },
  CAISSE_DECLAREE: {
    label: 'Caisse déclarée par le livreur',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },
  CAISSE_VALIDEE: {
    label: 'Caisse validée',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },
  CAISSE_AJUSTEE: {
    label: 'Écart de caisse ajusté',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },

  // --- Finance ---------------------------------------------------------
  PAYMENT_VALIDATED: {
    label: 'Paiement validé',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },
  PAYMENT_VOUCHER_PAID: {
    label: 'Bordereau décaissé',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },
  PAYMENT_REJECTED: {
    label: 'Paiement rejeté',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },
  PAYMENT_REFUNDED: {
    label: 'Paiement remboursé',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },
  CASH_PAYMENT_VALIDATED: {
    label: 'Encaissement COD validé',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },
  CASH_PAYMENT_REJECTED: {
    label: 'Encaissement COD rejeté',
    category: 'FINANCE',
    critical: true,
    requiresReason: true,
  },

  // --- Dépôts ----------------------------------------------------------
  DEPOT_CREE: { label: 'Dépôt créé', category: 'DEPOT' },
  DEPOT_MODIFIE: { label: 'Dépôt modifié', category: 'DEPOT' },
  DEPOT_FERME: { label: 'Dépôt fermé', category: 'DEPOT', critical: true },

  // --- Transferts inter-dépôts ----------------------------------------
  TRANSFERT_CREE: { label: 'Transfert créé', category: 'TRANSFERT' },
  TRANSFER_LOT_CONSTITUTION: { label: 'Lot inter-dépôt constitué', category: 'TRANSFERT' },
  TRANSFERT_ENTETE: { label: 'Transfert modifié', category: 'TRANSFERT' },
  INTERDEPOT_CHARGEMENT: { label: 'Colis chargé dans un inter-dépôt', category: 'TRANSFERT' },
  INTERDEPOT_ACCEPTATION: { label: "Colis accepté à l'arrivée d'un inter-dépôt", category: 'TRANSFERT', critical: true },
  INTERDEPOT_RETRAIT: { label: "Colis retiré d'un inter-dépôt", category: 'TRANSFERT' },
  INTERDEPOT_ANNULATION: { label: 'Inter-dépôt annulé', category: 'TRANSFERT', critical: true },
  TRANSFERT_RECU: {
    label: 'Transfert réceptionné',
    category: 'TRANSFERT',
    critical: true,
  },
  TRANSFERT_ANNULE: {
    label: 'Transfert annulé',
    category: 'TRANSFERT',
    critical: true,
    requiresReason: true,
  },
  TRANSFER_RECEPTION_PARTIAL: {
    label: 'Réception partielle d\'un transfert',
    category: 'TRANSFERT',
    critical: true,
    requiresReason: true,
  },

  // --- Ramassages ------------------------------------------------------
  RAMASSAGE_DEMANDE: { label: 'Ramassage demandé', category: 'RAMASSAGE' },
  RAMASSAGE_COLIS: { label: 'Colis rattaché au ramassage', category: 'RAMASSAGE' },

  // --- Référentiel -----------------------------------------------------
  //
  // Les trois entités suivent le même cycle : création, modification,
  // activation, désactivation. Les libellés sont volontairement symétriques :
  // l'écran d'historique filtre par action, et un exploitant qui cherche
  // « qui a désactivé quoi » doit pouvoir le faire sans connaître l'entité.
  USER_CREE: {
    label: 'Compte utilisateur créé',
    category: 'PARAMETRAGE',
    critical: true,
  },
  SHIPPER_MODIFIE: { label: 'Expéditeur modifié', category: 'PARAMETRAGE' },
  DRIVER_MODIFIE: { label: 'Livreur modifié', category: 'PARAMETRAGE' },
  USER_MODIFIE: { label: 'Compte utilisateur modifié', category: 'PARAMETRAGE', critical: true },
  SHIPPER_CREE: { label: 'Expéditeur créé', category: 'PARAMETRAGE' },
  DRIVER_CREE: { label: 'Livreur créé', category: 'PARAMETRAGE' },
  USER_ACTIVE: { label: 'Compte utilisateur activé', category: 'PARAMETRAGE', critical: true },
  USER_DESACTIVE: {
    label: 'Compte utilisateur désactivé',
    category: 'PARAMETRAGE',
    critical: true,
    requiresReason: true,
  },
  SHIPPER_ACTIVE: { label: 'Expéditeur activé', category: 'PARAMETRAGE' },
  SHIPPER_DESACTIVE: {
    label: 'Expéditeur désactivé',
    category: 'PARAMETRAGE',
    critical: true,
    requiresReason: true,
  },
  DRIVER_ACTIVE: { label: 'Livreur activé', category: 'PARAMETRAGE' },
  DRIVER_DESACTIVE: {
    label: 'Livreur désactivé',
    category: 'PARAMETRAGE',
    critical: true,
    requiresReason: true,
  },
  /**
   * Changement de rôle d'un compte.
   *
   * Le motif est exigé : c'est l'acte qui élève ou retire des droits. Sans
   * justification, un compte devenu administrateur six mois plus tôt est
   * impossible à expliquer — et c'est précisément la trace qu'on cherche lors
   * d'un incident.
   */
  USER_ROLE_MODIFIE: {
    label: 'Rôle du compte modifié',
    category: 'PARAMETRAGE',
    critical: true,
    requiresReason: true,
  },
  /** Rattachement ou détachement d'un compte à une fiche expéditeur ou livreur. */
  USER_COMPTE_ASSOCIE: {
    label: 'Compte rattaché ou détaché',
    category: 'PARAMETRAGE',
    critical: true,
  },

  // --- Génériques -------------------------------------------------------
  UPDATE: { label: 'Modification', category: 'PARAMETRAGE' },
  DELETE: { label: 'Suppression', category: 'PARAMETRAGE', critical: true },

  // --- Exports ---------------------------------------------------------
  EXPORT: { label: 'Export réalisé', category: 'PARAMETRAGE' },
};

/**
 * Familles d'actions construites par interpolation.
 *
 * `label` reçoit la capture du motif : le code métier décide du mot, le
 * catalogue décide de la phrase.
 */
export const AUDIT_ACTION_FAMILIES: ReadonlyArray<{
  pattern: RegExp;
  label: (captured: string) => string;
  category: AuditCategory;
  critical?: boolean;
}> = [
  {
    // `PACKAGE_STATUS_RECU_DEPOT` et consorts : la machine à états est la
    // source de vérité, le catalogue ne fait que la traduire.
    pattern: /^PACKAGE_STATUS_(.+)$/,
    label: (statut) => `Statut du colis : ${humaniser(statut)}`,
    category: 'COLIS',
  },
  { pattern: /^TRANSFERT_(.+)$/, label: (statut) => `Transfert : ${humaniser(statut)}`, category: 'TRANSFERT' },
  { pattern: /^TRANSFER_STEP_(.+)$/, label: (statut) => `Étape du transfert : ${humaniser(statut)}`, category: 'TRANSFERT' },
  { pattern: /^RAMASSAGE_(.+)$/, label: (statut) => `Ramassage : ${humaniser(statut)}`, category: 'RAMASSAGE' },
  { pattern: /^RUNSHEET_(.+)$/, label: (statut) => `Tournée : ${humaniser(statut)}`, category: 'TOURNEE' },
];

/** Ce que l'interface a besoin d'afficher une ligne du journal. */
export interface AuditActionDescription {
  code: string;
  label: string;
  category: AuditCategory;
  categoryLabel: string;
  critical: boolean;
  requiresReason: boolean;
  /** Faux si le code n'est ni au catalogue ni dans une famille connue. */
  known: boolean;
}

/**
 * Décrit une action pour l'affichage.
 *
 * Jamais d'exception : une action inconnue est décrite comme inconnue. Faire
 * échouer l'affichage d'un journal parce qu'il contient une ligne de plus
 * reviendrait à laisser les plus anciennes lisibles et les récentes invisibles
 * — exactement le contraire de ce qu'on attend d'un registre.
 */
export function describeAuditAction(code: string): AuditActionDescription {
  const exact = AUDIT_ACTIONS[code];
  if (exact) {
    return {
      code,
      label: exact.label,
      category: exact.category,
      categoryLabel: AUDIT_CATEGORIES[exact.category],
      critical: exact.critical ?? false,
      requiresReason: exact.requiresReason ?? false,
      known: true,
    };
  }

  for (const famille of AUDIT_ACTION_FAMILIES) {
    const trouve = code.match(famille.pattern);
    if (trouve) {
      return {
        code,
        label: famille.label(trouve[1]),
        category: famille.category,
        categoryLabel: AUDIT_CATEGORIES[famille.category],
        critical: famille.critical ?? false,
        requiresReason: false,
        known: true,
      };
    }
  }

  return {
    code,
    // Le code brut, lisible tel quel : c'est la seule information fiable dont
    // on dispose, et l'affichage montre exactement ce qui est stocké.
    label: code,
    category: 'REFERENTIEL',
    categoryLabel: AUDIT_CATEGORIES.REFERENTIEL,
    critical: false,
    requiresReason: false,
    known: false,
  };
}

/** Libellé d'un type d'entité, avec repli sur le code brut. */
export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_TYPES[entityType as AuditEntityType] ?? entityType;
}

/**
 * `RECU_DEPOT` → « Reçu depot ».
 *
 * Volontairement mechanical : un libellé inventé pour un statut inconnu serait
 * une approximation silencieuse, alors que le code, lui, est exact.
 */
function humaniser(statut: string): string {
  const mots = statut.toLowerCase().replace(/_/g, ' ').trim();
  return mots.charAt(0).toUpperCase() + mots.slice(1);
}

/**
 * Actions dont l'absence de motif rend la ligne inexploitable.
 *
 * Le journal les signale sans les bloquer : refuser l'opération métier parce
 * qu'un champ de commentaire manque aurait des conséquences bien pires
 * qu'une ligne à motif vide — un encaissement qui ne passe pas.
 */
/**
 * Préfixes d'actions d'une catégorie.
 *
 * Le filtre par catégorie doit rattraper les actions construites par
 * interpolation — `PACKAGE_STATUS_*`, `TRANSFERT_*` — qu'on ne peut pas
 * énumérer une à une. Cette fonction les dérive du catalogue et des familles :
 * une seule définition, donc rien à resynchroniser.
 */
export function prefixesDeCategorie(categorie: AuditCategory): string[] {
  const codes = Object.entries(AUDIT_ACTIONS)
    .filter(([, definition]) => definition.category === categorie)
    .map(([code]) => code);
  const familles = AUDIT_ACTION_FAMILIES.filter((f) => f.category === categorie).map((f) =>
    prefixeLitteral(f.pattern.source)
  );
  return [...new Set([...familles, ...codes])];
}

/** Tous les codes déclarés au catalogue. */
export function actionsCataloguees(): string[] {
  return Object.keys(AUDIT_ACTIONS);
}

/** Préfixes littéraux de toutes les familles d'actions. */
export function prefixesFamilles(): string[] {
  return AUDIT_ACTION_FAMILIES.map((f) => prefixeLitteral(f.pattern.source));
}

/**
 * Partie littérale d'un motif, pour un test de début de chaîne.
 *
 * `^PACKAGE_STATUS_(.+)$` devient `PACKAGE_STATUS_` et non
 * `PACKAGE_STATUS_(.+)`. Le premier se compare caractère par caractère, le
 * second chercherait ces caractères là — et ne trouverait jamais rien, en
 * silence.
 */
function prefixeLitteral(source: string): string {
  const sansAccroche = source.replace(/^\^/, '');
  const coupe = sansAccroche.search(/[.[\\()+*?{|$]/);
  return coupe === -1 ? sansAccroche : sansAccroche.slice(0, coupe);
}

export const REASON_REQUIRED_ACTIONS: readonly string[] = Object.entries(AUDIT_ACTIONS)
  .filter(([, definition]) => definition.requiresReason)
  .map(([code]) => code);