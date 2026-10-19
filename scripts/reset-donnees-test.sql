-- =============================================================================
-- Remise à zéro de la base RUNEX pour une phase de test client.
--
-- Supprime TOUTES les données d'exploitation et ne garde que :
--   - le compte administrateur désigné (variable psql `email_admin`) ;
--   - la configuration indispensable au fonctionnement de l'application :
--     société, branches, agences (dépôts), zones de livraison, rôles et
--     permissions, historique des migrations.
--
-- Tout le reste disparaît : colis, clients, expéditeurs et leurs comptes,
-- livreurs et leurs comptes, autres utilisateurs, tournées, ramassages,
-- inter-dépôts, retours, encaissements, bordereaux, paiements livreurs,
-- notifications, appareils, sessions (tout le monde est déconnecté) et
-- journal d'audit. La numérotation des colis repart de 1.
--
-- Sûretés :
--   - tout se fait dans UNE transaction : à la moindre erreur, rien n'est
--     modifié ;
--   - le script s'arrête sans rien toucher si le compte administrateur est
--     introuvable ou n'a pas le rôle ADMIN ;
--   - une trace « Base réinitialisée » est écrite dans le nouveau journal.
--
-- Usage : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v email_admin=direction@runex.tn -f scripts/reset-donnees-test.sql
-- (avec le rôle propriétaire de la base : TRUNCATE est refusé au rôle applicatif).
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE reset_parametres ON COMMIT DROP AS SELECT lower(trim(:'email_admin'))::text AS email_admin;

DO $$
DECLARE
  v_email text := (SELECT email_admin FROM reset_parametres);
  v_admin record;
  v_tables text;
  v_utilisateurs int;
BEGIN
  SELECT u.id, u."fullName", u.phone INTO v_admin
  FROM "User" u
  WHERE lower(u.email) = v_email AND u."deletedAt" IS NULL;
  IF v_admin.id IS NULL THEN
    RAISE EXCEPTION 'Compte administrateur % introuvable : rien n''a été supprimé.', v_email;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "UserRoleAssignment" a JOIN "Role" r ON r.id = a."roleId"
    WHERE a."userId" = v_admin.id AND r.name::text IN ('ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Le compte % n''a pas le rôle ADMIN : rien n''a été supprimé.', v_email;
  END IF;
  RAISE NOTICE 'Compte conservé : % (%), téléphone %', v_admin."fullName", v_email, v_admin.phone;

  -- Toutes les tables, sauf la configuration conservée.
  SELECT string_agg(format('%I', tablename), ', ' ORDER BY tablename) INTO v_tables
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN (
      '_prisma_migrations',
      'User', 'UserRoleAssignment', 'Role', 'Permission', 'RolePermission',
      'Company', 'Branch', 'Deposit', 'DeliveryZone'
    );
  RAISE NOTICE 'Tables vidées : %', v_tables;
  EXECUTE 'TRUNCATE TABLE ' || v_tables || ' RESTART IDENTITY CASCADE';

  -- Tous les utilisateurs sauf l'administrateur (leurs rôles suivent en cascade).
  UPDATE "Deposit" SET "managerId" = NULL WHERE "managerId" IS NOT NULL AND "managerId" <> v_admin.id;
  DELETE FROM "User" WHERE id <> v_admin.id;
  GET DIAGNOSTICS v_utilisateurs = ROW_COUNT;
  RAISE NOTICE 'Utilisateurs supprimés : %', v_utilisateurs;

  UPDATE "User" SET "isActive" = true WHERE id = v_admin.id;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'package_number_seq') THEN
    ALTER SEQUENCE package_number_seq RESTART WITH 1;
  END IF;

  INSERT INTO "AuditLog" ("id", "entityType", "entityId", "action", "reason", "userId")
  VALUES (gen_random_uuid(), 'SYSTEME', 'base', 'BASE_REINITIALISEE',
          'Base remise à zéro pour la phase de test : seul le compte ' || v_email || ' est conservé.', v_admin.id);
END
$$;

-- Contrôle final : la transaction n'est validée que si l'état est celui attendu.
DO $$
DECLARE v_email text := (SELECT email_admin FROM reset_parametres);
BEGIN
  IF (SELECT count(*) FROM "User") <> 1 OR NOT EXISTS (SELECT 1 FROM "User" WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'Contrôle final en échec : la base n''est pas dans l''état attendu, rien n''est validé.';
  END IF;
  IF EXISTS (SELECT 1 FROM "Package") OR EXISTS (SELECT 1 FROM "Shipper") OR EXISTS (SELECT 1 FROM "Driver") THEN
    RAISE EXCEPTION 'Contrôle final en échec : des données d''exploitation subsistent.';
  END IF;
END
$$;

SELECT 'Utilisateurs' AS donnee, count(*) AS restant FROM "User"
UNION ALL SELECT 'Agences', count(*) FROM "Deposit"
UNION ALL SELECT 'Zones de livraison', count(*) FROM "DeliveryZone"
UNION ALL SELECT 'Rôles', count(*) FROM "Role"
UNION ALL SELECT 'Colis', count(*) FROM "Package"
UNION ALL SELECT 'Expéditeurs', count(*) FROM "Shipper"
UNION ALL SELECT 'Livreurs', count(*) FROM "Driver";

COMMIT;
