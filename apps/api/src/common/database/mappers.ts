/**
 * Conversion des enregistrements Prisma vers les DTO partagés.
 *
 * Le schéma relationnel est normalisé (un client, une adresse, un dépôt…) alors
 * que les DTO de `@logixpress/types` sont des objets plats, tels que le
 * frontend les consomme. Toute la traduction est centralisée ici pour que les
 * modules ne dup---|quent pas la logique d'hydratation.
 */

import { Prisma } from '@prisma/client';
import type { PackageDto, TrackingTimelineEvent, DeliveryAttempt } from '@logixpress/types';
import { PackageStatus as SharedStatus } from '@logixpress/types';

/**
 * Relations chargées pour hydrater un colis.
 *
 * Exporté afin que les modules qui imbriquent un colis dans leur propre
 * requête (éléments de tournée, transferts) réutilisent exactement le même
 * jeu de relations, sans risquer de diverger de `toPackageDto`.
 */
export const PACKAGE_INCLUDE = {
  customer: true,
  customerAddress: { include: { zone: { select: { id: true, name: true } } } },
  shipper: true,
  assignedDriver: { include: { user: true } },
  currentDeposit: true,
  originDeposit: { select: { id: true, name: true } },
  destinationDeposit: { select: { id: true, name: true } },
  interDepotTransfer: { select: { transferNumber: true } },
  currentRunsheet: true,
  // Les trois pièces à conviction d'une livraison : sans elles, le frontend
  // ne peut afficher que le statut, et l'agent au dépôt n'a aucun moyen de
  // vérifier ce qu'il a reçu.
  partialDelivery: true,
  exchangeRecord: { include: { driver: { include: { user: true } } } },
  returns: {
    orderBy: { createdAt: 'desc' as const },
    include: { returnDeposit: true },
  },
  statusHistory: { orderBy: { createdAt: 'desc' as const } },
  deliveryAttempts: {
    orderBy: { attemptedAt: 'desc' as const },
    include: { driver: { include: { user: true } } },
  },
} as const;

/** Types Prisma enrichis des relations nécessaires à l'hydratation d'un colis. */
export type PackageWithRelations = Prisma.PackageGetPayload<{
  include: typeof PACKAGE_INCLUDE;
}>;

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

/** Timeline : la source de vérité de l'historique d'un colis. */
function mapTimeline(events: PackageWithRelations['statusHistory']): TrackingTimelineEvent[] {
  return events.map((event) => ({
    timestamp: event.createdAt.toISOString(),
    status: event.status as unknown as SharedStatus,
    label: event.title,
    location: event.locationName ?? '',
    actor: event.operatorName,
    notes: event.description ?? undefined,
  }));
}

/** Tentatives de livraison, triées de la plus récente à la plus ancienne. */
/**
 * Projette les tentatives de livraison.
 *
 * `reasonCode` et `callDurationSeconds` sont exposés tels qu'enregistrés :
 * le premier permet de mesurer un taux d'échec par motif, le second de
 * distinguer un client réellement joint d'un simple passage au domicile.
 */
function mapAttempts(
  attempts: PackageWithRelations['deliveryAttempts']
): DeliveryAttempt[] {
  return attempts.map((attempt) => ({
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    timestamp: attempt.attemptedAt.toISOString(),
    driverName: attempt.driver.user.fullName,
    status: attempt.result as unknown as DeliveryAttempt['status'],
    reasonCode: (attempt.reasonCode as DeliveryAttempt['reasonCode']) ?? undefined,
    callDurationSeconds: attempt.callDurationSeconds ?? undefined,
    customerNote: attempt.customerNote ?? undefined,
    rescheduledFor: attempt.rescheduledFor?.toISOString(),
    customerContacted: attempt.callDurationSeconds !== null && attempt.callDurationSeconds > 0,
    notes: attempt.driverComment ?? undefined,
  }));
}

/**
 * Construit le DTO d'un colis à partir de l'enregistrement Prisma et de ses
 * relations. Les montants `Decimal` sont convertis en `number` : le frontend
 * les manipule comme des nombres.
 */
