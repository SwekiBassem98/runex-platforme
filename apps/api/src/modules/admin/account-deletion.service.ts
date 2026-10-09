/**
 * Suppression définitive des comptes : utilisateur, livreur, expéditeur.
 *
 * Réservée à l'administration (route : rôle ADMIN). La désactivation reste la
 * voie normale ; la suppression définitive sert à effacer un compte créé par
 * erreur, en double ou de test.
 *
 * Règle unique : on ne supprime que ce qui n'a pas d'historique métier.
 * Un colis, une tournée, un encaissement, un bordereau ou une réception
 * signés par le compte doivent rester lisibles et prouvables — la base les
 * protège d'ailleurs (clés étrangères `Restrict`) ou garde l'identifiant de
 * leur auteur. Tant qu'il en existe, la suppression est refusée et l'aperçu
 * dit pourquoi, chiffres à l'appui ; il reste alors la désactivation.
 *
 * Ce qui part avec le compte : rôles, sessions (déconnexion immédiate),
 * appareils de notification, notifications, zones du livreur, configuration
 * et comptes de l'expéditeur. Ce qui reste : le journal d'audit, immuable,
 * où une entrée *_SUPPRIME garde l'état du compte au moment de la suppression.
 */

import { Prisma, RoleType as RoleSchemaEnum } from '@prisma/client';
import { rendreCodesLisibles } from '@logixpress/types';
import { getPrisma } from '../../common/database/prisma-context';
import { auditService } from '../../common/audit/audit.service';
import { asUuid, badRequest, conflict, notFound } from '../../common/errors/api-error';
import type { ActorRef } from './users.service';

export type TypeCompte = 'USER' | 'DRIVER' | 'SHIPPER';

export interface Obstacle {
  /** Ce qui empêche la suppression, en clair (« 3 tournées »). */
  libelle: string;
  nombre: number;
}

export interface ApercuSuppression {
  type: TypeCompte;
  id: string;
  nom: string;
  detail: string;
  possible: boolean;
  /** Raisons du refus : historique métier, compte de l'administrateur… */
  obstacles: Obstacle[];
  /** Ce qui sera effacé avec le compte. */
  consequences: string[];
}

/** Mot à saisir pour confirmer : la suppression est irréversible. */
export const MOT_CONFIRMATION = 'SUPPRIMER';

const ROLES_ADMIN: RoleSchemaEnum[] = [RoleSchemaEnum.SUPER_ADMIN, RoleSchemaEnum.ADMIN_GENERAL];

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

function pluriel(n: number, un: string, plusieurs: string): string {
  return `${n} ${n > 1 ? plusieurs : un}`;
}

function ajouter(obstacles: Obstacle[], nombre: number, un: string, plusieurs: string) {
  if (nombre > 0) obstacles.push({ nombre, libelle: pluriel(nombre, un, plusieurs) });
}

/** Historique laissé par un compte en tant qu'opérateur (exploitation, caisse, dépôt). */
async function obstaclesOperateur(client: Client, userIds: string[]): Promise<Obstacle[]> {
  if (userIds.length === 0) return [];
  const ids = { in: userIds };
  const [paiements, bordereaux, receptions, clotures, transferts, ajouts, receptionsLot, scans, retours] =
    await Promise.all([
      client.payment.count({ where: { validatedByUserId: ids } }),
      client.paymentVoucher.count({ where: { validatedByUserId: ids } }),
      client.package.count({ where: { receivedByUserId: ids } }),
      client.runsheet.count({ where: { closedByUserId: ids } }),
      client.interDepotTransfer.count({ where: { createdByUserId: ids } }),
      client.interDepotItem.count({ where: { addedByUserId: ids } }),
      client.interDepotItem.count({ where: { receivedByUserId: ids } }),
      client.interDepotPieceScan.count({ where: { scannedByUserId: ids } }),
      client.returnRecord.count({ where: { checkedByUserId: ids } }),
    ]);
  const o: Obstacle[] = [];
  ajouter(o, paiements, 'encaissement validé', 'encaissements validés');
  ajouter(o, bordereaux, 'bordereau validé', 'bordereaux validés');
  ajouter(o, receptions, 'colis réceptionné au dépôt', 'colis réceptionnés au dépôt');
  ajouter(o, clotures, 'tournée clôturée', 'tournées clôturées');
  ajouter(o, transferts, 'inter-dépôt créé', 'inter-dépôts créés');
  ajouter(o, ajouts + receptionsLot + scans, 'pièce inter-dépôt traitée', 'pièces inter-dépôt traitées');
  ajouter(o, retours, 'retour contrôlé', 'retours contrôlés');
  return o;
}

