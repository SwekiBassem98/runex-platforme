-- Présence livreur : dernier battement d'activité.
-- La colonne est nullable : un livreur créé avant cette migration ou n'ayant
-- jamais ouvert l'application mobile n'a jamais été vu, et doit apparaître
-- hors ligne — pas avec une date de création qui le ferait passer en ligne.
ALTER TABLE "Driver" ADD COLUMN "lastSeenAt" TIMESTAMPTZ(6);
CREATE INDEX "Driver_lastSeenAt_idx" ON "Driver"("lastSeenAt");
