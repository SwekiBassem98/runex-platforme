/**
 * Catalogue des événements notifiables.
 *
 * Source de vérité partagée entre l'API (qui produit les événements et
 * décide qui reçoit) et le frontend (qui les affiche, les regroupe et sait
 * où naviguer). Ajouter un événement ici oblige à le traiter des deux côtés :
 * c'est volontaire — un événement que l'API produit mais que l'écran ne sait
 * pas nommer s'afficherait comme une notification muette.
 *
 * Nommage : les valeurs sont celles de l'énumération `NotificationType` de
 * Prisma. Elles décrivent un fait observé (« un montant a changé »), jamais une
 * instruction (« mettez à jour »). Un fait se journalise, se lit et se
 * rattache à une entité ; une instruction se contredit et se périme.
 */

/** Les quatorze événements métier notifiés en temps réel. */
export enum NotificationEvent {
  /** Un expéditeur a déposé un colis. */
  NEW_COLIS_CREATED = 'NEW_COLIS_CREATED',
  /** Un colis a été affecté à un livreur. */
  COLIS_ASSIGNED = 'COLIS_ASSIGNED',
  /** Le contenu ou une information du colis a été modifié. */
  COLIS_MODIFIED = 'COLIS_MODIFIED',
  /** Le montant à encaisser a changé. Cas du plus : 58 → 65 DT. */
  AMOUNT_CHANGED = 'AMOUNT_CHANGED',
  /** Le nombre de pièces a changé. */
  QUANTITY_CHANGED = 'QUANTITY_CHANGED',
  /** Le colis est passé d'un statut de livraison à un autre. */
  DELIVERY_STATUS_CHANGED = 'DELIVERY_STATUS_CHANGED',
  /** Le livreur a dû repasser. */
  DELIVERY_POSTPONED = 'DELIVERY_POSTPONED',
  /** Le colis a été rendu à l'expéditeur. */
  COLIS_RETURNED = 'COLIS_RETURNED',
  /** Une partie seulement du colis a été livrée. */
  PARTIAL_DELIVERY = 'PARTIAL_DELIVERY',
  /** Un livreur a déclaré un encaissement. La caisse ne l'a pas encore validé. */
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  /** La caisse a validé un encaissement. */
  PAYMENT_VALIDATED = 'PAYMENT_VALIDATED',
  /** Un colis a été placé sur une tournée. */
  RUNSHEET_ASSIGNED = 'RUNSHEET_ASSIGNED',
  /** Un ramassage a été confié à un livreur. */
  RAMASSAGE_ASSIGNED = 'RAMASSAGE_ASSIGNED',
  /** Un inter-dépôt a réceptionné ce qu'il attendait. */
  INTER_DEPOT_RECEIVED = 'INTER_DEPOT_RECEIVED',
}

/** Catégorie d'écran : sert au regroupement et au filtrage du centre. */
export type NotificationCategory =
  | 'colis'
  | 'livraison'
  | 'finance'
  | 'tournee'
  | 'transfert';

export interface NotificationEventMeta {
  /** Libellé court, pour la pastille et le filtre. */
  label: string;
  /** Catégorie de rattachement. */
  category: NotificationCategory;
  /** Ordre d'affichage dans le centre de notifications. */
  order: number;
}

export const NOTIFICATION_EVENT_META: Readonly<Record<NotificationEvent, NotificationEventMeta>> = {
  NEW_COLIS_CREATED: { label: 'Nouveau colis', category: 'colis', order: 10 },
  COLIS_ASSIGNED: { label: 'Colis affecté', category: 'colis', order: 20 },
  COLIS_MODIFIED: { label: 'Colis modifié', category: 'colis', order: 30 },
  AMOUNT_CHANGED: { label: 'Montant modifié', category: 'finance', order: 40 },
  QUANTITY_CHANGED: { label: 'Quantité modifiée', category: 'colis', order: 50 },
  DELIVERY_STATUS_CHANGED: { label: 'Statut de livraison', category: 'livraison', order: 60 },
  DELIVERY_POSTPONED: { label: 'Livraison reportée', category: 'livraison', order: 70 },
  COLIS_RETURNED: { label: 'Colis rendu', category: 'livraison', order: 80 },
  PARTIAL_DELIVERY: { label: 'Livraison partielle', category: 'livraison', order: 90 },
  PAYMENT_RECEIVED: { label: 'Encaissement reçu', category: 'finance', order: 100 },
  PAYMENT_VALIDATED: { label: 'Encaissement validé', category: 'finance', order: 110 },
  RUNSHEET_ASSIGNED: { label: 'Tournée affectée', category: 'tournee', order: 120 },
  RAMASSAGE_ASSIGNED: { label: 'Ramassage affecté', category: 'tournee', order: 130 },
  INTER_DEPOT_RECEIVED: { label: 'Inter-dépôt réceptionné', category: 'transfert', order: 140 },
};

/** Libellés des catégories, en français, pour les filtres de l'écran. */
export const NOTIFICATION_CATEGORY_LABELS: Readonly<Record<NotificationCategory, string>> = {
  colis: 'Colis',
  livraison: 'Livraison',
  finance: 'Finance',
  tournee: 'Tournées',
  transfert: 'Inter-dépôts',
};

