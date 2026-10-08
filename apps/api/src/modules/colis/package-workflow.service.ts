/**
 * Service domaine « Machine à états du colis ».
 *
 * C'est le **seul** endroit du backend autorisé à écrire le statut d'un colis.
 * Aucun module ne décide lui-même qu'une transition est possible : il décrit
 * l'événement qu'il constate, et ce service tranche.
 *
 * Trois invariants tiennent ici, et nulle part ailleurs :
 *
 *  1. **Légalité** — la transition figure dans `PACKAGE_STATUS_TRANSITIONS`.
 *     Une transition absente est refusée en 409, avec la liste de ce qui est
 *     possible depuis l'état courant.
 *  2. **Justification** — la transition fournit ce que
 *     `PACKAGE_TRANSITION_REQUIREMENTS` exige : un motif pour un report, un
 *     échec ou un retour ; un motif, deux descriptions et deux montants pour
 *     une livraison partielle. Une transition sans ses preuves est refusée en
 *     400, en disant ce qui manque.
 *  3. **Traçabilité** — le statut, l'événement de chronologie et l'entrée
 *     d'audit sont écrits dans une seule transaction. Un colis et son
 *     historique ne peuvent pas diverger : il n'existe pas d'état dans lequel
 *     le statut a bougé sans que la raison soit écrite.
 *
 * Conséquence recherchée : aucun appelant ne peut fabriquer un statut, et
 * l'interface n'a rien à valider elle-même — elle ne fait qu'afficher les
 * transitions que ce service autorise.
 */

import { Prisma, PackageStatus as PrismaPackageStatus } from '@prisma/client';
import {
  PackageStatus,
  PACKAGE_STATUS_LABELS,
  RoleType,
  allowedNextStatuses,
  canTransition,
  missingTransitionInputs,
  type TransitionInput,
} from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { BusinessRuleError } from '../../common/errors/api-error';

/** Acteur d'une transition. Le livreur est cantonné à ses propres colis. */
export interface TransitionActor {
  id?: string;
  fullName: string;
  role: RoleType;
  driverId?: string;
}

/** Ce que l'appelant constate, et ce qu'il écrit sur la ligne colis. */
export interface TransitionCommand extends TransitionInput {
  /** Colis visé, par identifiant interne. */
  packageId: string;
  /** Statut d'arrivée demandé. */
  to: PackageStatus;
  actor: TransitionActor;
  /** Titre de l'événement de chronologie, par défaut un libellé dérivé. */
  title?: string;
  /** Complément libre de l'événement, distinct du motif. */
  note?: string;
  /** Autres colonnes du colis à mettre à jour dans la même transaction. */
  data?: Prisma.PackageUncheckedUpdateInput;
  /** Rattachement de l'événement à un numéro de tournée ou de transfert. */
  runsheetNumber?: string;
  transferNumber?: string;
  /**
   * Le scan magasin doit rester idempotent face à un double passage : c'est le
   * seul cas où redéclarer le même statut est accepté. Tout le reste est
   * refusé, sans quoi un colis déjà livré pourrait être « livré » à nouveau.
   */
  allowSameStatus?: boolean;
  /**
   * Clé de déduplication.
   *
   * Un scan part en 4G : la requête peut aboutir et perdre sa réponse. Rejouée
   * avec la même clé, elle doit être un no-op. La clé est conservée sur la
   * ligne de chronologie, ce qui laisse retrouver quel traitement a gain.
   */
  idempotencyKey?: string | null;
  /**
   * Action d'audit ; par défaut `PACKAGE_STATUS_<statut>`.
   */
  auditAction?: string;
  /**
   * Client à utiliser pour l'écriture. Fournir la transaction d'un appelant
   * enliste la transition dans cette transaction : c'est ce qui permet à une
   * opération de lot — constitution d'un transfert inter-dépôts, par exemple —
   * de rester atomique sans écrire le statut en dehors du domaine.
   */
  client?: Prisma.TransactionClient;
}

/** Résultat d'une transition appliquée. */
export interface TransitionResult {  from: PackageStatus;
  to: PackageStatus;
  trackingNumber: string;
}

/** Les éléments d'événement que la description sait mettre en forme. */
interface DescribableEvent {
  reason?: string | null;
  note?: string | null;
  deliveredContent?: string | null;
  returnedContent?: string | null;
  collectedAmount?: number | null;
  returnedAmount?: number | null;
}

/** Un acte métier consigné sans changement de statut. */
export interface AnnotateCommand {
  packageId: string;
  actor: TransitionActor;
  /** Intitulé de l'événement, lu tel quel dans la chronologie. */
  title: string;
  /** Action d'audit, ex. `PACKAGE_EXCHANGE`. */
  auditAction: string;
  reason?: string;
  note?: string;
  deliveredContent?: string;
  returnedContent?: string;
  collectedAmount?: number;
  returnedAmount?: number;
  location?: string;
  runsheetNumber?: string;
  /** Détail figé dans l'audit, sous forme d'objet. */
  newValues?: Prisma.InputJsonObject;
  client?: Prisma.TransactionClient;
}

