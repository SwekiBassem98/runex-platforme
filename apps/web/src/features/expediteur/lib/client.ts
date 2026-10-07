'use client';

/**
 * Client du portail expéditeur.
 *
 * Il ne fait qu'un travail : appeler les endpoints que l'API accorde déjà à un
 * expéditeur, en gardant la main sur la forme des réponses. Aucun périmètre
 * n'est transmis — ni `shipperId`, ni `shipperId` en paramètre de requête —
 * parce que le serveur le déduit du jeton et qu'une valeur envoyée par le
 * navigateur serait une invitation à lire les données d'un autre.
 *
 * `GET /colis` accepte neuf paramètres (`search`, `status`, `city`, `driver`,
 * `type`, `paymentStatus`, `date`, `page`, `limit`). Le tri et les plages de
 * dates n'existent pas côté serveur : ils ne sont donc pas exposés ici, pour
 * qu'aucun écran ne laisse croire à un filtrage serveur qui n'a pas lieu.
 */

import {
  type NotificationDto,
  type PackageDto,
  type PaymentVoucherDto,
  type PickupAppointmentDto,
} from '@logixpress/types';
import { notificationsApi } from '@/lib/notification-api';
import { request, requestData, type ApiEnvelope, type AuditEntry } from '@/lib/api';

/** Paramètres acceptés par la liste des colis, tels que l'API les définit. */
export interface FiltresColis {
  search?: string;
  status?: string;
  type?: string;
  city?: string;
  paymentStatus?: string;
  date?: string;
  page?: number;
  limit?: number;
}

/**
 * Les filtres ne contiennent aucun `shipperId`.
 *
 * L'API en accepte un — elle l'ignore et le remplace par celui du jeton. Le
 * retirer de ce type, c'est retirer l'envie de l'envoyer : un périmètre ne se
 * négocie pas depuis un navigateur.
 */
type QueryColis = Record<string, string | number | boolean | undefined | null>;

export interface PageColis {
  colis: PackageDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Page de colis.
 *
 * `meta.total` fait autorité : c'est le même décompte que celui du serveur sur
 * le même prédicat. Se rabattre sur `data.length` afficherait « 20 » sur une
 * page de 20 quand il y en a 300, et un expéditeur lirait ça comme un inventaire
 * complet.
 */
export async function listerColis(filtres: FiltresColis = {}): Promise<PageColis> {
  const enveloppe = await request<PackageDto[]>('/colis', { query: filtres as QueryColis });
  const colis = enveloppe.data ?? [];
  return {
    colis,
    total: Number(enveloppe.meta?.total ?? colis.length),
    page: Number(enveloppe.meta?.page ?? filtres.page ?? 1),
    limit: Number(enveloppe.meta?.limit ?? filtres.limit ?? colis.length),
  };
}

/**
 * Compte les colis d'un statut sans en charger la liste.
 *
 * L'API renvoie `meta.total` pour n'importe quel filtre, y compris avec
 * `limit: 1` : c'est la façon de poser une question fermée au serveur sans
 * transporter la réponse.
 */
export async function compterColis(filtres: FiltresColis): Promise<number> {
  const enveloppe = await request<PackageDto[]>('/colis', {
    query: { ...filtres, limit: 1 } as QueryColis,
  });
  return Number(enveloppe.meta?.total ?? 0);
}

/** Fiche complète d'un colis : chronologie, tentatives, retours, échange, audit. */
export async function lireColis(identifiant: string): Promise<PackageDto> {
  return requestData<PackageDto>(`/colis/${encodeURIComponent(identifiant)}`);
}

/**
 * Journal d'audit d'un colis, borné par le serveur aux 50 entrées les plus récentes.
 *
 * Le résolveur du colis est appliqué avant la lecture du journal : un numéro de
 * suivi d'une autre entreprise ne rend pas une erreur distincte, il rend un
 * 404. Le journal est donc bien cloisonné, et pas seulement filtré à l'affichage.
 */
export async function lireAuditColis(identifiant: string): Promise<AuditEntry[]> {
  return requestData<AuditEntry[]>(`/colis/${encodeURIComponent(identifiant)}/audit`);
}

export async function creerColis(charge: unknown): Promise<ApiEnvelope<PackageDto>> {
  return request<PackageDto>('/colis', { method: 'POST', body: charge });
}

/** Modification autorisée : l'API refuse elle-même les statuts verrouillés. */
export async function modifierColis(
  identifiant: string,
  charge: unknown
): Promise<ApiEnvelope<PackageDto>> {
  return request<PackageDto>(`/colis/${encodeURIComponent(identifiant)}`, {
    method: 'PUT',
    body: charge,
  });
}

export async function annulerColis(identifiant: string, motif: string): Promise<ApiEnvelope<PackageDto>> {
  return request<PackageDto>(`/colis/${encodeURIComponent(identifiant)}/cancel`, {
    method: 'POST',
    body: { reason: motif },
  });
}

export async function listerRamassages(filtres: { status?: string; date?: string } = {}) {
  const enveloppe = await request<PickupAppointmentDto[]>('/ramassages', { query: filtres });
  return {
    rendezVous: enveloppe.data ?? [],
    total: Number(enveloppe.meta?.total ?? 0),
  };
}

export async function demanderRamassage(charge: unknown): Promise<PickupAppointmentDto> {
  return requestData<PickupAppointmentDto>('/ramassages', { method: 'POST', body: charge });
}

/** Annulation par la référence du rendez-vous : c'est cet identifiant que l'API attend. */
export async function annulerRamassage(reference: string): Promise<PickupAppointmentDto> {
  return requestData<PickupAppointmentDto>(`/ramassages/${encodeURIComponent(reference)}/cancel`, {
    method: 'PATCH',
  });
}

/** Bordereaux de l'expéditeur : ce que RUNEX lui doit. */
export async function listerBordereaux(): Promise<PaymentVoucherDto[]> {
  const enveloppe = await request<PaymentVoucherDto[]>('/payments/vouchers');
  return enveloppe.data ?? [];
}

export type { NotificationDto };
export { notificationsApi };