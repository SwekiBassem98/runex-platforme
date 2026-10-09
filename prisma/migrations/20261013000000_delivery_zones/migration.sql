-- Zones de livraison automatiques.
--
-- Une zone est un couple (gouvernorat, délégation). Elle est créée à la
-- première saisie d'un colis vers une adresse jamais vue, rattachée à
-- l'agence qui dessert le gouvernorat. Les livreurs déclarent les zones
-- qu'ils couvrent (DriverZone).

ALTER TABLE "DeliveryZone" ADD COLUMN IF NOT EXISTS "autoCreated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DeliveryZone" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "DriverZone" (
  "driverId"  UUID NOT NULL,
  "zoneId"    UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverZone_pkey" PRIMARY KEY ("driverId", "zoneId"),
  CONSTRAINT "DriverZone_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DriverZone_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DriverZone_zoneId_idx" ON "DriverZone"("zoneId");

-- Reprise de l'existant : une zone par couple (gouvernorat, délégation) déjà
-- présent dans les adresses, puis rattachement des adresses.
-- Code déterministe, identique à celui de l'API (zones.service.ts).
INSERT INTO "DeliveryZone" ("id", "depositId", "code", "name", "governorate", "delegation", "postalCodes", "autoCreated")
SELECT
  gen_random_uuid(),
  COALESCE(
    (SELECT d."id" FROM "Deposit" d
      WHERE d."isActive" AND lower(trim(d."governorate")) = lower(trim(a.governorate))
      ORDER BY d."isMainHub" DESC LIMIT 1),
    (SELECT d."id" FROM "Deposit" d ORDER BY d."isMainHub" DESC LIMIT 1)
  ),
  'Z-' || upper(substr(md5(lower(trim(a.governorate)) || '|' || lower(trim(a.delegation))), 1, 10)),
  left(trim(a.delegation), 100),
  left(trim(a.governorate), 50),
  left(trim(a.delegation), 100),
  ARRAY[]::text[],
  true
FROM (
  SELECT DISTINCT ON (lower(trim(governorate)), lower(trim(delegation))) governorate, delegation
  FROM "CustomerAddress"
  WHERE trim(governorate) <> '' AND trim(delegation) <> ''
  ORDER BY lower(trim(governorate)), lower(trim(delegation))
) a
WHERE EXISTS (SELECT 1 FROM "Deposit")
  AND NOT EXISTS (
    SELECT 1 FROM "DeliveryZone" z
    WHERE lower(trim(z.governorate)) = lower(trim(a.governorate))
      AND lower(trim(z.delegation)) = lower(trim(a.delegation))
  )
ON CONFLICT ("code") DO NOTHING;

UPDATE "CustomerAddress" ca
SET "zoneId" = z."id"
FROM "DeliveryZone" z
WHERE ca."zoneId" IS NULL
  AND lower(trim(z.governorate)) = lower(trim(ca.governorate))
  AND lower(trim(z.delegation)) = lower(trim(ca.delegation));