export function toPackageDto(record: PackageWithRelations): PackageDto {
  const address = record.customerAddress;
  return {
    id: record.id,
    trackingNumber: record.trackingNumber,
    barcode: record.barcode,
    customerName: record.customer.fullName,
    customerPhone: record.customer.primaryPhone,
    governorate: address.governorate,
    delegation: address.delegation,
    zoneId: address.zone?.id ?? undefined,
    zoneName: address.zone?.name ?? undefined,
    address: address.streetAddress,
    packageType: record.packageType as unknown as PackageDto['packageType'],
    status: record.status as unknown as PackageDto['status'],
    sizeCategory: record.sizeCategory as unknown as PackageDto['sizeCategory'],
    pieceCount: record.pieceCount,
    contentSummary: record.contentSummary,
    allowOpen: record.allowOpen,
    isFragile: record.isFragile,
    totalPrice: toNumber(record.totalPrice),
    collectedAmount: toNumber(record.collectedAmount),
    deliveryFee: toNumber(record.deliveryFee),
    shipperId: record.shipperId,
    shipperName: record.shipper.brandName ?? record.shipper.companyName,
    assignedDriverId: record.assignedDriverId ?? undefined,
    assignedDriverName: record.assignedDriver?.user.fullName,
    runsheetNumber: record.currentRunsheet?.runsheetNumber,
    runsheetId: record.currentRunsheetId ?? undefined,
    expectedDeliveryDate: record.scheduledDeliveryDate?.toISOString(),
    driverNote: record.driverNotes ?? undefined,
    currentLocation: record.currentDeposit
      ? record.currentDeposit.name
      : record.interDepotTransfer
        ? `En transfert ${record.interDepotTransfer.transferNumber}`
        : 'En transit',
    currentDepositId: record.currentDepositId ?? undefined,
    currentDepositName: record.currentDeposit?.name,
    originDepositId: record.originDepositId,
    originDepositName: record.originDeposit?.name,
    destinationDepositId: record.destinationDepositId,
    destinationDepositName: record.destinationDeposit?.name,
    transferNumber: record.interDepotTransfer?.transferNumber,
    notes: record.shipperNotes ?? undefined,
    deliveredPieces:
      record.status === SharedStatus.LIVRE ? record.pieceCount : undefined,
    partialDelivery: record.partialDelivery
      ? {
          deliveredDescription: record.partialDelivery.deliveredDescription,
          returnedDescription: record.partialDelivery.returnedDescription,
          deliveredPieces: record.partialDelivery.deliveredPieces,
          returnedPieces: record.partialDelivery.returnedPieces,
          originalAmount: toNumber(record.partialDelivery.originalAmount),
          amountCollected: toNumber(record.partialDelivery.amountCollected),
          amountReturned: toNumber(record.partialDelivery.amountReturned),
          reason: record.partialDelivery.reason,
          driverId: record.partialDelivery.validatedByDriverId,
          validatedAt: record.partialDelivery.validatedAt.toISOString(),
        }
      : undefined,
    returns: record.returns.map((entry) => ({
      id: entry.id,
      returnNumber: entry.returnNumber,
      reason: entry.reason,
      returnedItems: entry.returnedItems ?? undefined,
      returnedQuantity: entry.returnedQuantity ?? undefined,
      amount: entry.amount !== null ? toNumber(entry.amount) : undefined,
      returnDepositId: entry.returnDepositId,
      returnDepositName: entry.returnDeposit.name,
      driverId: entry.driverId ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    })),
    exchange: record.exchangeRecord
      ? {
          id: record.exchangeRecord.id,
          packageId: record.exchangeRecord.packageId,
          oldPackageBarcode: record.exchangeRecord.oldPackageBarcode,
          returnedItemSummary: record.exchangeRecord.returnedItemSummary,
          newPackageBarcode: record.exchangeRecord.newPackageBarcode,
          financialDifference:
            record.exchangeRecord.financialDifference !== null
              ? toNumber(record.exchangeRecord.financialDifference)
              : undefined,
          driverId: record.exchangeRecord.driverId ?? undefined,
          driverName: record.exchangeRecord.driver?.user.fullName,
          createdAt: record.exchangeRecord.createdAt.toISOString(),
        }
      : undefined,
    trackingTimeline: mapTimeline(record.statusHistory),
    deliveryAttempts: mapAttempts(record.deliveryAttempts),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
