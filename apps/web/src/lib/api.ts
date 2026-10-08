/**
 * Client HTTP unique de la plateforme RUNEX.
 *
 * Toute communication avec l'API passe par ce module : aucune URL d'API n'est
 * écrite en dur ailleurs dans l'application, et aucun `fetch` n'est appelé
 * directement depuis un composant.
 *
 * La base provient de `NEXT_PUBLIC_API_URL` (variables d'environnement
 * inlinées par Next au moment du build), avec une valeur de repli
 * uniquement pour le développement local.
 */

const FALLBACK_API_URL = 'http://localhost:4000/api/v1';

function normalizeBaseUrl(raw: string): string {
  // Supprime les barres obliques finales pour éviter « //colis ».
  return raw.trim().replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_API_URL || FALLBACK_API_URL
);

/**
 * Enveloppe commune à toutes les réponses de l'API.
 */
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: Record<string, unknown>;
  error?: string | null;
}

/**
 * Erreur renvoyée par l'API ou générée par le client.
 *
 * Le message est celui de l'API (déjà rédigé en français) afin de pouvoir
 * l'afficher tel quel à l'utilisateur.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  /** L'utilisateur n'est pas authentifié (ou son jeton a expiré). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** L'utilisateur est authentifié mais n'a pas la permission requise. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** La ressource demandée n'existe pas. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** L'API est injoignable (serveur arrêté, CORS, réseau). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

const ACCESS_TOKEN_KEY = 'logixpress_access_token';
const REFRESH_TOKEN_KEY = 'logixpress_refresh_token';

/* ------------------------------------------------------------------ */
/* Stockage des jetons                                                 */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  // Accès direct à localStorage : indisponible pendant le rendu serveur.
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Mode navigation privée ou stockage bloqué par le navigateur.
    return null;
  }
}

export const tokenStorage = {
  getAccessToken(): string | null {
    return storage()?.getItem(ACCESS_TOKEN_KEY) ?? null;
  },
  getRefreshToken(): string | null {
    return storage()?.getItem(REFRESH_TOKEN_KEY) ?? null;
  },
  set(accessToken: string, refreshToken: string): void {
    const store = storage();
    store?.setItem(ACCESS_TOKEN_KEY, accessToken);
    store?.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  clear(): void {
    const store = storage();
    store?.removeItem(ACCESS_TOKEN_KEY);
    store?.removeItem(REFRESH_TOKEN_KEY);
  },
};

/* ------------------------------------------------------------------ */
/* Rafraîchissement automatique du jeton                               */
/* ------------------------------------------------------------------ */

let refreshPromise: Promise<boolean> | null = null;
let onUnauthorized: (() => void) | null = null;

/**
 * Enregistre le comportement à adopter lorsque la session est invalidée
 * (utilisé par le fournisseur d'authentification pour renvoyer vers /connexion).
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Échange le refresh token contre une nouvelle paire de jetons.
 *
 * Les requêtes simultanées partagent une seule promesse : sans cela, une page
 * déclenchant cinq appels en parallèle épuiserait le refresh token (il est à
 * usage unique, sa rotation invalide l'ancien).
 */
async function refreshTokens(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) return false;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        tokenStorage.clear();
        onUnauthorized?.();
        return false;
      }

      const envelope = (await response.json()) as ApiEnvelope<{
        accessToken: string;
        refreshToken: string;
      }>;

      if (!envelope.data?.accessToken || !envelope.data?.refreshToken) {
        tokenStorage.clear();
        onUnauthorized?.();
        return false;
      }

      tokenStorage.set(envelope.data.accessToken, envelope.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/* ------------------------------------------------------------------ */
/* Requête de base                                                     */
/* ------------------------------------------------------------------ */

type QueryValue = string | number | boolean | undefined | null;

/**
 * Construit une query string en ignorant les valeurs vides.
 */
export function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Requête interne : évite une boucle de rafraîchissement infinie. */
  skipAuthRefresh?: boolean;
  signal?: AbortSignal;
}

/**
 * Effectue une requête authentifiée et renvoie l'enveloppe complète.
 *
 * Le jeton d'accès est ajouté automatiquement. Sur un `401`, le client tente
 * une seule rotation puis rejoue la requête ; si elle échoue, la session est
 * purgée et l'application renvoie l'utilisateur vers l'écran de connexion.
 */
export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<ApiEnvelope<T>> {
  const { method = 'GET', body, query, skipAuthRefresh = false, signal } = options;
  const url = `${API_BASE_URL}${path}${buildQuery(query)}`;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const token = tokenStorage.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    return fetch(url, {
      method,
      headers,
      signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError(
      "Impossible de joindre le serveur RUNEX. Vérifiez que l'API est démarrée.",
      0,
      error
    );
  }

  // Session expirée : on rafraîchit une fois, puis on rejoue la requête.
  if (response.status === 401 && !skipAuthRefresh) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      try {
        response = await send();
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error;
        throw new ApiError("Impossible de joindre le serveur RUNEX.", 0, error);
      }
    }
  }

  const raw = await response.text();
  let parsed: unknown = null;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    const envelope = parsed as ApiEnvelope<unknown> | null;
    const message =
      envelope?.message ||
      envelope?.error ||
      `La requête a échoué (HTTP ${response.status}).`;
    throw new ApiError(message, response.status, parsed);
  }

  return (parsed ?? { success: true }) as ApiEnvelope<T>;
}

/**
 * Comme `request`, mais renvoie directement `data` et lève une erreur si
 * l'enveloppe ne contient pas de charge utile.
 */
export async function requestData<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await request<T>(path, options);
  if (envelope.data === undefined || envelope.data === null) {
    throw new ApiError('Réponse vide du serveur.', 200, envelope);
  }
  return envelope.data;
}

/* ------------------------------------------------------------------ */
/* Raccourcis typés                                                   */
/* ------------------------------------------------------------------ */

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
};

