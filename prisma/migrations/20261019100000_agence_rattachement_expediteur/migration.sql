-- Agence de rattachement de l'expéditeur.
--
-- Jusqu'ici l'agence de départ d'un colis était déduite du gouvernorat saisi
-- librement sur le dossier de l'expéditeur. Une saisie qui ne correspondait à
-- aucune agence (orthographe, accents, espace) retombait sans bruit sur le hub
-- central de Ben Arous : le colis était déclaré au hub, et l'inter-dépôt
-- (création et acceptation) partait du mauvais dépôt.
--
-- L'agence est désormais choisie explicitement à la création du dossier
-- (Shipper.depositId). Cette migration la renseigne pour les dossiers
-- existants, puis corrige les colis concernés.

ALTER TABLE "Shipper" ADD COLUMN IF NOT EXISTS "depositId" UUID;
CREATE INDEX IF NOT EXISTS "Shipper_depositId_idx" ON "Shipper"("depositId");
DO $$ BEGIN
  ALTER TABLE "Shipper" ADD CONSTRAINT "Shipper_depositId_fkey"
    FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Comparaison sans accents ni casse ni espaces superflus.
CREATE OR REPLACE FUNCTION pg_temp.norm_gov(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(lower(trim(coalesce(v, ''))), 'éèêëàâäîïôöûüùç', 'eeeeaaaiioouuuc')
$$;

-- 0. Zone du hub (Tunis, Ben Arous) : les colis sont déposés ou ramassés
--    directement au hub central (Acceptation Magasin).
UPDATE "Shipper" s
SET "depositId" = (SELECT id FROM "Deposit" WHERE "isMainHub" = true ORDER BY "createdAt" LIMIT 1)
WHERE s."depositId" IS NULL AND pg_temp.norm_gov(s.governorate) IN ('tunis', 'ben arous');

-- 1. Agence du même gouvernorat (le hub d'abord quand il y en a plusieurs).
UPDATE "Shipper" s
SET "depositId" = (
  SELECT d.id FROM "Deposit" d
  WHERE d."isActive" = true AND pg_temp.norm_gov(d.governorate) = pg_temp.norm_gov(s.governorate)
  ORDER BY d."isMainHub" DESC, d."createdAt" ASC
  LIMIT 1
)
WHERE s."depositId" IS NULL;

-- 2. Gouvernorat sans agence : l'agence régionale qui le dessert (même table
--    que le routage de l'application).
WITH regions(gov, code) AS (
  VALUES ('ariana', 'DEP-TUNIS-AGT'), ('la manouba', 'DEP-TUNIS-AGT'), ('manouba', 'DEP-TUNIS-AGT'), ('bizerte', 'DEP-TUNIS-AGT'),
         ('zaghouan', 'DEP-NABEUL-AGT'),
         ('monastir', 'DEP-SOUSSE-AGT'), ('mahdia', 'DEP-SOUSSE-AGT'), ('kairouan', 'DEP-SOUSSE-AGT'),
         ('beja', 'DEP-SILIANA-AGT'), ('jendouba', 'DEP-SILIANA-AGT'), ('le kef', 'DEP-SILIANA-AGT'), ('kef', 'DEP-SILIANA-AGT'),
         ('kasserine', 'DEP-GAFSA-AGT'), ('sidi bouzid', 'DEP-GAFSA-AGT'), ('tozeur', 'DEP-GAFSA-AGT'), ('kebili', 'DEP-GAFSA-AGT'),
         ('gabes', 'DEP-MEDENINE-AGT'), ('tataouine', 'DEP-MEDENINE-AGT')
)
UPDATE "Shipper" s
SET "depositId" = d.id
FROM regions r
JOIN "Deposit" d ON d.code = r.code AND d."isActive" = true
WHERE s."depositId" IS NULL AND pg_temp.norm_gov(s.governorate) = r.gov;

-- 3. À défaut : le hub central.
UPDATE "Shipper" s
SET "depositId" = (SELECT id FROM "Deposit" WHERE "isMainHub" = true ORDER BY "createdAt" LIMIT 1)
WHERE s."depositId" IS NULL;

-- Colis pas encore reçus dans un dépôt : ils sont chez l'expéditeur ou chez le
-- livreur qui les ramasse, en route vers son agence de rattachement.
UPDATE "Package" p
SET "originDepositId" = s."depositId", "currentDepositId" = s."depositId"
FROM "Shipper" s
WHERE p."shipperId" = s.id AND s."depositId" IS NOT NULL
  AND p."deletedAt" IS NULL
  AND p.status IN ('CREE', 'RAMASSAGE_PROGRAMME', 'RAMASSE')
  AND (p."originDepositId" IS DISTINCT FROM s."depositId" OR p."currentDepositId" IS DISTINCT FROM s."depositId");

-- Colis déjà en circulation : l'agence d'origine (celle où reviennent les
-- retours) devient celle de l'expéditeur ; leur position réelle ne change pas.
UPDATE "Package" p
SET "originDepositId" = s."depositId"
FROM "Shipper" s
WHERE p."shipperId" = s.id AND s."depositId" IS NOT NULL
  AND p."deletedAt" IS NULL
  AND p.status NOT IN ('CREE', 'RAMASSAGE_PROGRAMME', 'RAMASSE', 'LIVRE', 'LIVRAISON_PARTIELLE', 'RETOURNE_EXPEDITEUR', 'ANNULE')
  AND p."originDepositId" IS DISTINCT FROM s."depositId";
