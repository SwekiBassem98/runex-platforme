/**
 * Réception d'un colis en dépôt.
 *
 * Le scan d'entrée est le premier contact physique entre la marchandise et le
 * système. Trois fautes s'y glissent vite, et chacune a été commise :
 *
 *   - **recevoir un code inconnu.** Créer un colis à partir d'un code inconnu
 *     paraîtAussi anodin, il est grave : la réception est le seul moment où
 *     personne ne connaît encore le colis, et un code illisible — étiquette
 *     abîmée, lecteur mal réglé, erreur de saisie — deviendrait un colis
 *     fantôme à 0 DT, au client « Client Comptoir », impossible à facturer ni à
 *     livrer. Ici, un code inconnu est **refusé**, et distingue d'un code mal
 *     formé ;
 *   - **recevoir deux fois le même colis.** Le second passage ne doit pas
 *     laisser croire à une nouvelle entrée, ni réécrire le dépôt d'origine.
 *     Il est signalé comme tel, avec qui l'a reçue et quand ;
 *   - **recevoir dans le mauvais dépôt.** Le dépôt demandé est validé avant
 *     toute écriture : un dépôt inactif ne peut pas devenir la position
 *     courante d'un colis.
 *
 * Chaque réception écrit, dans une seule transaction : la position courante,
 * l'événement de chronologie, et la trace d'audit — avec l'opérateur et
 * l'horodatage. Écrire le statut sans l'événement laisserait un colis « reçu »
 * dont personne ne sait par qui ni quand.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { asUuid } from '../../common/errors/api-error';
import { packageWorkflowService } from '../colis/package-workflow.service';
import {
  classifyScannedCode,
  lookupIdentifiers,
  type ScannedCodeKind,
} from './package-identity';
import { PackageStatus, RoleType, packageStatusLabel } from '@logixpress/types';

/**
 * Statuts depuis lesquels une réception a encore un sens.
 *
 * Un colis livré, annulé ou restitué ne peut pas réapparaître à l'accueil :
 * l'accepter reviendrait à effacer une livraison ou une résiliation, et à
 * remettre l'encaissement en jeu.
 */
const RECEIVABLE_STATUSES: PackageStatus[] = [
  PackageStatus.CREE,
  PackageStatus.RAMASSAGE_PROGRAMME,
  PackageStatus.RAMASSE,
  PackageStatus.RETOUR_DEPOT,
];

/**
 * Motifs de refus.
 *
 * Le client — écran magasin ou application mobile — compare ces valeurs plutôt
 * que des messages rédigés : un texte peut être retraduit, un code ne le peut
 * pas.
 */
export type ReceptionOutcome =
  | 'RECEIVED'
  | 'ALREADY_RECEIVED'
  | 'UNKNOWN_CODE'
  | 'MALFORMED_CODE'
  | 'INVALID_DEPOSIT'
  | 'INVALID_STATE';

export interface ReceptionResult {
  outcome: ReceptionOutcome;
  message: string;
  /** Vrai si le colis a été physiquement accepté par cette requête. */
  accepted: boolean;
  package: ReceptionPreview | null;
  /** Moment de la réception préexistante, si le colis était déjà reçu. */
  receivedAt?: string | null;
  receivedBy?: string | null;
  receivedAtDeposit?: string | null;
}

export interface ReceptionPreview {
  id: string;
  trackingNumber: string;
  barcode: string;
  status: PackageStatus;
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
  /** Vrai si une réception est déjà consignée. */
  alreadyReceived: boolean;
  receivedAt: string | null;
  receivedBy: string | null;
}

export interface ReceptionInput {
  /** Code scanné ou numéro saisi à la main. */
  code: string;
  /** Dépôt d'accueil. À défaut, le dépôt de l'opérateur, puis le hub. */
  depositId?: string | null;
  actor: { id: string; fullName: string; role: RoleType };
  /**
   * Clé d'idempotence.
   *
   * Un téléphone scanne en 4G : la requête peut aboutir côté serveur et perdre
   * sa réponse en chemin. Sans clé, l'opérateur rescane et le colis est reçu
   * deux fois. Avec la même clé, la seconde tentative renvoie le résultat
   * déjà obtenu au lieu d'écrire une seconde réception.
   */
  idempotencyKey?: string | null;
}

export class ReceptionService {
  /**
   * Lecture d'un code, sans rien écrire.
   *
   * Alimente l'écran de prévisualisation et l'application mobile, qui veut
   * savoir si le colis existe et où il en est avant de confirmer.
   */
  async lookup(raw: string, depositId?: string | null): Promise<{
    kind: ScannedCodeKind;
    code: string;
    package: ReceptionPreview | null;
    deposit: { id: string; name: string } | null;
    depositError: string | null;
  }> {
    const code = raw.trim();
    const kind = classifyScannedCode(code);
    const deposit = await this.resolveDeposit(depositId);

    if (kind === 'malformed') {
      return { kind, code, package: null, deposit, depositError: null };
    }

    const record = await this.findByCode(code);
    return {
      kind,
      code,
      package: record ? await this.toPreview(record) : null,
      deposit,
      depositError: deposit ? null : 'Dépôt d\'accueil introuvable ou inactif.',
    };
  }