/** Historique d'une fiche livreur. */
async function obstaclesLivreur(client: Client, driverId: string): Promise<Obstacle[]> {
  const [tournees, tentatives, colis, paiements, ramassages, transferts, echanges, retours, partiels] =
    await Promise.all([
      client.runsheet.count({ where: { driverId } }),
      client.deliveryAttempt.count({ where: { driverId } }),
      client.package.count({ where: { assignedDriverId: driverId } }),
      client.payment.count({ where: { driverId } }),
      client.pickupAppointment.count({ where: { assignedDriverId: driverId } }),
      client.interDepotTransfer.count({ where: { transporterDriverId: driverId } }),
      client.exchangeRecord.count({ where: { driverId } }),
      client.returnRecord.count({ where: { driverId } }),
      client.partialDelivery.count({ where: { validatedByDriverId: driverId } }),
    ]);
  const o: Obstacle[] = [];
  ajouter(o, tournees, 'tournée', 'tournées');
  ajouter(o, tentatives, 'tentative de livraison', 'tentatives de livraison');
  ajouter(o, colis, 'colis affecté', 'colis affectés');
  ajouter(o, paiements, 'encaissement', 'encaissements');
  ajouter(o, ramassages, 'ramassage', 'ramassages');
  ajouter(o, transferts, 'inter-dépôt transporté', 'inter-dépôts transportés');
  ajouter(o, echanges + retours + partiels, 'échange ou retour', 'échanges ou retours');
  return o;
}

/** Garde-fous propres au compte qui agit : soi-même, dernier administrateur. */
async function obstaclesCompte(client: Client, userIds: string[], actor: ActorRef): Promise<Obstacle[]> {
  const o: Obstacle[] = [];
  if (actor.id && userIds.includes(actor.id)) {
    o.push({ nombre: 1, libelle: 'il s’agit de votre propre compte' });
  }
  const adminsVises = await client.user.count({
    where: { id: { in: userIds }, userRoles: { some: { role: { name: { in: ROLES_ADMIN } } } } },
  });
  if (adminsVises > 0) {
    const adminsRestants = await client.user.count({
      where: {
        id: { notIn: userIds },
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: { in: ROLES_ADMIN } } } },
      },
    });
    if (adminsRestants === 0) o.push({ nombre: 1, libelle: 'c’est le dernier compte administrateur actif' });
  }
  return o;
}

async function consequencesComptes(client: Client, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const [sessions, notifications, depots] = await Promise.all([
    client.session.count({ where: { userId: { in: userIds }, revokedAt: null } }),
    client.notification.count({ where: { userId: { in: userIds } } }),
    client.deposit.findMany({ where: { managerId: { in: userIds } }, select: { name: true } }),
  ]);
  const c: string[] = [];
  if (sessions > 0) c.push(`${pluriel(sessions, 'session ouverte fermée', 'sessions ouvertes fermées')} (déconnexion immédiate)`);
  if (notifications > 0) c.push(pluriel(notifications, 'notification effacée', 'notifications effacées'));
  for (const d of depots) c.push(`le dépôt « ${d.name} » n’aura plus de responsable`);
  return c;
}

