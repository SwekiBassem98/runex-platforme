/**
 * Scan d'un colis : du code lu (QR ou code-barres du bon de livraison) au
 * colis correspondant, avec ce que l'utilisateur peut en faire.
 *
 * Conçu pour l'application mobile du livreur, valable pour tout profil :
 *
 *  - livreur : le colis de sa tournée (DELIVERY), ou un colis à ramasser chez
 *    l'expéditeur d'un ramassage qui lui est affecté (PICKUP). Tout autre colis
 *    est refusé (NOT_ASSIGNED) sans en révéler le contenu ;
 *  - expéditeur : ses colis seulement ; ceux des autres sont « inconnus » ;
 *  - agent de dépôt : les colis présents dans son dépôt ou qui y sont attendus ;
 *  - administration : tout colis.
 *
 * Chaque refus porte un code stable (`ScanErrorCode`) que l'application
 * traduit en message et en son, sans analyser le texte.
 */

import {
  PackageStatus,
  PackageType,
  RoleType,
  allowedNextStatuses,
  type ScanAction,
  type ScanErrorCode,
  type ScanRelation,
  type ScanResultDto,
} from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { ApiError } from '../../common/errors/api-error';
import { packageCodeWhere, parsePackageCode } from '../../common/scan/package-code';
import { colisService } from '../colis/colis.service';

export class ScanError extends ApiError {
  readonly code: ScanErrorCode;
  constructor(code: ScanErrorCode, message: string, status: number) {
    super(message, status);
    this.name = 'ScanError';
    this.code = code;
  }
}

export interface ScanActor {
  role: RoleType;
  driverId?: string;
  shipperId?: string;
  depositId?: string;
}

/** Statuts d'un colis encore à collecter chez l'expéditeur. */
const TO_COLLECT: PackageStatus[] = [PackageStatus.CREE, PackageStatus.RAMASSAGE_PROGRAMME, PackageStatus.RAMASSE];
/** Ramassages sur lesquels le livreur peut encore rattacher des colis. */
const OPEN_PICKUP = ['ASSIGNE', 'EN_COURS'] as const;

const ACTION_LABELS: Record<ScanAction['key'], string> = {
  start: 'Démarrer la livraison',
  deliver: 'Livré',
  'partial-delivery': 'Livraison partielle',
  exchange: 'Échange',
  postpone: 'Reporter',
  'failed-attempt': 'Échec de livraison',
  return: 'Retour dépôt',
  'pickup-attach': 'Ajouter au ramassage',
  'pickup-detach': 'Retirer du ramassage',
};

function action(key: ScanAction['key'], path: string, body?: Record<string, unknown>): ScanAction {
  // Le rattachement à un ramassage est une mise à jour (PATCH), comme à l'écran.
  const method = key.startsWith('pickup-') ? 'PATCH' : 'POST';
  return { key, label: ACTION_LABELS[key], method, path, ...(body ? { body } : {}) };
}

/** Actions de livraison ouvertes par la machine à états, pour le livreur ou l'exploitation. */
function deliveryActions(trackingNumber: string, status: PackageStatus, packageType: PackageType): ScanAction[] {
  const next = allowedNextStatuses(status);
  const base = `/colis/${trackingNumber}`;
  const out: ScanAction[] = [];
  if (next.includes(PackageStatus.EN_COURS_LIVRAISON) && status !== PackageStatus.EN_COURS_LIVRAISON) {
    out.push(action('start', `${base}/start`));
  }
  if (next.includes(PackageStatus.LIVRE)) out.push(action('deliver', `${base}/deliver`));
  if (next.includes(PackageStatus.LIVRAISON_PARTIELLE)) out.push(action('partial-delivery', `${base}/partial-delivery`));
  if (
    packageType === PackageType.EXCHANGE &&
    [PackageStatus.AFFECTE_RUNSHEET, PackageStatus.EN_COURS_LIVRAISON, PackageStatus.REPORTE].includes(status)
  ) {
    out.push(action('exchange', `${base}/exchange`));
  }
  if (next.includes(PackageStatus.REPORTE)) out.push(action('postpone', `${base}/postpone`));
  if (next.includes(PackageStatus.ECHEC_LIVRAISON)) out.push(action('failed-attempt', `${base}/failed-attempt`));
  if (next.includes(PackageStatus.RETOUR_DEPOT)) out.push(action('return', `${base}/return`));
  return out;
}

export class ScanService {
  async resolve(input: unknown, actor: ScanActor): Promise<ScanResultDto> {
    const code = parsePackageCode(input);
    if (code.kind === 'malformed') {
      throw new ScanError(
        'INVALID_CODE',
        'Code illisible : ce n’est ni un code-barres de colis, ni un numéro de suivi, ni une étiquette de pièce. Rescannez l’étiquette.',
        400
      );
    }

    const prisma = getPrisma();
    const pkg = await prisma.package.findFirst({
      where: { deletedAt: null, ...packageCodeWhere(code.raw) },
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        packageType: true,
        pieceCount: true,
        shipperId: true,
        assignedDriverId: true,
        currentDepositId: true,
        destinationDepositId: true,
        pickupAppointmentId: true,
      },
    });
    // Un expéditeur ne doit pas pouvoir sonder les colis des autres : même réponse.
    if (!pkg || (actor.role === RoleType.EXPEDITEUR && pkg.shipperId !== actor.shipperId)) {
      throw new ScanError('UNKNOWN_CODE', `Aucun colis ne correspond au code ${code.raw}.`, 404);
    }

