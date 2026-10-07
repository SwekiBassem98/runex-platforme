-- =============================================================================
-- Dépôts : zone, responsable, état opérationnel
-- =============================================================================

-- CREATE TYPE ... ADD VALUE ne peut pas être utilisé dans la même transaction
-- que son usage ; le type est donc créé ici, et les lignes de données plus bas
-- sont reportées dans un bloc distinct.
CREATE TYPE "DepositStatus" AS ENUM ('ACTIF', 'MAINTENANCE', 'FERME');

ALTER TABLE "Deposit"
  ADD COLUMN "zone" VARCHAR(80),
  ADD COLUMN "managerId" UUID,
  ADD COLUMN "status" "DepositStatus" NOT NULL DEFAULT 'ACTIF';

CREATE INDEX "Deposit_managerId_idx" ON "Deposit"("managerId");

ALTER TABLE "Deposit"
  ADD CONSTRAINT "Deposit_managerId_fkey"
  FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Transferts inter-dépôts : date, pièces, notes, horodatages d'étapes
-- =============================================================================

ALTER TABLE "InterDepotTransfer"
  ADD COLUMN "scheduledDate" DATE,
  ADD COLUMN "totalPieces" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "notes" VARCHAR(500),
  ADD COLUMN "preparedAt" TIMESTAMPTZ(6),
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(6);

-- Le cycle de vie demandé est CRE → PREPARE → EN_TRANSIT → RECU, plus ANNULE.
-- L'ancien enum encodait deux notions dans le statut : le point d'entrée du
-- cycle et la conformité de la réception. La conformité devient un fait
-- dérivé (totalPackages - receivedPackages), pas un statut : l'anomalie se
-- lit dans l'écart, et un transfert reste « reçu » même s'il manque une
-- pièce. On conserve donc l'information sans surcharger le statut.
ALTER TYPE "InterDepotStatus" RENAME TO "InterDepotStatus_ancien";

CREATE TYPE "InterDepotStatus" AS ENUM ('CRE', 'PREPARE', 'EN_TRANSIT', 'RECU', 'ANNULE');

ALTER TABLE "InterDepotTransfer"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "InterDepotStatus" USING (
    CASE "status"::text
      WHEN 'EN_PREPARATION' THEN 'CRE'
      WHEN 'EXPEDIE'         THEN 'EN_TRANSIT'
      WHEN 'EN_TRANSIT'      THEN 'EN_TRANSIT'
      WHEN 'RECEPTIONNE_CONFORME' THEN 'RECU'
      WHEN 'RECEPTIONNE_ANOMALIE' THEN 'RECU'
      WHEN 'ANNULE'          THEN 'ANNULE'
      ELSE 'CRE'
    END
  )::"InterDepotStatus";

ALTER TABLE "InterDepotTransfer"
  ALTER COLUMN "status" SET DEFAULT 'CRE';

DROP TYPE "InterDepotStatus_ancien";

-- `totalPieces` est alimenté par le service à la constitution du lot ; les
-- transferts antérieurs conservent 0, l'écart est visible plutôt que deviné.
