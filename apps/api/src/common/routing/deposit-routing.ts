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
