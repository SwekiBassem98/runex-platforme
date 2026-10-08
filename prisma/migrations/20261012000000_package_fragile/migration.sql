-- Bon de livraison : case « FRAGILE » imprimée sur l'étiquette collée au colis.
-- Les colis existants dont la note expéditeur annonçait déjà « fragile »
-- conservent cette information sous forme de case cochée.
ALTER TABLE "Package" ADD COLUMN "isFragile" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Package" SET "isFragile" = true WHERE "shipperNotes" ILIKE '%fragile%';