function apercu(base: Omit<ApercuSuppression, 'possible'>): ApercuSuppression {
  return { ...base, possible: base.obstacles.length === 0 };
}

function idValide(id: string, quoi: string): string {
  const uuid = asUuid(id);
  if (!uuid) throw badRequest(`Identifiant ${quoi} invalide.`);
  return uuid;
}

export class AccountDeletionService {
  /* ------------------------------------------------------------------ */
  /* Aperçus                                                             */
  /* ------------------------------------------------------------------ */

  async apercuUtilisateur(id: string, actor: ActorRef, client: Client = getPrisma()): Promise<ApercuSuppression> {
    const uuid = idValide(id, 'utilisateur');
    const user = await client.user.findUnique({
      where: { id: uuid },
      include: {
        userRoles: { include: { role: true } },
        driverProfile: { select: { id: true, driverCode: true } },
        shipperUser: { include: { shipper: { select: { id: true, companyName: true } } } },
      },
    });
    if (!user) throw notFound('Utilisateur introuvable.');

    const obstacles = [
      ...(await obstaclesCompte(client, [uuid], actor)),
      ...(await obstaclesOperateur(client, [uuid])),
      ...(user.driverProfile ? await obstaclesLivreur(client, user.driverProfile.id) : []),
    ];
    const consequences = await consequencesComptes(client, [uuid]);
    if (user.driverProfile) consequences.unshift(`la fiche livreur ${user.driverProfile.driverCode} est supprimée aussi`);
    if (user.shipperUser) {
      const autres = await client.shipperUser.count({
        where: { shipperId: user.shipperUser.shipperId, userId: { not: uuid } },
      });
      consequences.push(
        autres === 0
          ? `l’expéditeur « ${user.shipperUser.shipper.companyName} » n’aura plus aucun compte de connexion`
          : `l’expéditeur « ${user.shipperUser.shipper.companyName} » garde ${pluriel(autres, 'autre compte', 'autres comptes')}`
      );
    }
    const roles = rendreCodesLisibles(user.userRoles.map((r) => r.role.name).join(', '));
    return apercu({
      type: 'USER',
      id: uuid,
      nom: user.fullName,
      detail: `${user.email}${roles ? ` · ${roles}` : ''}`,
      obstacles,
      consequences,
    });
  }