/* ------------------------------------------------------------------ */
/* Points de terminaison métier                                        */
/* ------------------------------------------------------------------ */

import type {
  AuthUser,
  LoginResponse,
  PackageDto,
  RunsheetSummaryDto,
  PickupAppointmentDto,
  PaymentVoucherDto,
  PaymentDto,
  PaymentSummaryDto,
  ShipperPaymentsDto,
  DriverPaymentsDto,
  PaymentValidationRequest,
  PaymentRejectionRequest,
  HealthCheckResponse,
  DomaineRapport,
  FiltresRapport,
  Rapport,
} from '@logixpress/types';

/** Type d'inter-dépôt. */
export type InterDepotType = 'LIVRAISON' | 'RETOUR';

/** Ligne d'un bordereau inter-dépôt (un colis et ses pièces). */
export interface InterDepotItemDto {
  packageId: string;
  trackingNumber: string;
  barcode: string;
  shipperName: string;
  customerName: string;
  destination: string;
  pieceCount: number;
  receivedPieces: number;
  receivedPieceNumbers: number[];
  receptionState: 'EN_ROUTE' | 'PARTIEL' | 'RECU';
  packageStatus: string;
  packageStatusLabel: string;
  addedAt: string;
  receivedAt: string | null;
}

/** Bordereau inter-dépôt tel que servi par `GET /inter-depots[/:id]`. */
export interface InterDepotDto {
  id: string;
  transferNumber: string;
  type: InterDepotType;
  typeLabel: string;
  sourceDeposit: string;
  sourceDepositId: string;
  destinationDeposit: string;
  destinationDepositId: string;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  departureAt: string | null;
  status: 'CRE' | 'RECU_PARTIEL' | 'RECU' | 'ANNULE' | 'PREPARE' | 'EN_TRANSIT';
  statusLabel: string;
  direction: 'ENVOI' | 'RECEPTION' | null;
  totalPackages: number;
  totalPieces: number;
  receivedPackages: number;
  receivedPieces: number;
  partialPackages: number;
  editable: boolean;
  notes: string | null;
  items: InterDepotItemDto[];
  createdAt: string;
  receivedAt: string | null;
  cancelledAt: string | null;
}

export interface InterDepotStats {
  total: number;
  sentPending: number;
  sentReceived: number;
  toReceive: number;
  received: number;
}

export interface InterDepotFormOptions {
  deposits: { id: string; name: string; code: string; isMainHub: boolean; governorate: string }[];
  drivers: {
    id: string;
    driverCode: string;
    fullName: string;
    phone: string;
    licensePlate: string | null;
    depositId: string | null;
    depositName: string | null;
    label: string;
  }[];
  operatingDepositId: string | null;
}

export interface InterDepotCandidate {
  id: string;
  trackingNumber: string;
  barcode: string;
  pieceCount: number;
  sizeCategory: string;
  status: string;
  shipperName: string;
  customerName: string;
  destination: string;
}

export interface AcceptanceBoard {
  depositId: string;
  type: InterDepotType;
  receivedCount: number;
  partialCount: number;
  expectedCount: number;
  expected: (InterDepotItemDto & { transferNumber: string; sourceDeposit: string })[];
  accepted: {
    trackingNumber: string;
    barcode: string;
    shipperName: string;
    pieceCount: number;
    receivedPieces: number;
    sizeCategory: string;
    state: 'RECU' | 'PARTIEL';
    transferNumber: string;
    lastScanAt: string | null;
  }[];
  openTransfers: {
    transferNumber: string;
    sourceDeposit: string;
    totalPackages: number;
    totalPieces: number;
    receivedPieces: number;
    status: string;
    statusLabel: string;
  }[];
}

export interface AcceptanceResult {
  message: string;
  trackingNumber: string;
  pieceNumber: number;
  pieceCount: number;
  receivedPieces: number;
  packageComplete: boolean;
  transferNumber: string;
  transferStatus: string;
}

/**
 * Agrégats du poste de commandement (`GET /dashboard`).
 *
 * Même remarque que pour `InterDepotDto` : la forme suit la réponse réelle de
 * l'API, seul le strict nécessaire aux écrans est typé.
 */
export interface DashboardDto {
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
  alerts?: {
    id: string;
    type: string;
    category?: string;
    title: string;
    message: string;
    count: number;
    actionLabel: string;
  }[];
  recentActivity?: {
    id: string;
    type: string;
    title: string;
    description: string;
    actor: string;
    timestamp: string;
    badge?: string;
  }[];
  /**
   * Séries des graphiques du poste de commandement.
   *
   * Chaque graphique a sa propre forme, exactement celle attendue par le
   * composant correspondant de `@logixpress/ui`.
   */
  charts?: {
    deliveriesOverTime?: { label: string; colis: number; livres: number }[];
    deliveredVsReturned?: { name: string; value: number; color: string }[];
    codAmounts?: { name: string; aEncaisser: number; encaisse: number }[];
    driverActivity?: { name: string; livraisons: number; echecs: number }[];
    supplierActivity?: { name: string; colis: number; montantTND: number }[];
  };
}

export interface DemoUser {
  email: string;
  role: string;
  name: string;
  passwordHint: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    requestData<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRefresh: true,
    }),

  me: () => requestData<AuthUser>('/auth/me'),

  // Le refresh token est transmis : l'API ferme précisément cette session,
  // sans toucher aux autres appareils de l'utilisateur.
  logout: () =>
    request<unknown>('/auth/logout', {
      method: 'POST',
      body: { refreshToken: tokenStorage.getRefreshToken() ?? undefined },
      skipAuthRefresh: true,
    }),

  demoUsers: () => requestData<DemoUser[]>('/auth/demo-users'),

  requestPasswordReset: (email: string) =>
    request<unknown>('/auth/password-reset/request', { method: 'POST', body: { email } }),

  confirmPasswordReset: (token: string, newPassword: string) =>
    request<unknown>('/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, newPassword },
    }),
};

