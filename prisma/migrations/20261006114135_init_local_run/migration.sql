-- DropIndex
DROP INDEX "AuditLog_entity_timestamp_idx";

-- DropIndex
DROP INDEX "AuditLog_user_timestamp_idx";

-- DropIndex
DROP INDEX "Deposit_managerId_idx";

-- DropIndex
DROP INDEX "Package_receivedByUserId_idx";

-- DropIndex
DROP INDEX "Package_status_depot_idx";

-- AlterTable
ALTER TABLE "PartialDelivery" ALTER COLUMN "deliveredPieces" DROP DEFAULT,
ALTER COLUMN "returnedPieces" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "PackageTimeline_packageId_idempotencyKey_idx" ON "PackageTimeline"("packageId", "idempotencyKey");
