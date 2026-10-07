/**
 * Résolution des destinataires d'un événement.
 *
 * C'est ici que se décide qui doit savoir quoi — la décision la plus facile à
 * laisser implicite, et la plus coûteuse quand on s'en aperçoit : notifier tout
 * le monde déforme les chiffres, et ne notifier personne laisse un livreur avec
 * un colis modifié sans qu'il le sache.
 *
 * Trois principes structurent le choix :
 *
 *   1. On ne notifie jamais celui qui vient de faire l'action. L'expéditeur qui
 *      passe son colis de 58 à 65 DT n'a pas besoin d'être prévenu de son propre
 *      geste ; il l'a fait exprès.
 *   2. On ne notifie que ceux qui peuvent agir. Le livreur du colis peut
 *      réorganiser sa tournée ; un autre livreur ne peut rien.
 *   3. Un événement financier atteint toujours la caisse. Un encaissement que
 *      personne n'apprend ne sera jamais validé.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { NotificationEvent } from '@logixpress/types';
import type { RoleType as PrismaRoleType } from '@prisma/client';

/**
 * Groupes de rôles.
 *
 * Les valeurs sont celles de l'énumération `RoleType` de Prisma, celle de la
 * table `Role`. Elles ne coïncident pas avec l'énumération `RoleType` du
 * paquet partagé, qui sert au jeton et aux permissions : d'un côté
 * `SUPER_ADMIN` et `DISPATCHER`, de l'autre `ADMIN` et `GESTIONNAIRE`. Les
 * deux vocabulaires coexistent, et confondre les deux revient à demander
 * des utilisateurs portant un rôle qui n'existe pas — donc à ne notifier
 * personne, sans qu'aucune erreur ne le signale.
 *
 * D'où le nommage explicite ci-dessous : on voit ici quel vocabulaire est
 * employé, sans avoir à remonter jusqu'à l'import.
 */
export const ROLE_GROUP = {
  /** Exploitation : ce qui suit les colis au quotidien. */
  EXPLOITATION: ['SUPER_ADMIN', 'ADMIN_GENERAL', 'DISPATCHER'] as PrismaRoleType[],
  /** Caisse : ce qui compte l'argent. */
  CAISSE: ['SUPER_ADMIN', 'CAISSIER'] as PrismaRoleType[],
  /** Dépôts : ce qui scanne et contrôle la marchandise. */
  DEPOT: ['SUPER_ADMIN', 'MAGASINIER'] as PrismaRoleType[],
} as const;

export interface AudienceContext {
  event: NotificationEvent;

  /** Entité à laquelle la notification se rattache, pour retrouver ses acteurs. */
  packageId?: string | null;
  paymentId?: string | null;
  runsheetId?: string | null;
  pickupAppointmentId?: string | null;
  transferId?: string | null;

  /**
   * Acteur à exclure. Par convention, l'utilisateur qui a provoqué
   * l'événement : il sait déjà, et le notifier revient à lui renvoyer sa
   * propre saisie comme une information nouvelle.
   */
  excludeUserId?: string | null;
}

interface PackageActors {
  driverUserId: string | null;
  shipperUserIds: string[];
}

