-- Opérations de livraison avancées : quantités de la livraison partielle,
-- contenu et amounts du retour, écart financier et livreur de l'échange,
-- note client de la tentative.
--
-- Les colonnes sont ajoutées avec DEFAULT puis rendues NOT NULL : les lignes
-- existantes sont remplies par la valeur par défaut, ce qui évite d'ajouter
-- une colonne NOT NULL sans défaut à une table peuplée.

-- 1. LIVRAISON PARTIELLE : les quantités livrées et reprises.
ALTER TABLE "PartialDelivery" ADD COLUMN IF NOT EXISTS "deliveredPieces" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PartialDelivery" ADD COLUMN IF NOT EXISTS "returnedPieces"  INTEGER NOT NULL DEFAULT 0;

-- Les lignes antérieures n'ont pas de quantité fiable. Elles sont marquées
-- par 0/0, un couple que la contrainte de bilans rejette : mieux vaut un
-- enregistrement qu'un contrôle peut voir comme incomplet qu'un bilan
-- silencieusement faux. La contrainte porte sur les nouvelles écritures.
ALTER TABLE "PartialDelivery" DROP CONSTRAINT IF EXISTS "PartialDelivery_quantites_coherent";
ALTER TABLE "PartialDelivery" ADD CONSTRAINT "PartialDelivery_quantites_coherent"
  CHECK ("deliveredPieces" >= 0 AND "returnedPieces" >= 0);

-- Le bilan financier doit se refermer. L'encaissé et le repris se
-- complétent au montant dû, à la millième près : 58.000 = 40.000 + 18.000.
ALTER TABLE "PartialDelivery" DROP CONSTRAINT IF EXISTS "PartialDelivery_bilan_se_referme";
ALTER TABLE "PartialDelivery" ADD CONSTRAINT "PartialDelivery_bilan_se_referme"
  CHECK ("amountCollected" + "amountReturned" = "originalAmount");

-- 2. RETOUR : ce que le livreur ramène, et qui le ramène.
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "returnedItems"    VARCHAR(500);
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "returnedQuantity" INTEGER;
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "amount"           DECIMAL(10,3);
ALTER TABLE "ReturnRecord" ADD COLUMN IF NOT EXISTS "driverId"         UUID;

ALTER TABLE "ReturnRecord" DROP CONSTRAINT IF EXISTS "ReturnRecord_quantite_positive";
ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_quantite_positive"
  CHECK ("returnedQuantity" IS NULL OR "returnedQuantity" > 0);

-- 3. ÉCHANGE : ce que l'échange coûte, et qui l'a constaté.
ALTER TABLE "ExchangeRecord" ADD COLUMN IF NOT EXISTS "financialDifference" DECIMAL(10,3);
ALTER TABLE "ExchangeRecord" ADD COLUMN IF NOT EXISTS "driverId"            UUID;

-- 4. REPORT : ce que le client a été dit, distinct de la note de tournée.
ALTER TABLE "DeliveryAttempt" ADD COLUMN IF NOT EXISTS "customerNote" VARCHAR(500);
