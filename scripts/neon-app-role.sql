-- ==============================================================================
-- Rôle applicatif à droits réduits — base hébergée (Neon, ou tout PostgreSQL géré)
-- ==============================================================================
--
-- L'API ne doit pas se connecter avec le rôle propriétaire du schéma
-- (`neondb_owner` sur Neon) : ce rôle peut modifier ou supprimer les tables,
-- désactiver le déclencheur qui protège le journal d'audit, et se réaccorder
-- tous les droits. Une faille applicative lui donnerait donc la main sur tout.
--
-- Deux rôles :
--   * propriétaire (neondb_owner) : migrations uniquement (GitHub Actions ou poste admin) ;
--   * runex_app                   : l'API — lecture/écriture des données, rien d'autre.
--
-- À exécuter UNE FOIS, avec le rôle propriétaire et l'URL DIRECTE (sans -pooler),
-- APRÈS la première migration :
--
--   APP_PASSWORD="$(openssl rand -hex 24)"; echo "$APP_PASSWORD"   # à copier dans Koyeb
--   psql "$DIRECT_DATABASE_URL" -v app_password="$APP_PASSWORD" -f scripts/neon-app-role.sql
--
-- Idempotent : relancé, il remet les droits en ordre et change le mot de passe.
--
-- Le rôle est créé en SQL et non depuis la console Neon : les rôles créés par
-- la console reçoivent `neon_superuser`, beaucoup plus que ce que l'API demande.
-- ==============================================================================

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE runex_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'runex_app')
\gexec
SELECT format('ALTER ROLE runex_app WITH LOGIN PASSWORD %L', :'app_password')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO runex_app', current_database())
\gexec

-- Données : lecture et écriture, sans DDL.
GRANT USAGE ON SCHEMA public TO runex_app;
REVOKE CREATE ON SCHEMA public FROM runex_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO runex_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO runex_app;

-- Tables créées par les prochaines migrations (lancées par le propriétaire) :
-- les mêmes droits s'appliquent sans relancer ce script.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO runex_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO runex_app;

-- Historique des migrations : l'API n'a pas à y toucher.
REVOKE ALL ON TABLE "_prisma_migrations" FROM runex_app;

-- Journal d'audit : ajout et lecture seulement. Le déclencheur
-- `audit_log_immutable` (migration 20261003120000) bloque déjà UPDATE/DELETE
-- pour tous ; runex_app n'étant pas propriétaire, il ne peut pas le désactiver.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM runex_app;
GRANT SELECT, INSERT ON TABLE "AuditLog" TO runex_app;

\echo ''
\echo '--- Contrôle des droits de runex_app ---'
SELECT
  r.rolname,
  r.rolsuper AS superuser,
  r.rolcreaterole AS createrole,
  r.rolcreatedb AS createdb,
  EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
          WHERE m.member = r.oid AND g.rolname = 'neon_superuser') AS neon_superuser
FROM pg_roles r WHERE r.rolname = 'runex_app';

SELECT 'AuditLog' AS "table",
  has_table_privilege('runex_app', '"AuditLog"', 'INSERT') AS insert_ok,
  has_table_privilege('runex_app', '"AuditLog"', 'UPDATE') AS update_interdit_si_false,
  has_table_privilege('runex_app', '"AuditLog"', 'DELETE') AS delete_interdit_si_false,
  has_schema_privilege('runex_app', 'public', 'CREATE') AS ddl_interdit_si_false;