export class NotificationAudience {
  /** Destinataires par rôle de la table `Role`. */
  private async usersByRole(roles: readonly PrismaRoleType[]): Promise<string[]> {
    const prisma = getPrisma();
    const rows = await prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: { in: [...roles] } } } },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Utilisateurs d'un expéditeur : ses comptes, pas celui d'un concurrent. */
  private async shipperUsers(shipperId: string): Promise<string[]> {
    const prisma = getPrisma();
    const rows = await prisma.shipperUser.findMany({
      where: { shipperId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /**
   * Livreur → utilisateur.
   *
   * Le profil `Driver` porte l'identité professionnelle ; c'est `User` qui
   * porte la session et la boîte de réception. Oublier cette translation est
   * l'erreur la plus fréquente de ce fichier : elle ne lève rien, elle
   * notifie personne.
   */
  private async driverUser(driverId: string | null | undefined): Promise<string | null> {
    if (!driverId) return null;
    const prisma = getPrisma();
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    return driver?.userId ?? null;
  }

  /** Acteurs d'un colis : son livreur s'il en a un, et les comptes de son expéditeur. */
  private async packageActors(packageId: string): Promise<PackageActors> {
    const prisma = getPrisma();
    const pkg = await prisma.package.findUnique({
      where: { id: packageId },
      select: { assignedDriverId: true, shipperId: true },
    });
    if (!pkg) return { driverUserId: null, shipperUserIds: [] };
    const [driverUserId, shipperUserIds] = await Promise.all([
      this.driverUser(pkg.assignedDriverId),
      this.shipperUsers(pkg.shipperId),
    ]);
    return { driverUserId, shipperUserIds };
  }

  /**
   * Destinataires effectifs d'un événement.
   *
   * L'ordre est sans importance : le résultat est dédupliqué avant d'être
   * renvoyé, pour qu'un colis dont le livreur est aussi administrateur ne
   * produise pas deux lignes identiques dans la boîte de réception.
   */
  async recipients(ctx: AudienceContext): Promise<string[]> {
    const found = new Set<string>();
    const add = (...ids: (string | null | undefined)[]) => {
      for (const id of ids) if (id) found.add(id);
    };

    switch (ctx.event) {
      // Un colis déposé concerne l'exploitation, et l'expéditeur veut la preuve
      // que sa saisie est passée. Le livreur n'existe pas encore à ce stade.
      case NotificationEvent.NEW_COLIS_CREATED: {
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        if (ctx.packageId) {
          const actors = await this.packageActors(ctx.packageId);
          add(...actors.shipperUserIds);
        }
        break;
      }

      // Le livreur doit savoir qu'il a du travail en plus.
      case NotificationEvent.COLIS_ASSIGNED:
      case NotificationEvent.RUNSHEET_ASSIGNED: {
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        if (ctx.packageId) {
          add((await this.packageActors(ctx.packageId)).driverUserId);
        }
        if (ctx.runsheetId) {
          add(await this.driverUser(await this.runsheetDriver(ctx.runsheetId)));
        }
        break;
      }

      // Modification du colis : le livreur concerné doit savoir avant de
      // partir. C'est le cas de figure de référence — un montant passé de 58 à
      // 65 DT change ce que le livreur a à demander au client.
      case NotificationEvent.COLIS_MODIFIED:
      case NotificationEvent.AMOUNT_CHANGED:
      case NotificationEvent.QUANTITY_CHANGED: {
        if (ctx.packageId) {
          add((await this.packageActors(ctx.packageId)).driverUserId);
        }
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        break;
      }

      // Ici, l'information remonte : l'expéditeur suit son colis.
      case NotificationEvent.DELIVERY_STATUS_CHANGED:
      case NotificationEvent.DELIVERY_POSTPONED:
      case NotificationEvent.PARTIAL_DELIVERY: {
        if (ctx.packageId) {
          const actors = await this.packageActors(ctx.packageId);
          add(...actors.shipperUserIds);
        }
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        break;
      }

      // Un retour remet de l'argent en jeu : la caisse doit le voir.
      case NotificationEvent.COLIS_RETURNED: {
        if (ctx.packageId) {
          const actors = await this.packageActors(ctx.packageId);
          add(...actors.shipperUserIds, actors.driverUserId);
        }
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        add(...(await this.usersByRole(ROLE_GROUP.CAISSE)));
        break;
      }

      // Encaissement déclaré par un livreur : c'est la caisse qui doit le
      // valider. Le livreur n'a rien à faire tant que la caisse n'a pas tranché.
      case NotificationEvent.PAYMENT_RECEIVED: {
        add(...(await this.usersByRole(ROLE_GROUP.CAISSE)));
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        if (ctx.paymentId) {
          const payment = await this.paymentActors(ctx.paymentId);
          add(...payment.shipperUserIds);
        }
        break;
      }

      // Encaissement validé : l'expéditeur peut régler, le livreur n'a plus rien à faire
      // pour cette tournée.
      case NotificationEvent.PAYMENT_VALIDATED: {
        if (ctx.paymentId) {
          const payment = await this.paymentActors(ctx.paymentId);
          add(...payment.shipperUserIds, payment.driverUserId);
        }
        add(...(await this.usersByRole(ROLE_GROUP.CAISSE)));
        break;
      }

      case NotificationEvent.RAMASSAGE_ASSIGNED: {
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        if (ctx.pickupAppointmentId) {
          const prisma = getPrisma();
          const appointment = await prisma.pickupAppointment.findUnique({
            where: { id: ctx.pickupAppointmentId },
            select: { assignedDriverId: true, shipperId: true },
          });
          if (appointment) {
            add(await this.driverUser(appointment.assignedDriverId));
            add(...(await this.shipperUsers(appointment.shipperId)));
          }
        }
        break;
      }

      // Réception d'un inter-dépôt : le dépôt d'arrivée contrôle, le transporteur
      // est informé que sa tournée est close.
      case NotificationEvent.INTER_DEPOT_RECEIVED: {
        add(...(await this.usersByRole(ROLE_GROUP.DEPOT)));
        add(...(await this.usersByRole(ROLE_GROUP.EXPLOITATION)));
        if (ctx.transferId) {
          const prisma = getPrisma();
          const transfer = await prisma.interDepotTransfer.findUnique({
            where: { id: ctx.transferId },
            select: { transporterDriverId: true, destinationDepositId: true },
          });
          if (transfer) {
            add(await this.driverUser(transfer.transporterDriverId));
            add(...(await this.depositManagers(transfer.destinationDepositId)));
          }
        }
        break;
      }

      default:
        break;
    }

    // L'auteur du geste ne fait pas partie de ses propres destinataires.
    found.delete(ctx.excludeUserId ?? '');

    // Un compte inactif ou supprimé ne doit pas ressortir, même s'il est encore
    // référencé par une affectation.
    if (found.size === 0) return [];
    const prisma = getPrisma();
    const active = await prisma.user.findMany({
      where: { id: { in: [...found] }, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return active.map((u) => u.id);
  }

  private async runsheetDriver(runsheetId: string): Promise<string | null> {
    const prisma = getPrisma();
    const sheet = await prisma.runsheet.findUnique({
      where: { id: runsheetId },
      select: { driverId: true },
    });
    return sheet?.driverId ?? null;
  }

  /** Acteurs d'un encaissement : l'expéditeur concerné et le livreur qui a encaissé. */
  private async paymentActors(paymentId: string): Promise<PackageActors> {
    const prisma = getPrisma();
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { shipperId: true, driverId: true },
    });
    if (!payment) return { driverUserId: null, shipperUserIds: [] };
    return {
      driverUserId: await this.driverUser(payment.driverId),
      shipperUserIds: await this.shipperUsers(payment.shipperId),
    };
  }

  /**
   * Responsable d'un dépôt.
   *
   * `Deposit.managerId` référence directement un `User` — le responsable est
   * le compte qui engage et réceptionne la charge, pas un profil séparé.
   */
  private async depositManagers(depositId: string): Promise<string[]> {
    const prisma = getPrisma();
    const deposit = await prisma.deposit.findUnique({
      where: { id: depositId },
      select: { managerId: true },
    });
    return deposit?.managerId ? [deposit.managerId] : [];
  }
}

export const notificationAudience = new NotificationAudience();