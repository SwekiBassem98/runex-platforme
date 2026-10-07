-- Réception en dépôt : qui, quand, et déduplication des scans.
--
-- `PackageTimeline` conservait déjà l'opérateur et l'horodatage de chaque
-- événement, mais la question « qui a reçu ce colis, et quand » demandait de
-- parcourir la chronologie. Ces trois colonnes la rendent lisible directement
-- sur le colis.
ALTER TABLE "Package"
  ADD COLUMN IF NOT EXISTS "receivedAt"      TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "receivedByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "receivedByName"  VARCHAR(150);

-- La réception écrit ces colonnes ; la relation vers l'utilisateur est laissée
-- sans contrainte physique : une réception doit rester lisible même si le
-- compte de l'opérateur est supprimé, ce qui arrive lors d'une rotation.
CREATE INDEX IF NOT EXISTS "Package_receivedByUserId_idx" ON "Package" ("receivedByUserId");

-- Clé de déduplication.
--
-- Un scan part en 4G : la requête peut aboutir et perdre sa réponse. Rejouée,
-- elle dupliquerait la réception. Cette clé rend le rejeu inoffensif, et sa
-- présence sur la chronologie permet de retrouver le premier traitement.
ALTER TABLE "PackageTimeline"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(120);

-- Index partiel : seules les réceptions idempotentes ont une clé, et la
-- requête de relecture filtre dessus.
CREATE UNIQUE INDEX IF NOT EXISTS "PackageTimeline_idempotency_key_uq"
  ON "PackageTimeline" ("packageId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;