export const colisApi = {
  list: (params?: Record<string, QueryValue>) => request<PackageDto[]>('/colis', { query: params }),
  get: (identifier: string) => requestData<PackageDto>(`/colis/${encodeURIComponent(identifier)}`),
  create: (payload: unknown) => request<PackageDto>('/colis', { method: 'POST', body: payload }),
  update: (identifier: string, payload: unknown) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}`, {
      method: 'PUT',
      body: payload,
    }),
  cancel: (identifier: string, reason: string) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}/cancel`, {
      method: 'POST',
      body: { reason },
    }),
  assign: (identifier: string, payload: unknown) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}/assign`, {
      method: 'POST',
      body: payload,
    }),
  deliver: (identifier: string, payload: unknown) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}/deliver`, {
      method: 'POST',
      body: payload,
    }),
  partialDelivery: (identifier: string, payload: unknown) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}/partial-delivery`, {
      method: 'POST',
      body: payload,
    }),
  exchange: (identifier: string, payload: unknown) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}/exchange`, {
      method: 'POST',
      body: payload,
    }),
  postpone: (identifier: string, payload: unknown) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}/postpone`, {
      method: 'POST',
      body: payload,
    }),
  returnPackage: (identifier: string, payload: unknown) =>
    request<PackageDto>(`/colis/${encodeURIComponent(identifier)}/return`, {
      method: 'POST',
      body: payload,
    }),
};

/* ------------------------------------------------------------------ */
/* Réception en dépôt                                                  */
/* ------------------------------------------------------------------ */

export type ReceptionOutcome =
  | 'RECEIVED'
  /**
   * Colis retrouvé par une simple lecture, sans enregistrement. Distinct de
   * `RECEIVED` pour que l'écran n'annonce jamais une réception qui n'a pas eu
   * lieu : les deux se affichaient jusqu'ici en vert, « Réception enregistrée ».
   */
  | 'PREVIEW'
  | 'ALREADY_RECEIVED'
  | 'UNKNOWN_CODE'
  | 'MALFORMED_CODE'
  | 'INVALID_DEPOSIT'
  | 'INVALID_STATE';

export interface ReceptionPreview {
  id: string;
  trackingNumber: string;
  barcode: string;
  status: string;
  statusLabel: string;
  customerName: string;
  customerPhone: string;
  shipperName: string;
  governorate: string;
  city: string;
  pieceCount: number;
  totalPrice: string;
  packageType: string;
  currentDepositId: string | null;
  currentDepositName: string | null;
  alreadyReceived: boolean;
  receivedAt: string | null;
  receivedBy: string | null;
}

export interface ReceptionResult {
  outcome: ReceptionOutcome;
  message: string;
  accepted: boolean;
  package: ReceptionPreview | null;
  receivedAt?: string | null;
  receivedBy?: string | null;
  receivedAtDeposit?: string | null;
}

export interface ReceptionLookup {
  kind: 'barcode' | 'business-number' | 'malformed';
  code: string;
  package: ReceptionPreview | null;
  deposit: { id: string; name: string } | null;
  depositError: string | null;
}

export interface DepotOption {
  id: string;
  code: string;
  name: string;
  city: string;
  isMainHub: boolean;
}

export interface RecentReception {
  id: string;
  receivedAt: string;
  operatorName: string;
  locationName: string | null;
  packageId: string;
  trackingNumber: string;
  status: string;
  customerName: string;
  shipperName: string;
}

/**
 * Identifiant de tentative de scan.
 *
 * Une requête peut aboutir côté serveur et perdre sa réponse en chemin sur un
 * réseau de dépôt. Rejouée avec la même clé, elle est reconnue comme un
 * doublon et n'écrit rien : c'est ce qui distingue « le même scan, rejoué par
 * le réseau » de « le même colis, pointé deux fois », qui doit être signalé.
 *
 * La clé ne couvre qu'un aller-retour, pas une session. Elle est renouvelée
 * dès que le serveur a répondu : sans cela, un opérateur qui rescane un colis
 * déjà reçu recevrait « réception déjà enregistrée » — un doublon côté réseau
 * — au lieu du « reçu le…, par… » qui est la vraie information. Le protection
 * viserait alors le mauvais cas.
 */
const SCAN_ATTEMPT_KEY = 'logixpress_scan_attempt';

function scanAttemptKey(): string {
  if (typeof window === 'undefined') return 'server';
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(SCAN_ATTEMPT_KEY, fresh);
  return fresh;
}

/** Ouvre une nouvelle tentative : l'aller-retour précédent est acquitté. */
function closeScanAttempt(): void {
  scanAttemptKey();
}

export const receptionApi = {
  depots: () => requestData<DepotOption[]>('/depot/reception/depots'),

  lookup: (code: string, depositId?: string) =>
    requestData<ReceptionLookup>('/depot/reception/lookup', {
      method: 'POST',
      body: { code, depositId },
    }),

  /**
   * Réception d'un colis.
   *
   * L'API répond 409 sur un doublon et 404 sur un code inconnu : l'appel
   * lève dans les deux cas. C'est volontaire — le refus est un résultat
   * attendu de l'écran, pas une panne — donc la charge utile est convertie en
   * résultat, avec son motif, au lieu de remonter en exception.
   */
  async receive(code: string, depositId?: string): Promise<ReceptionResult> {
    try {
      const result = await requestData<ReceptionResult>('/depot/reception', {
        method: 'POST',
        body: { code, depositId, idempotencyKey: scanAttemptKey() },
      });
      // Le serveur a répondu : l'aller-retour est clos, le scan suivant est un
      // autre scan.
      closeScanAttempt();
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        const data = (error.body as ApiEnvelope<ReceptionResult> | null)?.data;
        if (data && typeof data === 'object' && data.outcome) {
          // Un refus est une réponse acquittée, au même titre qu'un succès.
          closeScanAttempt();
          return data;
        }
      }
      // Aucune réponse du serveur : la tentative reste ouverte, et sa clé doit
      // survivre au rejeu, sinon une coupure réseau créerait un second
      // enregistrement du même colis.
      throw error;
    }
  },

  recent: (depositId?: string, limit = 20) =>
    requestData<RecentReception[]>('/depot/reception/recent', {
      query: { depositId, limit },
    }),
};

/* ------------------------------------------------------------------ */
/* Journal d'audit                                                     */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  id: string;
  entityType: string;
  entityLabel: string;
  entityId: string;
  action: string;
  actionLabel: string;
  category: string;
  categoryLabel: string;
  /** Action engageant argent, client ou preuve de livraison. */
  critical: boolean;
  /** Le code est-il au catalogue ? Un code inconnu s'affiche tel quel. */
  knownAction: boolean;
  reason: string | null;
  /** Le catalogue exigeait un motif, et il n'y en a pas. */
  missingReason: boolean;
  previousValues: unknown;
  newValues: unknown;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  userIp: string | null;
  userAgent: string | null;
  timestamp: string;
}

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  category?: string;
  userId?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditActionFacet {
  action: string;
  count: number;
  label: string;
  category: string;
  categoryLabel: string;
  critical: boolean;
  known: boolean;
}

export interface AuditSummary {
  total: number;
  parAction: Array<{ action: string; label: string; category: string; count: number; critical: boolean }>;
  parCategorie: Array<{ category: string; label: string; count: number }>;
  parEntite: Array<{ entityType: string; label: string; count: number }>;
}

/**
 * Journal d'audit.
 *
 * Trois lectures, aucune écriture — l'API n'expose pas d'écriture, et la base
 * refuse toute modification. Le client n'a donc rien à interdire : ce qu'il
 * pourrait tenter n'existe pas.
 */
export interface AuditPageMeta {
  total: number;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
}

export const auditApi = {
  list: async (filtres: AuditFilters): Promise<{ entries: AuditEntry[]; meta: AuditPageMeta }> => {
    const envelope = await request<AuditEntry[]>('/audit', {
      query: filtres as Record<string, string | number | boolean | undefined | null>,
    });
    return {
      entries: envelope.data ?? [],
      meta: envelope.meta as unknown as AuditPageMeta,
    };
  },

  actions: () => requestData<AuditActionFacet[]>('/audit/actions'),

  summary: (from?: string, to?: string) =>
    requestData<AuditSummary>('/audit/summary', {
      query: { from, to },
    }),
};

export const warehouseApi = {
  /** Ancienne route, conservée : délègue au même service de réception. */
  scanAccept: (barcode: string, depositId?: string) =>
    requestData<PackageDto>('/warehouse/scan-accept', {
      method: 'POST',
      body: depositId ? { barcode, depositId } : { barcode },
    }),
};

export const runsheetsApi = {
  list: (params?: Record<string, QueryValue>) =>
    request<RunsheetSummaryDto[]>('/runsheets', { query: params }),
  get: (id: string) => requestData<RunsheetSummaryDto>(`/runsheets/${encodeURIComponent(id)}`),
  create: (payload: unknown) => request<RunsheetSummaryDto>('/runsheets', { method: 'POST', body: payload }),
  driverActive: (driverId: string) =>
    requestData<RunsheetSummaryDto>(`/runsheets/driver/active?driverId=${encodeURIComponent(driverId)}`),
  addPackage: (id: string, packageIdentifier: string) =>
    request<RunsheetSummaryDto>(`/runsheets/${encodeURIComponent(id)}/add-package`, {
      method: 'POST',
      body: { packageIdentifier },
    }),
  removePackage: (id: string, packageIdentifier: string) =>
    request<RunsheetSummaryDto>(`/runsheets/${encodeURIComponent(id)}/remove-package`, {
      method: 'POST',
      body: { packageIdentifier },
    }),
  setStatus: (id: string, status: string) =>
    request<RunsheetSummaryDto>(`/runsheets/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: { status },
    }),
  close: (id: string, payload: unknown) =>
    request<RunsheetSummaryDto>(`/runsheets/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      body: payload,
    }),
  validate: (id: string, payload?: unknown) =>
    request<RunsheetSummaryDto>(`/runsheets/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      body: payload ?? {},
    }),
};