    if (code.piece !== null && code.piece > pkg.pieceCount) {
      throw new ScanError(
        'PIECE_NOT_FOUND',
        `Étiquette de la pièce ${code.piece}, mais le colis ${pkg.trackingNumber} n’a que ${pkg.pieceCount} pièce(s). Réimprimez le bon de livraison.`,
        409
      );
    }

    const status = pkg.status as unknown as PackageStatus;
    const packageType = pkg.packageType as unknown as PackageType;
    let relation: ScanRelation;
    let actions: ScanAction[] = [];
    let pickup: ScanResultDto['pickup'];

    switch (actor.role) {
      case RoleType.LIVREUR: {
        if (actor.driverId && pkg.assignedDriverId === actor.driverId) {
          relation = 'DELIVERY';
          actions = deliveryActions(pkg.trackingNumber, status, packageType);
          break;
        }
        const found = actor.driverId ? await this.pickupFor(pkg, actor.driverId) : null;
        if (!found) {
          throw new ScanError(
            'NOT_ASSIGNED',
            'Ce colis ne vous est pas affecté : il n’est ni dans votre tournée, ni à ramasser chez un expéditeur de vos ramassages.',
            403
          );
        }
        relation = 'PICKUP';
        pickup = found;
        const path = `/ramassages/${found.referenceNumber}/packages`;
        actions = found.attached
          ? [action('pickup-detach', path, { detach: [pkg.id] })]
          : [action('pickup-attach', path, { attach: [pkg.id] })];
        break;
      }
      case RoleType.EXPEDITEUR:
        relation = 'SHIPPER';
        break;
      case RoleType.AGENT_DEPOT:
        if (actor.depositId && pkg.currentDepositId !== actor.depositId && pkg.destinationDepositId !== actor.depositId) {
          throw new ScanError('OUT_OF_SCOPE', 'Ce colis n’est ni dans votre dépôt, ni attendu par lui.', 403);
        }
        relation = 'DEPOT';
        break;
      default:
        relation = 'BACK_OFFICE';
        if (actor.role === RoleType.ADMIN || actor.role === RoleType.GESTIONNAIRE) {
          actions = pkg.assignedDriverId ? deliveryActions(pkg.trackingNumber, status, packageType) : [];
        }
    }

    // Accès établi ci-dessus : la fiche complète, hors périmètre de liste
    // (un colis à ramasser n'est pas encore « affecté » au livreur).
    const dto = await colisService.findById(pkg.id);
    if (!dto) throw new ScanError('UNKNOWN_CODE', `Aucun colis ne correspond au code ${code.raw}.`, 404);

    return {
      code: code.raw,
      kind: code.kind,
      piece: code.piece !== null ? { number: code.piece, count: pkg.pieceCount } : null,
      relation,
      ...(pickup ? { pickup } : {}),
      nextStatuses: [...allowedNextStatuses(status)],
      actions,
      package: dto,
    };
  }

  /**
   * Ramassage du livreur auquel ce colis se rattache : celui où il est déjà,
   * sinon le ramassage ouvert du même expéditeur (en cours d'abord).
   */
  private async pickupFor(
    pkg: { id: string; shipperId: string; status: unknown; pickupAppointmentId: string | null },
    driverId: string
  ): Promise<ScanResultDto['pickup'] | null> {
    const prisma = getPrisma();
    if (pkg.pickupAppointmentId) {
      const current = await prisma.pickupAppointment.findUnique({
        where: { id: pkg.pickupAppointmentId },
        select: { referenceNumber: true, status: true, assignedDriverId: true },
      });
      if (current && current.assignedDriverId === driverId) {
        return { referenceNumber: current.referenceNumber, status: current.status, attached: true };
      }
      return null; // rattaché au ramassage d'un autre livreur
    }
    if (!TO_COLLECT.includes(pkg.status as PackageStatus)) return null;
    const open = await prisma.pickupAppointment.findMany({
      where: { shipperId: pkg.shipperId, assignedDriverId: driverId, status: { in: [...OPEN_PICKUP] } },
      select: { referenceNumber: true, status: true, scheduledDate: true },
      orderBy: [{ scheduledDate: 'asc' }],
    });
    const chosen = open.find((p) => p.status === 'EN_COURS') ?? open[0];
    return chosen ? { referenceNumber: chosen.referenceNumber, status: chosen.status, attached: false } : null;
  }
}

export const scanService = new ScanService();
