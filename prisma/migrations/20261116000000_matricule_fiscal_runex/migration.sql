-- Matricule fiscal de RUNEX (16/11), imprimé sur les bons de livraison et
-- les autres documents de la société.
UPDATE "Company" SET "taxRegistration" = '1906149', "updatedAt" = now();
-- Raison sociale de démonstration restée en base : le transporteur est RUNEX.
UPDATE "Company" SET "legalName" = 'RUNEX', "updatedAt" = now() WHERE "legalName" = 'LogiXpress Tunisie SARL';
