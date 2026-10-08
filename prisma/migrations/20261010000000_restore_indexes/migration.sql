-- ==============================================================================
-- Prompt 26 — Réconciliation du schéma et des index (dérive de migration)
-- ==============================================================================
--
-- La migration 20261006114135_init_local_run, générée par `prisma migrate dev`,
-- avait supprimé cinq index créés à la main par des migrations antérieures,
-- parce qu'ils n'étaient pas déclarés dans schema.prisma. Ils y sont désormais
-- déclarés, et recréés ici sous les noms que Prisma attend.
--
-- L'index partiel d'idempotence de la chronologie est remplacé par un index
-- unique ordinaire, exprimable dans le schéma : PostgreSQL admet plusieurs NULL
-- dans un index unique, la règle reste donc identique.

CREATE INDEX IF NOT EXISTS "Package_receivedByUserId_idx" ON "Package" ("receivedByUserId");
CREATE INDEX IF NOT EXISTS "Package_status_currentDepositId_idx" ON "Package" ("status", "currentDepositId");
CREATE INDEX IF NOT EXISTS "Deposit_managerId_idx" ON "Deposit" ("managerId");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_timestamp_idx" ON "AuditLog" ("entityType", "entityId", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_userId_timestamp_idx" ON "AuditLog" ("userId", "timestamp" DESC);

DROP INDEX IF EXISTS "PackageTimeline_idempotency_key_uq";
DROP INDEX IF EXISTS "PackageTimeline_packageId_idempotencyKey_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "PackageTimeline_packageId_idempotencyKey_key"
  ON "PackageTimeline" ("packageId", "idempotencyKey");
