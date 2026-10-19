-- Tarif propre à chaque expéditeur, fixé par l'administration à la création
-- de son dossier :
--   - frais de livraison par type de colis (légère, normale, lourde,
--     volumineuse), appliqués automatiquement à chaque colis créé ;
--   - frais de retour (par colis retourné), frais de gestion (par paiement)
--     et R.A.S. (taux appliqué au net à payer), déduits au paiement.

ALTER TABLE "ShipperConfig" ADD COLUMN IF NOT EXISTS "feeLegere" DECIMAL(10,3) NOT NULL DEFAULT 8.000;
ALTER TABLE "ShipperConfig" ADD COLUMN IF NOT EXISTS "feeMoyenne" DECIMAL(10,3) NOT NULL DEFAULT 8.000;
ALTER TABLE "ShipperConfig" ADD COLUMN IF NOT EXISTS "feeLourde" DECIMAL(10,3) NOT NULL DEFAULT 8.000;
ALTER TABLE "ShipperConfig" ADD COLUMN IF NOT EXISTS "feeVolumineuse" DECIMAL(10,3) NOT NULL DEFAULT 8.000;
ALTER TABLE "ShipperConfig" ADD COLUMN IF NOT EXISTS "managementFee" DECIMAL(10,3) NOT NULL DEFAULT 0.000;

-- Les tarifs existants reprennent le tarif unique en vigueur.
UPDATE "ShipperConfig"
SET "feeLegere" = "defaultDeliveryFee",
    "feeMoyenne" = "defaultDeliveryFee",
    "feeLourde" = "defaultDeliveryFee",
    "feeVolumineuse" = "defaultDeliveryFee";

-- La R.A.S. devient un choix explicite par expéditeur (3 % du net à payer
-- quand elle s'applique) : l'ancienne valeur par défaut, jamais choisie,
-- n'est plus appliquée.
ALTER TABLE "ShipperConfig" ALTER COLUMN "withholdingTaxRate" SET DEFAULT 0;
UPDATE "ShipperConfig" SET "withholdingTaxRate" = 0 WHERE "withholdingTaxRate" = 0.0100;

-- Un expéditeur créé par l'administration n'avait pas de configuration :
-- elle est créée avec le tarif par défaut (8 DT par colis, sans frais de
-- retour ni de gestion, sans R.A.S.), à ajuster sur son dossier.
INSERT INTO "ShipperConfig" ("id", "shipperId", "secretPaymentCode", "defaultReturnFee", "updatedAt")
SELECT gen_random_uuid(), s."id", 'non-defini:' || md5(random()::text), 0, now()
FROM "Shipper" s
WHERE NOT EXISTS (SELECT 1 FROM "ShipperConfig" c WHERE c."shipperId" = s."id");

-- Bordereau : frais de gestion déduits et taux de R.A.S. appliqué.
ALTER TABLE "PaymentVoucher" ADD COLUMN IF NOT EXISTS "managementFeesTotal" DECIMAL(12,3) NOT NULL DEFAULT 0.000;
ALTER TABLE "PaymentVoucher" ADD COLUMN IF NOT EXISTS "withholdingTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0;
