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
  bizerte: 'DEP-TUNIS-AGT',
  zaghouan: 'DEP-NABEUL-AGT',
  monastir: 'DEP-SOUSSE-AGT',
  mahdia: 'DEP-SOUSSE-AGT',
  kairouan: 'DEP-SOUSSE-AGT',
  beja: 'DEP-SILIANA-AGT',
  jendouba: 'DEP-SILIANA-AGT',
  'le kef': 'DEP-SILIANA-AGT',
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
    const deposit = await client.deposit.findFirst({
      where: { isActive: true, governorate: { equals: String(governorate).trim(), mode: 'insensitive' } },
      orderBy: { isMainHub: 'desc' },
      select: { id: true },
    });
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

/** Agence de rattachement d'un expéditeur (d'après son gouvernorat). */
export async function resolveShipperDepositId(
  client: Client,
  shipperGovernorate: string | null | undefined
): Promise<string | null> {
  return resolveDestinationDepositId(client, shipperGovernorate, null);
}

export const sameText = (a: string | null | undefined, b: string | null | undefined) => norm(a) === norm(b);