export const ramassagesApi = {
  list: (params?: Record<string, QueryValue>) =>
    request<PickupAppointmentDto[]>('/ramassages', { query: params }),
  create: (payload: unknown) => request<PickupAppointmentDto>('/ramassages', { method: 'POST', body: payload }),
  confirm: (id: string) =>
    request<PickupAppointmentDto>(`/ramassages/${encodeURIComponent(id)}/confirm`, { method: 'PATCH' }),
  complete: (id: string) =>
    request<PickupAppointmentDto>(`/ramassages/${encodeURIComponent(id)}/complete`, { method: 'PATCH' }),
  cancel: (id: string) =>
    request<PickupAppointmentDto>(`/ramassages/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' }),
};

export const paymentsApi = {
  list: (params?: Record<string, QueryValue>) =>
    request<PaymentVoucherDto[]>('/payments/vouchers', { query: params }),
  validate: (voucherNumber: string, payload: unknown) =>
    request<PaymentVoucherDto>(
      `/payments/vouchers/${encodeURIComponent(voucherNumber)}/validate`,
      { method: 'POST', body: payload }
    ),
};

/**
 * Encaissements COD.
 *
 * Aucune méthode n'envoie de `status` : valider et écarter sont des actions
 * de caisse, pas des champs modifiables. Le frontend n'a donc aucun moyen de
 * déclarer un paiement payé, et c'est voulu.
 */
export const cashApi = {
  list: (params?: Record<string, QueryValue>) =>
    request<PaymentDto[]>('/payments', { query: params }),
  get: (id: string) => requestData<PaymentDto>(`/payments/${encodeURIComponent(id)}`),
  summary: (params?: Record<string, QueryValue>) =>
    requestData<PaymentSummaryDto>('/payments/summary', { query: params }),
  byShipper: () => requestData<ShipperPaymentsDto[]>('/payments/by-shipper'),
  byDriver: () => requestData<DriverPaymentsDto[]>('/payments/by-driver'),
  validate: (id: string, payload: PaymentValidationRequest) =>
    requestData<PaymentDto>(`/payments/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      body: payload,
    }),
  reject: (id: string, payload: PaymentRejectionRequest) =>
    requestData<PaymentDto>(`/payments/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: payload,
    }),
};

export const interDepotsApi = {
  list: (params?: Record<string, QueryValue>) =>
    request<InterDepotDto[]>('/inter-depots', { query: params }),
  get: (id: string) => requestData<InterDepotDto>(`/inter-depots/${encodeURIComponent(id)}`),
  formOptions: () => requestData<InterDepotFormOptions>('/inter-depots/form-options'),
  create: (payload: {
    type: InterDepotType;
    sourceDepositId?: string;
    destinationDepositId: string;
    transporterDriverId: string;
    vehiclePlate?: string;
    departureAt?: string;
  }) => requestData<InterDepotDto>('/inter-depots', { method: 'POST', body: payload }),
  update: (id: string, payload: { transporterDriverId?: string; vehiclePlate?: string; departureAt?: string }) =>
    requestData<InterDepotDto>(`/inter-depots/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }),
  candidates: (id: string) =>
    requestData<InterDepotCandidate[]>(`/inter-depots/${encodeURIComponent(id)}/candidates`),
  scan: (id: string, code: string, mode: 'add' | 'remove') =>
    request<InterDepotDto>(`/inter-depots/${encodeURIComponent(id)}/scan`, { method: 'POST', body: { code, mode } }),
  cancel: (id: string) =>
    request<InterDepotDto>(`/inter-depots/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }),
  acceptance: (type: InterDepotType, depositId?: string) =>
    requestData<AcceptanceBoard>('/inter-depots/acceptance', { query: { type, depositId } }),
  acceptScan: (code: string, type: InterDepotType, depositId?: string) =>
    request<AcceptanceResult>('/inter-depots/acceptance/scan', { method: 'POST', body: { code, type, depositId } }),
};

export const dashboardApi = {
  get: () => requestData<DashboardDto>('/dashboard'),
};

export const healthApi = {
  check: () => request<HealthCheckResponse>('/health'),
};

/* ------------------------------------------------------------------ */
/* Administration — comptes, expéditeurs, livreurs                     */
/* ------------------------------------------------------------------ */
/*
 * Ces types sont le miroir exact des DTO renvoyés par `modules/admin`. Ils ne
 * contiennent volontairement ni `passwordHash` ni `secretPaymentCode` : ces
 * champs ne quittent jamais l'API, et les déclarer ici laisserait croire qu'on
 * peut les lire.
 */

/** Les huit rôles réellement attribuables. L'API refuse toute autre valeur. */
export type RoleAttribuable =
  | 'SUPER_ADMIN'
  | 'ADMIN_GENERAL'
  | 'DISPATCHER'
  | 'MAGASINIER'
  | 'CAISSIER'
  | 'EXPEDITEUR_ADMIN'
  | 'EXPEDITEUR_USER'
  | 'LIVREUR';

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  isActive: boolean;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  roles: RoleAttribuable[];
  depositId: string | null;
  depositName: string | null;
  shipper: { id: string; companyName: string; code: string } | null;
  driver: { id: string; driverCode: string; vehicleType: string } | null;
}

export interface ShipperDto {
  id: string;
  code: string;
  companyName: string;
  brandName: string | null;
  taxId: string | null;
  phone: string;
  phoneSecondary: string | null;
  email: string;
  governorate: string;
  address: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  packagesCount?: number;
  /** `null` quand aucune activité n'a jamais eu lieu — jamais une date inventée. */
  lastActivityAt?: string | null;
  users?: Array<{ id: string; fullName: string; email: string; isActive: boolean; role: RoleAttribuable | null }>;
}

export interface DriverDto {
  id: string;
  driverCode: string;
  vehicleType: string;
  licensePlate: string | null;
  cashCeiling: number;
  currentBalance: number;
  rating: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Présence mobile : ISO UTC du dernier battement, ou null si jamais vu. */
  lastSeenAt: string | null;
  /** En ligne si vu dans la fenêtre `DRIVER_PRESENCE_TIMEOUT_SECONDS` (défaut 180 s). */
  isOnline: boolean;
  user: { id: string; fullName: string; email: string; phone: string; isActive: boolean } | null;
  deposit: { id: string; name: string } | null;
  currentAssignment: { runsheetNumber: string; status: string; tourDate: string } | null;
}

/** Une page de résultats, telle que l'API l'enveloppe (`data` + `meta`). */
export interface PageResultat<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Référentiels nécessaires aux formulaires de création et de rattachement. */
export interface ReferentielsAdmin {
  roles: Array<{ name: RoleAttribuable; displayName: string }>;
  expediteurs: Array<{ id: string; code: string; companyName: string }>;
  depots: Array<{ id: string; name: string }>;
  comptesSansLivreur: Array<{ id: string; fullName: string; email: string; phone: string }>;
}

export interface FiltresListe {
  search?: string;
  status?: string;
  role?: string;
  page?: number;
  limit?: number;
}

/** Déplie l'enveloppe `{ data, meta }` en `{ items, total, page, limit }`. */
async function pageDe<T>(path: string, filtres?: FiltresListe): Promise<PageResultat<T>> {
  const enveloppe = await request<T[]>(path, {
    query: filtres as Record<string, QueryValue>,
  });
  const meta = (enveloppe.meta ?? {}) as { total?: number; page?: number; limit?: number };
  return {
    items: enveloppe.data ?? [],
    total: meta.total ?? (enveloppe.data?.length ?? 0),
    page: meta.page ?? 1,
    limit: meta.limit ?? (enveloppe.data?.length ?? 25),
  };
}

export const usersApi = {
  list: (filtres?: FiltresListe) => pageDe<UserDto>('/users', filtres),
  get: (id: string) => requestData<UserDto>(`/users/${id}`),
  referentiels: () => requestData<ReferentielsAdmin>('/users/referentiels'),
  create: (corps: Record<string, unknown>) =>
    requestData<UserDto>('/users', { method: 'POST', body: corps }),
  update: (id: string, corps: Record<string, unknown>) =>
    requestData<UserDto>(`/users/${id}`, { method: 'PATCH', body: corps }),
  /**
   * Active ou désactive un compte.
   *
   * Le motif est obligatoire côté API pour une désactivation : une trace
   * d'audit sans raison ne permet pas de répondre, six mois plus tard, à la
   * question « qui a coupé cet accès, et pourquoi ? ».
   */
  setStatus: (id: string, isActive: boolean, reason?: string) =>
    requestData<UserDto>(`/users/${id}/status`, {
      method: 'PATCH',
      body: { isActive, reason },
    }),
};

export const shippersApi = {
  list: (filtres?: FiltresListe) => pageDe<ShipperDto>('/shippers', filtres),
  get: (id: string) => requestData<ShipperDto>(`/shippers/${id}`),
  create: (corps: Record<string, unknown>) =>
    requestData<ShipperDto>('/shippers', { method: 'POST', body: corps }),
  update: (id: string, corps: Record<string, unknown>) =>
    requestData<ShipperDto>(`/shippers/${id}`, { method: 'PATCH', body: corps }),
  setStatus: (id: string, isActive: boolean, reason?: string) =>
    requestData<ShipperDto>(`/shippers/${id}/status`, {
      method: 'PATCH',
      body: { isActive, reason },
    }),
  rattacherCompte: (id: string, userId: string) =>
    requestData<ShipperDto>(`/shippers/${id}/users`, { method: 'POST', body: { userId } }),
  detacherCompte: (id: string, userId: string) =>
    requestData<ShipperDto>(`/shippers/${id}/users/${userId}`, { method: 'DELETE' }),
};

export const driversApi = {
  list: (filtres?: FiltresListe) => pageDe<DriverDto>('/drivers', filtres),
  get: (id: string) => requestData<DriverDto>(`/drivers/${id}`),
  comptesDisponibles: () =>
    requestData<Array<{ id: string; fullName: string; email: string; phone: string }>>(
      '/drivers/comptes-disponibles'
    ),
  create: (corps: Record<string, unknown>) =>
    requestData<DriverDto>('/drivers', { method: 'POST', body: corps }),
  update: (id: string, corps: Record<string, unknown>) =>
    requestData<DriverDto>(`/drivers/${id}`, { method: 'PATCH', body: corps }),
  setStatus: (id: string, isActive: boolean, reason?: string) =>
    requestData<DriverDto>(`/drivers/${id}/status`, {
      method: 'PATCH',
      body: { isActive, reason },
    }),
};

/* ------------------------------------------------------------------ */
/* Inventaire, historique et recherche                                 */
/* ------------------------------------------------------------------ */

export interface InventoryFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  shipperId?: string;
  driverId?: string;
  depositId?: string;
  city?: string;
  governorate?: string;
  type?: string;
  paymentStatus?: string;
  returnStatus?: string;
  page?: number;
  limit?: number;
}

export interface InventoryRow {
  id: string;
  trackingNumber: string;
  barcode: string;
  status: string;
  statusLabel: string;
  packageType: string;
  customerName: string;
  customerPhone: string;
  governorate: string;
  city: string;
  locality: string | null;
  shipperId: string;
  shipperName: string;
  driverId: string | null;
  driverName: string | null;
  depositId: string | null;
  depositName: string | null;
  runsheetNumber: string | null;
  pieceCount: number;
  totalPrice: string;
  collectedAmount: string;
  paymentStatus: string | null;
  returnStatus: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface InventoryListResponse {
  items: InventoryRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appliedFilters: Record<string, string>;
}

export interface InventoryOption {
  value: string;
  label: string;
  count?: number;
}

export interface InventoryFacets {
  shippers: { id: string; label: string }[];
  drivers: { id: string; label: string }[];
  deposits: { id: string; label: string }[];
  cities: string[];
  governorates: string[];
  statuses: InventoryOption[];
  packageTypes: InventoryOption[];
  paymentStatuses: InventoryOption[];
  returnStatuses: InventoryOption[];
}

export interface GlobalSearchResult {
  colis: {
    id: string;
    trackingNumber: string;
    customerName: string;
    customerPhone: string;
    statusLabel: string;
    shipperName: string;
    governorate: string | null;
    totalPrice: string;
    createdAt: string;
  }[];
  shippers: { id: string; code: string; companyName: string; packagesCount: number }[];
  drivers: { id: string; driverCode: string; fullName: string; packagesCount: number }[];
  runsheets: {
    id: string;
    runsheetNumber: string;
    tourDate: string;
    status: string;
    driverName: string | null;
    packagesCount: number;
  }[];
  deposits: { id: string; code: string; name: string; city: string; packagesCount: number }[];
}

/**
 * Convertit les filtres de l'écran en paramètres.
 *
 * `ALL` — la valeur affichée dans chaque liste — ne doit jamais atteindre la
 * requête : le serveur la traiterait comme une valeur réelle et ne
 * remonterait aucun résultat. On la supprime donc ici, une fois pour toutes.
 */
function inventoryQuery(filters: InventoryFilters): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === 'ALL') continue;
    query[key] = typeof value === 'number' ? value : String(value);
  }
  return query;
}

export const inventoryApi = {
  async list(filters: InventoryFilters = {}): Promise<InventoryListResponse> {
    const envelope = await request<InventoryRow[]>('/inventaire', {
      query: inventoryQuery(filters),
    });
    return {
      items: envelope.data ?? [],
      total: Number(envelope.meta?.total ?? 0),
      page: Number(envelope.meta?.page ?? 1),
      limit: Number(envelope.meta?.limit ?? 50),
      totalPages: Number(envelope.meta?.totalPages ?? 1),
      appliedFilters: (envelope.meta?.appliedFilters as Record<string, string>) ?? {},
    };
  },

  facets: () => requestData<InventoryFacets>('/inventaire/facets'),
};

// Exceptions d'inventaire — colis suspects
export interface InventoryExceptionFilters extends InventoryFilters {
  category?: string;
  severity?: string;
  stuckHours?: number;
  blockedHours?: number;
}

export interface InventoryExceptionRow extends InventoryRow {
  exceptionCategory: string;
  severity: string;
  reasons: string[];
  lastEventAt: string | null;
  lastEventTitle: string | null;
  ageHours: number;
  hoursSinceUpdate: number;
  timelineCount: number;
  deliveryAttemptsCount: number;
  runsheetId: string | null;
  runsheetStatus: string | null;
  updatedAt: string;
}

export interface InventoryExceptionListResponse {
  items: InventoryExceptionRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appliedFilters: Record<string, string>;
  thresholds: { stuckHours: number; blockedHours: number; nonTraceableHours: number; nonEnvoyeHours: number };
}

export interface InventoryExceptionFacets {
  shippers: { id: string; label: string }[];
  drivers: { id: string; label: string }[];
  deposits: { id: string; label: string }[];
  categories: { value: string; label: string; count: number }[];
  severities: { value: string; label: string; count: number }[];
  statuses: { value: string; label: string; count: number }[];
  totalExceptions: number;
  totalScanned: number;
  thresholds: { stuckHours: number; blockedHours: number; nonTraceableHours: number; nonEnvoyeHours: number };
}

export const inventoryExceptionsApi = {
  async list(filters: InventoryExceptionFilters = {}): Promise<InventoryExceptionListResponse> {
    const envelope = await request<InventoryExceptionRow[]>('/inventaire/exceptions', {
      query: inventoryQuery(filters as unknown as InventoryFilters),
    });
    return {
      items: envelope.data ?? [],
      total: Number(envelope.meta?.total ?? 0),
      page: Number(envelope.meta?.page ?? 1),
      limit: Number(envelope.meta?.limit ?? 50),
      totalPages: Number(envelope.meta?.totalPages ?? 1),
      appliedFilters: (envelope.meta?.appliedFilters as Record<string, string>) ?? {},
      thresholds: (envelope.meta?.thresholds as InventoryExceptionListResponse['thresholds']) ?? { stuckHours: 48, blockedHours: 72, nonTraceableHours: 24, nonEnvoyeHours: 48 },
    };
  },
  facets: (filters: InventoryExceptionFilters = {}) =>
    requestData<InventoryExceptionFacets>('/inventaire/exceptions/facets', { query: inventoryQuery(filters as unknown as InventoryFilters) }),
  detail: (id: string) => requestData<{ detail: unknown; exception: { category: string; severity: string; reasons: string[] } | null }>(`/inventaire/exceptions/${id}`),
};

export const searchApi = {
  global: (term: string) =>
    requestData<GlobalSearchResult>('/search', { query: { q: term } }),
};

/**
 * Export CSV de l'inventaire, filtres appliqués.
 *
 * Un téléchargement ne passe pas par `request` : la réponse n'est pas une
 * enveloppe JSON mais un fichier, et le navigateur doit le proposer à
 * l'utilisateur. On interroge donc l'API directement, jeton en en-tête — un
 * jeton passé en paramètre d'URL finirait dans les journaux du serveur.
 *
 * Le fichier transite par un `Blob`. À 50 000 lignes on parle de quelques
 * mégaoctets : c'est supportable en mémoire, et cela évite d'exposer le jeton
 * dans une URL. Le refus de l'API — trop de lignes — est remonté tel quel,
 * sinon l'utilisateur verrait un téléchargement vide sans explication.
 */
/**
 * Rapports d'exploitation.
 *
 * Un rapport se charge toujours avec une période : sans bornes, l'API applique
 * une période par défaut, et l'écran qui afficherait « aucune période » en
 * regard de chiffres calculés sur trente jours mentirait sur sa propre portée.
 */
export const reportsApi = {
  async lire(domaine: DomaineRapport, filtres: FiltresRapport = {}): Promise<Rapport> {
    const query: Record<string, string> = {};
    if (filtres.from) query.from = filtres.from;
    if (filtres.to) query.to = filtres.to;
    return requestData<Rapport>(`/reports/${domaine}`, { query });
  },

  domaines: () => requestData<Array<{ id: DomaineRapport; libelle: string }>>('/reports/domaines'),

  exporter: (domaine: DomaineRapport, filtres: FiltresRapport = {}) =>
    telechargerCsv(
      `/reports/${domaine}/export`,
      { ...(filtres.from ? { from: filtres.from } : {}), ...(filtres.to ? { to: filtres.to } : {}) },
      `rapport_${domaine}.csv`
    ),
};

export async function downloadInventoryCsv(
  filters: InventoryFilters = {}
): Promise<{ rowCount: number; filename: string }> {
  return telechargerCsv('/inventaire/export', inventoryQuery(filters), 'inventaire.csv');
}

/**
 * Télécharge un export CSV et confirme ce qu'il contient.
 *
 * La mécanique est la même pour tous les exports — jamais le jeton dans l'URL,
 * refus de l'API remonté tel quel, fichier libéré après coup — et ne mérite
 * donc pas d'être réécrite à chaque rapport.
 *
 * Le fichier transite par un `Blob`. À 50 000 lignes on parle de quelques
 * mégaoctets : c'est supportable en mémoire, et cela évite d'exposer le jeton
 * dans une URL.
 */
export async function telechargerCsv(
  chemin: string,
  query: Record<string, string | number> = {},
  nomParDefaut = 'export.csv'
): Promise<{ rowCount: number; filename: string }> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) search.append(key, String(value));
  const chaine = search.toString();

  const headers: Record<string, string> = { Accept: 'text/csv' };
  const token = tokenStorage.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${chemin}${chaine ? `?${chaine}` : ''}`, { headers });

  if (!response.ok) {
    // L'API répond en JSON même pour un téléchargement refusé : le message
    // explique pourquoi (trop de lignes, filtre incohérent), et il doit
    // atteindre l'utilisateur plutôt qu'être avalé.
    let message = `Export refusé (${response.status}).`;
    try {
      const payload = (await response.json()) as ApiEnvelope<null>;
      if (payload.message) message = payload.message;
    } catch {
      /* corps non JSON : le message générique suffit */
    }
    throw new ApiError(message, response.status);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? nomParDefaut;
  const rowCount = Number(response.headers.get('X-Export-Rows') ?? 0);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // L'URL téléchargée retient le fichier tant qu'elle n'est pas révoquée :
  // sans ce revoke, chaque export fuit plusieurs mégaoctets.
  URL.revokeObjectURL(url);

  return { rowCount, filename };
}

