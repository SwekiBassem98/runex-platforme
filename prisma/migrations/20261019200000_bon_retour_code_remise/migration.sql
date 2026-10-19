-- Code de remise des bons de retour.
--
-- Comme pour le paiement d'un bordereau, la remise d'un bon de retour se
-- valide avec un code à 6 chiffres que seul l'expéditeur voit (espace
-- « Retours ») et qu'il donne une fois ses colis reçus. Les bons encore
-- ouverts (en préparation, en cours de livraison) reçoivent leur code.

UPDATE "ReturnSlip"
SET "handoverCode" = lpad((floor(random() * 1000000))::int::text, 6, '0')
WHERE "handoverCode" IS NULL AND status IN ('PREPARE', 'EN_COURS');
