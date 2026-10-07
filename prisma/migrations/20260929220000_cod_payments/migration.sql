-- Module financier : encaissements COD.
--
-- Les contraintes ci-dessous ne sont pas une Redondance de l'application :
-- elles encodent la règle « un paiement ne se valide pas en changeant un
-- statut » au seul endroit où personne ne peut la contourner. Une écriture
-- directe en base qui pose `status = 'VALIDE'` sans validateur ni horodatage
-- échoue ici, quel que soit le code appelant.

CREATE TYPE "PaymentStatus" AS ENUM ('EN_ATTENTE', 'VALIDE', 'ECARTE', 'REMBOURSE', 'ANNULE');

CREATE TABLE "Payment" (
    "id"                UUID NOT NULL,
    "paymentNumber"     VARCHAR(50) NOT NULL,
    "packageId"         UUID NOT NULL,
    "shipperId"         UUID NOT NULL,
    "runsheetId"        UUID,
    "driverId"          UUID,
    "status"            "PaymentStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "method"            "PaymentMethod" NOT NULL DEFAULT 'ESPECE',

    "amountExpected"    DECIMAL(12,3) NOT NULL,
    "amountCollected"   DECIMAL(12,3) NOT NULL DEFAULT 0,
    "amountRefunded"    DECIMAL(12,3) NOT NULL DEFAULT 0,
    "deliveryFee"       DECIMAL(12,3) NOT NULL DEFAULT 0,

    "collectedAt"       TIMESTAMPTZ(6) NOT NULL,
    "validatedAt"       TIMESTAMPTZ(6),
    "validatedByUserId" UUID,
    "transactionRef"    VARCHAR(100),
    "discrepancyReason" VARCHAR(255),
    "notes"             VARCHAR(500),
    "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_paymentNumber_key" ON "Payment"("paymentNumber");
-- Un colis, un encaissement : sans cela, la même livraison peut être
-- comptabilisée deux fois, une fois par erreur et une fois par fraude.
CREATE UNIQUE INDEX "Payment_packageId_key" ON "Payment"("packageId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_shipperId_idx" ON "Payment"("shipperId");
CREATE INDEX "Payment_driverId_idx" ON "Payment"("driverId");
CREATE INDEX "Payment_collectedAt_idx" ON "Payment"("collectedAt");

-- Moyens de paiement réservés par avance : la migration `ALTER TYPE` du jour
-- où la carte arrive bloquerait une table en production, elle se fait ici.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CARTE_BANCAIRE';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PAIEMENT_EN_LIGNE';

-- 1. Un montant ne peut pas être négatif : un encaissement créditeur
--    n'est pas un remboursement, c'est un autre type de mouvement.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_montants_positifs" CHECK (
    "amountExpected" >= 0 AND "amountCollected" >= 0
    AND "amountRefunded" >= 0 AND "deliveryFee" >= 0
);

-- 2. On ne peut pas prendre plus que ce qui était dû, ni rendre plus que
--    ce qui a été pris. Le reliquat reste donc toujours recevable, ce qui
--    garde un écart visible au lieu de le faire disparaître par un signe.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_encaisse_sans_depassement" CHECK (
    "amountCollected" <= "amountExpected"
    AND "amountRefunded" <= "amountCollected"
);

-- 3. La règle centrale : aucun paiement n'est validé sans validateur et sans
--    horodatage. Poser le statut seul — depuis un formulaire, un script, une
--    console — est impossible.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_validation_signee" CHECK (
    "status" <> 'VALIDE'
    OR ("validatedAt" IS NOT NULL AND "validatedByUserId" IS NOT NULL)
);

-- 4. Un écart ne s'explique pas tout seul : un paiement écarté porte sa
--    raison. Sans elle, le rapport de caisse ne montre qu'un chiffre.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ecart_motive" CHECK (
    "status" <> 'ECARTE'
    OR ("discrepancyReason" IS NOT NULL AND length(btrim("discrepancyReason")) > 0)
);

-- 5. Un chèque sans numéro n'est pas rapprochable. La contrainte vaut pour
--    les moyens exigés d'une référence, aujourd'hui le seul : ajouter la
--    carte ou le paiement en ligne ne l'affectera pas, ils n'en ont pas besoin.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reference_si_cheque" CHECK (
    "method" NOT IN ('CHEQUE', 'VIREMENT', 'TRAITE')
    OR ("transactionRef" IS NOT NULL AND length(btrim("transactionRef")) > 0)
);

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shipperId_fkey"
  FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_runsheetId_fkey"
  FOREIGN KEY ("runsheetId") REFERENCES "Runsheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_validatedByUserId_fkey"
  FOREIGN KEY ("validatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
