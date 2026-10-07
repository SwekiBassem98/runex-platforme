-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'RAMASSAGE_CONFIRME';
ALTER TYPE "NotificationType" ADD VALUE 'RAMASSAGE_AFFECTE';
ALTER TYPE "NotificationType" ADD VALUE 'RAMASSAGE_TERMINE';
ALTER TYPE "NotificationType" ADD VALUE 'RAMASSAGE_ANNULE';

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "pickupAppointmentId" UUID;

-- CreateIndex
CREATE INDEX "Package_pickupAppointmentId_idx" ON "Package"("pickupAppointmentId");

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_pickupAppointmentId_fkey" FOREIGN KEY ("pickupAppointmentId") REFERENCES "PickupAppointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