/**
 * Entités vers lesquelles une notification peut mener.
 *
 * La clé est le `relatedEntity` écrit en base. La valeur est la route du
 * frontend. Le poste d'écriture est important : une notification sans point
 * d'arrivée est un texte que l'utilisateur doit interpréter seul, et il
 * reviendra demain sans savoir s'il manque quelque chose.
 */
export const NOTIFICATION_ENTITY_ROUTES: Readonly<Record<string, string>> = {
  PACKAGE: '/colis',
  PAYMENT: '/paiements',
  RUNSHEET: '/runsheets',
  RAMASSAGE: '/ramassages',
  INTER_DEPOT: '/inter-depots',
  DEPOT: '/depots',
};

/**
 * Route à ouvrir pour une notification.
 *
 * Une entité connue mène à sa liste. Une entité précise — un colis, un
 * encaissement — mène à son détail, ce qui est le cas le plus fréquent et le
 * plus utile : c'est ce qu'on cherche dans 9 cas sur 10 en cliquant sur
 * « livraison reportée ». Une entité inconnue ramène à l'accueil plutôt que
 * de laisser un lien mort.
 */
export function notificationRoute(entity: string | null, entityId: string | null): string {
  if (!entity) return '/dashboard';
  const base = NOTIFICATION_ENTITY_ROUTES[entity];
  if (!base) return '/dashboard';
  if (!entityId) return base;
  switch (entity) {
    case 'PACKAGE':
      return `${base}/${entityId}`;
    case 'PAYMENT':
      return `${base}/${entityId}`;
    default:
      return base;
  }
}

/** Événements deprecated conservés en base, avec leur équivalent moderne. */
export const LEGACY_NOTIFICATION_EVENTS: Readonly<Record<string, NotificationEvent | null>> = {
  COLIS_CREE: NotificationEvent.NEW_COLIS_CREATED,
  COLIS_ASSIGNE: NotificationEvent.COLIS_ASSIGNED,
  PRIX_MODIFIE_URGENT: NotificationEvent.AMOUNT_CHANGED,
  COLIS_REPORTE: NotificationEvent.DELIVERY_POSTPONED,
  COLIS_LIVRE: NotificationEvent.DELIVERY_STATUS_CHANGED,
  RAMASSAGE_DEMANDE: null,
  RAMASSAGE_CONFIRME: null,
  RAMASSAGE_AFFECTE: NotificationEvent.RAMASSAGE_ASSIGNED,
  RAMASSAGE_TERMINE: null,
  RAMASSAGE_ANNULE: null,
  RUNSHEET_CLOTUREE: null,
  PAIEMENT_DISPONIBLE: NotificationEvent.PAYMENT_VALIDATED,
  TRANSFERT_CREE: null,
  TRANSFERT_RECEPTIONNE: NotificationEvent.INTER_DEPOT_RECEIVED,
  SYSTEM_ALERT: null,
};

/** Vrai si l'événement fait partie des quatorze événements notifiés. */
export function isNotifiableEvent(value: string): value is NotificationEvent {
  return Object.values(NotificationEvent).includes(value as NotificationEvent);
}

/** Libellé français, avec repli sur la valeur brute pour un type inconnu. */
export function notificationEventLabel(value: string): string {
  return NOTIFICATION_EVENT_META[value as NotificationEvent]?.label ?? value;
}

/** Catégorie d'un événement, avec repli sur « colis ». */
export function notificationCategoryOf(value: string): NotificationCategory {
  return NOTIFICATION_EVENT_META[value as NotificationEvent]?.category ?? 'colis';
}

// ---------------------------------------------------------------------------
// Contrat de transport
// ---------------------------------------------------------------------------

/** Notification telle qu'elle circule sur le socket et dans l'API. */
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  content: string;
  relatedEntity: string | null;
  relatedEntityId: string | null;
  /** Route déjà résolue : le client n'a pas à refaire la correspondance. */
  href: string;
  category: NotificationCategory;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

/** Filtres du centre de notifications. */
export interface NotificationQuery {
  /** `true` ou `false` pour filtrer sur la lecture ; absent pour tout voir. */
  isRead?: boolean;
  type?: string;
  category?: NotificationCategory;
  relatedEntity?: string;
  limit?: number;
  offset?: number;
}

/** Événements émis par le client Socket.IO. */
export const SOCKET_EVENTS = {
  /** Serveur → client : une notification vient d'être créée. */
  NOTIFICATION_NEW: 'notification:new',
  /** Serveur → client : le compteur de non-lus a changé. */
  NOTIFICATION_UNREAD_COUNT: 'notification:unread-count',
  /** Serveur → client : une notification a été relue, y compris ailleurs. */
  NOTIFICATION_READ: 'notification:read',
  /** Client → serveur : demande le compteur de non-lus à la reconnexion. */
  READ_SYNC: 'notification:sync',
} as const;

/** Événements d'évènement système du transport, hors métier. */
export const SOCKET_SYSTEM_EVENTS = {
  READY: 'socket:ready',
  DISCONNECTED: 'socket:disconnected',
} as const;