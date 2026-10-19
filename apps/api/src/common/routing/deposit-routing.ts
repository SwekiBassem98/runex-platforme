/**
 * Routage des colis entre agences.
 *
 * Un colis a deux agences de référence :
 *  - l'agence de **destination**, celle qui livre le destinataire : déduite de
 *    l'adresse (zone de livraison exacte, sinon agence du même gouvernorat) ;
 *  - l'agence d'**origine**, celle de l'expéditeur : c'est vers elle que
 *    repartent ses retours (inter-dépôt retours).
 *
 * À défaut d'agence correspondante, le hub central est retenu : il trie et
 * réoriente. C'est sur ces deux agences que reposent les contrôles de
 * destination de l'inter-dépôt (un colis pour Nabeul ne monte pas dans un
 * bordereau pour Sfax).
 */

import type { Prisma, PrismaClient } from '@prisma/client';

type Client = PrismaClient | Prisma.TransactionClient;

const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();
const sansAccents = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Gouvernorats sans agence propre → agence régionale qui les livre (codes de
 * la migration 20261015000000_agences_regionales). Le hub central (Ben Arous)
 * reste le recours pour tout gouvernorat absent de la table. Ce n'est qu'un
 * défaut : l'agence de livraison se choisit à la création du colis, et une
 * zone peut être rattachée à une autre agence (Administration → Zones).
 */
const AGENCE_REGIONALE: Record<string, string> = {
  ariana: 'DEP-TUNIS-AGT',
  'la manouba': 'DEP-TUNIS-AGT',
  manouba: 'DEP-TUNIS-AGT',
  bizerte: 'DEP-TUNIS-AGT',
  zaghouan: 'DEP-NABEUL-AGT',
  monastir: 'DEP-SOUSSE-AGT',
  mahdia: 'DEP-SOUSSE-AGT',
  kairouan: 'DEP-SOUSSE-AGT',
  beja: 'DEP-SILIANA-AGT',
  jendouba: 'DEP-SILIANA-AGT',
  'le kef': 'DEP-SILIANA-AGT',
  kef: 'DEP-SILIANA-AGT',
  kasserine: 'DEP-GAFSA-AGT',
  'sidi bouzid': 'DEP-GAFSA-AGT',
  tozeur: 'DEP-GAFSA-AGT',
  kebili: 'DEP-GAFSA-AGT',
  gabes: 'DEP-MEDENINE-AGT',
  tataouine: 'DEP-MEDENINE-AGT',
};

export async function mainHubId(client: Client): Promise<string | null> {
  const hub =
    (await client.deposit.findFirst({ where: { isMainHub: true }, select: { id: true } })) ??
    (await client.deposit.findFirst({ select: { id: true } }));
  return hub?.id ?? null;
}

/** Agence qui livre une adresse (gouvernorat + délégation). */
export async function resolveDestinationDepositId(
  client: Client,
  governorate: string | null | undefined,
  delegation?: string | null
): Promise<string | null> {
  const gov = norm(governorate);
  if (gov) {
    if (delegation) {
      const zone = await client.deliveryZone.findFirst({
        where: {
          isActive: true,
          governorate: { equals: String(governorate).trim(), mode: 'insensitive' },
          delegation: { equals: String(delegation).trim(), mode: 'insensitive' },
          deposit: { isActive: true },
        },
        select: { depositId: true },
      });
      if (zone) return zone.depositId;
    }
    // Comparaison sans accents ni casse : « Gabès » et « Gabes » sont la même
    // agence. La table des agences est courte, on la compare en mémoire.
    const agences = await client.deposit.findMany({
      where: { isActive: true },
      orderBy: [{ isMainHub: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, governorate: true },
    });
    const deposit = agences.find((a) => sansAccents(norm(a.governorate)) === sansAccents(gov));
    if (deposit) return deposit.id;
    // Gouvernorat sans agence : l'agence régionale qui le dessert.
    const region = AGENCE_REGIONALE[sansAccents(gov)];
    if (region) {
      const agence = await client.deposit.findFirst({
        where: { isActive: true, code: region },
        select: { id: true },
      });
      if (agence) return agence.id;
    }
  }
  return mainHubId(client);
}

/**
 * Agence proposée pour un expéditeur d'après son gouvernorat — sert de valeur
 * par défaut à la création du dossier. L'agence retenue est ensuite celle
 * enregistrée sur la fiche (`Shipper.depositId`).
 */
export async function resolveShipperDepositId(
  client: Client,
  shipperGovernorate: string | null | undefined
): Promise<string | null> {
  // Zone du hub (Tunis, Ben Arous) : l'expéditeur dépose ou fait ramasser ses
  // colis directement au hub central (Acceptation Magasin).
  if (estZoneHub(shipperGovernorate)) return mainHubId(client);
  return resolveDestinationDepositId(client, shipperGovernorate, null);
}

/**
 * Agence de rattachement d'un expéditeur : celle choisie sur sa fiche, sinon
 * (fiche ancienne ou agence désactivée) celle de son gouvernorat.
 */
export async function agenceRattachementExpediteur(
  client: Client,
  shipper: { depositId?: string | null; governorate?: string | null }
): Promise<string | null> {
  if (shipper.depositId) {
    const agence = await client.deposit.findFirst({
      where: { id: shipper.depositId, isActive: true },
      select: { id: true },
    });
    if (agence) return agence.id;
  }
  return resolveShipperDepositId(client, shipper.governorate);
}

export const sameText = (a: string | null | undefined, b: string | null | undefined) => norm(a) === norm(b);

/**
 * Zone du hub : gouvernorats dont les expéditeurs déposent (ou font ramasser)
 * leurs colis directement au hub central — « Acceptation Magasin ». Les
 * expéditeurs des autres gouvernorats passent par leur agence, et leurs colis
 * arrivent au hub par inter-dépôt ; leurs retours repartent par inter-dépôt
 * retours. Configurable : `HUB_ZONE_GOVERNORATES="Tunis,Ben Arous"`.
 */
const ZONE_HUB = (process.env.HUB_ZONE_GOVERNORATES ?? 'Tunis,Ben Arous')
  .split(',')
  .map((g) => sansAccents(norm(g)))
  .filter(Boolean);

/** Gouvernorats de la zone du hub, tels que saisis (pour les écrans). */
export const GOUVERNORATS_ZONE_HUB = (process.env.HUB_ZONE_GOVERNORATES ?? 'Tunis,Ben Arous')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);

export const LIBELLE_ZONE_HUB = (process.env.HUB_ZONE_GOVERNORATES ?? 'Tunis,Ben Arous')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean)
  .join(' et ');

/** Vrai si le gouvernorat est dans la zone du hub (Tunis, Ben Arous par défaut). */
export function estZoneHub(governorate: string | null | undefined): boolean {
  return ZONE_HUB.includes(sansAccents(norm(governorate)));
}

/**
 * Vrai si l'expéditeur relève de la zone du hub : son agence de rattachement est
 * le hub central (ou une agence de la zone du hub). Sans agence enregistrée, on
 * s'en tient au gouvernorat de la fiche.
 */
export function expediteurZoneHub(shipper: {
  governorate?: string | null;
  deposit?: { isMainHub: boolean; governorate: string | null } | null;
}): boolean {
  if (shipper.deposit) return shipper.deposit.isMainHub || estZoneHub(shipper.deposit.governorate);
  return estZoneHub(shipper.governorate);
}
