/**
 * Sous-traitance de la livraison au partenaire JAX.
 *
 * Flux d'un colis confié à JAX :
 *
 *  1. Le colis est reçu dans une agence Runex (RECU_DEPOT ou
 *     RECU_DEPOT_DESTINATION). Il est confié à JAX automatiquement si son
 *     gouvernorat de destination est une zone JAX (Sous-traitance JAX ›
 *     Paramètres), ou à la main (« Confier à JAX »).
 *  2. Runex le crée chez JAX (expéditeur RUNEX, référence externe = numéro de
 *     suivi Runex) et garde le code EAN JAX. Le colis passe « Confié au
 *     partenaire JAX » (SOUS_TRAITE) : il ne peut plus entrer dans une tournée
 *     ni dans un inter-dépôt Runex.
 *  3. L'administrateur demande à JAX l'enlèvement, agence par agence.
 *  4. Runex relit les statuts JAX (automatiquement et à la demande) et les
 *     reporte dans la chronologie du colis : pris en charge, en livraison,
 *     livré (le colis passe LIVRE) ou non livré (retour en cours).
 *  5. Un retour JAX arrivé à l'agence est pointé « Retour JAX reçu » : le colis
 *     passe RETOUR_DEPOT et suit le circuit habituel des retours.
 *  6. Le contre-remboursement d'un colis livré par JAX est encaissé par JAX :
 *     l'expéditeur n'est réglé (bordereau) qu'une fois ce montant reçu de JAX.
 *
 * La correspondance statut JAX → étape Runex est proposée d'après le libellé
 * (référentiel /statuts) et peut être fixée par l'administrateur.
 *
 * Règles de la réunion client du 10/11 :
 *  - les colis à destination d'une « zone Runex » (Tunis et Ben Arous par
 *    défaut, réglable dans Paramètres) ne sont jamais créés chez JAX ;
 *  - un colis reporté, ou déjà présenté par un livreur Runex, reste chez Runex :
 *    son livreur le livre à nouveau ;
 *  - JAX garde sa part (6,500 DT par défaut, JAX_FRAIS_COLIS) sur chaque colis
 *    qu'il livre : il reverse le contre-remboursement moins cette part.
 */

import { Prisma, type EtatSousTraitance as EtatPrisma } from '@prisma/client';
import { ETATS_SOUS_TRAITANCE, NotificationEvent, PACKAGE_STATUS_LABELS, PackageStatus, RoleType, type EtatSousTraitance, type SousTraitanceColisDto } from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { BusinessRuleError, asUuid } from '../../common/errors/api-error';
import { packageWorkflowService } from '../colis/package-workflow.service';
import { notificationDispatcher } from '../notifications/notification.dispatcher';
import { versDto } from './sous-traitance.dto';
import { JaxError, jaxClient, jaxConfig, lireEan, lireProblemes, lireReferentiel, lireStatut, type StatutJax } from './jax.client';

const PARTENAIRE = 'JAX';
const ACTEUR_JAX = { fullName: 'JAX (partenaire de livraison)', role: RoleType.ADMIN };

export interface ActeurST {
  id?: string;
  fullName: string;
}

/** États où le colis est encore entre les mains de JAX (à relire). */
const ACTIFS: EtatSousTraitance[] = ['EN_ATTENTE_ENLEVEMENT', 'ENLEVEMENT_DEMANDE', 'PRIS_EN_CHARGE', 'EN_LIVRAISON', 'RETOUR_EN_COURS'];
/** États qui empêchent de confier à nouveau le colis. */
const EN_COURS: EtatSousTraitance[] = [...ACTIFS, 'LIVRE'];
const AVANT_ENLEVEMENT: EtatSousTraitance[] = ['EN_ATTENTE_ENLEVEMENT', 'ENLEVEMENT_DEMANDE'];
/**
 * Colis physiquement en agence Runex : créé chez JAX, il passe aussitôt
 * « Confié au partenaire JAX ». Un colis reporté n'en fait pas partie : il
 * reste chez Runex, son livreur le livre à nouveau (réunion du 10/11).
 */
const STATUTS_EN_AGENCE = ['RECU_DEPOT', 'RECU_DEPOT_DESTINATION'];
/** Colis entre les mains d'un livreur Runex : JAX ne peut pas l'avoir. */
const STATUTS_CHEZ_LIVREUR_RUNEX = ['AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON', 'REPORTE', 'ECHEC_LIVRAISON'];
/** Partenaire fictif des « zones Runex » : gouvernorats jamais confiés à JAX. */
const ZONES_RUNEX = 'RUNEX';
/** Part de JAX sur un colis qu'il livre (DT). Réunion du 10/11 : 6,500 sur 8,000. */
export function fraisJaxParColis(): number {
  const v = Number(process.env.JAX_FRAIS_COLIS ?? 6.5);
  return Number.isFinite(v) && v >= 0 ? v : 6.5;
}
/**
 * Colis pas encore en agence (chez l'expéditeur, en ramassage, en inter-dépôt) :
 * créé chez JAX tout de suite, confié à JAX à sa réception en agence.
 */
const STATUTS_AVANT_AGENCE = ['CREE', 'RAMASSAGE_PROGRAMME', 'RAMASSE', 'EN_LOT_INTER_DEPOT', 'EN_TRANSIT_INTER_DEPOT'];
const STATUTS_ENVOYABLES = [...STATUTS_AVANT_AGENCE, ...STATUTS_EN_AGENCE];
/**
 * Rattrapage : colis restés chez Runex, ni livrés, ni retournés, ni annulés.
 * En tournée (affecté, en cours de livraison, reporté) : retiré de la tournée
 * d'abord. Un échec ou refus de livraison part en retour, pas chez JAX.
 */
const STATUTS_RATTRAPAGE = [...STATUTS_ENVOYABLES, 'AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON'];
const enAgence = (statut: string | null | undefined, runsheet?: string | null) => STATUTS_EN_AGENCE.includes(String(statut)) && !runsheet;
/** Ordre d'avancement : une relecture ne fait jamais reculer un colis. */
const RANG: Record<EtatSousTraitance, number> = {
  ECHEC_ENVOI: 0,
  EN_ATTENTE_ENLEVEMENT: 1,
  ENLEVEMENT_DEMANDE: 2,
  PRIS_EN_CHARGE: 3,
  EN_LIVRAISON: 4,
  RETOUR_EN_COURS: 5,
  LIVRE: 6,
  RETOURNE: 7,
  ANNULE: 8,
};

