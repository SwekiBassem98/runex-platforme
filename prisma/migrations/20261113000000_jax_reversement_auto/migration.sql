-- Reversement JAX automatique (13/11) : un colis livré par JAX est réglé
-- d'office — JAX garde sa part (6,500 DT) et reverse le reste à Runex.
-- Les colis livrés par JAX dont le reversement attendait encore une
-- confirmation manuelle sont réglés maintenant, à la date de leur livraison,
-- avec la part de JAX. Les reversements déjà enregistrés ne changent pas.
UPDATE "SousTraitance" st
SET "fraisPartenaire" = COALESCE(st."fraisPartenaire", 6.5),
    "codMontant"      = CASE WHEN st."codMontant" > 0 THEN st."codMontant" ELSE p."totalPrice" END,
    "codRecuLe"       = COALESCE(p."deliveredAt", st."statutExterneLe", now()),
    "updatedAt"       = now()
FROM "Package" p
WHERE p.id = st."packageId"
  AND st.etat = 'LIVRE'
  AND st."codRecuLe" IS NULL;

-- Montant encaissé du colis (bordereaux expéditeurs) : celui que JAX a encaissé.
UPDATE "Package" p
SET "collectedAmount" = p."totalPrice"
FROM "SousTraitance" st
WHERE st."packageId" = p.id AND st.etat = 'LIVRE'
  AND p.status::text IN ('LIVRE', 'LIVRAISON_PARTIELLE')
  AND p."collectedAmount" IS NULL;
