/**
 * Rapports d'exploitation.
 *
 * Chaque rapport répond à une question que l'exploitation se pose réellement, et
 * rien d'autre. Trois règles ont guidé l'écriture :
 *
 * **Le périmètre d'abord.** Un expéditeur a le droit de consulter des rapports ;
 * il n'a pas le droit d'y voir la plateforme. Chaque requête reçoit le
 * `dataScope` de l'appelant, et le rapport dit en clair ce qu'il couvre.
 *
 * **Les dénominateurs sont explicites.** « 12 % d'échec » n'a de sens que
 * rapporté à ce que la question comptait. Les taux sont donc calculés sur la
 * population explicitement nommée, jamais sur « le reste ».
 *
 * **Les montants ne passent pas par `Number`.** Le dinar est un décimal en base ;
 * additionner des dizaines de lignes en flottant produit une erreur qui ne se
 * voit pas sur un rapport et se retrouve sur un virement. Tout passe par
 * `Prisma.Decimal`, et sort en chaîne à trois décimales.
 */

import { Prisma } from '@prisma/client';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { periode as bornes, periodeParDefaut, type Periode } from '../../common/dates/periode';
import type {
  DomaineRapport,
  EnteteRapport,
  Montant,
  RapportColis,
  RapportDepots,
  RapportExpediteurs,
  RapportFinance,
  RapportLivreurs,
  FiltresRapport,
  Rapport,
} from './reports.types';

type Scope = { shipperId?: string; assignedDriverId?: string; depositId?: string };

/** Période appliquée quand l'appelant n'en demande aucune. */
const JOURS_PAR_DEFAUT = 30;

/** Un montant, ramené à trois décimales sans passer par un flottant. */
function argent(valeur: Prisma.Decimal | number | null | undefined): Montant {
  if (valeur === null || valeur === undefined) return new Prisma.Decimal(0).toFixed(3);
  return new Prisma.Decimal(valeur).toFixed(3);
}

/** Somme d'une liste de décimaux, sans jamais sortir du type qui va bien. */
export function somme(valeurs: Array<Prisma.Decimal | null | undefined>): Prisma.Decimal {
  return valeurs.reduce<Prisma.Decimal>((cumul, v) => cumul.plus(v ?? 0), new Prisma.Decimal(0));
}

/**
 * Un pourcentage, arrondi à une décimale.
 *
 * Une population vide vaut zéro et non « indéterminé » : un rapport qui affiche
 * « — » là où il peut afficher « 0 % » oblige l'utilisateur à aller vérifier.
 */
function pourcent(numerateur: number, denominateur: number): number {
  if (denominateur <= 0) return 0;
  return Math.round((numerateur / denominateur) * 1000) / 10;
}

/** Un pourcentage calculé sur deux décimaux, sans repasser par un `number`. */
function pourcentDecimal(numerateur: Prisma.Decimal, denominateur: Prisma.Decimal): number {
  if (denominateur.isZero() || denominateur.isNegative()) return 0;
  return numerateur.div(denominateur).mul(100).toDecimalPlaces(1).toNumber();
}

