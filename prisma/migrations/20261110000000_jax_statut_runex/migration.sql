-- Statut Runex du colis correspondant à un statut JAX (vide : déduit du libellé).
ALTER TABLE "PartenaireStatut" ADD COLUMN IF NOT EXISTS "statutRunex" VARCHAR(40);
