/**
 * Recherche opérationnelle transversale.
 *
 * Une seule barre, un seul terme, et cinq familles d'objets possibles. Le
 * service renvoie un résultat par famille plutôt qu'une liste plate : « Karim »
 * désigne peut-être à la fois un client, un livreur et un expéditeur, et
 * l'utilisateur veut savoir lequel il cherche avant de cliquer.
 *
 * Chaque famille est bornée, et les requêtes partent en parallèle. Une
 * recherche sans borne ramènerait des dizaines de milliers de colis et ferait
 * scroller l'écran jusqu'au numéro que l'utilisateur cherchait — l'inverse de
 * l'usage visé.
 */

import { getPrisma } from '../../common/database/prisma-context';
import { PACKAGE_STATUS_LABELS } from '@logixpress/types';

/** Lignes ramenées par famille. Assez pour juger, trop peu pour ralentir. */
const PER_GROUP = 8;

export interface SearchResultDto {
  /** Colis, clients destinataires. */
  colis: {
    id: string;
    trackingNumber: string;
    barcode: string;
    customerName: string;
    customerPhone: string;
    status: string;
    statusLabel: string;
    shipperName: string;
    governorate: string | null;
    totalPrice: string;
    createdAt: string;
  }[];
  /** Expéditeurs, par nom ou code. */
  shippers: { id: string; code: string; companyName: string; packagesCount: number }[];
  /** Livreurs, par nom ou matricule. */
  drivers: { id: string; driverCode: string; fullName: string; phone: string | null; packagesCount: number }[];
  /** Runsheets, par numéro. */
  runsheets: {
    id: string;
    runsheetNumber: string;
    tourDate: string;
    status: string;
    driverName: string | null;
    packagesCount: number;
  }[];
  /** Dépôts, par nom, code ou ville. */
  deposits: { id: string; code: string; name: string; city: string; packagesCount: number }[];
}

/**
 * Longueur minimale d'une recherche.
 *
 * En dessous, chaque lettre déclencherait cinq requêtes sur des millions de
 * lignes pour un résultat que l'utilisateur n'a pas encore fini de taper.
 */
const MIN_LENGTH = 2;

export class SearchService {
  /**
   * Recherche transversale.
   *
   * `scope` isole les familles auxquelles le demandeur a droit : un expéditeur
   * ne voit ni les livreurs ni les dépôts d'autres, même en connaissant un nom.
   * Le résultat reste donc utile — il cherche dans ce qu'il a le droit de voir.
   */
  async search(
    term: string,
    scope: { shipperId?: string; assignedDriverId?: string; depositId?: string } = {}
  ): Promise<SearchResultDto> {
    const prisma = getPrisma();
    const q = term.trim();
    if (q.length < MIN_LENGTH) {
      return { colis: [], shippers: [], drivers: [], runsheets: [], deposits: [] };
    }

    // Un numéro de suivi est souvent saisi avec des séparateurs. On retire la
    // ponctuation une fois pour toutes et on cherche sur les deux formes.
    const bare = q.replace(/[\s-]/g, '');

    const packageWhere = {
      deletedAt: null,
      ...(scope.shipperId ? { shipperId: scope.shipperId } : {}),
      ...(scope.assignedDriverId ? { assignedDriverId: scope.assignedDriverId } : {}),
      ...(scope.depositId ? { currentDepositId: scope.depositId } : {}),
      OR: [
        { trackingNumber: { contains: q, mode: 'insensitive' as const } },
        { trackingNumber: { contains: bare, mode: 'insensitive' as const } },
        { barcode: { contains: q, mode: 'insensitive' as const } },
        { shipperReference: { contains: q, mode: 'insensitive' as const } },
        { customer: { fullName: { contains: q, mode: 'insensitive' as const } } },
        { customer: { primaryPhone: { contains: q } } },
        { customer: { secondaryPhone: { contains: q } } },
      ],
    };

    const [colis, shippers, drivers, runsheets, deposits] = await Promise.all([
      prisma.package.findMany({
        where: packageWhere,
        select: {
          id: true,
          trackingNumber: true,
          barcode: true,
          status: true,
          totalPrice: true,
          createdAt: true,
          customer: { select: { fullName: true, primaryPhone: true } },
          customerAddress: { select: { governorate: true } },
          shipper: { select: { companyName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: PER_GROUP,
      }),
      prisma.shipper.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          OR: [
            { companyName: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
            { brandName: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, code: true, companyName: true, _count: { select: { packages: true } } },
        orderBy: { companyName: 'asc' },
        take: PER_GROUP,
      }),
      prisma.driver.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          // Un livreur ne cherche pas l'annuaire des collègues : sa recherche
          // porte sur ses propres colis, déjà filtrés plus haut.
          ...(scope.assignedDriverId ? { id: scope.assignedDriverId } : {}),
          OR: [
            { driverCode: { contains: q, mode: 'insensitive' } },
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          driverCode: true,
          user: { select: { fullName: true, phone: true } },
          _count: { select: { assignedPackages: true } },
        },
        orderBy: { driverCode: 'asc' },
        take: PER_GROUP,
      }),
      prisma.runsheet.findMany({
        where: {
          runsheetNumber: { contains: q, mode: 'insensitive' },
          ...(scope.assignedDriverId ? { driverId: scope.assignedDriverId } : {}),
        },
        select: {
          id: true,
          runsheetNumber: true,
          tourDate: true,
          status: true,
          totalPackages: true,
          driver: { select: { driverCode: true, user: { select: { fullName: true } } } },
        },
        orderBy: { tourDate: 'desc' },
        take: PER_GROUP,
      }),
      prisma.deposit.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
            { governorate: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, code: true, name: true, city: true, _count: { select: { currentPackages: true } } },
        orderBy: { name: 'asc' },
        take: PER_GROUP,
      }),
    ]);

    return {
      colis: colis.map((p) => ({
        id: p.id,
        trackingNumber: p.trackingNumber,
        barcode: p.barcode,
        customerName: p.customer?.fullName ?? '',
        customerPhone: p.customer?.primaryPhone ?? '',
        status: p.status as string,
        statusLabel: PACKAGE_STATUS_LABELS[p.status] ?? p.status,
        shipperName: p.shipper?.companyName ?? '',
        governorate: p.customerAddress?.governorate ?? null,
        totalPrice: p.totalPrice.toFixed(3),
        createdAt: p.createdAt.toISOString(),
      })),
      shippers: shippers.map((s) => ({
        id: s.id,
        code: s.code,
        companyName: s.companyName,
        packagesCount: s._count.packages,
      })),
      drivers: drivers.map((d) => ({
        id: d.id,
        driverCode: d.driverCode,
        fullName: d.user?.fullName ?? '',
        phone: d.user?.phone ?? null,
        packagesCount: d._count.assignedPackages,
      })),
      runsheets: runsheets.map((r) => ({
        id: r.id,
        runsheetNumber: r.runsheetNumber,
        tourDate: r.tourDate.toISOString(),
        status: r.status as string,
        driverName: r.driver?.user?.fullName ?? null,
        packagesCount: r.totalPackages,
      })),
      deposits: deposits.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        city: d.city,
        packagesCount: d._count.currentPackages,
      })),
    };
  }
}

export const searchService = new SearchService();