/* ------------------------------------------------------------------ */
/* Adaptateur compatible `fetch`                                       */
/* ------------------------------------------------------------------ */

/**
 * Résultat brut d'une requête, avant toute décision de lever une exception.
 */
interface RawResult {
  ok: boolean;
  status: number;
  envelope: ApiEnvelope<unknown> | Record<string, unknown>;
}

/**
 * Exécute une requête et renvoie l'enveloppe telle quelle, sans lever d'erreur
 * sur un statut HTTP en échec.
 *
 * C'est le socle commun à `request()` (qui lève) et à `createApiFetch()` (qui
 * non). Elle applique la rotation du jeton en cas de `401`, comme `request`.
 */
async function performRaw(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
): Promise<RawResult> {
  const { method = 'GET', body, headers: extraHeaders, signal } = options;

  const send = async (): Promise<Response> => {
    // Les en-têtes arrivent en minuscules depuis `createApiFetch` (objet
    // Headers) : sans normalisation, « content-type » et « Content-Type »
    // coexistaient et le navigateur envoyait « application/json,
    // application/json », que l'API ne reconnaît pas comme JSON — le corps
    // était ignoré et chaque action de ces écrans répondait 400.
    const headers: Record<string, string> = { Accept: 'application/json' };
    for (const [key, value] of Object.entries(extraHeaders ?? {})) {
      const lower = key.toLowerCase();
      if (lower === 'content-type') headers['Content-Type'] = value;
      else if (lower === 'authorization') headers.Authorization = value;
      else if (lower === 'accept') headers.Accept = value;
      else headers[key] = value;
    }
    if (body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // Un en-tête d'autorisation vide (« Bearer »)Provient d'un appelant qui
    // n'a pas de jeton à disposition : on le remplace par celui du session en
    // cours plutôt que d'envoyer une requête qui échouerait en 401.
    const providedAuth = headers.Authorization ?? headers.authorization;
    if (!providedAuth || providedAuth.trim().length === 0 || /^bearer\s*$/i.test(providedAuth.trim())) {
      delete headers.Authorization;
      delete headers.authorization;
      const token = tokenStorage.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    return fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    return {
      ok: false,
      status: 0,
      envelope: {
        success: false,
        message:
          "Impossible de joindre le serveur RUNEX. Vérifiez que l'API est démarrée.",
      },
    };
  }

  // Session expirée : une rotation, puis un rejeu.
  if (response.status === 401) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      // Un en-tête Authorization fourni par l'appelant (jeton figé dans une
      // prop) est périmé : la nouvelle tentative utilise le jeton rafraîchi.
      delete extraHeaders?.Authorization;
      delete extraHeaders?.authorization;
      try {
        response = await send();
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error;
        return {
          ok: false,
          status: 0,
          envelope: {
            success: false,
            message: 'Impossible de joindre le serveur RUNEX.',
          },
        };
      }
    }
  }

  const raw = await response.text();
  let parsed: ApiEnvelope<unknown> | Record<string, unknown>;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw) as ApiEnvelope<unknown>;
    } catch {
      parsed = { success: response.ok, message: raw };
    }
  } else {
    parsed = { success: response.ok };
  }

  return { ok: response.ok, status: response.status, envelope: parsed };
}

