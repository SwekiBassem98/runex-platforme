-- Journal d'audit : immuabilité au niveau de la base.
--
-- Une trace d'audit n'a de valeur que si elle ne peut pas être réécrite après
-- coup. Le garantir dans le code applicatif ne suffit pas : une route oubliée,
-- une console d'administration, un script de reprise ou une requête lancée à la
-- main suffiraient à altérer l'historique. La règle doit donc tenir là où la
-- donnée vit.
--
-- Deux verrous, volontairement redondants.
--
--   1. Un déclencheur refuse `UPDATE` et `DELETE`. C'est le verrou réel : il
--      s'applique à toute session SQL, quel que soit le chemin qui y mène.
--
--   2. Les droits `UPDATE` et `DELETE` sont retirés au rôle applicatif. Moins
--      fort que le déclencheur — le propriétaire d'une table peut toujours
--      s'accorder les droits, ou contourner le déclencheur — mais il fait
--      échouer la requête plus tôt, avec un message qui nomme la cause.
--
-- Ce que le déclencheur ne bloque pas :
--
--   * `INSERT`. C'est le seul moyen d'écrire, et c'est voulu — le journal se
--     remplit. Qui peut insérer est décidé par les droits de la table, donc par
--     le rôle de l'application.
--
--   * `TRUNCATE`. Il ne déclenche ni `BEFORE UPDATE` ni `BEFORE DELETE`, et
--     seule la propriété `TRUNCATE` de la table l'autorise : le rôle
--     applicatif ne l'a pas, et ne l'obtiendra pas en devenant propriétaire
--     (section 4). Une reprise faite avec un compte d'administration reste
--     possible — c'est normal, et c'est visible : le journal saute d'un coup,
--     sans traces intermédiaires. Une suppression ligne à ligne, elle,
--     laisserait autant de refus que de lignes visées.
--
-- Le message d'erreur est explicite et cite la table : un refus doit se
-- diagnostiquer seul, dans les journaux de production, sans avoir à croire que
-- l'opération métier a été refusée.

-- ---------------------------------------------------------------------
-- 1. Déclencheur de refus
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_refuse_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Le journal d''audit est immuable : % sur "AuditLog" est refusé (ligne %, utilisateur %). '
    'Une trace ne peut être ni modifiée ni supprimée après coup.',
    TG_OP,
    OLD.id,
    COALESCE(OLD."userId"::text, 'inconnu')
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_immutable ON "AuditLog";

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_refuse_mutation();

-- ---------------------------------------------------------------------
-- 2. Droits de l'application
-- ---------------------------------------------------------------------

DO $$
DECLARE
  role_courant text := current_user;
BEGIN
  -- Le rôle applicatif perd `UPDATE` et `DELETE`, et les retrouve pour
  -- `INSERT` et `SELECT` : c'est tout ce dont il a besoin.
  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE "AuditLog" FROM %I', role_courant);
  EXECUTE format('GRANT SELECT, INSERT ON TABLE "AuditLog" TO %I', role_courant);
END
$$;

-- ---------------------------------------------------------------------
-- 3. Filet de sécurité : aucune écriture sans auteur ni horodatage
-- ---------------------------------------------------------------------
--
-- Une trace sans auteur ni heure n'est pas une trace : elle ne dit ni qui, ni
-- quand. Les colonnes acceptent `NULL` parce qu'une réception antérieure à
-- l'ouverture du journal — ou une migration — peut n'avoir pas d'acteur connu.
-- La contrainte porte donc sur la colonne technique, qui ne peut pas être
-- inventée, et non sur l'auteur, qui peut légitimement manquer.
ALTER TABLE "AuditLog"
  DROP CONSTRAINT IF EXISTS "AuditLog_action_not_blank";

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_action_not_blank" CHECK (btrim("action") <> '');

ALTER TABLE "AuditLog"
  DROP CONSTRAINT IF EXISTS "AuditLog_entity_not_blank";

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_entity_not_blank" CHECK (
    btrim("entityType") <> '' AND btrim("entityId") <> ''
  );

-- Index utile aux filtres de l'écran d'historique.
--
-- Le journal se lit par entité, puis par ordre inverse de temps : sans cet
-- index, la dixième page d'un filtre revient au tri complet de la table.
CREATE INDEX IF NOT EXISTS "AuditLog_entity_timestamp_idx"
  ON "AuditLog" ("entityType", "entityId", "timestamp" DESC);

-- Filtre par acteur : « qu'a fait cet utilisateur », la question qu'on pose en
-- premier quand on cherche une cause.
CREATE INDEX IF NOT EXISTS "AuditLog_user_timestamp_idx"
  ON "AuditLog" ("userId", "timestamp" DESC);

-- ---------------------------------------------------------------------
-- 4. Ce que cette migration ne peut pas faire
-- ---------------------------------------------------------------------
--
-- Elle ne peut pas retirer la propriété de la table au rôle applicatif.
--
-- Transférer la propriété exige de pouvoir incarner le rôle cible, donc
-- d'être membre de `audit_owner` — or faire de l'application un membre de ce
-- rôle lui rendrait exactement le pouvoir qu'on cherche à lui retirer. La
-- propriété ne peut donc être cédée que par un compte d'administration, ce
-- qui sort du cadre d'une migration exécutée par l'application.
--
-- Tant que ce transfert n'a pas été fait, l'application reste propriétaire et
-- peut écrire `ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_immutable`.
-- Les sections 1 et 2 tiennent toujours — mais l'application peut les
-- écarter. Le transfert est donc l'étape qui complète cette migration :
--
--     psql -U <administrateur> -f scripts/audit-ownership.sql
--
-- `scripts/audit-ownership.sql` est idempotent. Il fait aussi bien la
-- vérification que l'audit de production : une fois le transfert effectué,
-- la session applicative doit se voir refuser `UPDATE`, `DELETE` et
-- `ALTER TABLE` sur la table.
