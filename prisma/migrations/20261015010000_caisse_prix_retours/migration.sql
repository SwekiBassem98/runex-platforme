-- Retours client (octobre 2026) : rémunération des livreurs, changements de
-- prix soumis à approbation, bons de retour expéditeur, code de retrait des
-- bordereaux de paiement.

-- Enums
CREATE TYPE "PriceChangeStatus" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REFUSEE');
CREATE TYPE "ReturnSlipStatus" AS ENUM ('PREPARE', 'REMIS', 'ANNULE');

-- Paiements des livreurs
CREATE TABLE "DriverPayout" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "driverId" UUID NOT NULL,
    "amount" DECIMAL(10,3) NOT NULL,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "pickupCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" DATE,
    "periodEnd" DATE,
    "note" VARCHAR(255),
    "paidByUserId" UUID,
    "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriverPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriverPayout_reference_key" ON "DriverPayout"("reference");
CREATE INDEX "DriverPayout_driverId_idx" ON "DriverPayout"("driverId");
CREATE INDEX "DriverPayout_paidAt_idx" ON "DriverPayout"("paidAt");
ALTER TABLE "DriverPayout" ADD CONSTRAINT "DriverPayout_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Demandes de changement de prix
CREATE TABLE "PriceChangeRequest" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "status" "PriceChangeStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "previousGoodsPrice" DECIMAL(10,3) NOT NULL,
    "previousTotal" DECIMAL(10,3) NOT NULL,
    "newGoodsPrice" DECIMAL(10,3) NOT NULL,
    "newTotal" DECIMAL(10,3) NOT NULL,
    "reason" VARCHAR(255),
    "requestedByUserId" UUID,
    "decidedByUserId" UUID,
    "decisionNote" VARCHAR(255),
    "decidedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PriceChangeRequest_packageId_idx" ON "PriceChangeRequest"("packageId");
CREATE INDEX "PriceChangeRequest_status_idx" ON "PriceChangeRequest"("status");
ALTER TABLE "PriceChangeRequest" ADD CONSTRAINT "PriceChangeRequest_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Une seule demande en attente par colis.
CREATE UNIQUE INDEX "PriceChangeRequest_one_pending" ON "PriceChangeRequest"("packageId") WHERE "status" = 'EN_ATTENTE';

-- Bons de retour expéditeur
CREATE TABLE "ReturnSlip" (
    "id" UUID NOT NULL,
    "slipNumber" VARCHAR(40) NOT NULL,
    "shipperId" UUID NOT NULL,
    "status" "ReturnSlipStatus" NOT NULL DEFAULT 'PREPARE',
    "handoverCode" VARCHAR(12) NOT NULL,
    "packagesCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID,
    "handedOverAt" TIMESTAMPTZ(6),
    "handedOverById" UUID,
    "receiverName" VARCHAR(150),
    "notes" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ReturnSlip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReturnSlip_slipNumber_key" ON "ReturnSlip"("slipNumber");
CREATE INDEX "ReturnSlip_shipperId_idx" ON "ReturnSlip"("shipperId");
CREATE INDEX "ReturnSlip_status_idx" ON "ReturnSlip"("status");
ALTER TABLE "ReturnSlip" ADD CONSTRAINT "ReturnSlip_shipperId_fkey"
  FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "returnSlipId" UUID;
CREATE INDEX IF NOT EXISTS "Package_returnSlipId_idx" ON "Package"("returnSlipId");
ALTER TABLE "Package" ADD CONSTRAINT "Package_returnSlipId_fkey"
  FOREIGN KEY ("returnSlipId") REFERENCES "ReturnSlip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Code de retrait des bordereaux de paiement (les bordereaux non réglés
-- existants en reçoivent un).
ALTER TABLE "PaymentVoucher" ADD COLUMN IF NOT EXISTS "withdrawalCode" VARCHAR(12);
UPDATE "PaymentVoucher"
SET "withdrawalCode" = lpad((floor(random() * 1000000))::int::text, 6, '0')
WHERE "withdrawalCode" IS NULL AND status <> 'PAYE';

-- Le rôle applicatif (Neon : runex_app) reçoit les droits sur les nouvelles
-- tables s'il existe (sinon, scripts/neon-app-role.sql les accorde).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'runex_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "DriverPayout", "PriceChangeRequest", "ReturnSlip" TO runex_app;
  END IF;
END
$$;
