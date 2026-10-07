/**
 * Point d'accès unique au client Prisma pour les services métier.
 *
 * Chaque module récupère le client via `getPrisma()`. Cela évite de faire
 * circuler une instance dans toutes les méthodes et rend explicite, dans
 * chaque service, qu'il dépend de la base.
 */

import { PrismaClient } from '@prisma/client';
import { prismaService } from '../../database/prisma.service';

export function getPrisma(): PrismaClient {
  return prismaService.client;
}

export { prismaService };
