-- Bons de retour expéditeur, façon ADEX : le bon est créé pour un
-- expéditeur, un livreur (et son véhicule) le porte, les colis sont ajoutés
-- ou retirés au scan, et l'état suit la restitution (en préparation → en
-- cours de livraison → remis). Les articles repris lors d'un échange
-- reviennent aussi à l'expéditeur par ce bon.

ALTER TYPE "ReturnSlipStatus" ADD VALUE IF NOT EXISTS 'EN_COURS' AFTER 'PREPARE';

ALTER TABLE "ReturnSlip" ADD COLUMN IF NOT EXISTS "driverId" UUID;
ALTER TABLE "ReturnSlip" ADD COLUMN IF NOT EXISTS "vehiclePlate" VARCHAR(30);
ALTER TABLE "ReturnSlip" ADD COLUMN IF NOT EXISTS "plannedDate" DATE;
ALTER TABLE "ReturnSlip" ADD COLUMN IF NOT EXISTS "departedAt" TIMESTAMPTZ(6);
-- La remise n'exige plus de code : le livreur fait signer le bon.
ALTER TABLE "ReturnSlip" ALTER COLUMN "handoverCode" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "ReturnSlip_driverId_idx" ON "ReturnSlip"("driverId");
CREATE INDEX IF NOT EXISTS "ReturnSlip_createdAt_idx" ON "ReturnSlip"("createdAt");
DO $$ BEGIN
  ALTER TABLE "ReturnSlip" ADD CONSTRAINT "ReturnSlip_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Articles repris lors d'un échange : rendus à l'expéditeur par un bon.
ALTER TABLE "ExchangeRecord" ADD COLUMN IF NOT EXISTS "returnSlipId" UUID;
ALTER TABLE "ExchangeRecord" ADD COLUMN IF NOT EXISTS "returnedToShipperAt" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "ExchangeRecord_returnSlipId_idx" ON "ExchangeRecord"("returnSlipId");
DO $$ BEGIN
  ALTER TABLE "ExchangeRecord" ADD CONSTRAINT "ExchangeRecord_returnSlipId_fkey"
    FOREIGN KEY ("returnSlipId") REFERENCES "ReturnSlip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
