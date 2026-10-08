-- Inter-dépôts « au scan » (bordereau d'abord, colis scannés ensuite, acceptation
-- pièce par pièce), inter-dépôts retours, et routage réel des colis.

-- 1. Types
CREATE TYPE "InterDepotType" AS ENUM ('LIVRAISON', 'RETOUR');
ALTER TYPE "InterDepotStatus" ADD VALUE IF NOT EXISTS 'RECU_PARTIEL';

-- 2. En-tête du bordereau
ALTER TABLE "InterDepotTransfer"
  ADD COLUMN "type" "InterDepotType" NOT NULL DEFAULT 'LIVRAISON',
  ADD COLUMN "vehiclePlate" VARCHAR(30),
  ADD COLUMN "departureAt" TIMESTAMPTZ(6),
  ADD COLUMN "createdByUserId" UUID;
CREATE INDEX "InterDepotTransfer_type_status_idx" ON "InterDepotTransfer"("type", "status");

-- 3. Lignes du bordereau et pièces acceptées
CREATE TABLE "InterDepotItem" (
  "id" UUID NOT NULL,
  "transferId" UUID NOT NULL,
  "packageId" UUID NOT NULL,
  "pieceCount" INTEGER NOT NULL DEFAULT 1,
  "previousStatus" "PackageStatus" NOT NULL,
  "previousDepositId" UUID,
  "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "addedByUserId" UUID,
  "receivedPieces" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMPTZ(6),
  "receivedByUserId" UUID,
  CONSTRAINT "InterDepotItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InterDepotItem_transferId_packageId_key" ON "InterDepotItem"("transferId", "packageId");
CREATE INDEX "InterDepotItem_packageId_idx" ON "InterDepotItem"("packageId");
ALTER TABLE "InterDepotItem" ADD CONSTRAINT "InterDepotItem_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES "InterDepotTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterDepotItem" ADD CONSTRAINT "InterDepotItem_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InterDepotPieceScan" (
  "id" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "pieceNumber" INTEGER NOT NULL,
  "scannedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scannedByUserId" UUID,
  CONSTRAINT "InterDepotPieceScan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InterDepotPieceScan_itemId_pieceNumber_key" ON "InterDepotPieceScan"("itemId", "pieceNumber");
ALTER TABLE "InterDepotPieceScan" ADD CONSTRAINT "InterDepotPieceScan_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InterDepotItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Reprise des transferts existants : une ligne par colis encore rattaché.
INSERT INTO "InterDepotItem" ("id", "transferId", "packageId", "pieceCount", "previousStatus", "previousDepositId", "addedAt")
SELECT gen_random_uuid(), p."interDepotTransferId", p.id, GREATEST(p."pieceCount", 1), 'RECU_DEPOT', t."sourceDepositId", t."createdAt"
FROM "Package" p JOIN "InterDepotTransfer" t ON t.id = p."interDepotTransferId"
ON CONFLICT DO NOTHING;

-- 5. Routage : agence de destination d'après l'adresse du destinataire
--    (zone de livraison, sinon dépôt du même gouvernorat), agence d'origine
--    d'après le gouvernorat de l'expéditeur. Seuls les colis encore rattachés
--    au hub par défaut sont corrigés.
UPDATE "Package" p
SET "destinationDepositId" = r.deposit_id
FROM (
  SELECT p2.id AS package_id,
         COALESCE(
           (SELECT z."depositId" FROM "DeliveryZone" z
             WHERE z."isActive" AND lower(z.governorate) = lower(a.governorate)
               AND lower(z.delegation) = lower(a.delegation) LIMIT 1),
           (SELECT d.id FROM "Deposit" d
             WHERE d."isActive" AND lower(d.governorate) = lower(a.governorate)
             ORDER BY d."isMainHub" DESC LIMIT 1)
         ) AS deposit_id
  FROM "Package" p2 JOIN "CustomerAddress" a ON a.id = p2."customerAddressId"
) r
WHERE p.id = r.package_id AND r.deposit_id IS NOT NULL
  AND p."destinationDepositId" = (SELECT id FROM "Deposit" WHERE "isMainHub" LIMIT 1)
  AND p."destinationDepositId" <> r.deposit_id;

UPDATE "Package" p
SET "originDepositId" = d.id
FROM "Shipper" s, "Deposit" d
WHERE s.id = p."shipperId" AND d."isActive" AND lower(d.governorate) = lower(s.governorate)
  AND p."originDepositId" = (SELECT id FROM "Deposit" WHERE "isMainHub" LIMIT 1)
  AND p."originDepositId" <> d.id;