/** Le jour, au format `AAAA-MM-JJ`, en UTC comme les bornes de période. */
function jour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Le jour, affiché court : c'est un axe de graphique, pas une lecture. */
function jourCourt(date: Date): string {
  return date.toLocaleDateString('fr-TN', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

/** Un horodatage affichable, au format ISO comme partout dans l'application. */
function instant(date: Date | null | undefined): string {
  return date ? date.toISOString() : '';
}

/** Les statuts qui marquent une fin de parcours pour le colis. */
const LIVRES: string[] = ['LIVRE', 'LIVRAISON_PARTIELLE'];
const INCIDENTS: string[] = ['REPORTE', 'ECHEC_LIVRAISON', 'RETOUR_DEPOT', 'RETOURNE_EXPEDITEUR'];
const RETOURNES: string[] = ['RETOUR_DEPOT', 'RETOURNE_EXPEDITEUR', 'ECHEC_LIVRAISON'];
/** Un colis qui n'est ni arrivé, ni parti, ni annulé : il est en cours. */
const SANS_FIN: string[] = [
  'CREE',
  'RAMASSAGE_PROGRAMME',
  'RAMASSE',
  'RECU_DEPOT',
  'EN_LOT_INTER_DEPOT',
  'EN_TRANSIT_INTER_DEPOT',
  'RECU_DEPOT_DESTINATION',
  'AFFECTE_RUNSHEET',
  'EN_COURS_LIVRAISON',
];

/** Ce qu'un code d'issue veut dire pour un exploitant, pas pour une machine. */
const LIBELLE_STATUT: Record<string, string> = {
  CREE: 'Créé',
  RAMASSAGE_PROGRAMME: 'Ramassage programmé',
  RAMASSE: 'Ramassé',
  RECU_DEPOT: 'Reçu au dépôt',
  EN_LOT_INTER_DEPOT: 'En lot inter-dépôts',
  EN_TRANSIT_INTER_DEPOT: 'En transit inter-dépôts',
  RECU_DEPOT_DESTINATION: 'Reçu au dépôt de destination',
  AFFECTE_RUNSHEET: 'Affecté à une tournée',
  EN_COURS_LIVRAISON: 'En cours de livraison',
  LIVRE: 'Livré',
  LIVRAISON_PARTIELLE: 'Livraison partielle',
  REPORTE: 'Reporté',
  ECHEC_LIVRAISON: 'Échec de livraison',
  RETOUR_DEPOT: 'Retourné au dépôt',
  EN_RUNSHEET_RETOUR: 'En tournée retour',
  RETOURNE_EXPEDITEUR: "Retourné à l'expéditeur",
  ANNULE: 'Annulé',
};

const LIBELLE_STATUT_TRANSFERT: Record<string, string> = {
  CRE: 'Créé',
  PREPARE: 'Préparé',
  EN_TRANSIT: 'En transit',
  RECU: 'Réceptionné',
  ANNULE: 'Annulé',
};

const LIBELLE_STATUT_PAIEMENT: Record<string, string> = {
  EN_ATTENTE: 'En attente',
  VALIDE: 'Validé',
  ECARTE: 'Écarté',
  REMBOURSE: 'Remboursé',
  ANNULE: 'Annulé',
};

const LIBELLE_MOYEN_PAIEMENT: Record<string, string> = {
  ESPECE: 'Espèces',
  CHEQUE: 'Chèque',
  VIREMENT: 'Virement',
  TRAITE: 'Traite',
  CARTE_BANCAIRE: 'Carte bancaire',
  PAIEMENT_EN_LIGNE: 'Paiement en ligne',
};

/**
 * Un motif d'incident, lisible par un exploitant.
 *
 * Un code technique — `REFUSEE` — ne dit rien à l'exploitant ; c'est la
 * formulation du livreur qui l'intéresse, et le code n'est qu'un secours quand
 * le livreur n'a rien écrit.
 */
const MOTIF_INCIDENT: Record<string, string> = {
  REUSSIE: 'Livré',
  LIVRAISON_PARTIELLE: 'Livraison partielle',
  REPORTEE: 'Reporté',
  REFUSEE: 'Destinataire absent',
  INJOIGNABLE: 'Destinataire injoignable',
  ADRESSE_INCORRECTE: 'Adresse incorrecte',
  PAS_D_ARGENT: 'Destinataire sans espèces',
};

const AUCUN_MOTIF = 'Aucune tentative enregistrée';

function libelleMotif(resultat: string | null, commentaire: string | null): string {
  if (commentaire?.trim()) return commentaire.trim().slice(0, 80);
  return MOTIF_INCIDENT[resultat ?? ''] ?? resultat ?? AUCUN_MOTIF;
}

export class ReportsService {
  private get prisma() {
    return getPrisma();
  }

  /**
   * Bornes de la période.
   *
   * Un rapport sans période se lirait comme un bilan depuis l'origine des
   * données, ce qui n'est presque jamais la question posée : « ces trente
   * derniers jours » l'est. La borne est donc explicite, et l'en-tête du
   * rapport la rediscovered — un chiffre sans période lue est un chiffre
   * qu'on ne peut pas comparer.
   */
  private fenetre(filtres: FiltresRapport): { bornes: Periode; appliquee: boolean } {
    const demandee = bornes(filtres.from, filtres.to);
    if (demandee) return { bornes: demandee, appliquee: true };
    return { bornes: periodeParDefaut(JOURS_PAR_DEFAUT), appliquee: false };
  }

  /** Ce que l'appelant a le droit de voir, en clair. */
  private perimetre(scope: Scope): string {
    if (scope.shipperId) return 'Votre expéditeur';
    if (scope.assignedDriverId) return 'Vos livraisons';
    if (scope.depositId) return 'Votre dépôt';
    return 'Toute la plateforme';
  }

  /**
   * En-tête commun à tous les rapports : période résolue et périmètre.
   *
   * Le domaine est propagé en type générique pour que l'interface reste une
   * union discriminée côté interface : sans cela, TypeScript élargirait
   * `'colis'` en `DomaineRapport` et le composant Colis ne pourrait plus
   * narrowed vers son propre type.
   */
  private entete<D extends DomaineRapport>(
    filtres: FiltresRapport,
    scope: Scope,
    domaine: D
  ): EnteteRapport & { domaine: D } {
    const debut = filtres.from?.trim();
    const fin = filtres.to?.trim();
    const periode = debut
      ? fin
        ? `${debut} → ${fin}`
        : `Depuis le ${debut}`
      : fin
        ? `Jusqu'au ${fin}`
        : `${JOURS_PAR_DEFAUT} derniers jours`;
    return {
      domaine,
      periode,
      from: debut || null,
      to: fin || null,
      perimetre: this.perimetre(scope),
      genereLe: new Date().toISOString(),
    };
  }

  /**
   * COLIS — le flux du parc sur la période.
   *
   * Le comptage porte sur les colis **créés** dans la période, et les issues
   * sont lues sur ces colis-là. C'est le seul découpage qui répond à « ce que
   * j'ai confié ce mois-ci, qu'en est-il devenu » : compter les livraisons par
   * date de livraison répondrait à une autre question — le volume du jour — et
   * mélangerait des colis de tous les mois.
   */
  async colis(filtres: FiltresRapport, scope: Scope): Promise<RapportColis> {
    const { bornes: p } = this.fenetre(filtres);
    const extra: Prisma.PackageWhereInput[] = [{ deletedAt: null }];
    if (scope.shipperId) extra.push({ shipperId: scope.shipperId });
    if (scope.assignedDriverId) extra.push({ assignedDriverId: scope.assignedDriverId });
    if (scope.depositId) {
      extra.push({ OR: [{ currentDepositId: scope.depositId }, { destinationDepositId: scope.depositId }] });
    }

    const colis = await this.prisma.package.findMany({
      where: { AND: [...extra, { createdAt: p }] },
      select: {
        status: true,
        packageType: true,
        createdAt: true,
        deliveredAt: true,
        deliveryAttempts: {
          select: { result: true, driverComment: true, customerNote: true },
          orderBy: { attemptedAt: 'desc' },
          take: 1,
        },
      },
    });

    const parStatut = new Map<string, number>();
    for (const c of colis) parStatut.set(c.status, (parStatut.get(c.status) ?? 0) + 1);

    const livres = count(colis, (c) => c.status === 'LIVRE');
    const partiels = count(colis, (c) => c.status === 'LIVRAISON_PARTIELLE');
    const echecs = count(colis, (c) => c.status === 'ECHEC_LIVRAISON');
    const incidents = count(colis, (c) => INCIDENTS.includes(c.status));

    // Le flux par jour : ce qui permet de voir si le retard s'accumule, ce qu'un
    // total ne montrera jamais.
    const parJour = new Map<string, { crees: number; livres: number; incidents: number }>();
    for (const clef of joursCouverts(p)) parJour.set(clef, { crees: 0, livres: 0, incidents: 0 });
    for (const c of colis) {
      const ligne = parJour.get(jour(c.createdAt));
      if (ligne) ligne.crees++;
      if (c.deliveredAt) {
        const sortie = parJour.get(jour(c.deliveredAt));
        if (sortie) sortie.livres++;
      }
      if (INCIDENTS.includes(c.status)) {
        const entree = parJour.get(jour(c.createdAt));
        if (entree) entree.incidents++;
      }
    }

    const motifs = new Map<string, number>();
    for (const c of colis) {
      if (!INCIDENTS.includes(c.status)) continue;
      const derniere = c.deliveryAttempts[0];
      const motif = derniere
        ? libelleMotif(derniere.result, derniere.driverComment || derniere.customerNote)
        : AUCUN_MOTIF;
      motifs.set(motif, (motifs.get(motif) ?? 0) + 1);
    }

    return {
      ...this.entete(filtres, scope, 'colis'),
      totaux: {
        crees: colis.length,
        livres,
        livraisonPartielle: partiels,
        reportes: count(colis, (c) => c.status === 'REPORTE'),
        echecs,
        retournes: count(colis, (c) => RETOURNES.includes(c.status)),
        annules: count(colis, (c) => c.status === 'ANNULE'),
        echanges: count(colis, (c) => c.packageType === 'EXCHANGE'),
        enCours: count(colis, (c) => SANS_FIN.includes(c.status)),
      },
      taux: {
        livraison: pourcent(livres + partiels, colis.length),
        incident: pourcent(incidents, colis.length),
      },
      parJour: serieParJour(parJour, p),
      parStatut: [...parStatut.entries()]
        .map(([statut, n]) => ({ statut, libelle: LIBELLE_STATUT[statut] ?? statut, count: n }))
        .sort((a, b) => b.count - a.count),
      parMotifIncident: [...motifs.entries()]
        .map(([motif, n]) => ({ motif, count: n }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
    };
  }

  /**
   * EXPÉDITEURS — ce qui a été confié, et ce qui en est revenu.
   *
   * Le taux de réussite est rapporté au nombre de colis **confiés sur la
   * période**, jamais au nombre de livraisons de la période : le second calcul
   * donnerait le même taux à un expéditeur qui livre vite mais mal qu'à un
   * expéditeur excellent et catastrophique à la fois.
   */
  async expediteurs(filtres: FiltresRapport, scope: Scope): Promise<RapportExpediteurs> {
    const { bornes: p } = this.fenetre(filtres);
    const filtreColis: Prisma.PackageWhereInput = {
      deletedAt: null,
      ...(scope.shipperId ? { shipperId: scope.shipperId } : {}),
      createdAt: p,
    };
    const filtrePaiement: Prisma.PaymentWhereInput = {
      ...(scope.shipperId ? { shipperId: scope.shipperId } : {}),
      collectedAt: p,
    };

    const [expediteurs, groupes, paiements] = await Promise.all([
      this.prisma.shipper.findMany({
        where: { deletedAt: null, ...(scope.shipperId ? { id: scope.shipperId } : {}) },
        select: { id: true, code: true, companyName: true },
        orderBy: { companyName: 'asc' },
      }),
      this.prisma.package.groupBy({
        by: ['shipperId', 'status'],
        where: filtreColis,
        _count: { _all: true },
        _sum: { totalPrice: true },
      }),
      this.prisma.payment.groupBy({
        by: ['shipperId'],
        where: filtrePaiement,
        _sum: { amountExpected: true, amountCollected: true, amountRefunded: true },
      }),
    ]);

    // Un seul balayage par expéditeur plutôt qu'une requête chacun : le nombre
    // d'expéditeurs est de l'ordre de la dizaine aujourd'hui, mais la requête
    // doit rester juste quand il y en a mille.
    const parExp = new Map<
      string,
      { colis: number; livres: number; incidents: number; montantConfie: Prisma.Decimal }
    >();
    for (const ligne of groupes) {
      const entree = parExp.get(ligne.shipperId) ?? {
        colis: 0,
        livres: 0,
        incidents: 0,
        montantConfie: new Prisma.Decimal(0),
      };
      entree.colis += ligne._count._all;
      if (LIVRES.includes(ligne.status)) entree.livres += ligne._count._all;
      if (INCIDENTS.includes(ligne.status)) entree.incidents += ligne._count._all;
      entree.montantConfie = entree.montantConfie.plus(ligne._sum.totalPrice ?? 0);
      parExp.set(ligne.shipperId, entree);
    }

    const parPaiement = new Map<string, { du: Prisma.Decimal; encaisse: Prisma.Decimal }>();
    for (const ligne of paiements) {
      const entree =
        parPaiement.get(ligne.shipperId) ?? { du: new Prisma.Decimal(0), encaisse: new Prisma.Decimal(0) };
      entree.du = entree.du.plus(ligne._sum.amountExpected ?? 0);
      entree.encaisse = entree.encaisse
        .plus(ligne._sum.amountCollected ?? 0)
        .minus(ligne._sum.amountRefunded ?? 0);
      parPaiement.set(ligne.shipperId, entree);
    }

    const lignes = expediteurs
      .map((exp) => {
        const colis = parExp.get(exp.id);
        const caisse = parPaiement.get(exp.id);
        const du = caisse?.du ?? new Prisma.Decimal(0);
        const encaisse = caisse?.encaisse ?? new Prisma.Decimal(0);
        return {
          id: exp.id,
          code: exp.code,
          nom: exp.companyName,
          colis: colis?.colis ?? 0,
          livres: colis?.livres ?? 0,
          incidents: colis?.incidents ?? 0,
          tauxReussite: pourcent(colis?.livres ?? 0, colis?.colis ?? 0),
          montantConfie: colis?.montantConfie ?? new Prisma.Decimal(0),
          montantDu: du,
          montantEncaisse: encaisse,
          nonEncaisse: du.minus(encaisse),
        };
      })
      .sort((a, b) => b.colis - a.colis);

    const totauxColis = lignes.reduce(
      (acc, l) => ({
        colis: acc.colis + l.colis,
        livres: acc.livres + l.livres,
        incidents: acc.incidents + l.incidents,
        montantConfie: acc.montantConfie.plus(l.montantConfie),
        montantDu: acc.montantDu.plus(l.montantDu),
        montantEncaisse: acc.montantEncaisse.plus(l.montantEncaisse),
      }),
      {
        colis: 0,
        livres: 0,
        incidents: 0,
        montantConfie: new Prisma.Decimal(0),
        montantDu: new Prisma.Decimal(0),
        montantEncaisse: new Prisma.Decimal(0),
      }
    );

    return {
      ...this.entete(filtres, scope, 'expediteurs'),
      totaux: {
        colis: totauxColis.colis,
        livres: totauxColis.livres,
        incidents: totauxColis.incidents,
        tauxReussite: pourcent(totauxColis.livres, totauxColis.colis),
        montantConfie: argent(totauxColis.montantConfie),
        montantDu: argent(totauxColis.montantDu),
        montantEncaisse: argent(totauxColis.montantEncaisse),
        nonEncaisse: argent(totauxColis.montantDu.minus(totauxColis.montantEncaisse)),
      },
      expediteurs: lignes.map((l) => ({
        id: l.id,
        code: l.code,
        nom: l.nom,
        colis: l.colis,
        livres: l.livres,
        incidents: l.incidents,
        tauxReussite: l.tauxReussite,
        montantDu: argent(l.montantDu),
        montantEncaisse: argent(l.montantEncaisse),
        nonEncaisse: argent(l.nonEncaisse),
      })),
      concentration: [...lignes]
        .sort((a, b) => (b.montantConfie.comparedTo(a.montantConfie) as number) || b.colis - a.colis)
        .slice(0, 10)
        .map((l) => ({ nom: l.nom, colis: l.colis, montantConfie: argent(l.montantConfie) })),
    };
  }

  /**
   * LIVREURS — la performance, et ce qu'il faut pour agir dessus.
   *
   * Le solde d'espèces est lu sur le livreur et non recalculé : c'est lui qui
   * déclare ce qu'il a en main, et l'écart entre le calcul et la déclaration est
   * précisément l'information que l'exploitation cherche.
   */
  async livreurs(filtres: FiltresRapport, scope: Scope): Promise<RapportLivreurs> {
    const { bornes: p } = this.fenetre(filtres);
    const filtreColis: Prisma.PackageWhereInput = {
      deletedAt: null,
      ...(scope.shipperId ? { shipperId: scope.shipperId } : {}),
      createdAt: p,
    };

    const [livreurs, groupes, paiements, motifsEchec, tournees] = await Promise.all([
      this.prisma.driver.findMany({
        where: { deletedAt: null, ...(scope.assignedDriverId ? { id: scope.assignedDriverId } : {}) },
        select: {
          id: true,
          driverCode: true,
          vehicleType: true,
          currentBalance: true,
          user: { select: { fullName: true } },
          runsheets: { select: { tourDate: true }, orderBy: { tourDate: 'desc' }, take: 1 },
        },
        orderBy: { driverCode: 'asc' },
      }),
      this.prisma.package.groupBy({
        by: ['assignedDriverId', 'status'],
        where: { ...filtreColis, assignedDriverId: { not: null } },
        _count: { _all: true },
        _sum: { collectedAmount: true },
      }),
      this.prisma.payment.groupBy({
        by: ['driverId'],
        where: {
          driverId: { not: null },
          ...(scope.assignedDriverId ? { driverId: scope.assignedDriverId } : {}),
          collectedAt: p,
        },
        _sum: { amountCollected: true, amountRefunded: true },
      }),
      this.prisma.deliveryAttempt.groupBy({
        by: ['driverId', 'result'],
        where: {
          ...(scope.assignedDriverId ? { driverId: scope.assignedDriverId } : {}),
          attemptedAt: p,
        },
        _count: { _all: true },
      }),
      // Le déficit n'existe que là où le livreur a rendu des comptes.
      this.prisma.runsheet.groupBy({
        by: ['driverId'],
        where: {
          ...(scope.assignedDriverId ? { driverId: scope.assignedDriverId } : {}),
          tourDate: p,
        },
        _sum: { deficitAmount: true },
      }),
    ]);

    const parLivreur = new Map<
      string,
      { livres: number; echecs: number; retournes: number; enCours: number; affectes: number }
    >();
    for (const ligne of groupes) {
      const id = ligne.assignedDriverId as string;
      const entree = parLivreur.get(id) ?? {
        livres: 0,
        echecs: 0,
        retournes: 0,
        enCours: 0,
        affectes: 0,
      };
      entree.affectes += ligne._count._all;
      if (LIVRES.includes(ligne.status)) entree.livres += ligne._count._all;
      if (ligne.status === 'ECHEC_LIVRAISON') entree.echecs += ligne._count._all;
      if (RETOURNES.includes(ligne.status)) entree.retournes += ligne._count._all;
      if (ligne.status === 'EN_COURS_LIVRAISON' || ligne.status === 'AFFECTE_RUNSHEET') {
        entree.enCours += ligne._count._all;
      }
      parLivreur.set(id, entree);
    }

    const net = new Map<string, Prisma.Decimal>();
    for (const ligne of paiements) {
      const id = ligne.driverId as string;
      let courant = net.get(id) ?? new Prisma.Decimal(0);
      courant = courant.plus(ligne._sum.amountCollected ?? 0).minus(ligne._sum.amountRefunded ?? 0);
      net.set(id, courant);
    }

    const deficits = new Map<string, Prisma.Decimal>();
    for (const ligne of tournees) {
      const id = ligne.driverId as string;
      let courant = deficits.get(id) ?? new Prisma.Decimal(0);
      courant = courant.plus(ligne._sum.deficitAmount ?? 0);
      deficits.set(id, courant);
    }

    // Le nombre de passages Tentés par livreur, toutes issues confondues :
    // c'est le coût réel d'un colis difficile, pas le seul nombre d'échecs.
    const tentatives = new Map<string, number>();
    const motifsParLivreur = new Map<string, Map<string, number>>();
    for (const ligne of motifsEchec) {
      const id = (ligne.driverId as string) ?? '';
      tentatives.set(id, (tentatives.get(id) ?? 0) + ligne._count._all);
      const parCode = motifsParLivreur.get(id) ?? new Map<string, number>();
      parCode.set(ligne.result, (parCode.get(ligne.result) ?? 0) + ligne._count._all);
      motifsParLivreur.set(id, parCode);
    }

    const lignes = livreurs.map((livreur) => {
      const stats = parLivreur.get(livreur.id);
      const affectes = stats?.affectes ?? 0;
      const livres = stats?.livres ?? 0;
      return {
        id: livreur.id,
        code: livreur.driverCode,
        nom: livreur.user.fullName,
        vehicule: livreur.vehicleType,
        affectes,
        livres,
        echecs: stats?.echecs ?? 0,
        retournes: stats?.retournes ?? 0,
        enCours: stats?.enCours ?? 0,
        tauxReussite: pourcent(livres, affectes),
        montantEncaisse: net.get(livreur.id) ?? new Prisma.Decimal(0),
        deficitDeclare: deficits.get(livreur.id) ?? new Prisma.Decimal(0),
        soldeEspeces: argent(livreur.currentBalance),
        tentatives: tentatives.get(livreur.id) ?? 0,
        dernierTour: livreur.runsheets[0] ? jourCourt(livreur.runsheets[0].tourDate) : null,
      };
    });

    const totalAffectes = lignes.reduce((a, l) => a + l.affectes, 0);
    const totalEncaisse = somme(lignes.map((l) => l.montantEncaisse));

    return {
      ...this.entete(filtres, scope, 'livreurs'),
      totaux: {
        livreurs: livreurs.length,
        affectes: totalAffectes,
        livres: lignes.reduce((a, l) => a + l.livres, 0),
        echecs: lignes.reduce((a, l) => a + l.echecs, 0),
        retournes: lignes.reduce((a, l) => a + l.retournes, 0),
        enCours: lignes.reduce((a, l) => a + l.enCours, 0),
        montantEncaisse: argent(totalEncaisse),
        tauxReussite: pourcent(
          lignes.reduce((a, l) => a + l.livres, 0),
          totalAffectes
        ),
        deficitDeclare: argent(somme(lignes.map((l) => l.deficitDeclare))),
      },
      livreurs: lignes.sort((a, b) => b.affectes - a.affectes).map((l) => ({
        ...l,
        montantEncaisse: argent(l.montantEncaisse),
        deficitDeclare: argent(l.deficitDeclare),
      })),
      // Les motifs d'échec, tous livreurs confondus : ce qu'il faut corriger
      // au passage, indépendamment de qui l'a constaté.
      parMotifEchec: [...motifsEchec
        .filter((m) => m.result !== 'REUSSIE' && m.result !== 'LIVRAISON_PARTIELLE')
        .reduce((acc, m) => acc.set(m.result, (acc.get(m.result) ?? 0) + m._count._all), new Map<string, number>())]
        .map(([resultat, n]) => ({ motif: MOTIF_INCIDENT[resultat] ?? resultat, count: n }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * FINANCE — où est l'argent, et ce qui ne reviendra pas.
   *
   * Le reliquat est `encaissé − remboursé` : l'argent rendu au client est un
   * encaissement légitime, pas un manque. Oublier ce terme ferait apparaître
   * comme perte tout ce qui a été restitué.
   */
  async finance(filtres: FiltresRapport, scope: Scope): Promise<RapportFinance> {
    const { bornes: p } = this.fenetre(filtres);
    const where: Prisma.PaymentWhereInput = {
      ...(scope.shipperId ? { shipperId: scope.shipperId } : {}),
      ...(scope.assignedDriverId ? { driverId: scope.assignedDriverId } : {}),
      collectedAt: p,
    };

    const [parStatut, parMoyen, parJour, ecarts] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { amountExpected: true, amountCollected: true, amountRefunded: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where,
        _count: { _all: true },
        _sum: { amountExpected: true, amountCollected: true, amountRefunded: true },
      }),
      this.joursDeCaisse(where, p),
      this.ecartsDeCaisse(where, p),
    ]);

    const attendu = somme(parStatut.map((l) => l._sum.amountExpected));
    const encaisse = somme(parStatut.map((l) => l._sum.amountCollected));
    const rembourse = somme(parStatut.map((l) => l._sum.amountRefunded));
    const net = encaisse.minus(rembourse);

    // La clé est un texte : le rapport parle par libellés, et les statuts
    // Prisma n'ont pas à fuiter dans la logique de lecture.
    const parCode = new Map<string, (typeof parStatut)[number]>(
      parStatut.map((l) => [l.status as string, l])
    );
    const solde = (code: string): Prisma.Decimal => {
      const ligne = parCode.get(code);
      if (!ligne) return new Prisma.Decimal(0);
      return (ligne._sum.amountCollected ?? new Prisma.Decimal(0)).minus(
        ligne._sum.amountRefunded ?? new Prisma.Decimal(0)
      );
    };

    return {
      ...this.entete(filtres, scope, 'finance'),
      totaux: {
        attendu: argent(attendu),
        encaisse: argent(net),
        manquant: argent(attendu.minus(net)),
        tauxRecouvrement: pourcentDecimal(net, attendu),
        valide: argent(solde('VALIDE')),
        enAttente: argent(solde('EN_ATTENTE')),
        ecart: argent(attendu.minus(net)),
        nbEcarts: ecarts.length,
        nbRejets: parCode.get('ECARTE')?._count._all ?? 0,
      },
      parStatut: parStatut.map((ligne) => ({
        statut: ligne.status,
        libelle: LIBELLE_STATUT_PAIEMENT[ligne.status] ?? ligne.status,
        count: ligne._count._all,
        attendu: argent(ligne._sum.amountExpected),
        encaisse: argent(ligne._sum.amountCollected),
        rembourse: argent(ligne._sum.amountRefunded),
      })),
      parMoyen: parMoyen.map((ligne) => ({
        moyen: ligne.method,
        libelle: LIBELLE_MOYEN_PAIEMENT[ligne.method] ?? ligne.method,
        count: ligne._count._all,
        attendu: argent(ligne._sum.amountExpected),
        encaisse: argent(ligne._sum.amountCollected),
      })),
      ecarts,
      parJour,
    };
  }

  /** L'encours par jour de collecte : la tendance de la caisse. */
  private async joursDeCaisse(
    where: Prisma.PaymentWhereInput,
    p: Periode
  ): Promise<RapportFinance['parJour']> {
    const lignes = await this.prisma.payment.findMany({
      where,
      select: {
        collectedAt: true,
        amountExpected: true,
        amountCollected: true,
        amountRefunded: true,
      },
    });
    const parJour = new Map<string, { attendu: Prisma.Decimal; encaisse: Prisma.Decimal; nb: number }>();
    for (const clef of joursCouverts(p)) {
      parJour.set(clef, { attendu: new Prisma.Decimal(0), encaisse: new Prisma.Decimal(0), nb: 0 });
    }
    for (const ligne of lignes) {
      const clef = jour(ligne.collectedAt);
      const entree =
        parJour.get(clef) ?? { attendu: new Prisma.Decimal(0), encaisse: new Prisma.Decimal(0), nb: 0 };
      entree.attendu = entree.attendu.plus(ligne.amountExpected);
      entree.encaisse = entree.encaisse.plus(ligne.amountCollected).minus(ligne.amountRefunded);
      entree.nb++;
      parJour.set(clef, entree);
    }
    return [...parJour.entries()].map(([clef, v]) => ({
      jour: clef,
      libelle: jourCourt(new Date(`${clef}T00:00:00.000Z`)),
      attendu: argent(v.attendu),
      encaisse: argent(v.encaisse),
      nb: v.nb,
    }));
  }

  /**
   * Les écarts d'encaissement, un par ligne.
   *
   * L'écart se calcule sur une expression — `attendu <> encaissé − remboursé` —
   * que Prisma ne sait pas écrire dans un `where`. La requête est donc
   * écrite, ce qui est plus rapide que de ramener toutes les lignes et de les
   * trier en mémoire.
   */
  private async ecartsDeCaisse(
    where: Prisma.PaymentWhereInput,
    p: Periode
  ): Promise<RapportFinance['ecarts']> {
    // Les fragments sont assemblés par Prisma, qui numérote lui-même les
    // paramètres : écrire `$${n}` à la main produirait des requêtes invalides
    // dès que l'ordre des filtres change.
    const filtres: Prisma.Sql[] = [];
    if (where.shipperId) filtres.push(Prisma.sql`p."shipperId" = ${where.shipperId}`);
    if (where.driverId) filtres.push(Prisma.sql`p."driverId" = ${where.driverId}`);
    if (p.gte) filtres.push(Prisma.sql`p."collectedAt" >= ${p.gte}`);
    if (p.lt) filtres.push(Prisma.sql`p."collectedAt" < ${p.lt}`);
    filtres.push(Prisma.sql`p."amountExpected" <> p."amountCollected" - p."amountRefunded"`);

    const lignes = await this.prisma.$queryRaw<
      Array<{
        id: string;
        paymentNumber: string;
        status: string;
        amountExpected: Prisma.Decimal;
        amountCollected: Prisma.Decimal;
        amountRefunded: Prisma.Decimal;
        ecart: Prisma.Decimal;
        discrepancyReason: string | null;
        collectedAt: Date;
        livreur: string | null;
        expediteur: string;
      }>
    >(Prisma.sql`
      SELECT p.id,
             p."paymentNumber",
             p.status,
             p."amountExpected",
             p."amountCollected",
             p."amountRefunded",
             p."amountExpected" - (p."amountCollected" - p."amountRefunded") AS ecart,
             p."discrepancyReason",
             p."collectedAt",
             u."fullName" AS livreur,
             s."companyName" AS expediteur
      FROM "Payment" p
      LEFT JOIN "Driver" d ON d.id = p."driverId"
      LEFT JOIN "User" u ON u.id = d."userId"
      JOIN "Shipper" s ON s.id = p."shipperId"
      WHERE ${Prisma.join(filtres, ' AND ')}
      ORDER BY ABS(p."amountExpected" - (p."amountCollected" - p."amountRefunded")) DESC
      LIMIT 50
    `);

    return lignes.map((l) => ({
      id: l.id,
      numero: l.paymentNumber,
      livreur: l.livreur ?? '—',
      expediteur: l.expediteur,
      attendu: argent(l.amountExpected),
      encaisse: argent(l.amountCollected),
      ecart: argent(l.ecart),
      statut: l.status,
      motif: l.discrepancyReason,
      collecteLe: instant(l.collectedAt),
    }));
  }

  /**
   * DÉPÔTS — le stock, et ce qui circule.
   *
   * Le « stock actuel » est le stock **d'aujourd'hui**, hors période : c'est la
   * seule lecture qui sert à décider quoi évaluer, et elle ne doit pas changer
   * quand on change la période. Les flux, eux, respectent la période demandée.
   */
  async depots(filtres: FiltresRapport, scope: Scope): Promise<RapportDepots> {
    const { bornes: p } = this.fenetre(filtres);
    const borneDepot = scope.depositId ? scope.depositId : undefined;

    const [depots, stock, stockEnTransfert, flux, transferts, dormants] = await Promise.all([
      this.prisma.deposit.findMany({
        where: borneDepot ? { id: borneDepot } : {},
        select: { id: true, code: true, name: true, city: true, isActive: true, status: true },
        orderBy: { code: 'asc' },
      }),
      // Le stock n'est pas filtré par la période : c'est l'état d'aujourd'hui.
      this.parDepot({ deletedAt: null, currentDepositId: { not: null } }, borneDepot),
      this.parDepot(
        { deletedAt: null, currentDepositId: { not: null }, interDepotTransferId: { not: null } },
        borneDepot
      ),
      this.fluxDepots(p, borneDepot),
      this.prisma.interDepotTransfer.findMany({
        where: {
          ...(borneDepot
            ? { OR: [{ sourceDepositId: borneDepot }, { destinationDepositId: borneDepot }] }
            : {}),
          createdAt: p,
        },
        select: {
          id: true,
          transferNumber: true,
          totalPackages: true,
          receivedPackages: true,
          status: true,
          shippedAt: true,
          receivedAt: true,
          sourceDeposit: { select: { name: true } },
          destinationDeposit: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // Le stock immobile : le plus ancien colis de chaque dépôt, pour savoir
      // depuis combien de temps il dort.
      this.prisma.package.groupBy({
        by: ['currentDepositId'],
        where: {
          deletedAt: null,
          currentDepositId: { not: null },
          ...(borneDepot ? { currentDepositId: borneDepot } : {}),
        },
        _min: { createdAt: true },
        _count: { _all: true },
        _sum: { totalPrice: true },
      }),
    ]);

    const lignesDepot = depots.map((depot) => {
      const fluxDuDepot = flux.get(depot.id) ?? { recus: 0, livres: 0, retournes: 0 };
      return {
        id: depot.id,
        code: depot.code,
        nom: depot.name,
        ville: depot.city,
        actif: depot.isActive && depot.status === 'ACTIF',
        recus: fluxDuDepot.recus,
        livres: fluxDuDepot.livres,
        retournes: fluxDuDepot.retournes,
        stock: stock.get(depot.id)?.count ?? 0,
        enTransfert: stockEnTransfert.get(depot.id)?.count ?? 0,
        enTransit: 0,
      };
    });

    return {
      ...this.entete(filtres, scope, 'depots'),
      totaux: {
        depots: depots.length,
        recus: lignesDepot.reduce((a, d) => a + d.recus, 0),
        livres: lignesDepot.reduce((a, d) => a + d.livres, 0),
        retournes: lignesDepot.reduce((a, d) => a + d.retournes, 0),
        transferes: transferts.filter((t) => t.shippedAt).length,
        recusTransfert: transferts.filter((t) => t.receivedAt).length,
        stockActuel: lignesDepot.reduce((a, d) => a + d.stock, 0),
      },
      depots: lignesDepot,
      transferts: transferts.map((t) => ({
        id: t.id,
        numero: t.transferNumber,
        source: t.sourceDeposit.name,
        destination: t.destinationDeposit.name,
        colisAttendus: t.totalPackages,
        colisRecus: t.receivedPackages,
        ecart: t.receivedAt ? t.totalPackages - t.receivedPackages : 0,
        statut: t.status,
        libelleStatut: LIBELLE_STATUT_TRANSFERT[t.status] ?? t.status,
        expedieLe: t.shippedAt ? jour(t.shippedAt) : null,
        recuLe: t.receivedAt ? jour(t.receivedAt) : null,
      })),
      stockImmobile: dormants
        .filter((d) => d.currentDepositId)
        .map((d) => {
          const depot = depots.find((x) => x.id === d.currentDepositId);
          return {
            depot: depot?.name ?? '—',
            colis: d._count._all,
            plusAncienJours: d._min.createdAt
              ? Math.floor((Date.now() - d._min.createdAt.getTime()) / 86_400_000)
              : 0,
            montant: argent(d._sum.totalPrice),
          };
        })
        .sort((a, b) => b.plusAncienJours - a.plusAncienJours),
    };
  }

  /** Colis par dépôt courant, hors période : c'est l'inventaire d'aujourd'hui. */
  private async parDepot(
    where: Prisma.PackageWhereInput,
    borneDepot: string | undefined
  ): Promise<Map<string, { count: number; montant: Prisma.Decimal }>> {
    const lignes = await this.prisma.package.groupBy({
      by: ['currentDepositId'],
      where: { ...where, ...(borneDepot ? { currentDepositId: borneDepot } : {}) },
      _count: { _all: true },
      _sum: { totalPrice: true },
    });
    return new Map(
      lignes
        .filter((l) => l.currentDepositId)
        .map((l) => [
          l.currentDepositId as string,
          { count: l._count._all, montant: l._sum.totalPrice ?? new Prisma.Decimal(0) },
        ])
    );
  }

  /**
   * Les flux de la période, par dépôt.
   *
   * Les réceptions sont attribuées au dépôt où le colis se trouve aujourd'hui :
   * le schéma ne conserve pas quel dépôt a fait le guichet, et attribuer au
   * dépôt actuel reste plus juste que de compter la réception là où le colis
   * n'est plus.
   */
  private async fluxDepots(
    p: Periode,
    borneDepot: string | undefined
  ): Promise<Map<string, { recus: number; livres: number; retournes: number }>> {
    const vide = () => ({ recus: 0, livres: 0, retournes: 0 });
    const cumul = new Map<string, { recus: number; livres: number; retournes: number }>();
    const ajouter = (clef: string | null, champ: 'recus' | 'livres' | 'retournes', n: number): void => {
      if (!clef) return;
      const entree = cumul.get(clef) ?? vide();
      entree[champ] += n;
      cumul.set(clef, entree);
    };

    const [recus, livres, retournes] = await Promise.all([
      this.prisma.package.groupBy({
        by: ['currentDepositId'],
        where: {
          deletedAt: null,
          receivedAt: p,
          ...(borneDepot ? { currentDepositId: borneDepot } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.package.groupBy({
        by: ['originDepositId'],
        where: {
          deletedAt: null,
          deliveredAt: p,
          ...(borneDepot ? { originDepositId: borneDepot } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.package.groupBy({
        by: ['currentDepositId'],
        where: {
          deletedAt: null,
          status: { in: RETOURNES as never },
          updatedAt: p,
          ...(borneDepot ? { currentDepositId: borneDepot } : {}),
        },
        _count: { _all: true },
      }),
    ]);

    for (const l of recus) ajouter(l.currentDepositId, 'recus', l._count._all);
    for (const l of livres) ajouter(l.originDepositId, 'livres', l._count._all);
    for (const l of retournes) ajouter(l.currentDepositId, 'retournes', l._count._all);
    return cumul;
  }

  /**
   * Les colis créés dans la période, en clair.
   *
   * Le rapport COLIS se lit en agrégats ; l'export, lui, doit permettre de
   * retrouver le colis derrière un chiffre. C'est la même population — les colis
   * créés dans la période — pas une autre.
   */
  async detailColis(
    filtres: FiltresRapport,
    scope: Scope
  ): Promise<Array<Record<string, string | number | null>>> {
    const { bornes: p } = this.fenetre(filtres);
    const extra: Prisma.PackageWhereInput[] = [{ deletedAt: null }];
    if (scope.shipperId) extra.push({ shipperId: scope.shipperId });
    if (scope.assignedDriverId) extra.push({ assignedDriverId: scope.assignedDriverId });
    if (scope.depositId) extra.push({ currentDepositId: scope.depositId });

    const colis = await this.prisma.package.findMany({
      where: { AND: [...extra, { createdAt: p }] },
      select: {
        trackingNumber: true,
        status: true,
        packageType: true,
        pieceCount: true,
        totalPrice: true,
        collectedAmount: true,
        createdAt: true,
        deliveredAt: true,
        shipper: { select: { companyName: true } },
        assignedDriver: { select: { driverCode: true, user: { select: { fullName: true } } } },
        originDeposit: { select: { name: true } },
        currentDeposit: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20_000,
    });

    return colis.map((c) => ({
      tracking: c.trackingNumber,
      expediteur: c.shipper.companyName,
      livreur: c.assignedDriver?.user.fullName ?? '',
      codeLivreur: c.assignedDriver?.driverCode ?? '',
      depotOrigine: c.originDeposit.name,
      depotActuel: c.currentDeposit?.name ?? '',
      statut: LIBELLE_STATUT[c.status] ?? c.status,
      type: c.packageType,
      pieces: c.pieceCount,
      montantDu: argent(c.totalPrice),
      encaisse: argent(c.collectedAmount),
      creeLe: c.createdAt.toISOString(),
      livreLe: c.deliveredAt ? c.deliveredAt.toISOString() : '',
    }));
  }

  /**
   * Les encaissements de la période, ligne par ligne.
   *
   * C'est le grand livre de la caisse sur la période. Les écarts y figurent
   * comme une colonne, avec leur montant, plutôt qucomme une liste à part : la
   * question « quelle ligne ne tombe pas juste » se pose ligne par ligne.
   */
  async detailFinancier(
    filtres: FiltresRapport,
    scope: Scope
  ): Promise<Array<Record<string, string | number | null>>> {
    const { bornes: p } = this.fenetre(filtres);
    const paiements = await this.prisma.payment.findMany({
      where: {
        ...(scope.shipperId ? { shipperId: scope.shipperId } : {}),
        ...(scope.assignedDriverId ? { driverId: scope.assignedDriverId } : {}),
        collectedAt: p,
      },
      select: {
        paymentNumber: true,
        status: true,
        method: true,
        amountExpected: true,
        amountCollected: true,
        amountRefunded: true,
        discrepancyReason: true,
        collectedAt: true,
        validatedAt: true,
        shipper: { select: { companyName: true } },
        driver: { select: { driverCode: true, user: { select: { fullName: true } } } },
        package: { select: { trackingNumber: true } },
      },
      orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
      take: 20_000,
    });

    return paiements.map((paiement) => {
      const net = paiement.amountCollected.minus(paiement.amountRefunded);
      const ecart = paiement.amountExpected.minus(net);
      return {
        numero: paiement.paymentNumber,
        colis: paiement.package?.trackingNumber ?? '',
        expediteur: paiement.shipper.companyName,
        livreur: paiement.driver?.user.fullName ?? '',
        moyen: LIBELLE_MOYEN_PAIEMENT[paiement.method] ?? paiement.method,
        statut: LIBELLE_STATUT_PAIEMENT[paiement.status] ?? paiement.status,
        attendu: argent(paiement.amountExpected),
        encaisse: argent(paiement.amountCollected),
        rembourse: argent(paiement.amountRefunded),
        ecart: argent(ecart),
        motif: paiement.discrepancyReason ?? '',
        collecteLe: paiement.collectedAt.toISOString(),
        valideLe: paiement.validatedAt ? paiement.validatedAt.toISOString() : '',
      };
    });
  }

  /** Renvoie le rapport d'un domaine. Le domaine est connu des routes. */
  async lire(domaine: DomaineRapport, filtres: FiltresRapport, scope: Scope): Promise<Rapport> {
    switch (domaine) {
      case 'colis':
        return this.colis(filtres, scope);
      case 'expediteurs':
        return this.expediteurs(filtres, scope);
      case 'livreurs':
        return this.livreurs(filtres, scope);
      case 'finance':
        return this.finance(filtres, scope);
      case 'depots':
        return this.depots(filtres, scope);
      default:
        return this.colis(filtres, scope);
    }
  }

  /**
   * Journalise la sortie d'un rapport.
   *
   * Un relevé exporté quitte l'application : il faut pouvoir dire qui a sorti
   * quels chiffres, sur quelle période.
   */
  async tracerExport(domaine: DomaineRapport, filtres: FiltresRapport, actor: { id?: string }): Promise<void> {
    await auditService.record({
      entityType: 'REPORT',
      entityId: `REPORT_EXPORT_${domaine}`,
      action: 'EXPORT',
      userId: actor.id ?? null,
      reason: `Export du rapport ${domaine} — période ${
        filtres.from || filtres.to ? `${filtres.from ?? 'début'} → ${filtres.to ?? "aujourd'hui"}` : `${JOURS_PAR_DEFAUT} derniers jours`
      }`,
    });
  }
}

/** Nombre d'éléments vérifiant un prédicat. */
function count<T>(liste: readonly T[], predicat: (element: T) => boolean): number {
  let n = 0;
  for (const element of liste) if (predicat(element)) n++;
  return n;
}

/**
 * Les jours de la période, sans trou.
 *
 * Un histogramme doit porter autant de points que la période en compte jours :
 * un jour sans mouvement est une information — c'est un jour plat.
 */
function joursCouverts(p: Periode): string[] {
  const debut = p.gte ?? new Date(Date.now() - 30 * 86_400_000);
  const fin = p.lt ?? new Date();
  const jours: string[] = [];
  const curseur = new Date(`${jour(debut)}T00:00:00.000Z`);
  const borne = new Date(`${jour(fin)}T00:00:00.000Z`);
  // La borne de 400 jours évite qu'une saisie abusive — une année, dix ans —
  // ne transforme l'écran en traitement de plusieurs milliers de points.
  while (curseur <= borne && jours.length < 400) {
    jours.push(jour(curseur));
    curseur.setUTCDate(curseur.getUTCDate() + 1);
  }
  return jours;
}

/** La série temporelle, prête pour un graphique. */
function serieParJour(
  source: Map<string, { crees: number; livres: number; incidents: number }>,
  p: Periode
): Array<{ jour: string; libelle: string; crees: number; livres: number; incidents: number }> {
  return [...source.entries()].map(([clef, valeurs]) => ({
    jour: clef,
    libelle: jourCourt(new Date(`${clef}T00:00:00.000Z`)),
    ...valeurs,
  }));
}

export const reportsService = new ReportsService();
