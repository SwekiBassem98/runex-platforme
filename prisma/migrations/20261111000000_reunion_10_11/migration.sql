-- Réunion client du 10/11.

-- Part du partenaire (JAX) sur un colis livré par lui, figée à la livraison.
ALTER TABLE "SousTraitance" ADD COLUMN IF NOT EXISTS "fraisPartenaire" DECIMAL(10,3);
-- Geste à faire à la main chez JAX (son API n'offre ni annulation ni modification).
ALTER TABLE "SousTraitance" ADD COLUMN IF NOT EXISTS "actionJax" VARCHAR(300);
ALTER TABLE "SousTraitance" ADD COLUMN IF NOT EXISTS "actionJaxLe" TIMESTAMPTZ(6);

-- Sous-zone choisie par le livreur pour ranger ses colis (application mobile).
ALTER TABLE "Package" ADD COLUMN IF NOT EXISTS "driverSubZone" VARCHAR(60);

-- Zones livrées par Runex seulement : leurs colis ne sont jamais créés chez JAX.
INSERT INTO "SousTraitanceZone" (id, partenaire, governorate)
VALUES (gen_random_uuid(), 'RUNEX', 'Tunis'), (gen_random_uuid(), 'RUNEX', 'Ben Arous')
ON CONFLICT (partenaire, governorate) DO NOTHING;
