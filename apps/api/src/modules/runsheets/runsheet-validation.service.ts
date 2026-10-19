/**
 * Validation d'une tournée par la caisse (comme « Validation runsheet » chez
 * ADEX), en un seul écran :
 *
 *   1. lecture : chaque colis de la tournée avec son état (livré, reporté,
 *      retour définitif, non traité), son prix et le montant payé ; les
 *      totaux (total des colis livrés, total réglé, recette espèces et
 *      chèques) et les écarts ;
 *   2. scan des colis non livrés, en « Reporté » ou « Retour définitif » ;
 *   3. correction du montant payé d'un colis livré ;
 *   4. validation : la tournée est clôturée (conforme ou en déficit), les
 *      encaissements des colis livrés sont validés (ou écartés s'ils ne
 *      correspondent pas au prix), l'argent remis sort du solde du livreur,
 *      les colis non livrés quittent la tournée. Une tournée validée sort de
 *      la liste des tournées en cours et reste dans l'historique.
 *
 * Une tournée ne se valide qu'une fois tous ses colis traités.
 */

import { Prisma, PaymentStatus as PrismaPaymentStatus } from '@prisma/client';
import { PackageStatus, RoleType, PACKAGE_STATUS_LABELS } from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { BusinessRuleError, badRequest, conflict, notFound } from '../../common/errors/api-error';
import { codeMatchesPackage } from '../../common/scan/package-code';
import { packageWorkflowService } from '../colis/package-workflow.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuts d'une tournée que la caisse peut valider. */
const VALIDABLES = ['EN_ATTENTE', 'VALIDEE_DEPART', 'EN_COURS', 'RETOUR_DEPOT'];
const CLOTUREES = ['CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT'];

export type EtatValidation = 'LIVRE' | 'REPORTE' | 'RETOUR' | 'NON_TRAITE' | 'ANNULE';