  /**
   * Réception d'un colis.
   *
   * N'écrit rien avant d'avoir validé le code, le dépôt et le statut. Dans
   * l'ordre, parce que chaque refus a une conséquence différente sur le
   * terrain : un code mal formé est une étiquette, un dépôt invalide est une
   * erreur de configuration, un statut incohérent est un colis qui ne va pas
   * à l'accueil.
   */
  async receive(input: ReceptionInput): Promise<ReceptionResult> {
    const code = input.code?.trim() ?? '';
    const kind = classifyScannedCode(code);

    if (!code) {
      return this.refuse('MALFORMED_CODE', 'Aucun code à lire.', null);
    }

    if (kind === 'malformed') {
      // Un code de longueur correcte mais de clé fausse est le cas le plus
      // vivant : une étiquette froissée. Le dire précisément oriente
      // l'opérateur vers le bon réflexe — resscanner, pas chercher un colis.
      return this.refuse(
        'MALFORMED_CODE',
        `Code « ${code} » illisible : ce n'est ni un code-barres valide ni un numéro de colis.`,
        null
      );
    }

    const deposit = await this.resolveDeposit(input.depositId);
    if (!deposit) {
      return this.refuse(
        'INVALID_DEPOSIT',
        'Dépôt d\'accueil introuvable ou inactif. La réception est refusée.',
        null
      );
    }

    const record = await this.findByCode(code);
    if (!record) {
      return this.refuse(
        'UNKNOWN_CODE',
        `Aucun colis ne porte le code « ${code} ». Vérifiez l'étiquette, ou saisissez le numéro de colis.`,
        null
      );
    }

    // Idempotence : la même clé, le même résultat — sans réécrire.
    if (input.idempotencyKey) {
      const deja = await this.findIdempotentReception(record.id, input.idempotencyKey);
      if (deja) {
        return {
          outcome: 'RECEIVED',
          accepted: true,
          message: 'Réception déjà enregistrée pour cette session.',
          package: await this.toPreview(record),
          receivedAt: deja.createdAt.toISOString(),
          receivedBy: deja.operatorName,
          receivedAtDeposit: deposit.name,
        };
      }
    }

    // Déjà reçu au dépôt : signalé, jamais réécrit. Réceptionner deux fois
    // déplacerait `originDepositId` lors d'un passage inter-dépôts et
    // réécrirait une entrée qui a bien eu lieu.
    if (record.status === PackageStatus.RECU_DEPOT) {
      const previous = await this.lastReceptionEvent(record.id);
      return {
        outcome: 'ALREADY_RECEIVED',
        accepted: false,
        message: previous
          ? `Déjà reçu le ${previous.createdAt.toLocaleString('fr-TN')} par ${previous.operatorName}. Rien n'a été modifié.`
          : 'Ce colis a déjà été reçu en dépôt. Rien n\'a été modifié.',
        package: await this.toPreview(record),
        receivedAt: previous?.createdAt.toISOString() ?? null,
        receivedBy: previous?.operatorName ?? null,
        receivedAtDeposit: record.currentDeposit?.name ?? null,
      };
    }

    if (!RECEIVABLE_STATUSES.includes(record.status as PackageStatus)) {
      return {
        outcome: 'INVALID_STATE',
        accepted: false,
        message:
          `Ce colis est « ${packageStatusLabel(record.status)} » : il n'a pas sa place à l'accueil. ` +
          'Seuls les colis déclarés, ramassés ou revenue au dépôt peuvent être reçus.',
        package: await this.toPreview(record),
        receivedAtDeposit: deposit.name,
      };
    }

    // Réception : position courante, chronologie et audit, en une transaction.
    await packageWorkflowService.transition({
      packageId: record.id,
      to: PackageStatus.RECU_DEPOT,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        role: input.actor.role ?? RoleType.AGENT_DEPOT,
      },
      title: 'Colis accepté au dépôt',
      note: `Scan « ${code} » reçu à ${deposit.name}`,
      reason: `Réception en dépôt ${deposit.name}`,
      location: deposit.name,
      auditAction: 'PACKAGE_RECEIVED_AT_DEPOT',
      data: {
        currentDepositId: deposit.id,
        receivedAt: new Date(),
        receivedByUserId: input.actor.id,
        receivedByName: input.actor.fullName,
      },
      idempotencyKey: input.idempotencyKey ?? null,
    });

    // La réception renvoie l'état réellement écrit, relu après la transaction :
    // la réponse doit décrire ce qui est en base, pas ce qui était prévu.
    const recu = await this.findByCode(record.trackingNumber);

