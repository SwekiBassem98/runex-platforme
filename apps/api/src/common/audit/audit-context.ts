/**
 * Contexte de la requête courante, pour le journal d'audit.
 *
 * Une trace d'audit doit dire *qui*, *quoi*, *depuis quelle machine*. Le
 * « depuis quelle machine » — adresse IP et client — n'existe que sur la
 * requête HTTP, alors que l'écriture d'audit se fait dans un service métier qui
 * ne voit qu'un identifiant d'utilisateur.
 *
 * Faire circuler l'objet `Request` jusque dans les services aurait lié chaque
 * méthode métier à la couche HTTP. À la place, le contexte est ouvert une fois
 * par requête et rendu disponible partout, y compris dans les branches
 * asynchrones : c'est le rôle d'`AsyncLocalStorage`.
 *
 * Le contexte est ouvert avant l'authentification — l'adresse IP existe même
 * pour une requête refusée — puis complété quand l'utilisateur est connu.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { RoleType } from '@logixpress/types';

/** Ce que l'audit sait de l'origine d'une écriture. */
export interface AuditContext {
  /** Adresse IP du client, telle que la voit le serveur. */
  ip: string | null;
  /** Client à l'origine de la requête, tronqué à la longueur de la colonne. */
  userAgent: string | null;
  /** Renseigné dès que l'authentification a abouti. */
  userId?: string | null;
  fullName?: string | null;
  role?: RoleType | null;
  /** Identifiant de requête, pour recouper deux lignes entre elles. */
  requestId?: string | null;
}

/**
 * Longueurs alignées sur le schéma.
 *
 * Le journal ne doit jamais échouer parce qu'une chaîne est trop longue pour sa
 * colonne : `varchar` refuse la ligne entière, et l'opération métier — qui, elle,
 * a abouti — serait alors signalée en erreur alors qu'elle est faite.
 */
export const IP_MAX = 45;
export const USER_AGENT_MAX = 255;
export const REASON_MAX = 255;

const storage = new AsyncLocalStorage<AuditContext>();

/** Ouvre un contexte et exécute l'appel dans son périmètre. */
export function runWithAuditContext<T>(context: AuditContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Contexte courant, s'il y en a un. */
export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

/**
 * Complète le contexte une fois l'utilisateur identifié.
 *
 * L'objet du contexte est volontairement modifié sur place : la requête est déjà
 * en cours, et tout ce qui a capturé la référence doit voir l'acteur.
 */
export function identifyAuditActor(actor: {
  id: string;
  fullName: string;
  role: RoleType;
}): void {
  const context = storage.getStore();
  if (!context) return;
  context.userId = actor.id;
  context.fullName = actor.fullName;
  context.role = actor.role;
}

/**
 * Adresse IP du client.
 *
 * `X-Forwarded-For` n'est lu que si l'application a été déclarée comme faisant
 * confiance à ses proxys, faute de quoi n'importe quel client pourrait
 * annoncer une adresse arbitraire et polluer la trace.
 */
export function clientIp(remoteAddress?: string | null, forwardedFor?: string | null): string | null {
  const brut = forwardedFor?.split(',')[0]?.trim() || remoteAddress?.trim() || null;
  return brut ? brut.slice(0, IP_MAX) : null;
}

/** Client, ramené à ce que la colonne accepte. */
export function clientUserAgent(entete?: string | string[] | null): string | null {
  const brut = Array.isArray(entete) ? entete[0] : entete;
  if (!brut) return null;
  const nettoye = brut.replace(/\s+/g, ' ').trim();
  return nettoye ? nettoye.slice(0, USER_AGENT_MAX) : null;
}

/** Motif libre, ramené à la longueur de la colonne. */
export function auditReason(motif?: string | null): string | null {
  if (!motif) return null;
  const nettoye = motif.replace(/\s+/g, ' ').trim();
  return nettoye ? nettoye.slice(0, REASON_MAX) : null;
}