/**
 * Crée un `fetch` de remplacement qui route les appels vers l'API RUNEX.
 *
 * Il conserve la signature et le comportement de `fetch` — y compris le fait de
 * **ne pas** lever d'exception sur une erreur HTTP — ce qui permet de reprendre
 * les modules migrés depuis l'application Vite sans en réécrire la logique
 * métier. Seule l'origine des requêtes change : plus aucune URL d'API n'est
 * écrite en dur dans l'application.
 *
 * @example
 * const fetch = createApiFetch();
 * const data = await (await fetch('/colis')).json();
 */
export function createApiFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    // Retire l'origine et le préfixe de version pour ne garder que le chemin.
    let path = rawUrl.replace(/^https?:\/\/[^/]+/, '');
    path = path.replace(/^\/api\/v1/, '');
    if (!path.startsWith('/')) path = `/${path}`;

    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders) {
      new Headers(rawHeaders as HeadersInit).forEach((value, key) => {
        headers[key] = value;
      });
    }

    const result = await performRaw(path, {
      method,
      body,
      headers,
      signal: init?.signal ?? undefined,
    });

    const payload = JSON.stringify(result.envelope);

    // Objet compatible avec Response, suffisant pour un appel à `.json()`.
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.ok ? 'OK' : 'Error',
      url: `${API_BASE_URL}${path}`,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => JSON.parse(payload),
      text: async () => payload,
      clone() {
        return this;
      },
    } as unknown as Response;
  }) as typeof fetch;
}