    return {
      outcome: 'RECEIVED',
      accepted: true,
      message: `Colis ${record.trackingNumber} reçu à ${deposit.name}.`,
      package: recu ? await this.toPreview(recu) : null,
      receivedAt: new Date().toISOString(),
      receivedBy: input.actor.fullName,
      receivedAtDeposit: deposit.name,
    };
  }

  /** Dépôts actifs, pour alimenter le sélecteur de l'écran. */
  async listDepots() {
    const rows = await this.prisma().deposit.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, city: true, isMainHub: true },
      orderBy: [{ isMainHub: 'desc' }, { name: 'asc' }],
    });
    return rows;
  }

  /**
   * Réceptions récentes du dépôt.
   *
   * Alimenté par la chronologie des colis, pas par la liste des colis : un
   * colis reçu il y a trois jours est plus vieux que les trois derniers
   * pointages, et l'écran doit montrer ce qui vient de passer devant la
   * balance.
   */
  async recentReceptions(depositId?: string | null, limit = 20) {
    // La chronologie porte le *nom* du dépôt. Filtrer directement sur
    // l'identifiant ne retiendrait jamais rien.
    const depot = await this.resolveDeposit(depositId);
    const locationName = depot?.name;

    const rows = await this.prisma().packageTimeline.findMany({
      where: {
        title: 'Colis accepté au dépôt',
        ...(locationName ? { locationName } : {}),
      },
      select: {
        id: true,
        createdAt: true,
        operatorName: true,
        locationName: true,
        package: {
          select: {
            id: true,
            trackingNumber: true,
            status: true,
            customer: { select: { fullName: true } },
            shipper: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
        id: row.id,
        receivedAt: row.createdAt.toISOString(),
        operatorName: row.operatorName,
        locationName: row.locationName,
        packageId: row.package.id,
        trackingNumber: row.package.trackingNumber,
        status: row.package.status as string,
      customerName: row.package.customer?.fullName ?? '',
      shipperName: row.package.shipper?.companyName ?? '',
    }));
  }

  private refuse(outcome: ReceptionOutcome, message: string, pkg: ReceptionPreview | null): ReceptionResult {
    return { outcome, accepted: false, message, package: pkg };
  }

  private prisma() {
    return getPrisma();
  }

  /** Résout le dépôt d'accueil : demandé, puis celui de l'opérateur, puis le hub. */
  private async resolveDeposit(depositId?: string | null) {
    const prisma = this.prisma();
    const uuid = depositId ? asUuid(depositId) : null;

    // Un identifiant présent mais malformé est une erreur de configuration
    // explicite : on ne se rabat pas silencieusement sur le hub, ce qui
    // enverrait les colis au mauvais endroit.
    if (depositId && !uuid) return null;

    const row = uuid
      ? await prisma.deposit.findFirst({ where: { id: uuid, isActive: true }, select: { id: true, name: true } })
      : await prisma.deposit.findFirst({
          where: { isActive: true, isMainHub: true },
          select: { id: true, name: true },
        });

    return row;
  }

  private async findByCode(code: string) {
    const identifiers = lookupIdentifiers(code);
    return this.prisma().package.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { barcode: identifiers.barcode ?? '__none__' },
          { trackingNumber: identifiers.trackingNumber ?? '__none__' },
        ],
      },
      select: {
        id: true,
        trackingNumber: true,
        barcode: true,
        status: true,
        packageType: true,
        pieceCount: true,
        totalPrice: true,
        currentDepositId: true,
        customer: { select: { fullName: true, primaryPhone: true } },
        customerAddress: { select: { governorate: true, delegation: true } },
        shipper: { select: { companyName: true } },
        currentDeposit: { select: { name: true } },
      },
    });
  }

  private async lastReceptionEvent(packageId: string) {
    return this.prisma().packageTimeline.findFirst({
      where: { packageId, title: 'Colis accepté au dépôt' },
      select: { createdAt: true, operatorName: true, locationName: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findIdempotentReception(packageId: string, key: string) {
    return this.prisma().packageTimeline.findFirst({
      where: { packageId, title: 'Colis accepté au dépôt', idempotencyKey: key },
      select: { createdAt: true, operatorName: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async toPreview(record: NonNullable<Awaited<ReturnType<ReceptionService['findByCode']>>>): Promise<ReceptionPreview> {
    const previous = record.status === PackageStatus.RECU_DEPOT
      ? await this.lastReceptionEvent(record.id)
      : null;

    return {
      id: record.id,
      trackingNumber: record.trackingNumber,
      barcode: record.barcode,
      status: record.status as string as PackageStatus,
      statusLabel: packageStatusLabel(record.status as PackageStatus),
      customerName: record.customer?.fullName ?? '',
      customerPhone: record.customer?.primaryPhone ?? '',
      shipperName: record.shipper?.companyName ?? '',
      governorate: record.customerAddress?.governorate ?? '',
      city: record.customerAddress?.delegation ?? '',
      pieceCount: record.pieceCount,
      totalPrice: record.totalPrice.toFixed(3),
      packageType: record.packageType as string,
      currentDepositId: record.currentDepositId,
      currentDepositName: record.currentDeposit?.name ?? null,
      alreadyReceived: record.status === PackageStatus.RECU_DEPOT,
      receivedAt: previous?.createdAt.toISOString() ?? null,
      receivedBy: previous?.operatorName ?? null,
    };
  }
}

export const receptionService = new ReceptionService();
