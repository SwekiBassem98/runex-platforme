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
 */

import { Prisma, type EtatSousTraitance as EtatPrisma } from '@prisma/client';
import { ETATS_SOUS_TRAITANCE, NotificationEvent, PackageStatus, RoleType, type EtatSousTraitance, type SousTraitanceColisDto } from '@logixpress/types';
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
  if (/annul/.test(l)) return 'ANNULE';
  if (/retour|retourne|rtn/.test(l)) return 'RETOUR_EN_COURS';
  if (/(non|pas) livr|echec|refus|injoignable|report|probleme|anomalie/.test(l)) return 'EN_LIVRAISON';
  if (/en cours de livraison|en livraison|sortie|en distribution|livreur/.test(l)) return 'EN_LIVRAISON';
  if (/livr|delivr|remis au client|paye/.test(l)) return 'LIVRE';
  if (/enlev|ramass|pick|collect|recu|reception|depot|transit|hub|entrepot|en route|expedi/.test(l)) return 'PRIS_EN_CHARGE';
  if (/demande d enlevement|enlevement demande/.test(l)) return 'ENLEVEMENT_DEMANDE';
  if (/attente|cree|nouveau|enregistr|en preparation|valide/.test(l)) return 'EN_ATTENTE_ENLEVEMENT';
  return null;
}

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
      gouvernorats: gouvernorats.map((g) => ({ id: g.externeId, nom: g.nom })),
      statuts: statuts.map((s) => ({
        code: s.code,
        libelle: s.libelle,
        etat: s.etat as EtatSousTraitance | null,
        etatPropose: etatDepuisLibelle(s.libelle),
        manuel: s.manuel,
      })),
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

  async definirZones(governorates: unknown, acteur: ActeurST) {
    const liste = Array.isArray(governorates)
      ? [...new Set(governorates.filter((g): g is string => typeof g === 'string' && !!g.trim()).map((g) => g.trim()))]
      : null;
    if (!liste) throw new BusinessRuleError('Liste de gouvernorats invalide.', 400);
    await this.prisma.$transaction([
      this.prisma.sousTraitanceZone.deleteMany({ where: { partenaire: PARTENAIRE, governorate: { notIn: liste } } }),
      ...liste.map((g) =>
        this.prisma.sousTraitanceZone.upsert({
          where: { partenaire_governorate: { partenaire: PARTENAIRE, governorate: g } },
          create: { partenaire: PARTENAIRE, governorate: g },
          update: {},
        })
      ),
    ]);
    await auditService.record({
      entityType: 'SOUS_TRAITANCE',
      entityId: PARTENAIRE,
      action: 'JAX_ZONES',
      userId: acteur.id ?? null,
      reason: liste.length ? `Zones confiées à JAX : ${liste.join(', ')}.` : 'Plus aucune zone confiée automatiquement à JAX.',
    });
    return liste;
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
    if (c.status !== 'CREE' && c.status !== 'RECU_DEPOT' && c.status !== 'RECU_DEPOT_DESTINATION') {
      return `statut « ${c.status} » : seuls les colis créés ou reçus dans une agence Runex peuvent être confiés à JAX`;
    }
    if (!c.currentDepositId || !c.currentDeposit) return 'colis sans agence Runex';
    if (c.currentRunsheetId) return 'colis dans une tournée';
    if (c.interDepotTransferId) return 'colis dans un inter-dépôt';
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
    const avantConfie = ['CREE', 'RECU_DEPOT', 'RECU_DEPOT_DESTINATION'].includes(String(deja?.package.status));
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
      select: { trackingNumber: true, status: true, currentDepositId: true, currentDeposit: { select: { name: true } }, sousTraitance: { select: { codeExterne: true } } },
    });
    if (!c) return { packageId, trackingNumber: packageId, ok: false, message: 'Colis introuvable.' };
    const ean = c.sousTraitance?.codeExterne ?? '';
    if (c.status !== 'RECU_DEPOT' && c.status !== 'RECU_DEPOT_DESTINATION') {
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
          depositId: c.currentDepositId,
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
    let agence = colis.currentDeposit!;
    const [govDest, govPickup] = await Promise.all([this.idGouvernoratJax(adresse.governorate), this.idGouvernoratJax(agence.governorate)]);
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
    let enAgence = colis.status === 'RECU_DEPOT' || colis.status === 'RECU_DEPOT_DESTINATION';

    // 4. Le colis passe chez le partenaire (même transaction que la fiche).
    const maintenant = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Package" WHERE id = ${packageId}::uuid FOR UPDATE`;
        const actuel = await tx.package.findUnique({ where: { id: packageId }, select: { status: true, currentDepositId: true, currentDeposit: { select: { name: true } } } });
        enAgence = actuel?.status === 'RECU_DEPOT' || actuel?.status === 'RECU_DEPOT_DESTINATION';
        if (actuel?.currentDeposit) agence = { ...agence, name: actuel.currentDeposit.name };
        await tx.sousTraitance.update({
          where: { packageId },
          data: { codeExterne: ean, etat: 'EN_ATTENTE_ENLEVEMENT', envoyeLe: maintenant, statutExterne: 'Créé chez JAX', statutExterneLe: maintenant, depositId: actuel?.currentDepositId ?? colis.currentDepositId },
        });
        // Colis encore « Créé » : il est visible chez JAX dès maintenant, mais
        // ne passe « Confié à JAX » qu'à sa réception dans une agence.
        if (enAgence) {
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
      message: enAgence
        ? `Confié à JAX (code ${ean}).`
        : `Créé chez JAX (code ${ean}) : il sera confié au partenaire à sa réception à ${agence.name}.`,
    };
  }

  /**
   * Création du colis dans Runex : il est aussitôt créé chez JAX si sa
   * destination est une zone JAX (l'expéditeur voit le code EAN, JAX le connaît
   * avant l'enlèvement). Ne lève jamais : un échec est consigné et reprenable.
   */
  async enregistrerALaCreation(packageId: string): Promise<void> {
    try {
      if (!jaxConfig().token) return;
      const c = await this.prisma.package.findUnique({
        where: { id: packageId },
        select: { status: true, customerAddress: { select: { governorate: true } }, sousTraitance: { select: { etat: true, codeExterne: true } } },
      });
      if (!c || c.status !== 'CREE') return;
      if (c.sousTraitance?.codeExterne) return; // déjà chez JAX
      if (c.sousTraitance && c.sousTraitance.etat !== 'ECHEC_ENVOI' && c.sousTraitance.etat !== 'ANNULE') return;
      const zones = await this.prisma.sousTraitanceZone.findMany({ where: { partenaire: PARTENAIRE } });
      const cle = cleGouvernorat(c.customerAddress.governorate);
      if (!zones.some((z) => cleGouvernorat(z.governorate) === cle)) return;
      await this.envoyerUn(packageId, { fullName: 'Création (zone JAX)' }, 'AUTO');
    } catch (e) {
      console.warn('[RUNEX API] Création chez JAX impossible :', e instanceof Error ? e.message : String(e));
    }
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
        select: { status: true, customerAddress: { select: { governorate: true } }, sousTraitance: { select: { etat: true, codeExterne: true } } },
      });
      if (!c) return;
      if (c.sousTraitance?.codeExterne && c.sousTraitance.etat === 'EN_ATTENTE_ENLEVEMENT') {
        await this.confirmerReception(packageId, { fullName: 'Réception en agence (zone JAX)' });
        return;
      }
      if (c.status !== 'RECU_DEPOT' && c.status !== 'RECU_DEPOT_DESTINATION') return;
      // Déjà traité, ou repris volontairement (ANNULE) : seul un échec d'envoi est retenté automatiquement.
      if (c.sousTraitance && c.sousTraitance.etat !== 'ECHEC_ENVOI') return;
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

  /** Relit les statuts JAX (tous les colis actifs, ou ceux demandés). */
  async synchroniser(packageIds?: unknown) {
    if (!jaxConfig().token) throw new BusinessRuleError('Sous-traitance JAX non configurée : le jeton JAX (JAX_API_TOKEN) est absent sur le serveur.', 409);
    const ids = Array.isArray(packageIds) ? packageIds.map((x) => asUuid(String(x))).filter((x): x is string => !!x) : null;
    const rows = await this.prisma.sousTraitance.findMany({
      where: {
        partenaire: PARTENAIRE,
        codeExterne: { not: null },
        ...(ids && ids.length ? { packageId: { in: ids } } : { etat: { in: ACTIFS }, package: { is: { status: { not: 'CREE' as const } } } }),
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
      include: { deposit: { select: { name: true } }, package: { select: { trackingNumber: true, status: true, totalPrice: true, shipperId: true } } },
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
    r: Prisma.SousTraitanceGetPayload<{ include: { deposit: { select: { name: true } }; package: { select: { trackingNumber: true; status: true; totalPrice: true; shipperId: true } } } }>,
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
    const enRetard =
      !!propose &&
      propose !== actuel &&
      (actuel === 'LIVRE' || actuel === 'RETOURNE' || actuel === 'ANNULE' || (propose !== 'ANNULE' && RANG[propose] < RANG[actuel]));
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
    const lieu = r.deposit?.name ?? 'JAX';
    const acteur = ACTEUR_JAX;
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
          ...(cible === 'LIVRE' ? { codMontant: r.package.totalPrice } : {}),
        },
      });
      if (!etatChange && !libelleChange) return;
      const pkgStatus = r.package.status as string;
      if (etatChange && cible === 'LIVRE' && pkgStatus === 'SOUS_TRAITE') {
        await packageWorkflowService.transition({
          packageId: r.packageId,
          to: PackageStatus.LIVRE,
          actor: acteur,
          title: 'Livré par JAX',
          note: `JAX : ${statut.libelle} — montant encaissé par JAX, à reverser à Runex`,
          location: 'Livré par le partenaire JAX',
          auditAction: 'JAX_LIVRE',
          data: { collectedAmount: r.package.totalPrice, deliveredAt: statut.le ?? maintenant, currentDepositId: null },
          client: tx,
        });
      } else if (etatChange && cible === 'ANNULE' && pkgStatus === 'SOUS_TRAITE') {
        await packageWorkflowService.transition({
          packageId: r.packageId,
          to: PackageStatus.RECU_DEPOT,
          actor: acteur,
          title: 'Annulé chez JAX avant enlèvement — de nouveau en stock',
          note: `JAX : ${statut.libelle}`,
          location: lieu,
          auditAction: 'JAX_ANNULE',
          data: { currentDepositId: r.depositId },
          client: tx,
        });
      } else {
        // Sortie de l'agence : le colis n'est plus dans le stock Runex.
        if (etatChange && AVANT_ENLEVEMENT.includes(actuel) && (cible === 'PRIS_EN_CHARGE' || cible === 'EN_LIVRAISON' || cible === 'RETOUR_EN_COURS')) {
          await tx.package.update({ where: { id: r.packageId }, data: { currentDepositId: null } });
        }
        await tx.packageTimeline.create({
          data: {
            packageId: r.packageId,
            status: r.package.status,
            title: etatChange ? ETATS_SOUS_TRAITANCE[cible] : `JAX : ${statut.libelle}`.slice(0, 150),
            description: [`Statut JAX : ${statut.libelle}`, problemes ? `Problème signalé : ${problemes}` : null].filter(Boolean).join(' — ').slice(0, 500),
            locationName: cible === 'PRIS_EN_CHARGE' || cible === 'EN_LIVRAISON' ? 'Réseau JAX' : lieu,
            operatorName: acteur.fullName,
            createdAt: maintenant,
          },
        });
      }
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
          content: `Colis ${r.package.trackingNumber} : ${ETATS_SOUS_TRAITANCE[cible].toLowerCase()} (${statut.libelle}).`,
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
          include: { deposit: { select: { id: true, name: true } }, package: { select: { trackingNumber: true, status: true, totalPrice: true, shipperId: true } } },
        })
      : null;
    if (!r) throw new BusinessRuleError('Ce colis n’est pas confié à JAX.', 404);
    return r;
  }

  /** Retour JAX arrivé à l'agence Runex : le colis repasse dans le circuit des retours. */
  async retourRecu(packageId: string, acteur: ActeurST) {
    const r = await this.ligne(packageId);
    if (r.package.status !== 'SOUS_TRAITE' || r.etat === 'LIVRE') {
      throw new BusinessRuleError(`Le colis ${r.package.trackingNumber} n’est pas un retour JAX en attente.`, 409);
    }
    const agence = r.deposit?.name ?? 'Agence';
    await this.prisma.$transaction(async (tx) => {
      await tx.sousTraitance.update({ where: { id: r.id }, data: { etat: 'RETOURNE' } });
      await packageWorkflowService.transition({
        packageId: r.packageId,
        to: PackageStatus.RETOUR_DEPOT,
        actor: { id: acteur.id, fullName: acteur.fullName, role: RoleType.ADMIN },
        title: `Retour JAX reçu à ${agence}`,
        reason: `Non livré par JAX${r.statutExterne ? ` (${r.statutExterne})` : ''}`,
        location: agence,
        auditAction: 'JAX_RETOUR_RECU',
        data: { currentDepositId: r.depositId, assignedDriverId: null },
        client: tx,
      });
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
      select: { id: true, codMontant: true, package: { select: { trackingNumber: true } } },
    });
    if (!rows.length) throw new BusinessRuleError('Aucun de ces colis n’attend un reversement JAX.', 409);
    const total = n3(rows.reduce((s, r) => s + Number(r.codMontant), 0));
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
      this.prisma.sousTraitance.aggregate({ where: { partenaire: PARTENAIRE, etat: 'LIVRE', codRecuLe: null }, _sum: { codMontant: true }, _count: { _all: true } }),
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
      codARecevoir: { colis: codAttendu._count._all, total: n3(codAttendu._sum.codMontant) },
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
  if (!cfg.token || !(cfg.syncMinutes > 0)) {
    console.log('[RUNEX API] Sous-traitance JAX : ' + (cfg.token ? 'relecture automatique désactivée' : 'non configurée (JAX_API_TOKEN absent)'));
    return;
  }
  const tour = () =>
    void sousTraitanceService.synchroniser().then(
      (r) => r.changes && console.log(`[RUNEX API] JAX : ${r.relus} colis relus, ${r.changes} mis à jour.`),
      (e: unknown) => console.warn('[RUNEX API] Relecture JAX impossible :', e instanceof Error ? e.message : String(e))
    );
  setInterval(tour, cfg.syncMinutes * 60_000).unref();
  console.log(`[RUNEX API] Sous-traitance JAX : statuts relus toutes les ${cfg.syncMinutes} min.`);
}