  async apercuLivreur(id: string, actor: ActorRef, client: Client = getPrisma()): Promise<ApercuSuppression> {
    const uuid = idValide(id, 'livreur');
    const driver = await client.driver.findUnique({
      where: { id: uuid },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
    if (!driver) throw notFound('Livreur introuvable.');
    const obstacles = [
      ...(await obstaclesCompte(client, [driver.userId], actor)),
      ...(await obstaclesLivreur(client, uuid)),
      ...(await obstaclesOperateur(client, [driver.userId])),
    ];
    const consequences = [
      `le compte de connexion ${driver.user.email} est supprimé aussi`,
      ...(await consequencesComptes(client, [driver.userId])),
    ];
    return apercu({
      type: 'DRIVER',
      id: uuid,
      nom: driver.user.fullName,
      detail: `${driver.driverCode}${driver.licensePlate ? ` · ${driver.licensePlate}` : ''}`,
      obstacles,
      consequences,
    });
  }

  async apercuExpediteur(id: string, actor: ActorRef, client: Client = getPrisma()): Promise<ApercuSuppression> {
    const uuid = idValide(id, 'expéditeur');
    const shipper = await client.shipper.findUnique({
      where: { id: uuid },
      include: { shipperUsers: { select: { userId: true } } },
    });
    if (!shipper) throw notFound('Expéditeur introuvable.');
    const userIds = shipper.shipperUsers.map((u) => u.userId);
    const [colis, ramassages, bordereaux, paiements] = await Promise.all([
      client.package.count({ where: { shipperId: uuid } }),
      client.pickupAppointment.count({ where: { shipperId: uuid } }),
      client.paymentVoucher.count({ where: { shipperId: uuid } }),
      client.payment.count({ where: { shipperId: uuid } }),
    ]);
    const obstacles: Obstacle[] = [];
    ajouter(obstacles, colis, 'colis', 'colis');
    ajouter(obstacles, ramassages, 'ramassage', 'ramassages');
    ajouter(obstacles, bordereaux, 'bordereau de paiement', 'bordereaux de paiement');
    ajouter(obstacles, paiements, 'encaissement', 'encaissements');
    obstacles.push(...(await obstaclesCompte(client, userIds, actor)), ...(await obstaclesOperateur(client, userIds)));
    const consequences = [
      ...(userIds.length > 0
        ? [`${pluriel(userIds.length, 'compte de connexion supprimé', 'comptes de connexion supprimés')} avec l’entreprise`]
        : []),
      'sa configuration (tarifs, préférences) est effacée',
      ...(await consequencesComptes(client, userIds)),
    ];
    return apercu({
      type: 'SHIPPER',
      id: uuid,
      nom: shipper.companyName,
      detail: `${shipper.code} · ${shipper.email}`,
      obstacles,
      consequences,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Suppressions                                                        */
  /* ------------------------------------------------------------------ */

  async supprimerUtilisateur(id: string, confirmation: unknown, actor: ActorRef): Promise<ApercuSuppression> {
    exigerConfirmation(confirmation);
    return executer(async (tx) => {
      const a = await this.apercuUtilisateur(id, actor, tx);
      refuserSiImpossible(a);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: a.id },
        include: { userRoles: { include: { role: true } }, driverProfile: true, shipperUser: true },
      });
      await auditService.record(
        {
          entityType: 'USER',
          entityId: user.id,
          action: 'USER_SUPPRIME',
          userId: actor.id ?? null,
          reason: `Compte « ${user.fullName} » (${user.email}) supprimé définitivement.`,
          previousValues: {
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            role: user.userRoles[0]?.role.name ?? null,
            roles: user.userRoles.map((r) => r.role.name),
            shipperId: user.shipperUser?.shipperId ?? null,
            driverCode: user.driverProfile?.driverCode ?? null,
            createdAt: user.createdAt.toISOString(),
          },
        },
        tx
      );
      // Rôles, sessions, appareils, notifications, rattachement expéditeur et
      // fiche livreur (avec ses zones) partent en cascade.
      await tx.user.delete({ where: { id: user.id } });
      return a;
    });
  }

  async supprimerLivreur(id: string, confirmation: unknown, actor: ActorRef): Promise<ApercuSuppression> {
    exigerConfirmation(confirmation);
    return executer(async (tx) => {
      const a = await this.apercuLivreur(id, actor, tx);
      refuserSiImpossible(a);
      const driver = await tx.driver.findUniqueOrThrow({
        where: { id: a.id },
        include: { user: { include: { userRoles: { include: { role: true } } } } },
      });
      const instantane = {
        driverCode: driver.driverCode,
        vehicleType: driver.vehicleType,
        licensePlate: driver.licensePlate,
        fullName: driver.user.fullName,
        email: driver.user.email,
        phone: driver.user.phone,
        role: driver.user.userRoles[0]?.role.name ?? 'LIVREUR',
      };
      await auditService.record(
        {
          entityType: 'DRIVER',
          entityId: driver.id,
          action: 'DRIVER_SUPPRIME',
          userId: actor.id ?? null,
          reason: `Livreur ${driver.driverCode} (${driver.user.fullName}) supprimé définitivement.`,
          previousValues: instantane,
        },
        tx
      );
      // Entrée au nom du compte : c'est elle qui garde le nom lisible dans le
      // journal pour les traces que ce livreur a laissées.
      await auditService.record(
        {
          entityType: 'USER',
          entityId: driver.userId,
          action: 'USER_SUPPRIME',
          userId: actor.id ?? null,
          reason: `Compte du livreur ${driver.driverCode} supprimé avec sa fiche.`,
          previousValues: instantane,
        },
        tx
      );
      await tx.user.delete({ where: { id: driver.userId } }); // la fiche suit (cascade)
      return a;
    });
  }

  async supprimerExpediteur(id: string, confirmation: unknown, actor: ActorRef): Promise<ApercuSuppression> {
    exigerConfirmation(confirmation);
    return executer(async (tx) => {
      const a = await this.apercuExpediteur(id, actor, tx);
      refuserSiImpossible(a);
      const shipper = await tx.shipper.findUniqueOrThrow({
        where: { id: a.id },
        include: {
          shipperUsers: { include: { user: { include: { userRoles: { include: { role: true } } } } } },
        },
      });
      await auditService.record(
        {
          entityType: 'SHIPPER',
          entityId: shipper.id,
          action: 'SHIPPER_SUPPRIME',
          userId: actor.id ?? null,
          reason: `Expéditeur « ${shipper.companyName} » (${shipper.code}) supprimé définitivement.`,
          previousValues: {
            code: shipper.code,
            companyName: shipper.companyName,
            email: shipper.email,
            phone: shipper.phone,
            governorate: shipper.governorate,
            comptes: shipper.shipperUsers.map((u) => u.user.email),
          },
        },
        tx
      );
      for (const lien of shipper.shipperUsers) {
        await auditService.record(
          {
            entityType: 'USER',
            entityId: lien.userId,
            action: 'USER_SUPPRIME',
            userId: actor.id ?? null,
            reason: `Compte de l’expéditeur ${shipper.code} supprimé avec l’entreprise.`,
            previousValues: {
              fullName: lien.user.fullName,
              email: lien.user.email,
              role: lien.user.userRoles[0]?.role.name ?? null,
              shipperId: shipper.id,
            },
          },
          tx
        );
      }
      await tx.user.deleteMany({ where: { id: { in: shipper.shipperUsers.map((u) => u.userId) } } });
      await tx.shipper.delete({ where: { id: shipper.id } }); // configuration en cascade
      return a;
    });
  }
}

function exigerConfirmation(confirmation: unknown) {
  if (typeof confirmation !== 'string' || confirmation.trim().toUpperCase() !== MOT_CONFIRMATION) {
    throw badRequest(`Saisissez « ${MOT_CONFIRMATION} » pour confirmer la suppression définitive.`);
  }
}

function refuserSiImpossible(a: ApercuSuppression) {
  if (!a.possible) {
    throw conflict(
      `Suppression impossible : ${a.obstacles.map((o) => o.libelle).join(', ')}. ` +
        'Désactivez plutôt ce compte : son historique reste ainsi consultable.'
    );
  }
}

/**
 * Transaction unique : vérification et suppression lisent le même état. Une
 * contrainte de la base qui refuserait malgré tout (historique apparu entre
 * l'aperçu et le clic, journal d'audit encore relié au compte) devient un 409
 * explicite, jamais une erreur 500.
 */
async function executer<T>(travail: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await getPrisma().$transaction(travail, { timeout: 20_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2014'].includes(error.code)) {
      throw conflict('Suppression impossible : ce compte est encore relié à un historique. Désactivez-le plutôt.');
    }
    const message = error instanceof Error ? error.message : '';
    if (/journal d'audit est immuable|audit_log_immutable/i.test(message)) {
      throw conflict(
        'Suppression impossible : ce compte a laissé des traces dans le journal d’audit et la base n’a pas encore ' +
          'reçu la mise à jour qui le permet (migration 20261014000000). Désactivez-le en attendant.'
      );
    }
    throw error;
  }
}

export const accountDeletionService = new AccountDeletionService();
