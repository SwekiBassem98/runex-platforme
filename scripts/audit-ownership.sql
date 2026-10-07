-- ==============================================================================
-- Verrouillage définitif du journal d'audit — étape d'administration
-- ==============================================================================
--
-- À exécuter UNE FOIS, avec un compte d'administration, après
-- `npm run prisma:deploy` :
--
--     psql -U <administrateur> -f scripts/audit-ownership.sql
--
-- Idempotent : le rejouer ne casse rien.
--
--
-- POURQUOI CE N'EST PAS DANS LA MIGRATION
--
-- La migration 20261003120000 pose deux verrous qu'un rôle ordinaire peut
-- poser : un déclencheur qui refuse `UPDATE` et `DELETE`, et la retrait de ces
-- deux droits au rôle applicatif.
--
-- Il en manque un troisième, et lui n'est pas à la portée du rôle applicatif :
-- la propriété de la table. Un propriétaire peut écrire
--
--     ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_immutable;
--
-- puis se réaccorder `UPDATE` sur sa propre table, réécrire ce qu'il veut, et
-- réactiver le déclencheur. Les deux premiers verrous seraient alors
-- désarmés sans laisser de trace — exactement ce que le journal doit empêcher.
--
-- Transférer la propriété exige d'être membre du rôle cible. Faire de
-- `logixpress_user` membre de `audit_owner` donnerait à l'application le
-- pouvoir qu'on cherche à lui ôter : c'est donc nécessairement un compte
-- d'administration qui s'en charge, hors du cycle de migration.
--
--
-- CE QUE ÇA CHANGE CONCRÈTEMENT
--
-- Avant : logixpress_user possède AuditLog → peut ALTÉRER la table.
-- Après :  audit_owner    possède AuditLog → logixpress_user ne peut plus ni
--         ALTER ni GRANT, donc plus rien de ce qui précède.
--
-- Il lui reste `SELECT` et `INSERT` : lire le journal, et l'alimenter. C'est
-- exactement ce dont l'application a besoin.
--
--
-- LA LIMITE, DITE PLAINEMENT
--
-- Le déclencheur arrête tout le monde, y compris un superutilisateur : la
-- table ne se modifie ni ne se purge pas tant qu'il est actif. Pour passer
-- outre, il faut d'abord écrire `ALTER TABLE "AuditLog" DISABLE TRIGGER
-- audit_log_immutable` — un geste explicite, tracé dans les journaux de la
-- base, qui rompt la continuité du journal.
--
-- Ce geste reste possible à un superutilisateur, ou au rôle `audit_owner`
-- lui-même. C'est inhérent à PostgreSQL et vrai de tout dispositif d'audit :
-- une base administrée par quelqu'un qui peut tout réécrire ne peut pas
-- prouver sa propre intégrité face à lui.
--
-- Ce que ce verrou garantit, en revanche, est net : aucun compte de
-- l'application n'échappe. Ni le rôle applicatif, ni celui de l'exécutant
-- d'une migration, ni un rôle que l'application pourrait se créer.
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  role_applicatif constant text := 'logixpress_user';
  role_audit      constant text := 'audit_owner';
  proprietaire    text;
BEGIN
  -- Le rôle propriétaire doit exister. Il est créé à l'initialisation de la
  -- base par docker/postgres/01-audit-owner.sql ; sur une base plus ancienne,
  -- on le crée ici, ce qui est possible : nous sommes en administration.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_audit) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN', role_audit);
    RAISE NOTICE 'Rôle % créé.', role_audit;
  END IF;

  SELECT tableowner INTO proprietaire
  FROM pg_tables
  WHERE tablename = 'AuditLog';

  IF proprietaire IS NULL THEN
    RAISE EXCEPTION
      'Table "AuditLog" introuvable. Appliquez d''abord les migrations (npm run prisma:deploy).';
  END IF;

  IF proprietaire <> role_audit THEN
    EXECUTE format('ALTER TABLE "AuditLog" OWNER TO %I', role_audit);
    RAISE NOTICE 'Propriété de "AuditLog" transférée à %.', role_audit;
  END IF;

  -- Le changement de propriétaire retire les droits que l'ancien propriétaire
  -- tenait de sa fonction : ils sont réaccordés explicitement.
  EXECUTE format('GRANT SELECT, INSERT ON TABLE "AuditLog" TO %I', role_applicatif);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM %I', role_applicatif);
END
$$;

-- Le déclencheur a suivi la table, mais il est réactivé par précaution : sa
-- présence et son état sont vérifiés, pas supposés.
ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_immutable;

-- Le rôle propriétaire n'a pas de droit de connexion ; on le confirme plutôt
-- que de le présumer.
DO $$
DECLARE
  peut_se_connecter boolean;
BEGIN
  SELECT rolcanlogin INTO peut_se_connecter FROM pg_roles WHERE rolname = 'audit_owner';
  IF peut_se_connecter THEN
    RAISE EXCEPTION 'Le rôle audit_owner ne doit pas pouvoir se connecter.';
  END IF;
END
$$;

\echo ''
\echo '--- Verrouillage appliqué. Ce qui reste possible pour logixpress_user : ---'
SELECT
  'INSERT' AS operation,
  has_table_privilege('logixpress_user', '"AuditLog"', 'INSERT') AS autorisee
UNION ALL
SELECT 'SELECT', has_table_privilege('logixpress_user', '"AuditLog"', 'SELECT')
UNION ALL
SELECT 'UPDATE', has_table_privilege('logixpress_user', '"AuditLog"', 'UPDATE')
UNION ALL
SELECT 'DELETE', has_table_privilege('logixpress_user', '"AuditLog"', 'DELETE')
UNION ALL
SELECT 'TRUNCATE', has_table_privilege('logixpress_user', '"AuditLog"', 'TRUNCATE');

\echo ''
\echo '--- Propriétaire de la table ---'
SELECT tableowner FROM pg_tables WHERE tablename = 'AuditLog';

\echo ''
\echo '--- Déclencheur ---'
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = '"AuditLog"'::regclass
  AND NOT tgisinternal;