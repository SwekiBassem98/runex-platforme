-- Suppression définitive des comptes (utilisateurs, livreurs, expéditeurs).
--
-- "AuditLog"."userId" référençait "User" avec ON DELETE SET NULL. Or le journal
-- est immuable (déclencheur audit_log_immutable, migration 20261003120000) :
-- supprimer un compte ayant laissé des traces déclenchait un UPDATE refusé, et
-- la suppression échouait. Sans clé étrangère, la colonne garde l'identifiant
-- de l'auteur — la trace reste intacte, ce qui est le but du journal — et le
-- compte peut être supprimé. L'écran d'historique retrouve le nom d'un compte
-- supprimé dans l'entrée *_SUPPRIME écrite juste avant la suppression.
--
-- Si "AuditLog" a été confiée à audit_owner (scripts/audit-ownership.sql), le
-- rôle des migrations n'en est plus propriétaire : la migration ne doit pas
-- échouer pour autant. Un avertissement le signale ; un administrateur rejoue
-- alors la commande avec le compte audit_owner. En attendant, l'API refuse
-- proprement la suppression d'un compte qui a laissé des traces.
DO $$
BEGIN
  ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_userId_fkey";
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'AuditLog_userId_fkey conservée : exécuter avec le propriétaire de "AuditLog" : ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_userId_fkey";';
END
$$;
