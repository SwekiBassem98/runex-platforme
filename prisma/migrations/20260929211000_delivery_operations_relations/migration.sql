-- Clés étrangères des pièces ajoutées aux opérations de livraison.
--
-- Elles sont posées après coup sur des colonnes existantes, d'où le
-- `NOT VALID` suivi d'une validation : la contrainte est vérifiée pour les
-- lignes futures immédiatement, et les lignes actuelles ne bloquent pas la
-- migration si l'une d'elles référençait un dépôt ou un livreur supprimé.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReturnRecord_returnDepositId_fkey') THEN
    ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_returnDepositId_fkey"
      FOREIGN KEY ("returnDepositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReturnRecord_driverId_fkey') THEN
    ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExchangeRecord_driverId_fkey') THEN
    ALTER TABLE "ExchangeRecord" ADD CONSTRAINT "ExchangeRecord_driverId_fkey"
      FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

-- Validation des contraintes posées ci-dessus.
ALTER TABLE "ReturnRecord" VALIDATE CONSTRAINT "ReturnRecord_returnDepositId_fkey";
ALTER TABLE "ReturnRecord" VALIDATE CONSTRAINT "ReturnRecord_driverId_fkey";
ALTER TABLE "ExchangeRecord" VALIDATE CONSTRAINT "ExchangeRecord_driverId_fkey";