/** Les deux énumérations portent les mêmes valeurs ; TS les voit distinctes. */
function toSharedStatus(status: PrismaPackageStatus): PackageStatus {
  return status as unknown as PackageStatus;
}

function toPrismaStatus(status: PackageStatus): PrismaPackageStatus {
  return status as unknown as PrismaPackageStatus;
}

/** Libellé lisible d'un statut, pour composer un message d'erreur. */
function label(status: PackageStatus): string {
  return PACKAGE_STATUS_LABELS[status] ?? status;
}

export class PackageWorkflowService {
  private get prisma() {
    return getPrisma();
  }

  /**
   * Vérifie qu'une transition serait acceptée, sans rien écrire.
   *
   * Sert aux parcours qui décident en lot — une feuille de tournée qui démarre
   * vingt colis ne doit pas en écrire seize avant de se heurter au dix-septième.
   */
  async check(
    packageId: string,
    to: PackageStatus,
    options: { allowSameStatus?: boolean } = {}
  ): Promise<{ allowed: boolean; reason?: string }> {
    const record = await this.prisma.package.findUnique({
      where: { id: packageId },
      select: { status: true, trackingNumber: true },
    });
    if (!record) return { allowed: false, reason: 'Colis introuvable.' };

    try {
      this.assertTransitionAllowed(record.status, record.trackingNumber, to, options);
      return { allowed: true };
    } catch (error) {
      if (error instanceof BusinessRuleError) {
        return { allowed: false, reason: error.message };
      }
      throw error;
    }
  }

  /**
   * Applique une transition : statut, chronologie et audit, en une transaction.
   */
  async transition(command: TransitionCommand): Promise<TransitionResult> {
    const { packageId, to, actor } = command;
    const location = command.location?.trim() || null;
    const reason = command.reason?.trim() || null;
    const now = new Date();

    // La lecture du statut courant et l'écriture se font dans la MÊME
    // transaction, et l'écriture est conditionnée au statut lu : deux gestes
    // concurrents sur le même colis (double tap, deux postes) ne peuvent pas
    // réussir tous les deux. Le second reçoit un 409 explicite.
    const write = async (tx: Prisma.TransactionClient): Promise<TransitionResult> => {
      const record = await tx.package.findUnique({
        where: { id: packageId },
        select: {
          status: true,
          trackingNumber: true,
          assignedDriverId: true,
          pieceCount: true,
          totalPrice: true,
          deletedAt: true,
        },
      });
      if (!record || record.deletedAt) {
        throw new BusinessRuleError('Colis introuvable.', 404);
      }

      this.assertTransitionAllowed(record.status, record.trackingNumber, to, {
        allowSameStatus: command.allowSameStatus,
      });
      this.assertActorOwnsPackage(record.assignedDriverId, actor);
      this.assertJustified(to, command, record.totalPrice, record.pieceCount);

      const updated = await tx.package.updateMany({
        where: { id: packageId, status: record.status, deletedAt: null },
        data: { ...(command.data as Prisma.PackageUncheckedUpdateManyInput), status: toPrismaStatus(to) },
      });
      if (updated.count !== 1) {
        throw new BusinessRuleError(
          `Le colis #${record.trackingNumber} vient d'être modifié par une autre opération. ` +
            'Rechargez-le avant de recommencer.',
          409
        );
      }
      await tx.packageTimeline.create({
        data: {
          packageId,
          status: toPrismaStatus(to),
          title: command.title ?? `${label(to)} par ${actor.fullName}`,
          description: this.composeDescription(command, reason),
          locationName: location,
          runsheetNumber: command.runsheetNumber ?? null,
          transferNumber: command.transferNumber ?? null,
          operatorName: actor.fullName,
          idempotencyKey: command.idempotencyKey ?? null,
          createdAt: now,
        },
      });
      await auditService.record(
        {
          entityType: 'PACKAGE',
          entityId: packageId,
          action: command.auditAction ?? `PACKAGE_STATUS_${to}`,
          userId: actor.id ?? null,
          reason: this.composeAuditReason(record.trackingNumber, record.status, to, reason, actor),
          previousValues: { status: record.status },
          newValues: this.composeNewValues(command, to, reason),
        },
        tx
      );
      return { from: toSharedStatus(record.status), to, trackingNumber: record.trackingNumber };
    };

    if (command.client) {
      return write(command.client);
    }
    return this.prisma.$transaction(write);
  }

