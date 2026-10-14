-- Réseau d'agences demandé par le client (octobre 2026).
--
-- Hub central Ben Arous (inchangé) + sept agences régionales :
-- Gafsa, Médenine, Sfax, Sousse, Siliana, Nabeul, Tunis.
--
-- Idempotent : une agence déjà présente (même code) est seulement renommée et
-- réactivée ; rien n'est supprimé. Les agences existantes (Tunis, Sousse,
-- Sfax) gardent leurs identifiants, donc leurs colis et leurs tournées.

DO $$
DECLARE
  societe uuid;
  agence record;
  branche uuid;
BEGIN
  SELECT "companyId" INTO societe FROM "Deposit" WHERE "isMainHub" = true ORDER BY "createdAt" LIMIT 1;
  IF societe IS NULL THEN
    SELECT id INTO societe FROM "Company" ORDER BY "createdAt" LIMIT 1;
  END IF;
  IF societe IS NULL THEN
    RAISE NOTICE 'Aucune société : agences non créées (base vide, le bootstrap s''en chargera).';
    RETURN;
  END IF;

  FOR agence IN
    SELECT * FROM (VALUES
      ('TUNIS',    'Agence Tunis',    'Tunis',    'Avenue Habib Bourguiba, Tunis', '71300001'),
      ('NABEUL',   'Agence Nabeul',   'Nabeul',   'Avenue Habib Thameur, Nabeul',  '72200001'),
      ('SOUSSE',   'Agence Sousse',   'Sousse',   'Avenue Yasser Arafat, Sousse',  '73200001'),
      ('SFAX',     'Agence Sfax',     'Sfax',     'Avenue Al Massila, Sfax',       '74200001'),
      ('SILIANA',  'Agence Siliana',  'Siliana',  'Centre-ville, Siliana',         '78800001'),
      ('GAFSA',    'Agence Gafsa',    'Gafsa',    'Centre-ville, Gafsa',           '76200001'),
      ('MEDENINE', 'Agence Médenine', 'Médenine', 'Centre-ville, Médenine',        '75600001')
    ) AS t(cle, nom, gouvernorat, adresse, tel)
  LOOP
    INSERT INTO "Branch" (id, "companyId", code, name, governorate, address, phone, "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), societe, 'BR-' || agence.cle, agence.nom, agence.gouvernorat, agence.adresse, agence.tel, now(), now())
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, "updatedAt" = now()
    RETURNING id INTO branche;

    INSERT INTO "Deposit" (id, "companyId", "branchId", code, name, "isMainHub", governorate, city, address, phone, status, "isActive", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), societe, branche, 'DEP-' || agence.cle || '-AGT', agence.nom, false, agence.gouvernorat,
            agence.gouvernorat, agence.adresse, agence.tel, 'ACTIF', true, now(), now())
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, "isActive" = true, status = 'ACTIF', "updatedAt" = now();
  END LOOP;

  -- Le hub garde son rôle et un nom explicite.
  UPDATE "Deposit" SET name = 'Hub Central Ben Arous', "updatedAt" = now() WHERE "isMainHub" = true;
END
$$;