const sansAccents = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (v: string | null | undefined) =>
  sansAccents(String(v ?? '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
/** « La Manouba » = « Manouba », « Médenine » = « Medenine », « Ben-Arous » = « Ben Arous ». */
const cleGouvernorat = (v: string) => norm(v).replace(/^(la|le|el) /, '').replace(/ /g, '');
const n3 = (v: unknown) => Math.round(Number(v ?? 0) * 1000) / 1000;

/**
 * Étape Runex proposée pour un libellé de statut JAX. Les libellés JAX ne sont
 * pas documentés : la correspondance part des mots, et l'administrateur peut
 * la corriger statut par statut.
 */
export function etatDepuisLibelle(libelle: string): EtatSousTraitance | null {
  const l = norm(libelle);
  if (!l) return null;
  // Chez JAX, « Annulé » est rangé dans « En retour » : le colis revient.
  if (/annul/.test(l)) return 'RETOUR_EN_COURS';
  if (/retour|retourne|rtn/.test(l)) return 'RETOUR_EN_COURS';
  if (/(non|pas) livr|echec|refus|injoignable|report|probleme|anomalie/.test(l)) return 'EN_LIVRAISON';
  if (/en cours de livraison|en livraison|sortie|en distribution|livreur/.test(l)) return 'EN_LIVRAISON';
  if (/livr|delivr|remis au client|paye/.test(l)) return 'LIVRE';
  if (/enlev|ramass|pick|collect|recu|reception|depot|transit|transfert|hub|entrepot|en route|expedi/.test(l)) return 'PRIS_EN_CHARGE';
  if (/demande d enlevement|enlevement demande/.test(l)) return 'ENLEVEMENT_DEMANDE';
  if (/attente|cree|nouveau|enregistr|en preparation|valide/.test(l)) return 'EN_ATTENTE_ENLEVEMENT';
  return null;
}

/**
 * Statut Runex du colis pour un statut JAX, d'après les rubriques de
 * l'application JAX (liste fournie par le client, 10/11) :
 *
 *   En préparation    « en attente »                                   → Créé (En préparation)
 *   Au dépôt          « reçu à l'entrepôt »                            → Reçu au dépôt
 *   Inter-dépôt       « en cours de préparation au transfert … »       → En lot inter-dépôt
 *   En livraison      « en cours de livraison »                        → En cours de livraison
 *   Reportés          « reçu à l'entrepôt » après une sortie en livraison → Reporté
 *   En retour         « annulé »                                       → Retour au dépôt
 *   Retour expéditeur « en cours de préparation au retour vers l'exp. » → En retour fournisseur
 *   (et « livré » → Livré, « retourné à l'expéditeur » → Retourné à l'expéditeur)
 */
export function statutRunexDepuisLibelle(libelle: string): string | null {
  const l = norm(libelle);
  if (!l) return null;
  if (/retour/.test(l) && /exped|fournisseur|vendeur|client final/.test(l)) {
    return /retourne|rendu|remis|livre a l exp/.test(l) && !/preparation|cours/.test(l) ? 'RETOURNE_EXPEDITEUR' : 'EN_RUNSHEET_RETOUR';
  }
  if (/annul|retour/.test(l)) return 'RETOUR_DEPOT';
  if (/report/.test(l)) return 'REPORTE';
  if (/(non|pas) livr|echec|refus|injoignable/.test(l)) return 'REPORTE';
  if (/en cours de livraison|en livraison|en distribution|sortie|livreur/.test(l)) return 'EN_COURS_LIVRAISON';
  if (/livr|delivr|remis au client/.test(l)) return 'LIVRE';
  if (/transit/.test(l)) return 'EN_TRANSIT_INTER_DEPOT';
  if (/transfert|inter ?depot|autre agence/.test(l)) return 'EN_LOT_INTER_DEPOT';
  if (/entrepot|depot|recu|reception|hub|enlev|ramass|collect/.test(l)) return 'RECU_DEPOT';
  if (/attente|cree|nouveau|enregistr|preparation|valide/.test(l)) return 'CREE';
  return null;
}

/** Statuts Runex qu'un statut JAX peut donner au colis (choix de l'administrateur). */
export const STATUTS_RUNEX_JAX = [
  'CREE',
  'RECU_DEPOT',
  'EN_LOT_INTER_DEPOT',
  'EN_TRANSIT_INTER_DEPOT',
  'EN_COURS_LIVRAISON',
  'REPORTE',
  'LIVRE',
  'RETOUR_DEPOT',
  'EN_RUNSHEET_RETOUR',
  'RETOURNE_EXPEDITEUR',
] as const;
/** Statuts Runex définitifs : une relecture JAX ne les change plus. */
const STATUTS_RUNEX_FINAUX = ['LIVRE', 'LIVRAISON_PARTIELLE', 'RETOURNE_EXPEDITEUR', 'ANNULE'];

const SELECT_COLIS = {
  id: true,
  trackingNumber: true,
  status: true,
  packageType: true,
  pieceCount: true,
  contentSummary: true,
  totalPrice: true,
  allowOpen: true,
  isFragile: true,
  shipperNotes: true,
  currentDepositId: true,
  currentRunsheetId: true,
  interDepotTransferId: true,
  deletedAt: true,
  shipperId: true,
  shipper: { select: { companyName: true, brandName: true } },
  customer: { select: { fullName: true, primaryPhone: true, secondaryPhone: true } },
  customerAddress: { select: { streetAddress: true, delegation: true, governorate: true, locality: true } },
  currentDeposit: { select: { id: true, name: true, address: true, governorate: true, phone: true } },
  destinationDeposit: { select: { id: true, name: true, address: true, governorate: true, phone: true } },
  destinationDepositId: true,
  sousTraitance: true,
} satisfies Prisma.PackageSelect;

type ColisST = Prisma.PackageGetPayload<{ select: typeof SELECT_COLIS }>;

export interface ResultatEnvoi {
  packageId: string;
  trackingNumber: string;
  ok: boolean;
  codeExterne?: string | null;
  message: string;
}

export class SousTraitanceService {
  private get prisma() {
    return getPrisma();
  }

  /* ---------------------------------------------------------------- */
  /* Référentiels et paramètres                                        */
  /* ---------------------------------------------------------------- */

  async parametres() {
    const cfg = jaxConfig();
    const [zones, gouvernorats, statuts] = await Promise.all([
      this.prisma.sousTraitanceZone.findMany({ where: { partenaire: PARTENAIRE }, orderBy: { governorate: 'asc' } }),
      this.prisma.partenaireGouvernorat.findMany({ where: { partenaire: PARTENAIRE }, orderBy: { nom: 'asc' } }),
      this.prisma.partenaireStatut.findMany({ where: { partenaire: PARTENAIRE }, orderBy: { code: 'asc' } }),
    ]);
    return {
      configure: !!cfg.token,
      url: cfg.url,
      expediteur: { nom: cfg.expediteurNom, tel: cfg.expediteurTel || null },
      syncMinutes: cfg.syncMinutes,
      zones: zones.map((z) => z.governorate),
      zonesRunex: (await this.prisma.sousTraitanceZone.findMany({ where: { partenaire: ZONES_RUNEX }, orderBy: { governorate: 'asc' } })).map((z) => z.governorate),
      fraisColis: fraisJaxParColis(),
      gouvernorats: gouvernorats.map((g) => ({ id: g.externeId, nom: g.nom })),
      statuts: statuts.map((s) => ({
        code: s.code,
        libelle: s.libelle,
        etat: s.etat as EtatSousTraitance | null,
        etatPropose: etatDepuisLibelle(s.libelle),
        manuel: s.manuel,
        statutRunex: s.statutRunex,
        statutRunexPropose: statutRunexDepuisLibelle(s.libelle),
      })),
      statutsRunex: STATUTS_RUNEX_JAX.map((statut) => ({ statut, libelle: PACKAGE_STATUS_LABELS[statut as PackageStatus] })),
      etats: Object.entries(ETATS_SOUS_TRAITANCE).map(([etat, libelle]) => ({ etat, libelle })),
    };
  }

  /** Relit chez JAX les gouvernorats (identifiants) et les statuts. */
  async synchroniserReferentiels(acteur: ActeurST) {
    if (!jaxConfig().token) throw new BusinessRuleError('Sous-traitance JAX non configurée : le jeton JAX (JAX_API_TOKEN) est absent sur le serveur.', 409);
    let g: unknown;
    let s: unknown;
    try {
      [g, s] = await Promise.all([jaxClient.gouvernorats(), jaxClient.statuts()]);
    } catch (e) {
      throw new BusinessRuleError(e instanceof JaxError ? e.message : 'API JAX indisponible.', 424);
    }
    const gouvernorats = lireReferentiel(g);
    const statuts = lireReferentiel(s);
    if (!gouvernorats.length) throw new BusinessRuleError('JAX n’a renvoyé aucun gouvernorat (réponse illisible).', 424);
    for (const x of gouvernorats) {
      await this.prisma.partenaireGouvernorat.upsert({
        where: { partenaire_externeId: { partenaire: PARTENAIRE, externeId: x.id } },
        create: { partenaire: PARTENAIRE, externeId: x.id, nom: x.nom },
        update: { nom: x.nom },
      });
    }
    for (const x of statuts) {
      const existant = await this.prisma.partenaireStatut.findUnique({ where: { partenaire_code: { partenaire: PARTENAIRE, code: x.id } } });
      await this.prisma.partenaireStatut.upsert({
        where: { partenaire_code: { partenaire: PARTENAIRE, code: x.id } },
        create: { partenaire: PARTENAIRE, code: x.id, libelle: x.nom, etat: etatDepuisLibelle(x.nom) as EtatPrisma | null },
        // Une correspondance fixée à la main n'est pas écrasée.
        update: { libelle: x.nom, ...(existant?.manuel ? {} : { etat: etatDepuisLibelle(x.nom) as EtatPrisma | null }) },
      });
    }
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_REFERENTIELS',
      userId: acteur.id ?? null,
      reason: `Référentiels JAX relus : ${gouvernorats.length} gouvernorats, ${statuts.length} statuts.`,
    });
    return { gouvernorats: gouvernorats.length, statuts: statuts.length };
  }

  async definirZones(governorates: unknown, acteur: ActeurST, partenaire: string = PARTENAIRE) {
    const liste = Array.isArray(governorates)
      ? [...new Set(governorates.filter((g): g is string => typeof g === 'string' && !!g.trim()).map((g) => g.trim()))]
      : null;
    if (!liste) throw new BusinessRuleError('Liste de gouvernorats invalide.', 400);
    await this.prisma.$transaction([
      this.prisma.sousTraitanceZone.deleteMany({ where: { partenaire, governorate: { notIn: liste } } }),
      ...liste.map((g) =>
        this.prisma.sousTraitanceZone.upsert({
          where: { partenaire_governorate: { partenaire, governorate: g } },
          create: { partenaire, governorate: g },
          update: {},
        })
      ),
    ]);
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_ZONES',
      userId: acteur.id ?? null,
      reason:
        partenaire === ZONES_RUNEX
          ? liste.length
            ? `Zones livrées par Runex seulement (jamais créées chez JAX) : ${liste.join(', ')}.`
            : 'Plus aucune zone réservée à Runex : tout colis part chez JAX.'
          : liste.length
            ? `Zones confiées à JAX : ${liste.join(', ')}.`
            : 'Plus aucune zone confiée automatiquement à JAX.',
    });
    return liste;
  }

  /** Gouvernorats livrés par Runex seulement (clés normalisées). */
  private async clesZonesRunex(): Promise<Set<string>> {
    const zones = await this.prisma.sousTraitanceZone.findMany({ where: { partenaire: ZONES_RUNEX }, select: { governorate: true } });
    return new Set(zones.map((z) => cleGouvernorat(z.governorate)));
  }

  /** Vrai si la destination est une zone livrée par Runex seulement. */
  async estZoneRunex(governorate: string | null | undefined): Promise<boolean> {
    if (!governorate) return false;
    return (await this.clesZonesRunex()).has(cleGouvernorat(governorate));
  }

  /**
   * Le colis reste chez Runex : sa fiche JAX est abandonnée (état ANNULE) et le
   * code JAX est signalé « à annuler chez JAX » (l'API JAX n'a pas de route
   * d'annulation). Sans effet sur un colis déjà enlevé par JAX.
   */
  async abandonnerChezJax(packageId: string, motif: string, acteur: ActeurST, client?: Prisma.TransactionClient): Promise<boolean> {
    const db = client ?? this.prisma;
    const r = await db.sousTraitance.findUnique({ where: { packageId }, select: { id: true, etat: true, codeExterne: true, package: { select: { trackingNumber: true } } } });
    if (!r) return false;
    if (r.etat === 'ECHEC_ENVOI') {
      await db.sousTraitance.update({ where: { id: r.id }, data: { etat: 'ANNULE', derniereErreur: null } });
      return true;
    }
    if (!AVANT_ENLEVEMENT.includes(r.etat as EtatSousTraitance)) return false;
    await db.sousTraitance.update({
      where: { id: r.id },
      data: {
        etat: 'ANNULE',
        ...(r.codeExterne ? { actionJax: `Annuler le code ${r.codeExterne} chez JAX — ${motif}`.slice(0, 300), actionJaxLe: new Date() } : {}),
      },
    });
    await auditService.record(
      {
        entityType: 'PACKAGE',
        entityId: packageId,
        action: 'JAX_REPRIS',
        userId: acteur.id ?? null,
        reason: `Colis ${r.package.trackingNumber} gardé par Runex (${motif})${r.codeExterne ? ` : code JAX ${r.codeExterne} à annuler chez JAX` : ''}.`.slice(0, 255),
      },
      client
    );
    return true;
  }

  /** Statut Runex du colis pour un statut JAX (null : déduit du libellé). */
  async definirStatutRunex(code: string, statutRunex: unknown, acteur: ActeurST) {
    const cible = statutRunex === null || statutRunex === '' ? null : String(statutRunex);
    if (cible !== null && !(STATUTS_RUNEX_JAX as readonly string[]).includes(cible)) throw new BusinessRuleError('Statut Runex inconnu.', 400);
    const s = await this.prisma.partenaireStatut.findUnique({ where: { partenaire_code: { partenaire: PARTENAIRE, code } } });
    if (!s) throw new BusinessRuleError('Statut JAX inconnu : relisez les référentiels.', 404);
    await this.prisma.partenaireStatut.update({ where: { id: s.id }, data: { statutRunex: cible } });
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_STATUT_CORRESPONDANCE',
      userId: acteur.id ?? null,
      reason: `Statut JAX « ${s.libelle} » (${code}) → colis ${cible ? `« ${PACKAGE_STATUS_LABELS[cible as PackageStatus]} »` : 'statut déduit du libellé'}.`,
    });
  }

  async definirStatut(code: string, etat: unknown, acteur: ActeurST) {
    const cible = etat === null || etat === '' ? null : String(etat);
    if (cible !== null && !(cible in ETATS_SOUS_TRAITANCE)) throw new BusinessRuleError('Étape inconnue.', 400);
    const s = await this.prisma.partenaireStatut.findUnique({ where: { partenaire_code: { partenaire: PARTENAIRE, code } } });
    if (!s) throw new BusinessRuleError('Statut JAX inconnu : relisez les référentiels.', 404);
    await this.prisma.partenaireStatut.update({
      where: { id: s.id },
      data: cible === null ? { etat: etatDepuisLibelle(s.libelle) as EtatPrisma | null, manuel: false } : { etat: cible as EtatPrisma, manuel: true },
    });
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_STATUT_CORRESPONDANCE',
      userId: acteur.id ?? null,
      reason: `Statut JAX « ${s.libelle} » (${code}) → ${cible ? ETATS_SOUS_TRAITANCE[cible as EtatSousTraitance] : 'correspondance automatique'}.`,
    });
  }

  /** Identifiant JAX d'un gouvernorat Runex (référentiel relu chez JAX). */
  private async idGouvernoratJax(nom: string | null | undefined): Promise<string | null> {
    if (!nom) return null;
    const cle = cleGouvernorat(nom);
    const liste = await this.prisma.partenaireGouvernorat.findMany({ where: { partenaire: PARTENAIRE } });
    const exact = liste.find((g) => cleGouvernorat(g.nom) === cle);
    if (exact) return exact.externeId;
    const proche = liste.find((g) => cleGouvernorat(g.nom).includes(cle) || cle.includes(cleGouvernorat(g.nom)));
    return proche?.externeId ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Envoi à JAX                                                        */
  /* ---------------------------------------------------------------- */

  /** Pourquoi un colis ne peut pas être confié à JAX (null : il peut). */
  private motifRefus(c: ColisST): string | null {
    if (c.deletedAt) return 'colis supprimé';
    if (c.sousTraitance && EN_COURS.includes(c.sousTraitance.etat as EtatSousTraitance)) return 'déjà confié à JAX';
    if (!STATUTS_ENVOYABLES.includes(String(c.status))) {
      return `statut « ${c.status} » : seuls les colis pas encore livrés, retournés ou annulés peuvent être confiés à JAX`;
    }
    if (!(c.currentDeposit ?? c.destinationDeposit)) return 'colis sans agence Runex';
    if (c.currentRunsheetId) return 'colis dans une tournée (retirez-le d’abord de la tournée)';
    // En inter-dépôt, le colis est créé chez JAX et confié à son arrivée ;
    // en stock, un colis rattaché à un lot en préparation ne peut pas partir.
    if (c.interDepotTransferId && !STATUTS_AVANT_AGENCE.includes(String(c.status))) return 'colis dans un inter-dépôt';
    return null;
  }

  async eligibles(filtres: { depositId?: string; governorate?: string; q?: string }) {
    const depot = asUuid(filtres.depositId ?? null);
    const where: Prisma.PackageWhereInput = {
      deletedAt: null,
      status: { in: ['RECU_DEPOT', 'RECU_DEPOT_DESTINATION'] },
      currentDepositId: depot ?? { not: null },
      currentRunsheetId: null,
      interDepotTransferId: null,
      OR: [{ sousTraitance: { is: null } }, { sousTraitance: { is: { etat: { in: ['ANNULE', 'ECHEC_ENVOI', 'RETOURNE'] } } } }],
      ...(filtres.governorate ? { customerAddress: { governorate: { equals: filtres.governorate, mode: 'insensitive' } } } : {}),
      ...(filtres.q?.trim() ? { trackingNumber: { contains: filtres.q.trim() } } : {}),
    };
    const rows = await this.prisma.package.findMany({
      where,
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        totalPrice: true,
        pieceCount: true,
        createdAt: true,
        shipper: { select: { companyName: true, brandName: true } },
        customer: { select: { fullName: true } },
        customerAddress: { select: { governorate: true, delegation: true } },
        currentDeposit: { select: { id: true, name: true } },
        sousTraitance: { select: { etat: true, derniereErreur: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const zones = new Set(
      (await this.prisma.sousTraitanceZone.findMany({ where: { partenaire: PARTENAIRE } })).map((z) => cleGouvernorat(z.governorate))
    );
    return rows.map((r) => ({
      id: r.id,
      trackingNumber: r.trackingNumber,
      status: r.status,
      expediteur: r.shipper.brandName || r.shipper.companyName,
      destinataire: r.customer.fullName,
      destination: [r.customerAddress.delegation, r.customerAddress.governorate].filter(Boolean).join(', '),
      governorate: r.customerAddress.governorate,
      agenceId: r.currentDeposit?.id ?? null,
      agence: r.currentDeposit?.name ?? null,
      montant: n3(r.totalPrice),
      pieces: r.pieceCount,
      zoneJax: zones.has(cleGouvernorat(r.customerAddress.governorate)),
      echecPrecedent: r.sousTraitance?.etat === 'ECHEC_ENVOI' ? r.sousTraitance.derniereErreur : null,
    }));
  }

  /** Confie des colis à JAX (manuel). */
  async envoyer(packageIds: unknown, acteur: ActeurST, mode: 'MANUEL' | 'AUTO' = 'MANUEL'): Promise<ResultatEnvoi[]> {
    const ids = Array.isArray(packageIds) ? packageIds.map((x) => asUuid(String(x))).filter((x): x is string => !!x) : [];
    if (!ids.length) throw new BusinessRuleError('Choisissez au moins un colis à confier à JAX.', 400);
    if (ids.length > 200) throw new BusinessRuleError('200 colis au plus par envoi.', 400);
    if (!jaxConfig().token) throw new BusinessRuleError('Sous-traitance JAX non configurée : le jeton JAX (JAX_API_TOKEN) est absent sur le serveur.', 409);
    const resultats: ResultatEnvoi[] = [];
    for (const id of ids) resultats.push(await this.envoyerOuConfirmer(id, acteur, mode));
    return resultats;
  }

  /** Colis déjà créé chez JAX (à la création) : on le confirme à sa réception, on ne le recrée pas. */
  private async envoyerOuConfirmer(packageId: string, acteur: ActeurST, mode: 'MANUEL' | 'AUTO'): Promise<ResultatEnvoi> {
    const deja = await this.prisma.sousTraitance.findUnique({ where: { packageId }, select: { codeExterne: true, etat: true, package: { select: { status: true } } } });
    const avantConfie = STATUTS_ENVOYABLES.includes(String(deja?.package.status));
    if (deja?.codeExterne && deja.etat === 'EN_ATTENTE_ENLEVEMENT' && avantConfie) return this.confirmerReception(packageId, acteur);
    return this.envoyerUn(packageId, acteur, mode);
  }

  /**
   * Le colis déjà enregistré chez JAX arrive dans une agence Runex : il passe
   * « Confié au partenaire JAX » et son enlèvement peut être demandé.
   */
  private async confirmerReception(packageId: string, acteur: ActeurST): Promise<ResultatEnvoi> {
    const c = await this.prisma.package.findUnique({
      where: { id: packageId },
      select: { trackingNumber: true, status: true, currentDepositId: true, currentRunsheetId: true, currentDeposit: { select: { name: true } }, sousTraitance: { select: { codeExterne: true } } },
    });
    if (!c) return { packageId, trackingNumber: packageId, ok: false, message: 'Colis introuvable.' };
    const ean = c.sousTraitance?.codeExterne ?? '';
    if (!enAgence(c.status, c.currentRunsheetId)) {
      return { packageId, trackingNumber: c.trackingNumber, ok: true, codeExterne: ean, message: `Déjà chez JAX (code ${ean}) : il sera confié au partenaire à sa réception dans une agence Runex.` };
    }
    const agence = c.currentDeposit?.name ?? '—';
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${packageId}::uuid FOR UPDATE`;
        // L'enlèvement se fait à l'agence qui détient réellement le colis.
        await tx.sousTraitance.update({ where: { packageId }, data: { depositId: c.currentDepositId, derniereErreur: null } });
        await packageWorkflowService.transition({
          packageId,
          to: PackageStatus.SOUS_TRAITE,
          actor: { id: acteur.id, fullName: acteur.fullName, role: RoleType.ADMIN },
          title: 'Confié au partenaire de livraison JAX',
          note: `Code JAX ${ean} — enlèvement à ${agence}`,
          location: agence,
          auditAction: 'JAX_ENVOI',
          client: tx,
        });
      });
    } catch (e) {
      return { packageId, trackingNumber: c.trackingNumber, ok: false, message: e instanceof Error ? e.message : 'Confirmation impossible.' };
    }
    return { packageId, trackingNumber: c.trackingNumber, ok: true, codeExterne: ean, message: `Confié à JAX (code ${ean}).` };
  }

  private async envoyerUn(packageId: string, acteur: ActeurST, mode: 'MANUEL' | 'AUTO'): Promise<ResultatEnvoi> {
    // 1. Réservation : une seule demande à la fois pour un colis.
    let colis: ColisST;
    try {
      colis = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${packageId}::uuid FOR UPDATE`;
        const c = await tx.package.findUnique({ where: { id: packageId }, select: SELECT_COLIS });
        if (!c) throw new BusinessRuleError('Colis introuvable.', 404);
        const refus = this.motifRefus(c);
        if (refus) throw new BusinessRuleError(refus, 409);
        const base = {
          partenaire: PARTENAIRE,
          etat: 'EN_ATTENTE_ENLEVEMENT' as const,
          mode,
          depositId: c.currentDepositId ?? c.destinationDepositId,
          codeExterne: null,
          statutExterne: null,
          statutExterneCode: null,
          statutExterneLe: null,
          problemes: null,
          enlevementRef: null,
          enlevementDemandeLe: null,
          envoyeLe: null,
          envoyeParNom: acteur.fullName,
          derniereErreur: null,
          codMontant: 0,
          codRecuLe: null,
        };
        await tx.sousTraitance.upsert({ where: { packageId }, create: { packageId, ...base }, update: base });
        return c;
      });
    } catch (e) {
      const tracking = (await this.prisma.package.findUnique({ where: { id: packageId }, select: { trackingNumber: true } }))?.trackingNumber ?? packageId;
      return { packageId, trackingNumber: tracking, ok: false, message: e instanceof Error ? e.message : 'Envoi impossible.' };
    }

    const echec = async (message: string): Promise<ResultatEnvoi> => {
      await this.prisma.sousTraitance.update({ where: { packageId }, data: { etat: 'ECHEC_ENVOI', derniereErreur: message.slice(0, 500) } });
      await auditService.record({
        entityType: 'PACKAGE',
        entityId: packageId,
        action: 'JAX_ENVOI_ECHEC',
        userId: acteur.id ?? null,
        reason: `Colis ${colis.trackingNumber} non confié à JAX : ${message}`,
      });
      return { packageId, trackingNumber: colis.trackingNumber, ok: false, message };
    };

    // 2. Correspondances : gouvernorats JAX de la destination et de l'agence.
    const adresse = colis.customerAddress;
    let agence = (colis.currentDeposit ?? colis.destinationDeposit)!;
    let [govDest, govPickup] = await Promise.all([this.idGouvernoratJax(adresse.governorate), this.idGouvernoratJax(agence.governorate)]);
    if (!govDest || !govPickup) {
      // Référentiel JAX jamais relu ou incomplet : on le relit une fois, sans attendre l'administrateur.
      try {
        await this.synchroniserReferentiels({ fullName: 'Envoi automatique à JAX' });
        [govDest, govPickup] = await Promise.all([this.idGouvernoratJax(adresse.governorate), this.idGouvernoratJax(agence.governorate)]);
      } catch {
        /* JAX injoignable : l'échec est consigné ci-dessous */
      }
    }
    if (!govDest || !govPickup) {
      const manque = !govDest ? adresse.governorate : agence.governorate;
      return echec(`gouvernorat « ${manque} » introuvable dans le référentiel JAX : relisez les référentiels (Sous-traitance JAX › Paramètres).`);
    }

    // 3. Création chez JAX : expéditeur RUNEX, référence externe = suivi Runex.
    const cfg = jaxConfig();
    const exp = colis.shipper.brandName || colis.shipper.companyName;
    const mentions = [
      colis.packageType === 'EXCHANGE' ? 'ÉCHANGE : reprendre l’article' : null,
      colis.allowOpen ? 'ouverture autorisée' : null,
      colis.isFragile ? 'FRAGILE' : null,
      colis.shipperNotes,
    ].filter(Boolean);
    const description = [
      colis.contentSummary,
      `${colis.pieceCount} pièce(s)`,
      `Exp. ${exp}`,
      `Réf. RUNEX ${colis.trackingNumber}`,
      ...mentions,
    ]
      .join(' — ')
      .slice(0, 500);
    let reponse: unknown;
    try {
      reponse = await jaxClient.creerColis({
        referenceExterne: colis.trackingNumber,
        nomContact: colis.customer.fullName,
        tel: colis.customer.primaryPhone,
        tel2: colis.customer.secondaryPhone || colis.customer.primaryPhone,
        adresseLivraison: [adresse.streetAddress, adresse.locality, adresse.delegation, adresse.governorate].filter(Boolean).join(', '),
        governorat: govDest,
        delegation: adresse.delegation,
        description,
        cod: String(n3(colis.totalPrice)),
        echange: colis.packageType === 'EXCHANGE' ? 1 : 0,
        gouvernorat_pickup: /^\d+$/.test(govPickup) ? Number(govPickup) : govPickup,
        adresse_pickup: [agence.name, agence.address].filter(Boolean).join(', '),
        expediteur_phone: cfg.expediteurTel ? (/^\d+$/.test(cfg.expediteurTel) ? Number(cfg.expediteurTel) : cfg.expediteurTel) : (agence.phone ?? ''),
        expediteur_name: cfg.expediteurNom,
      });
    } catch (e) {
      return echec(e instanceof JaxError ? e.message : 'API JAX indisponible.');
    }
    const ean = lireEan(reponse);
    if (!ean) return echec(`JAX n’a pas renvoyé de code colis (réponse : ${JSON.stringify(reponse).slice(0, 200)}).`);
    // Le colis a pu être reçu en agence pendant l'appel à JAX : son statut est relu sous verrou.
    let estEnAgence = enAgence(colis.status, colis.currentRunsheetId);

    // 4. Le colis passe chez le partenaire (même transaction que la fiche).
    const maintenant = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${packageId}::uuid FOR UPDATE`;
        const actuel = await tx.package.findUnique({ where: { id: packageId }, select: { status: true, currentDepositId: true, currentRunsheetId: true, currentDeposit: { select: { name: true } } } });
        estEnAgence = enAgence(actuel?.status, actuel?.currentRunsheetId);
        if (actuel?.currentDeposit) agence = { ...agence, name: actuel.currentDeposit.name };
        await tx.sousTraitance.update({
          where: { packageId },
          data: { codeExterne: ean, etat: 'EN_ATTENTE_ENLEVEMENT', envoyeLe: maintenant, statutExterne: 'Créé chez JAX', statutExterneLe: maintenant, depositId: actuel?.currentDepositId ?? agence.id },
        });
        // Colis encore « Créé » : il est visible chez JAX dès maintenant, mais
        // ne passe « Confié à JAX » qu'à sa réception dans une agence.
        if (estEnAgence) {
          await packageWorkflowService.transition({
            packageId,
            to: PackageStatus.SOUS_TRAITE,
            actor: { id: acteur.id, fullName: acteur.fullName, role: RoleType.ADMIN },
            title: 'Confié au partenaire de livraison JAX',
            note: `Code JAX ${ean}${mode === 'AUTO' ? ' — zone confiée à JAX' : ''} — enlèvement à ${agence.name}`,
            location: agence.name,
            auditAction: 'JAX_ENVOI',
            client: tx,
          });
        }
      });
    } catch (e) {
      return echec(
        `créé chez JAX (code ${ean}) mais le colis a changé entre-temps : ${e instanceof Error ? e.message : ''} Annulez-le chez JAX.`
      );
    }
    return {
      packageId,
      trackingNumber: colis.trackingNumber,
      ok: true,
      codeExterne: ean,
      message: estEnAgence
        ? `Confié à JAX (code ${ean}).`
        : `Créé chez JAX (code ${ean}) : il sera confié au partenaire à sa réception à ${agence.name}.`,
    };
  }

  /**
   * Création du colis dans Runex : il est aussitôt créé chez JAX, sans
   * intervention de l'administrateur et quelle que soit sa destination.
   * Ne lève jamais : un échec est consigné sur le colis et retenté
   * automatiquement (relecture périodique, puis réception en agence).
   */
  async enregistrerALaCreation(packageId: string): Promise<void> {
    try {
      if (!jaxConfig().token) return;
      const c = await this.prisma.package.findUnique({
        where: { id: packageId },
        select: { status: true, customerAddress: { select: { governorate: true } }, sousTraitance: { select: { etat: true, codeExterne: true } } },
      });
      if (!c || c.status !== 'CREE') return;
      // Zones livrées par Runex seulement (Tunis, Ben Arous…) : jamais chez JAX.
      if (await this.estZoneRunex(c.customerAddress.governorate)) return;
      if (c.sousTraitance?.codeExterne) return; // déjà chez JAX
      if (c.sousTraitance && c.sousTraitance.etat !== 'ECHEC_ENVOI') return; // repris volontairement (ANNULE) : pas renvoyé
      await this.envoyerUn(packageId, { fullName: 'Envoi automatique à la création' }, 'AUTO');
    } catch (e) {
      console.warn('[RUNEX API] Création chez JAX impossible :', e instanceof Error ? e.message : String(e));
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rattrapage : colis restés chez Runex                               */
  /* ---------------------------------------------------------------- */

  private async whereRattrapage(exclure: string[] = []): Promise<Prisma.PackageWhereInput> {
    const zonesRunex = (await this.prisma.sousTraitanceZone.findMany({ where: { partenaire: ZONES_RUNEX }, select: { governorate: true } })).map((z) => z.governorate);
    return {
      deletedAt: null,
      status: { in: STATUTS_RATTRAPAGE as never },
      // Déjà présenté par un livreur Runex (reporté, échec…) : il reste chez Runex.
      deliveryAttemptsCount: 0,
      ...(zonesRunex.length
        ? { NOT: { customerAddress: { OR: zonesRunex.map((g) => ({ governorate: { equals: g, mode: 'insensitive' as const } })) } } }
        : {}),
      // Jamais envoyés, ou dont l'envoi a échoué. Un colis repris (ANNULE) l'a été volontairement.
      OR: [{ sousTraitance: { is: null } }, { sousTraitance: { is: { etat: 'ECHEC_ENVOI' } } }],
      ...(exclure.length ? { id: { notIn: exclure } } : {}),
    };
  }

  /** Colis restés chez Runex (pas livrés, retournés ni annulés) : à envoyer à JAX. */
  async apercuRattrapage() {
    const where = await this.whereRattrapage();
    const [groupes, total, enTournee, colis] = await Promise.all([
      this.prisma.package.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.package.count({ where }),
      this.prisma.package.count({ where: { ...where, currentRunsheetId: { not: null } } }),
      this.prisma.package.findMany({
        where,
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          createdAt: true,
          totalPrice: true,
          currentRunsheetId: true,
          shipper: { select: { companyName: true, brandName: true } },
          customerAddress: { select: { governorate: true, delegation: true } },
          assignedDriver: { select: { user: { select: { fullName: true } } } },
          sousTraitance: { select: { derniereErreur: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 300,
      }),
    ]);
    return {
      configure: !!jaxConfig().token,
      total,
      enTournee,
      parStatut: groupes.map((g) => ({ status: String(g.status), n: g._count._all })).sort((a, b) => b.n - a.n),
      colis: colis.map((c) => ({
        id: c.id,
        trackingNumber: c.trackingNumber,
        status: String(c.status),
        createdAt: c.createdAt.toISOString(),
        montant: n3(c.totalPrice),
        expediteur: c.shipper.brandName || c.shipper.companyName,
        destination: [c.customerAddress.delegation, c.customerAddress.governorate].filter(Boolean).join(', '),
        enTournee: !!c.currentRunsheetId,
        livreur: c.assignedDriver?.user.fullName ?? null,
        erreur: c.sousTraitance?.derniereErreur ?? null,
      })),
    };
  }

  /**
   * Envoie à JAX un lot de colis restés chez Runex. Un colis en tournée en est
   * d'abord retiré (le livreur, prévenu, le rapporte au dépôt où JAX
   * l'enlève). `exclure` : colis déjà refusés lors des lots précédents.
   */
  async rattraper(acteur: ActeurST, exclureBrut?: unknown, taille = 40) {
    if (!jaxConfig().token) throw new BusinessRuleError('Sous-traitance JAX non configurée : le jeton JAX (JAX_API_TOKEN) est absent sur le serveur.', 409);
    const exclure = Array.isArray(exclureBrut) ? exclureBrut.map((x) => asUuid(String(x))).filter((x): x is string => !!x).slice(0, 5000) : [];
    const rows = await this.prisma.package.findMany({
      where: await this.whereRattrapage(exclure),
      select: { id: true, trackingNumber: true, status: true, currentRunsheetId: true },
      orderBy: { createdAt: 'asc' },
      take: taille,
    });
    const resultats: ResultatEnvoi[] = [];
    for (const r of rows) {
      try {
        if (r.currentRunsheetId) {
          const { runsheetsService } = await import('../runsheets/runsheets.service');
          await runsheetsService.removePackage(r.currentRunsheetId, r.id, { id: acteur.id, fullName: acteur.fullName });
        } else if (r.status === 'AFFECTE_RUNSHEET' || r.status === 'EN_COURS_LIVRAISON') {
          await this.retirerDuLivreur(r.id, acteur);
        }
        resultats.push(await this.envoyerUn(r.id, acteur, 'MANUEL'));
      } catch (e) {
        resultats.push({ packageId: r.id, trackingNumber: r.trackingNumber, ok: false, message: e instanceof Error ? e.message : 'Envoi impossible.' });
      }
    }
    const echecs = resultats.filter((x) => !x.ok);
    const restants = await this.prisma.package.count({ where: await this.whereRattrapage([...exclure, ...echecs.map((x) => x.packageId)]) });
    if (resultats.length) {
      await auditService.record({
        entityType: 'SOUS_TRAITANCE',
        entityId: PARTENAIRE,
        action: 'JAX_ENVOI',
        userId: acteur.id ?? null,
        reason: `Rattrapage JAX : ${resultats.length - echecs.length} colis envoyés, ${echecs.length} refusés.`,
      });
    }
    return { traites: resultats.length, reussis: resultats.length - echecs.length, echecs, restants };
  }

  /**
   * Colis affecté à un livreur hors de toute tournée : il revient en stock à
   * son agence, sans livreur (le livreur le rapporte), avant d'être confié à JAX.
   */
  private async retirerDuLivreur(packageId: string, acteur: ActeurST): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${packageId}::uuid FOR UPDATE`;
      const c = await tx.package.findUnique({
        where: { id: packageId },
        select: { trackingNumber: true, status: true, currentDeposit: { select: { name: true } }, assignedDriver: { select: { user: { select: { fullName: true } } } } },
      });
      if (!c || (c.status !== 'AFFECTE_RUNSHEET' && c.status !== 'EN_COURS_LIVRAISON')) return;
      await tx.package.update({ where: { id: packageId }, data: { status: 'RECU_DEPOT', assignedDriverId: null } });
      await tx.packageTimeline.create({
        data: {
          packageId,
          status: 'RECU_DEPOT',
          title: 'Retiré du livreur pour être confié à JAX',
          description: `À rapporter au dépôt${c.assignedDriver ? ` par ${c.assignedDriver.user.fullName}` : ''} : JAX l’y enlève.`,
          locationName: c.currentDeposit?.name ?? 'Dépôt',
          operatorName: acteur.fullName,
        },
      });
      await auditService.record(
        { entityType: 'PACKAGE', entityId: packageId, action: 'JAX_ENVOI', userId: acteur.id ?? null, reason: `Colis ${c.trackingNumber} retiré du livreur (statut ${c.status}) pour être confié à JAX.` },
        tx
      );
    });
  }

  /**
   * Envoi unique, automatique, des colis restés chez Runex (demande du client,
   * 09/11 : « envoyer les colis en cours à JAX »). Fait une seule fois par
   * base : une entrée JAX_RATTRAPAGE_AUTO du journal d'audit en garde la trace
   * (et le bilan). Un double démarrage est sans risque : chaque colis est
   * réservé sous verrou avant son envoi, un colis déjà confié est refusé.
   */
  async rattrapageUnique(): Promise<void> {
    if (!jaxConfig().token) return;
    if (await this.prisma.auditLog.count({ where: { action: 'JAX_RATTRAPAGE_AUTO' } })) return;
    const acteur = { fullName: 'Envoi automatique des colis restés chez Runex' };
    const total = (await this.apercuRattrapage()).total;
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_RATTRAPAGE_AUTO',
      reason: `Début : ${total} colis restés chez Runex à envoyer à JAX.`,
    });
    const exclure: string[] = [];
    const refuses: string[] = [];
    let envoyes = 0;
    for (let tour = 0; tour < 1000; tour++) {
      const r = await this.rattraper(acteur, exclure);
      envoyes += r.reussis;
      for (const x of r.echecs) {
        exclure.push(x.packageId);
        refuses.push(`${x.trackingNumber} (${x.message.slice(0, 60)})`);
      }
      if (r.traites === 0 || r.restants === 0) break;
    }
    const bilan = `Fin : ${envoyes} colis envoyés à JAX, ${refuses.length} refusés${refuses.length ? ` : ${refuses.join(' ; ')}` : ''}.`;
    await auditService.record({ entityType: 'SOUS_TRAITANCE', entityId: PARTENAIRE, action: 'JAX_RATTRAPAGE_AUTO', reason: bilan.slice(0, 255) });
    console.log(`[RUNEX API] JAX — colis restés chez Runex : ${bilan}`);
  }

  /**
   * Correction unique (réunion du 10/11), faite une fois par base au démarrage
   * (trace JAX_CORRECTION_10_11 dans le journal d'audit) : les colis confiés à
   * JAX mais pas encore enlevés par lui reviennent chez Runex quand
   *  - leur destination est une zone livrée par Runex (Tunis, Ben Arous…) ;
   *  - ils avaient été reportés ou présentés par un livreur Runex.
   * Un colis reporté redevient « Reporté » (son livreur le livre à nouveau) ;
   * un autre colis confié revient « Reçu au dépôt ». Les colis déjà enlevés,
   * livrés, retournés ou annulés ne changent pas. Chaque code JAX abandonné
   * apparaît dans « À faire chez JAX ».
   */
  async correctionReunion(): Promise<{ repris: number; reportes: number }> {
    if (await this.prisma.auditLog.count({ where: { action: 'JAX_CORRECTION_10_11' } })) return { repris: 0, reportes: 0 };
    await auditService.record({ entityType: 'SOUS_TRAITANCE', entityId: PARTENAIRE, action: 'JAX_CORRECTION_10_11', reason: 'Début : colis reportés et zones Runex rendus à Runex.' });
    const r = await this.corrigerColisGardesParRunex({ fullName: 'Correction automatique (réunion du 10/11)' });
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_CORRECTION_10_11',
      reason: `Fin : ${r.repris} colis rendus à Runex, dont ${r.reportes} de nouveau « Reporté ».`,
    });
    if (r.repris) console.log(`[RUNEX API] JAX — ${r.repris} colis rendus à Runex (dont ${r.reportes} reportés).`);
    return r;
  }

  /** Colis confiés à JAX, pas encore enlevés, qui doivent rester chez Runex. */
  async corrigerColisGardesParRunex(acteur: ActeurST): Promise<{ repris: number; reportes: number }> {
    const zonesRunex = await this.clesZonesRunex();
    const rows = await this.prisma.sousTraitance.findMany({
      where: {
        partenaire: PARTENAIRE,
        etat: { in: [...AVANT_ENLEVEMENT, 'ECHEC_ENVOI'] },
        package: { is: { deletedAt: null, status: { notIn: STATUTS_RUNEX_FINAUX as never } } },
      },
      select: {
        packageId: true,
        envoyeLe: true,
        depositId: true,
        deposit: { select: { name: true } },
        package: { select: { status: true, deliveryAttemptsCount: true, customerAddress: { select: { governorate: true } } } },
      },
    });
    let repris = 0;
    let reportes = 0;
    for (const x of rows) {
      const zone = zonesRunex.has(cleGouvernorat(x.package.customerAddress.governorate));
      // Reporté avant son envoi à JAX : une entrée « Reporté » écrite par Runex
      // (pas une relecture JAX) dans sa chronologie, ou une tentative de livraison.
      const reporte =
        x.package.deliveryAttemptsCount > 0 ||
        x.package.status === 'REPORTE' ||
        (await this.prisma.packageTimeline.count({
          where: { packageId: x.packageId, status: 'REPORTE', NOT: { operatorName: ACTEUR_JAX.fullName } },
        })) > 0;
      if (!zone && !reporte) continue;
      const motif = reporte ? 'colis reporté, livré par Runex' : 'zone livrée par Runex';
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${x.packageId}::uuid FOR UPDATE`;
        if (!(await this.abandonnerChezJax(x.packageId, motif, acteur, tx))) return;
        // « Confié au partenaire JAX » mais pas enlevé : le colis est à l'agence Runex.
        // Les autres (créé, en ramassage, reporté…) gardent leur statut.
        if (String(x.package.status) === 'SOUS_TRAITE') {
          const cible = reporte ? 'REPORTE' : 'RECU_DEPOT';
          await tx.package.update({ where: { id: x.packageId }, data: { status: cible, currentDepositId: x.depositId, currentRunsheetId: null } });
          await tx.packageTimeline.create({
            data: {
              packageId: x.packageId,
              status: cible,
              title: reporte ? 'Reporté — livré par Runex' : 'Reçu au dépôt — livré par Runex',
              description: reporte ? 'Colis reporté : il reste chez Runex, son livreur le livre à nouveau.' : 'Destination livrée par Runex.',
              locationName: x.deposit?.name ?? 'Dépôt',
              operatorName: acteur.fullName,
            },
          });
          if (reporte) reportes++;
        }
        repris++;
      });
    }
    return { repris, reportes };
  }

  /** Gestes à faire à la main chez JAX (annuler un code, corriger un prix). */
  async actionsAFaire() {
    const rows = await this.prisma.sousTraitance.findMany({
      where: { partenaire: PARTENAIRE, actionJax: { not: null } },
      select: { packageId: true, codeExterne: true, actionJax: true, actionJaxLe: true, package: { select: { trackingNumber: true, status: true } } },
      orderBy: { actionJaxLe: 'asc' },
      take: 500,
    });
    return rows.map((r) => ({
      packageId: r.packageId,
      trackingNumber: r.package.trackingNumber,
      statutRunex: String(r.package.status),
      codeExterne: r.codeExterne,
      action: r.actionJax!,
      depuis: r.actionJaxLe?.toISOString() ?? null,
    }));
  }

  /** Geste fait chez JAX : il disparaît de la liste. */
  async actionFaite(packageIdBrut: string, acteur: ActeurST) {
    const packageId = asUuid(packageIdBrut);
    const r = packageId ? await this.prisma.sousTraitance.findUnique({ where: { packageId }, select: { id: true, actionJax: true, package: { select: { trackingNumber: true } } } }) : null;
    if (!r?.actionJax) throw new BusinessRuleError('Aucun geste en attente chez JAX pour ce colis.', 404);
    await this.prisma.sousTraitance.update({ where: { id: r.id }, data: { actionJax: null, actionJaxLe: null } });
    await auditService.record({
      entityType: 'PACKAGE',
      entityId: packageId!,
      action: 'JAX_ACTION_FAITE',
      userId: acteur.id ?? null,
      reason: `Fait chez JAX pour ${r.package.trackingNumber} : ${r.actionJax}`.slice(0, 255),
    });
    return { message: `Colis ${r.package.trackingNumber} : fait chez JAX.` };
  }

  /** Prix d'un colis modifié chez Runex alors qu'il est chez JAX : à reporter chez JAX. */
  async signalerPrixModifie(packageId: string, nouveauTotal: number, client?: Prisma.TransactionClient): Promise<string | null> {
    const db = client ?? this.prisma;
    const r = await db.sousTraitance.findUnique({ where: { packageId }, select: { id: true, etat: true, codeExterne: true } });
    if (!r?.codeExterne || !ACTIFS.includes(r.etat as EtatSousTraitance)) return null;
    const action = `Corriger le montant à encaisser chez JAX (code ${r.codeExterne}) : ${nouveauTotal.toFixed(3)} DT`;
    await db.sousTraitance.update({ where: { id: r.id }, data: { actionJax: action, actionJaxLe: new Date() } });
    return action;
  }

  /** Essaie de reporter le nouveau prix chez JAX ; vrai si JAX l'a accepté. */
  async reporterPrixChezJax(packageId: string): Promise<boolean> {
    const r = await this.prisma.sousTraitance.findUnique({ where: { packageId }, select: { id: true, codeExterne: true, package: { select: { totalPrice: true } } } });
    if (!r?.codeExterne || !jaxConfig().token) return false;
    try {
      await jaxClient.modifierPrix(r.codeExterne, n3(r.package.totalPrice));
    } catch {
      return false; // reste dans « À faire chez JAX »
    }
    await this.prisma.sousTraitance.update({ where: { id: r.id }, data: { actionJax: null, actionJaxLe: null } });
    return true;
  }

  /** Retente les créations chez JAX qui ont échoué (colis pas encore chez JAX). */
  async retenterEchecs(): Promise<number> {
    if (!jaxConfig().token) return 0;
    const rows = await this.prisma.sousTraitance.findMany({
      where: {
        partenaire: PARTENAIRE,
        etat: 'ECHEC_ENVOI',
        package: { is: { deletedAt: null, status: { in: STATUTS_ENVOYABLES as never }, currentRunsheetId: null, deliveryAttemptsCount: 0 } },
      },
      select: { packageId: true, package: { select: { customerAddress: { select: { governorate: true } } } } },
      take: 100,
    });
    const zonesRunex = await this.clesZonesRunex();
    let reussis = 0;
    for (const r of rows) {
      if (zonesRunex.has(cleGouvernorat(r.package.customerAddress.governorate))) {
        await this.abandonnerChezJax(r.packageId, 'zone livrée par Runex', { fullName: 'Envoi automatique' });
        continue;
      }
      if ((await this.envoyerUn(r.packageId, { fullName: 'Envoi automatique (nouvel essai)' }, 'AUTO')).ok) reussis++;
    }
    return reussis;
  }

  /**
   * Envoi automatique : appelé après la réception d'un colis dans une agence.
   * Sans effet si JAX n'est pas configuré ou si la destination n'est pas une
   * zone JAX. Ne lève jamais : un échec est consigné sur la fiche du colis.
   */
  async envoiAutoSiEligible(packageId: string): Promise<void> {
    try {
      if (!jaxConfig().token) return;
      const c = await this.prisma.package.findUnique({
        where: { id: packageId },
        select: { status: true, deliveryAttemptsCount: true, customerAddress: { select: { governorate: true } }, sousTraitance: { select: { etat: true, codeExterne: true } } },
      });
      if (!c) return;
      // Reste chez Runex : zone livrée par Runex, ou colis déjà présenté par un
      // livreur Runex (reporté). Sa fiche JAX éventuelle est abandonnée.
      const zoneRunex = await this.estZoneRunex(c.customerAddress.governorate);
      if (zoneRunex || c.deliveryAttemptsCount > 0 || c.status === 'REPORTE') {
        if (c.sousTraitance && (c.sousTraitance.etat === 'ECHEC_ENVOI' || AVANT_ENLEVEMENT.includes(c.sousTraitance.etat as EtatSousTraitance))) {
          await this.abandonnerChezJax(packageId, zoneRunex ? 'zone livrée par Runex' : 'colis reporté, livré par Runex', { fullName: 'Réception en agence' });
        }
        return;
      }
      if (c.sousTraitance?.codeExterne && c.sousTraitance.etat === 'EN_ATTENTE_ENLEVEMENT') {
        await this.confirmerReception(packageId, { fullName: 'Réception en agence' });
        return;
      }
      if (c.status !== 'RECU_DEPOT' && c.status !== 'RECU_DEPOT_DESTINATION') return;
      // Déjà traité, ou repris volontairement (ANNULE) : seul un échec d'envoi est retenté automatiquement.
      if (c.sousTraitance && c.sousTraitance.etat !== 'ECHEC_ENVOI') return;
      // Création chez JAX échouée : nouvel essai, quelle que soit la destination.
      if (c.sousTraitance?.etat === 'ECHEC_ENVOI') {
        await this.envoyerUn(packageId, { fullName: 'Envoi automatique (nouvel essai)' }, 'AUTO');
        return;
      }
      // Colis sans fiche JAX (créé avant la mise en service de JAX) : zones JAX.
      const zones = await this.prisma.sousTraitanceZone.findMany({ where: { partenaire: PARTENAIRE } });
      const cle = cleGouvernorat(c.customerAddress.governorate);
      if (!zones.some((z) => cleGouvernorat(z.governorate) === cle)) return;
      await this.envoyerUn(packageId, { fullName: 'Envoi automatique (zone JAX)' }, 'AUTO');
    } catch (e) {
      console.warn('[RUNEX API] Envoi automatique JAX impossible :', e instanceof Error ? e.message : String(e));
    }
  }

  /* ---------------------------------------------------------------- */
  /* Enlèvement                                                         */
  /* ---------------------------------------------------------------- */

  /** Colis en attente d'enlèvement, regroupés par agence. */
  async enlevementsEnAttente() {
    const rows = await this.prisma.sousTraitance.findMany({
      where: { partenaire: PARTENAIRE, etat: { in: ['EN_ATTENTE_ENLEVEMENT', 'ENLEVEMENT_DEMANDE'] }, codeExterne: { not: null }, package: { is: { status: 'SOUS_TRAITE' as const } } },
      include: { deposit: { select: { id: true, name: true } }, package: { select: { trackingNumber: true, pieceCount: true } } },
      orderBy: { envoyeLe: 'asc' },
    });
    const parAgence = new Map<string, { depositId: string | null; agence: string; aDemander: number; demandes: number; pieces: number; colis: { trackingNumber: string; codeExterne: string; etat: string }[] }>();
    for (const r of rows) {
      const k = r.depositId ?? 'aucune';
      const g = parAgence.get(k) ?? { depositId: r.depositId, agence: r.deposit?.name ?? '—', aDemander: 0, demandes: 0, pieces: 0, colis: [] };
      if (r.etat === 'EN_ATTENTE_ENLEVEMENT') g.aDemander++;
      else g.demandes++;
      g.pieces += r.package.pieceCount;
      g.colis.push({ trackingNumber: r.package.trackingNumber, codeExterne: r.codeExterne!, etat: r.etat });
      parAgence.set(k, g);
    }
    return [...parAgence.values()];
  }

  /** Demande à JAX l'enlèvement des colis d'une agence. */
  async demanderEnlevement(depositIdBrut: unknown, note: unknown, acteur: ActeurST) {
    const depositId = asUuid(typeof depositIdBrut === 'string' ? depositIdBrut : null);
    if (!depositId) throw new BusinessRuleError('Choisissez l’agence où JAX doit enlever les colis.', 400);
    const agence = await this.prisma.deposit.findUnique({ where: { id: depositId }, select: { id: true, name: true, address: true, governorate: true } });
    if (!agence) throw new BusinessRuleError('Agence introuvable.', 404);
    const rows = await this.prisma.sousTraitance.findMany({
      where: { partenaire: PARTENAIRE, depositId, etat: 'EN_ATTENTE_ENLEVEMENT', codeExterne: { not: null }, package: { is: { status: 'SOUS_TRAITE' as const } } },
      select: { id: true, packageId: true, codeExterne: true, package: { select: { pieceCount: true } } },
    });
    if (!rows.length) throw new BusinessRuleError(`Aucun colis JAX en attente d’enlèvement à ${agence.name}.`, 409);
    const gov = await this.idGouvernoratJax(agence.governorate);
    if (!gov) throw new BusinessRuleError(`Gouvernorat « ${agence.governorate} » introuvable dans le référentiel JAX : relisez les référentiels.`, 409);
    const nbPieces = rows.reduce((s, r) => s + r.package.pieceCount, 0);
    const texteNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : `Enlèvement RUNEX — ${agence.name}`;
    let reponse: unknown;
    try {
      reponse = await jaxClient.demanderEnlevement({
        adresse: [agence.name, agence.address].filter(Boolean).join(', '),
        nbrColis: String(nbPieces),
        colis_statut: jaxConfig().statutEnlevement,
        colis_list: rows.map((r) => r.codeExterne!),
        note: texteNote,
        gouvernorat_id: /^\d+$/.test(gov) ? Number(gov) : gov,
      });
    } catch (e) {
      throw new BusinessRuleError(e instanceof JaxError ? e.message : 'API JAX indisponible.', 424);
    }
    const ref = (() => {
      if (reponse && typeof reponse === 'object') {
        const o = reponse as Record<string, unknown>;
        const d = (o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : o) as Record<string, unknown>;
        const v = d.id ?? d.pickup_id ?? d.reference ?? d.code ?? o.id;
        if (typeof v === 'string' || typeof v === 'number') return String(v);
      }
      return null;
    })();
    const maintenant = new Date();
    await this.prisma.sousTraitance.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { etat: 'ENLEVEMENT_DEMANDE', enlevementRef: ref, enlevementDemandeLe: maintenant },
    });
    for (const r of rows) {
      await packageWorkflowService
        .annotate({
          packageId: r.packageId,
          actor: { id: acteur.id, fullName: acteur.fullName, role: RoleType.ADMIN },
          title: 'Enlèvement demandé à JAX',
          note: `À ${agence.name}${ref ? ` — demande JAX ${ref}` : ''}`,
          location: agence.name,
          auditAction: 'JAX_ENLEVEMENT',
        })
        .catch(() => undefined);
    }
    return { agence: agence.name, colis: rows.length, pieces: nbPieces, reference: ref };
  }

  /* ---------------------------------------------------------------- */
  /* Relecture des statuts JAX                                          */
  /* ---------------------------------------------------------------- */

  private async etatPourStatut(statut: StatutJax): Promise<EtatSousTraitance | null> {
    if (statut.code) {
      const s = await this.prisma.partenaireStatut.findUnique({ where: { partenaire_code: { partenaire: PARTENAIRE, code: statut.code } } });
      if (s?.etat) return s.etat as EtatSousTraitance;
      if (s && !statut.libelle.startsWith('Statut ')) return etatDepuisLibelle(statut.libelle) ?? etatDepuisLibelle(s.libelle);
      if (s) return etatDepuisLibelle(s.libelle);
    }
    return etatDepuisLibelle(statut.libelle);
  }

  /** Statut Runex du colis pour un statut JAX : choix de l'administrateur, sinon d'après le libellé. */
  private async statutRunexPour(statut: StatutJax): Promise<string | null> {
    if (statut.code) {
      const s = await this.prisma.partenaireStatut.findUnique({ where: { partenaire_code: { partenaire: PARTENAIRE, code: statut.code } } });
      if (s?.statutRunex) return s.statutRunex;
      const depuis = statutRunexDepuisLibelle(statut.libelle.startsWith('Statut ') && s ? s.libelle : statut.libelle);
      if (depuis) return depuis;
      if (s) return statutRunexDepuisLibelle(s.libelle);
    }
    return statutRunexDepuisLibelle(statut.libelle);
  }

  /** Relit les statuts JAX (tous les colis actifs, ou ceux demandés). */
  async synchroniser(packageIds?: unknown) {
    if (!jaxConfig().token) throw new BusinessRuleError('Sous-traitance JAX non configurée : le jeton JAX (JAX_API_TOKEN) est absent sur le serveur.', 409);
    const ids = Array.isArray(packageIds) ? packageIds.map((x) => asUuid(String(x))).filter((x): x is string => !!x) : null;
    const rows = await this.prisma.sousTraitance.findMany({
      where: {
        partenaire: PARTENAIRE,
        codeExterne: { not: null },
        ...(ids && ids.length ? { packageId: { in: ids } } : { etat: { in: ACTIFS } }),
      },
      select: { packageId: true },
      take: 500,
    });
    let changes = 0;
    const erreurs: string[] = [];
    const file = [...rows];
    const travailleur = async () => {
      for (let r = file.shift(); r; r = file.shift()) {
        try {
          if (await this.synchroniserUn(r.packageId)) changes++;
        } catch (e) {
          erreurs.push(e instanceof Error ? e.message : String(e));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, travailleur));
    return { relus: rows.length, changes, erreurs: [...new Set(erreurs)].slice(0, 5) };
  }

  /** Relit un colis chez JAX ; vrai si son état a changé. */
  async synchroniserUn(packageId: string): Promise<boolean> {
    const r = await this.prisma.sousTraitance.findUnique({
      where: { packageId },
      include: { deposit: { select: { name: true } }, package: { select: { trackingNumber: true, status: true, totalPrice: true, shipperId: true, currentRunsheetId: true } } },
    });
    if (!r?.codeExterne) return false;
    let statut: StatutJax | null = null;
    try {
      statut = lireStatut(await jaxClient.statut(r.codeExterne));
    } catch (e) {
      // Repli : statut avec date, par référence.
      try {
        statut = lireStatut(await jaxClient.statutDate(r.codeExterne));
      } catch {
        const message = e instanceof Error ? e.message : String(e);
        await this.prisma.sousTraitance.update({ where: { id: r.id }, data: { derniereSyncLe: new Date(), derniereErreur: message.slice(0, 500) } });
        throw new BusinessRuleError(`${r.package.trackingNumber} : ${message}`, 424);
      }
    }
    let problemes: string | null = r.problemes;
    try {
      problemes = lireProblemes(await jaxClient.problemes(r.codeExterne));
    } catch {
      /* pas de problème signalé, ou route indisponible : on garde l'existant */
    }
    return this.appliquer(r, statut, problemes);
  }

  /** Reporte un statut JAX dans le flux Runex. */
  private async appliquer(
    r: Prisma.SousTraitanceGetPayload<{ include: { deposit: { select: { name: true } }; package: { select: { trackingNumber: true; status: true; totalPrice: true; shipperId: true; currentRunsheetId: true } } } }>,
    statut: StatutJax | null,
    problemes: string | null
  ): Promise<boolean> {
    const maintenant = new Date();
    const base = { derniereSyncLe: maintenant, derniereErreur: null, problemes };
    if (!statut) {
      await this.prisma.sousTraitance.update({ where: { id: r.id }, data: base });
      return false;
    }
    const propose = await this.etatPourStatut(statut);
    let cible = propose ?? (r.etat as EtatSousTraitance);
    const actuel = r.etat as EtatSousTraitance;
    // Statut plus ancien que l'étape connue (relecture tardive, ordre des
    // relectures) : on ne l'affiche pas, il contredirait l'étape.
    // Seul un colis à une étape finale (livré, retourné, annulé) ignore une
    // relecture tardive : avant, le dernier statut JAX fait foi (un colis
    // « reçu à l'entrepôt » après une sortie en livraison est reporté).
    const enRetard = !!propose && propose !== actuel && (actuel === 'LIVRE' || actuel === 'RETOURNE' || actuel === 'ANNULE');
    const libelleChange = !enRetard && statut.libelle !== r.statutExterne;
    // Annulé chez JAX : avant enlèvement, le colis est toujours à l'agence ;
    // après, il doit revenir (retour).
    if (cible === 'ANNULE' && !AVANT_ENLEVEMENT.includes(actuel)) cible = 'RETOUR_EN_COURS';
    // Jamais de retour en arrière (une relecture tardive ne défait rien).
    if (actuel === 'LIVRE' || actuel === 'RETOURNE' || actuel === 'ANNULE') cible = actuel;
    else if (cible !== 'ANNULE' && RANG[cible] < RANG[actuel]) cible = actuel;
    // « Demande d'enlèvement » n'est un statut que pour Runex.
    if (cible === 'EN_ATTENTE_ENLEVEMENT' && actuel === 'ENLEVEMENT_DEMANDE') cible = actuel;

    const etatChange = cible !== actuel;
    const acteur = ACTEUR_JAX;
    // Statut Runex du colis : celui qui correspond au statut JAX lu.
    const pkgStatus = r.package.status as string;
    let statutCible = enRetard ? null : await this.statutRunexPour(statut);
    // Colis entre les mains d'un livreur Runex (reporté, en tournée) alors que
    // JAX ne l'a pas enlevé : son statut reste celui de Runex.
    const chezRunex = STATUTS_CHEZ_LIVREUR_RUNEX.includes(pkgStatus) || !!r.package.currentRunsheetId;
    if (chezRunex && AVANT_ENLEVEMENT.includes(cible)) statutCible = null;
    // « Reportés » : JAX remet le colis à l'entrepôt après une sortie en livraison.
    if (statutCible === 'RECU_DEPOT' && (pkgStatus === 'EN_COURS_LIVRAISON' || pkgStatus === 'REPORTE' || (!!problemes && actuel === 'EN_LIVRAISON'))) statutCible = 'REPORTE';
    // « En attente » chez JAX : le colis garde son statut Runex (créé, ou confié en agence).
    if (statutCible === 'CREE' && pkgStatus !== 'CREE') statutCible = null;
    const statutChange = !!statutCible && statutCible !== pkgStatus && !STATUTS_RUNEX_FINAUX.includes(pkgStatus);
    await this.prisma.$transaction(async (tx) => {
      await tx.sousTraitance.update({
        where: { id: r.id },
        data: {
          ...base,
          ...(enRetard
            ? {}
            : {
                statutExterne: statut.libelle.slice(0, 150),
                statutExterneCode: statut.code,
                statutExterneLe: statut.le ?? (libelleChange ? maintenant : r.statutExterneLe),
              }),
          etat: cible as EtatPrisma,
          // Livré par JAX : il encaisse le contre-remboursement et garde sa part.
          ...(cible === 'LIVRE' && actuel !== 'LIVRE' ? { codMontant: r.package.totalPrice, fraisPartenaire: fraisJaxParColis() } : {}),
        },
      });
      if (!etatChange && !libelleChange && !statutChange) return;
      if (statutChange && statutCible) {
        // Le statut du colis suit celui de JAX : l'expéditeur et l'exploitation
        // voient la même étape que dans l'application JAX.
        await tx.package.update({
          where: { id: r.packageId },
          data: {
            status: statutCible as never,
            // Chez JAX : dans aucune agence ni tournée Runex.
            currentDepositId: null,
            currentRunsheetId: null,
            assignedDriverId: null,
            ...(statutCible === 'LIVRE' ? { collectedAmount: r.package.totalPrice, deliveredAt: statut.le ?? maintenant } : {}),
          },
        });
        await auditService.record(
          {
            entityType: 'PACKAGE',
            entityId: r.packageId,
            action: 'JAX_STATUT',
            reason: `Colis ${r.package.trackingNumber} : « ${PACKAGE_STATUS_LABELS[statutCible as PackageStatus]} » (JAX : ${statut.libelle})`.slice(0, 255),
            previousValues: { status: pkgStatus },
            newValues: { status: statutCible },
          },
          tx
        );
      }
      await tx.packageTimeline.create({
        data: {
          packageId: r.packageId,
          status: (statutChange && statutCible ? statutCible : r.package.status) as never,
          title: (statutChange && statutCible ? PACKAGE_STATUS_LABELS[statutCible as PackageStatus] : etatChange ? ETATS_SOUS_TRAITANCE[cible] : `JAX : ${statut.libelle}`).slice(0, 150),
          description: [`Statut JAX : ${statut.libelle}`, problemes ? `Problème signalé : ${problemes}` : null].filter(Boolean).join(' — ').slice(0, 500),
          locationName: 'Réseau JAX',
          operatorName: acteur.fullName,
          createdAt: maintenant,
        },
      });
    });

    if (etatChange && (cible === 'LIVRE' || cible === 'RETOUR_EN_COURS' || cible === 'PRIS_EN_CHARGE')) {
      const titres: Partial<Record<EtatSousTraitance, string>> = {
        LIVRE: 'Colis livré',
        RETOUR_EN_COURS: 'Colis non livré',
        PRIS_EN_CHARGE: 'Colis pris en charge',
      };
      await notificationDispatcher
        .notify({
          event: NotificationEvent.DELIVERY_STATUS_CHANGED,
          title: titres[cible] ?? 'Colis',
          // L'expéditeur reçoit aussi cette notification : aucune mention du partenaire.
          content: `Colis ${r.package.trackingNumber} : ${(statutCible ? PACKAGE_STATUS_LABELS[statutCible as PackageStatus] : titres[cible] ?? 'mis à jour').toLowerCase()}.`,
          relatedEntity: 'PACKAGE',
          relatedEntityId: r.packageId,
          packageId: r.packageId,
        })
        .catch(() => undefined);
    }
    return etatChange || libelleChange;
  }

  /* ---------------------------------------------------------------- */
  /* Gestes de l'exploitation sur un colis confié                      */
  /* ---------------------------------------------------------------- */

  private async ligne(packageIdBrut: string) {
    const packageId = asUuid(packageIdBrut);
    const r = packageId
      ? await this.prisma.sousTraitance.findUnique({
          where: { packageId },
          include: { deposit: { select: { id: true, name: true } }, package: { select: { trackingNumber: true, status: true, totalPrice: true, shipperId: true, currentRunsheetId: true } } },
        })
      : null;
    if (!r) throw new BusinessRuleError('Ce colis n’est pas confié à JAX.', 404);
    return r;
  }

  /** Retour JAX arrivé à l'agence Runex : le colis repasse dans le circuit des retours. */
  async retourRecu(packageId: string, acteur: ActeurST) {
    const r = await this.ligne(packageId);
    const enCours = r.etat === 'RETOUR_EN_COURS' || r.package.status === 'SOUS_TRAITE' || ['RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'REPORTE'].includes(String(r.package.status));
    if (!enCours || r.etat === 'LIVRE' || STATUTS_RUNEX_FINAUX.includes(String(r.package.status))) {
      throw new BusinessRuleError(`Le colis ${r.package.trackingNumber} n’est pas un retour JAX en attente.`, 409);
    }
    const agence = r.deposit?.name ?? 'Agence';
    await this.prisma.$transaction(async (tx) => {
      await tx.sousTraitance.update({ where: { id: r.id }, data: { etat: 'RETOURNE' } });
      // Le statut du colis suit déjà JAX (retour en cours) : il revient en stock retour à l'agence.
      await tx.package.update({
        where: { id: r.packageId },
        data: { status: 'RETOUR_DEPOT', currentDepositId: r.depositId, assignedDriverId: null, currentRunsheetId: null },
      });
      await tx.packageTimeline.create({
        data: {
          packageId: r.packageId,
          status: 'RETOUR_DEPOT',
          title: `Retour JAX reçu à ${agence}`,
          description: `Non livré par JAX${r.statutExterne ? ` (${r.statutExterne})` : ''} — suit le circuit des retours.`,
          locationName: agence,
          operatorName: acteur.fullName,
        },
      });
      await auditService.record(
        { entityType: 'PACKAGE', entityId: r.packageId, action: 'JAX_RETOUR_RECU', userId: acteur.id ?? null, reason: `Retour JAX ${r.package.trackingNumber} reçu à ${agence}.` },
        tx
      );
    });
    return { message: `Retour ${r.package.trackingNumber} reçu à ${agence} : il suit le circuit des retours.` };
  }

  /**
   * Reprendre un colis avant l'enlèvement par JAX (erreur d'envoi, client qui
   * change d'avis…). L'API JAX n'a pas de route d'annulation : il faut aussi
   * l'annuler chez JAX.
   */
  async reprendre(packageId: string, acteur: ActeurST) {
    const r = await this.ligne(packageId);
    if (!AVANT_ENLEVEMENT.includes(r.etat as EtatSousTraitance) || (r.package.status !== 'SOUS_TRAITE' && r.package.status !== 'CREE')) {
      throw new BusinessRuleError(`Le colis ${r.package.trackingNumber} a déjà été enlevé par JAX : il ne peut plus être repris.`, 409);
    }
    // Créé chez JAX mais pas encore reçu dans une agence : seule la fiche JAX est abandonnée.
    if (r.package.status === 'CREE') {
      await this.prisma.sousTraitance.update({ where: { id: r.id }, data: { etat: 'ANNULE' } });
      await auditService.record({
        entityType: 'PACKAGE',
        entityId: r.packageId,
        action: 'JAX_REPRIS',
        userId: acteur.id ?? null,
        reason: `Colis ${r.package.trackingNumber} repris avant réception : code JAX ${r.codeExterne} à annuler chez JAX.`,
      });
      return {
        message: `Colis ${r.package.trackingNumber} repris : il ne sera pas confié à JAX. Annulez le code ${r.codeExterne} auprès de JAX.`,
      };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.sousTraitance.update({ where: { id: r.id }, data: { etat: 'ANNULE' } });
      await packageWorkflowService.transition({
        packageId: r.packageId,
        to: PackageStatus.RECU_DEPOT,
        actor: { id: acteur.id, fullName: acteur.fullName, role: RoleType.ADMIN },
        title: 'Repris par Runex (non confié à JAX)',
        note: `Code JAX ${r.codeExterne} à annuler chez JAX`,
        location: r.deposit?.name ?? undefined,
        auditAction: 'JAX_REPRIS',
        data: { currentDepositId: r.depositId },
        client: tx,
      });
    });
    return {
      message: `Colis ${r.package.trackingNumber} repris : il est de nouveau en stock. JAX n’offre pas d’annulation par API : annulez le code ${r.codeExterne} auprès de JAX.`,
    };
  }

  /** Contre-remboursements reversés par JAX : l'expéditeur peut être réglé. */
  async marquerCodRecu(packageIds: unknown, acteur: ActeurST) {
    const ids = Array.isArray(packageIds) ? packageIds.map((x) => asUuid(String(x))).filter((x): x is string => !!x) : [];
    if (!ids.length) throw new BusinessRuleError('Choisissez les colis dont JAX a reversé le montant.', 400);
    const rows = await this.prisma.sousTraitance.findMany({
      where: { packageId: { in: ids }, etat: 'LIVRE', codRecuLe: null },
      select: { id: true, codMontant: true, fraisPartenaire: true, package: { select: { trackingNumber: true } } },
    });
    if (!rows.length) throw new BusinessRuleError('Aucun de ces colis n’attend un reversement JAX.', 409);
    // JAX reverse le contre-remboursement moins sa part.
    const total = n3(rows.reduce((s, r) => s + Number(r.codMontant) - Number(r.fraisPartenaire ?? 0), 0));
    await this.prisma.sousTraitance.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { codRecuLe: new Date() } });
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_COD_RECU',
      userId: acteur.id ?? null,
      reason: `Reversement JAX reçu : ${total.toFixed(3)} DT pour ${rows.length} colis (${rows.map((r) => r.package.trackingNumber).join(', ').slice(0, 300)}).`,
    });
    return { colis: rows.length, total };
  }

  /* ---------------------------------------------------------------- */
  /* Lecture                                                            */
  /* ---------------------------------------------------------------- */

  async lister(filtres: { etat?: string; depositId?: string; q?: string; cod?: string }) {
    const where: Prisma.SousTraitanceWhereInput = { partenaire: PARTENAIRE };
    if (filtres.etat && filtres.etat in ETATS_SOUS_TRAITANCE) where.etat = filtres.etat as EtatPrisma;
    const depot = asUuid(filtres.depositId ?? null);
    if (depot) where.depositId = depot;
    if (filtres.cod === 'a_recevoir') Object.assign(where, { etat: 'LIVRE', codRecuLe: null });
    if (filtres.q?.trim()) {
      const q = filtres.q.trim();
      where.OR = [{ codeExterne: { contains: q, mode: 'insensitive' } }, { package: { trackingNumber: { contains: q } } }];
    }
    const [rows, compte, codAttendu] = await Promise.all([
      this.prisma.sousTraitance.findMany({
        where,
        include: {
          deposit: { select: { name: true } },
          package: {
            select: {
              id: true,
              trackingNumber: true,
              status: true,
              totalPrice: true,
              shipper: { select: { companyName: true, brandName: true } },
              customer: { select: { fullName: true } },
              customerAddress: { select: { governorate: true, delegation: true } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
      this.prisma.sousTraitance.groupBy({ by: ['etat'], where: { partenaire: PARTENAIRE }, _count: { _all: true } }),
      this.prisma.sousTraitance.aggregate({ where: { partenaire: PARTENAIRE, etat: 'LIVRE', codRecuLe: null }, _sum: { codMontant: true, fraisPartenaire: true }, _count: { _all: true } }),
    ]);
    const compteurs = Object.fromEntries(Object.keys(ETATS_SOUS_TRAITANCE).map((e) => [e, 0])) as Record<EtatSousTraitance, number>;
    for (const c of compte) compteurs[c.etat as EtatSousTraitance] = c._count._all;
    return {
      lignes: rows.map((r) => ({
        ...versDto(r)!,
        packageId: r.packageId,
        trackingNumber: r.package.trackingNumber,
        statutRunex: r.package.status,
        expediteur: r.package.shipper.brandName || r.package.shipper.companyName,
        destinataire: r.package.customer.fullName,
        destination: [r.package.customerAddress.delegation, r.package.customerAddress.governorate].filter(Boolean).join(', '),
        montant: n3(r.package.totalPrice),
      })),
      compteurs,
      // Reversement attendu de JAX : contre-remboursement moins sa part.
      codARecevoir: { colis: codAttendu._count._all, total: n3(Number(codAttendu._sum.codMontant ?? 0) - Number(codAttendu._sum.fraisPartenaire ?? 0)), fraisJax: n3(codAttendu._sum.fraisPartenaire) },
    };
  }

  async detail(packageId: string) {
    const id = asUuid(packageId);
    if (!id) throw new BusinessRuleError('Colis introuvable.', 404);
    const r = await this.prisma.sousTraitance.findUnique({ where: { packageId: id }, include: { deposit: { select: { name: true } } } });
    return versDto(r);
  }
}

export const sousTraitanceService = new SousTraitanceService();
export { versDto };

/** Relecture périodique des statuts JAX (si le jeton est configuré). */
export function demarrerSynchronisationJax(): void {
  const cfg = jaxConfig();
  // Colis restés chez Runex : envoyés à JAX une seule fois, peu après le démarrage
  // (JAX_RATTRAPAGE_AUTO=0 pour s'en abstenir).
  if (cfg.token && process.env.JAX_RATTRAPAGE_AUTO !== '0') {
    setTimeout(
      () =>
        void sousTraitanceService
          .rattrapageUnique()
          .catch((e: unknown) => console.warn('[RUNEX API] Envoi des colis restés chez Runex impossible :', e instanceof Error ? e.message : String(e))),
      Number(process.env.JAX_RATTRAPAGE_DELAI_MS ?? 60_000)
    ).unref();
  }
  // Réunion du 10/11 : colis reportés et zones Runex rendus à Runex, une fois.
  if (cfg.token && process.env.JAX_CORRECTION_AUTO !== '0') {
    setTimeout(
      () =>
        void sousTraitanceService
          .correctionReunion()
          .catch((e: unknown) => console.warn('[RUNEX API] Correction des colis gardés par Runex impossible :', e instanceof Error ? e.message : String(e))),
      Number(process.env.JAX_CORRECTION_DELAI_MS ?? 15_000)
    ).unref();
  }
  if (!cfg.token || !(cfg.syncMinutes > 0)) {
    console.log('[RUNEX API] Sous-traitance JAX : ' + (cfg.token ? 'relecture automatique désactivée' : 'non configurée (JAX_API_TOKEN absent)'));
    return;
  }
  const tour = () =>
    void sousTraitanceService
      .retenterEchecs()
      .then(
        (n) => n && console.log(`[RUNEX API] JAX : ${n} colis créés chez JAX au nouvel essai.`),
        (e: unknown) => console.warn('[RUNEX API] Nouvel essai JAX impossible :', e instanceof Error ? e.message : String(e))
      )
      .then(() => sousTraitanceService.synchroniser())
      .then(
      (r) => r.changes && console.log(`[RUNEX API] JAX : ${r.relus} colis relus, ${r.changes} mis à jour.`),
      (e: unknown) => console.warn('[RUNEX API] Relecture JAX impossible :', e instanceof Error ? e.message : String(e))
    );
  setInterval(tour, cfg.syncMinutes * 60_000).unref();
  console.log(`[RUNEX API] Sous-traitance JAX : statuts relus toutes les ${cfg.syncMinutes} min.`);
}