  /**
   * Enregistre un événement qui **ne change pas** le statut du colis.
   *
   * Certaines opérations sont des actes métier sans être des transitions :
   * un échange laisse le colis au même statut alors qu'il engage la
   * marchandise, le client et l'argent. Les écrire à la main — comme c'était
   * le cas pour l'échange — les sortait du champ de l'audit : elles
   * apparaissaient dans la chronologie du colis, et nowhere else.
   *
   * Même atomicité que `transition`, même contrôle de propriété : un livreur
   * ne consigne rien sur le colis d'un autre.
   */
  async annotate(command: AnnotateCommand): Promise<void> {
    const { packageId, actor } = command;

    const record = await this.prisma.package.findUnique({
      where: { id: packageId },
      select: { status: true, trackingNumber: true, assignedDriverId: true },
    });
    if (!record) {
      throw new BusinessRuleError('Colis introuvable.', 404);
    }
    this.assertActorOwnsPackage(record.assignedDriverId, actor);

    const reason = command.reason?.trim() || null;
    const now = new Date();

    const write = async (tx: Prisma.TransactionClient): Promise<void> => {
      await tx.packageTimeline.create({
        data: {
          packageId,
          status: record.status,
          title: command.title,
          description: this.composeDescription(command, reason),
          locationName: command.location?.trim() || null,
          runsheetNumber: command.runsheetNumber ?? null,
          operatorName: actor.fullName,
          createdAt: now,
        },
      });
      await auditService.record(
        {
          entityType: 'PACKAGE',
          entityId: packageId,
          action: command.auditAction,
          userId: actor.id ?? null,
          reason: this.composeAnnotationReason(record.trackingNumber, command, reason, actor),
          previousValues: { status: record.status },
          newValues: {
            status: record.status,
            // Dit explicitement : un audit sans statut d'arrivée se lit
            // comme un oubli d'écriture, pas comme « rien n'a changé ».
            unchanged: true,
            ...(command.newValues ?? {}),
          },
        },
        tx
      );
    };

    if (command.client) {
      await write(command.client);
    } else {
      await this.prisma.$transaction(write);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Règles métier                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Règle 1 — la transition doit exister dans la machine à états.
   */
  private assertTransitionAllowed(
    current: PrismaPackageStatus,
    trackingNumber: string,
    to: PackageStatus,
    options: { allowSameStatus?: boolean } = {}
  ): void {
    const sameStatus = current === to;
    if (sameStatus) {
      if (options.allowSameStatus) return;
      throw new BusinessRuleError(
        `Action impossible : le colis #${trackingNumber} est déjà au statut « ${label(toSharedStatus(current))} ».`,
        409
      );
    }

    if (!canTransition(toSharedStatus(current), to)) {
      const allowed = allowedNextStatuses(toSharedStatus(current));
      throw new BusinessRuleError(
        `Transition interdite : ${label(toSharedStatus(current))} → ${label(to)}. ` +
          (allowed.length > 0
            ? `Transitions possibles depuis « ${label(toSharedStatus(current))} » : ` +
              allowed.map((s) => `« ${label(s)} »`).join(', ') +
              '.'
            : `« ${label(toSharedStatus(current))} » est un état terminal.`),
        409
      );
    }
  }

  /**
   * Règle 2 — un livreur n'agit que sur ses propres colis.
   *
   * Les rôles de bureau interviennent sur l'ensemble du parc ; le livreur est
   * cantonné à ce qui lui est affecté.
   */
  private assertActorOwnsPackage(
    assignedDriverId: string | null,
    actor: TransitionActor
  ): void {
    if (actor.role !== RoleType.LIVREUR) return;
    if (!assignedDriverId || assignedDriverId !== actor.driverId) {
      throw new BusinessRuleError("Ce colis n'est pas affecté à ce livreur.", 403);
    }
  }

  /**
   * Règle 3 — la transition fournit les preuves qu'elle exige.
   *
   * Le refus nomme ce qui manque : « motif manquant » ne permet pas au
   * livreur de corriger sa saisie, la liste des données le fait.
   */
  private assertJustified(
    to: PackageStatus,
    command: TransitionCommand,
    totalPrice: Prisma.Decimal | number,
    pieceCount: number
  ): void {
    const missing = missingTransitionInputs(to, command);
    if (missing.length > 0) {
      throw new BusinessRuleError(
        `Passage au statut « ${label(to)} » refusé : il faut préciser ${this.humanList(missing)}. ` +
          'Une transition sans justification ne serait pas exploitable plus tard.',
        400
      );
    }

    // Contrôles de cohérence : avoir fourni un montant ne suffit pas, il doit
    // tenir. Un montant encaissé supérieur au dû, ou un écart qui ne se referme
    // pas, sont des fautes de saisie qui se paient comptant à la livraison.
    const due = Number(totalPrice);
    const collected = command.collectedAmount;
    const returned = command.returnedAmount;

    if (collected !== undefined && collected !== null && collected < 0) {
      throw new BusinessRuleError('Le montant encaissé ne peut pas être négatif.', 400);
    }
    if (returned !== undefined && returned !== null && returned < 0) {
      throw new BusinessRuleError('Le montant non encaissé ne peut pas être négatif.', 400);
    }
    if (collected !== undefined && collected !== null && collected > due) {
      throw new BusinessRuleError(
        `Le montant encaissé (${collected.toFixed(3)} DT) dépasse le montant dû (${due.toFixed(3)} DT).`,
        400
      );
    }
    if (
      collected !== undefined &&
      collected !== null &&
      returned !== undefined &&
      returned !== null &&
      Math.abs(collected + returned - due) > 0.001
    ) {
      throw new BusinessRuleError(
        `Le bilan financier ne se referme pas : ${collected.toFixed(3)} DT encaissés + ` +
          `${returned.toFixed(3)} DT repris = ${(collected + returned).toFixed(3)} DT, ` +
          `pour un montant dû de ${due.toFixed(3)} DT.`,
        400
      );
    }
    if (to === PackageStatus.LIVRAISON_PARTIELLE && pieceCount <= 1) {
      throw new BusinessRuleError(
        'Une livraison partielle suppose plusieurs pièces : ce colis n’en compte qu’une. ' +
          'Utilisez une livraison complète ou un retour.',
        400
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Mise en forme                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Compose la description de l'événement : motif, montants, note libre.
   *
   * L'ordre est fixe pour que deux événements du même type se lisent de la
   * même façon dans la chronologie.
   */
  private composeDescription(command: DescribableEvent, reason: string | null): string | null {
    const parts: string[] = [];
    if (reason) parts.push(reason);
    if (command.deliveredContent?.trim()) parts.push(`Livré : ${command.deliveredContent.trim()}`);
    if (command.returnedContent?.trim()) parts.push(`Repris : ${command.returnedContent.trim()}`);
    if (command.collectedAmount !== undefined && command.collectedAmount !== null) {
      parts.push(`Encaissé : ${command.collectedAmount.toFixed(3)} DT`);
    }
    if (command.returnedAmount !== undefined && command.returnedAmount !== null) {
      parts.push(`Non encaissé : ${command.returnedAmount.toFixed(3)} DT`);
    }
    if (command.note?.trim()) parts.push(command.note.trim());
    return parts.length > 0 ? parts.join(' — ') : null;
  }

  /**
   * Snapshot d'audit : statut d'arrivée, motif, et les montants lorsqu'ils
   * ont été déclarés. Les clés absentes ne sont pas écrites — un audit qui
   * contient des champs à `null` noie l'information utile.
   */
  private composeNewValues(
    command: TransitionCommand,
    to: PackageStatus,
    reason: string | null
  ): Prisma.InputJsonObject {
    const values: Record<string, Prisma.InputJsonValue> = { status: to };
    if (reason) values.reason = reason;
    if (command.collectedAmount !== undefined && command.collectedAmount !== null) {
      values.collectedAmount = command.collectedAmount;
    }
    if (command.returnedAmount !== undefined && command.returnedAmount !== null) {
      values.returnedAmount = command.returnedAmount;
    }
    return values;
  }

  private composeAuditReason(    trackingNumber: string,
    from: PrismaPackageStatus,
    to: PackageStatus,
    reason: string | null,
    actor: TransitionActor
  ): string {
    const sentence =
      `Colis #${trackingNumber} : ${label(toSharedStatus(from))} → ${label(to)}` +
      (reason ? ` — motif : ${reason}` : '') +
      ` (par ${actor.fullName}).`;
    // `AuditLog.reason` est un VarChar(255) : un motif libre et bavard ne doit
    // pas faire échouer l'écriture de l'audit, qui est justement ce qui
    // conservera le motif intégral.
    return sentence.length > 255 ? `${sentence.slice(0, 252)}...` : sentence;
  }

  /**
   * Phrase d'audit d'un acte sans changement de statut. Elle nomme l'acte,
   * le colis et son auteur : c'est ce que l'on cherchera dans six mois.
   */
  private composeAnnotationReason(
    trackingNumber: string,
    command: AnnotateCommand,
    reason: string | null,
    actor: TransitionActor
  ): string {
    const sentence =
      `Colis #${trackingNumber} : ${command.title}` +
      (reason ? ` — motif : ${reason}` : '') +
      ` (par ${actor.fullName}).`;
    return sentence.length > 255 ? `${sentence.slice(0, 252)}...` : sentence;
  }

  /** « a, b et c » — lisible dans une phrase d'erreur. */  private humanList(items: string[]): string {
    if (items.length === 1) return items[0];
    return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
  }
}

export const packageWorkflowService = new PackageWorkflowService();
