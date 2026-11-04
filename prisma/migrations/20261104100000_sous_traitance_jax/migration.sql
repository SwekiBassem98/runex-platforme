-- Sous-traitance de la livraison au partenaire JAX.
--
-- Un colis reçu dans une agence Runex peut être confié à JAX (automatiquement
-- pour les gouvernorats de destination qui lui sont confiés, ou à la main) :
-- il est créé chez JAX (code EAN), enlevé à l'agence, puis livré ou retourné
-- par JAX. Runex relit les statuts JAX et les reporte dans son propre flux.

ALTER TYPE "PackageStatus" ADD VALUE IF NOT EXISTS 'SOUS_TRAITE' AFTER 'RECU_DEPOT_DESTINATION';

DO $$ BEGIN
  CREATE TYPE "EtatSousTraitance" AS ENUM (
    'ECHEC_ENVOI', 'EN_ATTENTE_ENLEVEMENT', 'ENLEVEMENT_DEMANDE', 'PRIS_EN_CHARGE',
    'EN_LIVRAISON', 'LIVRE', 'RETOUR_EN_COURS', 'RETOURNE', 'ANNULE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "SousTraitance" (
  "id" UUID NOT NULL,
  "packageId" UUID NOT NULL,
  "partenaire" VARCHAR(20) NOT NULL DEFAULT 'JAX',
  "codeExterne" VARCHAR(60),
  "etat" "EtatSousTraitance" NOT NULL DEFAULT 'EN_ATTENTE_ENLEVEMENT',
  "mode" VARCHAR(10) NOT NULL DEFAULT 'MANUEL',
  "depositId" UUID,
  "statutExterne" VARCHAR(150),
  "statutExterneCode" VARCHAR(30),
  "statutExterneLe" TIMESTAMPTZ(6),
  "problemes" VARCHAR(1000),
  "enlevementRef" VARCHAR(100),
  "enlevementDemandeLe" TIMESTAMPTZ(6),
  "envoyeLe" TIMESTAMPTZ(6),
  "envoyeParNom" VARCHAR(150),
  "derniereSyncLe" TIMESTAMPTZ(6),
  "derniereErreur" VARCHAR(500),
  "codMontant" DECIMAL(10,3) NOT NULL DEFAULT 0.000,
  "codRecuLe" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SousTraitance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SousTraitance_packageId_key" ON "SousTraitance"("packageId");
CREATE UNIQUE INDEX IF NOT EXISTS "SousTraitance_partenaire_codeExterne_key" ON "SousTraitance"("partenaire", "codeExterne");
CREATE INDEX IF NOT EXISTS "SousTraitance_etat_idx" ON "SousTraitance"("etat");
CREATE INDEX IF NOT EXISTS "SousTraitance_depositId_idx" ON "SousTraitance"("depositId");
DO $$ BEGIN
  ALTER TABLE "SousTraitance" ADD CONSTRAINT "SousTraitance_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SousTraitance" ADD CONSTRAINT "SousTraitance_depositId_fkey"
    FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PartenaireGouvernorat" (
  "id" UUID NOT NULL,
  "partenaire" VARCHAR(20) NOT NULL DEFAULT 'JAX',
  "externeId" VARCHAR(20) NOT NULL,
  "nom" VARCHAR(80) NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PartenaireGouvernorat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PartenaireGouvernorat_partenaire_externeId_key" ON "PartenaireGouvernorat"("partenaire", "externeId");

CREATE TABLE IF NOT EXISTS "PartenaireStatut" (
  "id" UUID NOT NULL,
  "partenaire" VARCHAR(20) NOT NULL DEFAULT 'JAX',
  "code" VARCHAR(30) NOT NULL,
  "libelle" VARCHAR(150) NOT NULL,
  "etat" "EtatSousTraitance",
  "manuel" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PartenaireStatut_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PartenaireStatut_partenaire_code_key" ON "PartenaireStatut"("partenaire", "code");

CREATE TABLE IF NOT EXISTS "SousTraitanceZone" (
  "id" UUID NOT NULL,
  "partenaire" VARCHAR(20) NOT NULL DEFAULT 'JAX',
  "governorate" VARCHAR(50) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SousTraitanceZone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SousTraitanceZone_partenaire_governorate_key" ON "SousTraitanceZone"("partenaire", "governorate");

-- Le rôle applicatif lit et écrit ces tables (comme les autres tables métier).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'runex_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SousTraitance", "PartenaireGouvernorat", "PartenaireStatut", "SousTraitanceZone" TO runex_app;
  END IF;
END $$;