function etatDe(status: string): EtatValidation {
  if (status === 'LIVRE' || status === 'LIVRAISON_PARTIELLE') return 'LIVRE';
  if (status === 'REPORTE') return 'REPORTE';
  if (['RETOUR_DEPOT', 'ECHEC_LIVRAISON', 'EN_RUNSHEET_RETOUR', 'RETOURNE_EXPEDITEUR'].includes(status)) return 'RETOUR';
  if (status === 'ANNULE') return 'ANNULE';
  return 'NON_TRAITE';
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface ColisValidation {
  id: string;
  trackingNumber: string;
  barcode: string;
  pieceCount: number;
  status: string;
  statusLabel: string;
  etat: EtatValidation;
  customerName: string;
  shipperName: string;
  price: number;
  paid: number;
  /** Prix − payé pour un colis livré ; prix pour un colis non livré. */
  ecart: number;
  method: string | null;
  paymentStatus: string | null;
  /** Le montant payé peut encore être corrigé. */
  modifiable: boolean;
}

export interface ValidationTournee {
  id: string;
  runsheetNumber: string;
  status: string;
  validable: boolean;
  tourDate: string;
  createdAt: string;
  closedAt: string | null;
  driver: { id: string; name: string; code: string; plate: string | null; vehicle: string | null };
  depositName: string;
  validatedBy: string | null;
  totaux: {
    colis: number;
    pieces: number;
    livres: number;
    reportes: number;
    retours: number;
    nonTraites: number;
    annules: number;
    /** Somme des prix des colis livrés. */
    totalColisLivres: number;
    /** Somme des montants payés sur les colis livrés. */
    totalReglement: number;
    recetteEspece: number;
    recetteCheque: number;
    nbCheques: number;
    recetteAutre: number;
    ecart: number;
    /** Après validation : espèces remises et déficit. */
    especesRemises: number;
    deficit: number;
  };
  colis: ColisValidation[];
}

interface Acteur {
  id?: string;
  fullName: string;
  role?: RoleType;
  /** Périmètre d'un agent de dépôt. */
  depositId?: string;
}

async function chargerTournee(identifiant: string, depositId?: string) {
  const prisma = getPrisma();
  const tournee = await prisma.runsheet.findFirst({
    where: UUID.test(identifiant) ? { OR: [{ id: identifiant }, { runsheetNumber: identifiant }] } : { runsheetNumber: identifiant },
    include: {
      driver: { select: { id: true, driverCode: true, licensePlate: true, vehicleType: true, user: { select: { fullName: true } } } },
      deposit: { select: { name: true } },
      runsheetItems: {
        orderBy: { orderIndex: 'asc' },
        include: {
          package: {
            select: {
              id: true,
              trackingNumber: true,
              barcode: true,
              pieceCount: true,
              status: true,
              totalPrice: true,
              collectedAmount: true,
              paymentVoucherId: true,
              assignedDriverId: true,
              currentRunsheetId: true,
              customer: { select: { fullName: true } },
              shipper: { select: { companyName: true } },
              payment: { select: { id: true, status: true, method: true, amountCollected: true, amountExpected: true, amountRefunded: true } },
            },
          },
        },
      },
    },
  });
  // Un agent de dépôt ne valide que les tournées de son dépôt.
  if (!tournee || (depositId && tournee.depositId !== depositId)) throw notFound('Feuille de tournée introuvable.');
  return tournee;
}

type Tournee = Awaited<ReturnType<typeof chargerTournee>>;

async function nomValideur(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = await getPrisma().user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return u?.fullName ?? null;
}

function versVue(t: Tournee, validatedBy: string | null): ValidationTournee {
  const validable = VALIDABLES.includes(t.status);
  const colis: ColisValidation[] = t.runsheetItems.map((item) => {
    const p = item.package;
    // Une tournée clôturée se relit telle qu'elle était à la validation : un
    // colis reporté a pu être livré depuis dans une autre tournée.
    const statut = String(CLOTUREES.includes(t.status) && item.statusAtClose ? item.statusAtClose : p.status);
    const etat = etatDe(statut);
    const price = n(p.totalPrice);
    // Une tournée validée garde le montant figé sur la ligne de tournée.
    const paid = etat === 'LIVRE' ? n(validable ? p.collectedAmount : item.collectedAmount || p.collectedAmount) : 0;
    return {
      id: p.id,
      trackingNumber: p.trackingNumber,
      barcode: p.barcode,
      pieceCount: p.pieceCount,
      status: statut,
      statusLabel: PACKAGE_STATUS_LABELS[statut as PackageStatus] ?? statut,
      etat,
      customerName: p.customer.fullName,
      shipperName: p.shipper.companyName,
      price,
      paid,
      ecart: r3(etat === 'LIVRE' ? price - paid : etat === 'ANNULE' ? 0 : price),
      method: p.payment?.method ?? null,
      paymentStatus: p.payment?.status ?? null,
      modifiable: validable && etat === 'LIVRE' && p.payment?.status !== 'VALIDE' && !p.paymentVoucherId,
    };
  });
  const livres = colis.filter((c) => c.etat === 'LIVRE');
  const somme = (liste: ColisValidation[], f: (c: ColisValidation) => number) => r3(liste.reduce((s, c) => s + f(c), 0));
  const totalColisLivres = somme(livres, (c) => c.price);
  const totalReglement = somme(livres, (c) => c.paid);
  const cheques = livres.filter((c) => c.method === 'CHEQUE');
  const autres = livres.filter((c) => c.method && c.method !== 'ESPECE' && c.method !== 'CHEQUE');
  const recetteCheque = somme(cheques, (c) => c.paid);
  const recetteAutre = somme(autres, (c) => c.paid);
  return {
    id: t.id,
    runsheetNumber: t.runsheetNumber,
    status: t.status,
    validable,
    tourDate: t.tourDate.toISOString().slice(0, 10),
    createdAt: t.createdAt.toISOString(),
    closedAt: t.closureTime?.toISOString() ?? null,
    driver: {
      id: t.driver.id,
      name: t.driver.user.fullName,
      code: t.driver.driverCode,
      plate: t.driver.licensePlate,
      vehicle: t.driver.vehicleType,
    },
    depositName: t.deposit.name,
    validatedBy,
    totaux: {
      colis: colis.length,
      pieces: colis.reduce((s, c) => s + (c.pieceCount || 1), 0),
      livres: livres.length,
      reportes: colis.filter((c) => c.etat === 'REPORTE').length,
      retours: colis.filter((c) => c.etat === 'RETOUR').length,
      nonTraites: colis.filter((c) => c.etat === 'NON_TRAITE').length,
      annules: colis.filter((c) => c.etat === 'ANNULE').length,
      totalColisLivres,
      totalReglement,
      recetteEspece: r3(totalReglement - recetteCheque - recetteAutre),
      recetteCheque,
      nbCheques: cheques.length,
      recetteAutre,
      ecart: r3(totalColisLivres - totalReglement),
      especesRemises: CLOTUREES.includes(t.status) ? n(t.collectedCash) : n(t.collectedCash) || r3(totalReglement - recetteCheque - recetteAutre),
      deficit: n(t.deficitAmount),
    },
    colis,
  };
}

function exigerValidable(t: Tournee): void {
  if (CLOTUREES.includes(t.status)) {
    throw conflict(`La tournée ${t.runsheetNumber} est déjà validée.`);
  }
  if (!VALIDABLES.includes(t.status)) {
    throw conflict(`La tournée ${t.runsheetNumber} ne peut pas être validée (statut ${t.status}).`);
  }
}

export class RunsheetValidationService {
  async lire(identifiant: string, depositId?: string): Promise<ValidationTournee> {
    const t = await chargerTournee(identifiant, depositId);
    return versVue(t, await nomValideur(t.closedByUserId));
  }

  /** Scan d'un colis non livré : « Reporté » ou « Retour définitif ». */
  async scanner(identifiant: string, code: string, mode: 'REPORTE' | 'RETOUR', acteur: Acteur) {
    const t = await chargerTournee(identifiant, acteur.depositId);
    exigerValidable(t);
    const valeur = String(code ?? '').trim();
    if (!valeur) throw badRequest('Scannez ou saisissez le code du colis.');
    const item = t.runsheetItems.find((i) => codeMatchesPackage(valeur, i.package));
    if (!item) throw new BusinessRuleError(`Le colis « ${valeur} » n'est pas dans la tournée ${t.runsheetNumber}.`, 404);
    const p = item.package;
    const etat = etatDe(p.status);
    if (etat === 'LIVRE') throw conflict(`Colis #${p.trackingNumber} livré : il ne peut pas être reporté ni retourné ici.`);
    if (etat === 'ANNULE') throw conflict(`Colis #${p.trackingNumber} annulé.`);
    if (mode === 'REPORTE' && etat === 'REPORTE') {
      return { message: `Colis #${p.trackingNumber} déjà reporté.`, vue: versVue(t, null) };
    }
    if (mode === 'RETOUR' && etat === 'RETOUR') {
      return { message: `Colis #${p.trackingNumber} déjà en retour définitif.`, vue: versVue(t, null) };
    }
    if (mode === 'REPORTE' && etat === 'RETOUR') {
      throw conflict(`Colis #${p.trackingNumber} déjà en retour définitif : il ne peut plus être reporté.`);
    }
    const cible = mode === 'REPORTE' ? PackageStatus.REPORTE : PackageStatus.RETOUR_DEPOT;
    await getPrisma().$transaction(async (tx) => {
      await packageWorkflowService.transition({
        packageId: p.id,
        to: cible,
        actor: { id: acteur.id, fullName: acteur.fullName, role: acteur.role ?? RoleType.FINANCE },
        reason: mode === 'REPORTE' ? 'Reporté à la validation de la tournée' : 'Retour définitif à la validation de la tournée',
        location: t.deposit.name,
        runsheetNumber: t.runsheetNumber,
        auditAction: 'RUNSHEET_VALIDATION_SCAN',
        client: tx,
      });
    });
    const apres = await chargerTournee(t.id);
    return {
      message: `Colis #${p.trackingNumber} : ${mode === 'REPORTE' ? 'reporté' : 'retour définitif'}.`,
      vue: versVue(apres, null),
    };
  }

  /** Correction du montant payé d'un colis livré (avant validation). */
  async corrigerMontant(identifiant: string, packageId: string, montant: number, acteur: Acteur) {
    const t = await chargerTournee(identifiant, acteur.depositId);
    exigerValidable(t);
    const item = t.runsheetItems.find((i) => i.package.id === packageId);
    if (!item) throw notFound('Colis absent de cette tournée.');
    const p = item.package;
    if (etatDe(p.status) !== 'LIVRE') throw conflict('Seul le montant d’un colis livré se corrige.');
    if (p.payment?.status === 'VALIDE' || p.paymentVoucherId) throw conflict('Encaissement déjà validé : le montant ne se corrige plus.');
    if (!Number.isFinite(montant) || montant < 0) throw badRequest('Montant invalide.');
    const prix = n(p.totalPrice);
    if (montant > prix) throw badRequest(`Le montant payé (${montant.toFixed(3)} DT) dépasse le prix du colis (${prix.toFixed(3)} DT).`);
    const avant = n(p.collectedAmount);
    const nouveau = new Prisma.Decimal(montant.toFixed(3));
    const delta = nouveau.minus(new Prisma.Decimal(avant.toFixed(3)));
    await getPrisma().$transaction(async (tx) => {
      await tx.package.update({ where: { id: p.id }, data: { collectedAmount: nouveau } });
      if (p.payment) {
        await tx.payment.update({ where: { id: p.payment.id }, data: { amountCollected: nouveau } });
      }
      if (!delta.isZero()) {
        await tx.driver.update({ where: { id: t.driverId }, data: { currentBalance: { increment: delta } } });
      }
      await auditService.record(
        {
          entityType: 'PACKAGE',
          entityId: p.id,
          action: 'CAISSE_AJUSTEE',
          userId: acteur.id ?? null,
          reason: `Montant payé du colis #${p.trackingNumber} corrigé à la validation de ${t.runsheetNumber} : ${avant.toFixed(3)} → ${montant.toFixed(3)} DT.`,
          previousValues: { collectedAmount: avant.toFixed(3) },
          newValues: { collectedAmount: montant.toFixed(3) },
        },
        tx
      );
    });
    return versVue(await chargerTournee(t.id), null);
  }

  /** Validation finale de la tournée. */
  async valider(identifiant: string, saisie: { especesRemises?: number; notes?: string }, acteur: Acteur) {
    if (!acteur.id) throw new BusinessRuleError('Une tournée ne peut être validée que par un utilisateur identifié.', 403);
    const t = await chargerTournee(identifiant, acteur.depositId);
    exigerValidable(t);
    const vue = versVue(t, null);
    const tot = vue.totaux;
    if (tot.nonTraites > 0) {
      throw new BusinessRuleError(
        `${tot.nonTraites} colis non traité${tot.nonTraites > 1 ? 's' : ''} : scannez-les en « Reporté » ou « Retour définitif » avant de valider.`,
        409
      );
    }
    const notes = saisie.notes === undefined || saisie.notes === null ? t.notes : String(saisie.notes).slice(0, 500);
    const remises = saisie.especesRemises === undefined || saisie.especesRemises === null ? tot.recetteEspece : Number(saisie.especesRemises);
    if (!Number.isFinite(remises) || remises < 0) throw badRequest('Montant des espèces remises invalide.');
    const deficit = r3(Math.max(0, tot.recetteEspece - remises));
    const statut = deficit > 0 ? 'CLOTUREE_DEFICIT' : 'CLOTUREE_CONFORME';
    const remis = new Prisma.Decimal(r3(remises + tot.recetteCheque + tot.recetteAutre).toFixed(3));
    const maintenant = new Date();

    await getPrisma().$transaction(async (tx) => {
      const ok = await tx.runsheet.updateMany({
        where: { id: t.id, status: t.status },
        data: {
          status: statut as never,
          expectedCash: new Prisma.Decimal(tot.totalReglement.toFixed(3)),
          collectedCash: new Prisma.Decimal(remises.toFixed(3)),
          collectedChecks: new Prisma.Decimal(tot.recetteCheque.toFixed(3)),
          deficitAmount: new Prisma.Decimal(deficit.toFixed(3)),
          deliveredCount: tot.livres,
          postponedCount: tot.reportes,
          returnedCount: tot.retours,
          pendingCount: 0,
          totalPackages: tot.colis,
          totalPieces: tot.pieces,
          closureTime: t.closureTime ?? maintenant,
          closedByUserId: acteur.id,
          notes,
        },
      });
      if (ok.count !== 1) throw conflict('La tournée vient d’être modifiée par un autre poste. Rechargez-la.');

      for (const item of t.runsheetItems) {
        const p = item.package;
        const etat = etatDe(p.status);
        await tx.runsheetItem.update({
          where: { id: item.id },
          data: {
            isHandled: true,
            statusAtClose: p.status,
            collectedAmount: etat === 'LIVRE' ? p.collectedAmount : new Prisma.Decimal(0),
            scannedAtReturn: item.scannedAtReturn ?? maintenant,
          },
        });

        if (etat === 'LIVRE' && p.payment && p.payment.status === PrismaPaymentStatus.EN_ATTENTE) {
          const reste = n(p.payment.amountExpected) - n(p.payment.amountCollected) - n(p.payment.amountRefunded);
          const conforme = Math.abs(reste) < 0.0005;
          await tx.payment.update({
            where: { id: p.payment.id },
            data: conforme
              ? { status: PrismaPaymentStatus.VALIDE, validatedAt: maintenant, validatedByUserId: acteur.id }
              : {
                  status: PrismaPaymentStatus.ECARTE,
                  validatedAt: maintenant,
                  validatedByUserId: acteur.id,
                  discrepancyReason: `Écart à la validation de ${t.runsheetNumber} : ${n(p.payment.amountCollected).toFixed(3)} DT payés sur ${n(p.payment.amountExpected).toFixed(3)} DT.`.slice(0, 255),
                },
          });
        }

        // Les colis non livrés quittent la tournée : le reporté repartira
        // dans une prochaine tournée, le retour rejoint le stock des retours.
        if ((etat === 'REPORTE' || etat === 'RETOUR') && p.currentRunsheetId === t.id) {
          await tx.package.update({
            where: { id: p.id },
            data: { currentRunsheetId: null, ...(etat === 'RETOUR' ? { assignedDriverId: null } : {}) },
          });
        }
      }

      // L'argent remis à la caisse n'est plus dans les mains du livreur.
      const livreur = await tx.driver.findUnique({ where: { id: t.driverId }, select: { currentBalance: true } });
      if (livreur) {
        const solde = new Prisma.Decimal(livreur.currentBalance);
        await tx.driver.update({
          where: { id: t.driverId },
          data: { currentBalance: solde.greaterThan(remis) ? solde.minus(remis) : new Prisma.Decimal(0) },
        });
      }

      await auditService.record(
        {
          entityType: 'RUNSHEET',
          entityId: t.id,
          action: 'CAISSE_VALIDEE',
          userId: acteur.id ?? null,
          reason:
            `Tournée ${t.runsheetNumber} validée par ${acteur.fullName} : ${tot.livres} livrés, ${tot.reportes} reportés, ${tot.retours} retours ; ` +
            `réglé ${tot.totalReglement.toFixed(3)} DT, espèces remises ${remises.toFixed(3)} DT` +
            (deficit > 0 ? `, déficit ${deficit.toFixed(3)} DT.` : '.'),
          previousValues: { status: t.status },
          newValues: { status: statut, especesRemises: remises.toFixed(3), deficit: deficit.toFixed(3) },
        },
        tx
      );
    });

    const apres = await chargerTournee(t.id);
    return versVue(apres, acteur.fullName);
  }

  /** Compteurs de la liste (comme ADEX) : à valider, déficit, conformes, toutes. */
  async compteurs(scope: { depositId?: string; driverId?: string }) {
    const groupes = await getPrisma().runsheet.groupBy({
      by: ['status'],
      where: { ...(scope.depositId ? { depositId: scope.depositId } : {}), ...(scope.driverId ? { driverId: scope.driverId } : {}) },
      _count: { _all: true },
    });
    const nb = (statuts: string[]) => groupes.filter((g) => statuts.includes(g.status)).reduce((s, g) => s + g._count._all, 0);
    return {
      aValider: nb(VALIDABLES),
      deficit: nb(['CLOTUREE_DEFICIT']),
      conformes: nb(['CLOTUREE_CONFORME']),
      annulees: nb(['ANNULEE']),
      total: nb(['BROUILLON', ...VALIDABLES, ...CLOTUREES, 'ANNULEE']),
    };
  }
}

export const runsheetValidationService = new RunsheetValidationService();
export const STATUTS_HISTORIQUE = [...CLOTUREES, 'ANNULEE'];
