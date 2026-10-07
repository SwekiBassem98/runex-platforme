-- ==============================================================================
-- Rôle propriétaire du journal d'audit
-- ==============================================================================
--
-- Le rôle applicatif ne doit pas posséder la table `AuditLog`.
--
-- Tant qu'il la possède, il peut désactiver le déclencheur qui interdit de la
-- modifier : l'immuabilité reposerait alors sur une promesse faite par le code
-- qu'elle est censée protéger. Le rôle ci-dessous possède la table et n'a pas
-- de droit de connexion — personne ne s'y connecte, et personne ne le peut — si
-- bien que l'application ne dispose d'aucun moyen de contourner le
-- déclencheur.
--
-- Ce rôle ne se connecte pas. Le déclencheur, lui, arrête tout le monde tant
-- qu'il est actif ; le seul moyen de passer outre consiste à le désactiver
-- d'abord, geste explicite qu'un superutilisateur peut encore accomplir.
-- C'est inhérent à PostgreSQL et vrai de tout journal : ce qui compte est
-- qu'aucun compte de l'application, et aucun compte qu'elle pourrait détenir,
-- n'y échappe.
--
-- La propriété elle-même est cédée après coup, par un compte d'administration :
-- voir scripts/audit-ownership.sql.
--
-- Ce script n'est rejoué qu'à la création du volume. Sur une base plus
-- ancienne, l'administrateur crée le rôle à la main ; le script d'audit le
-- fait aussi s'il est absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_owner') THEN
    CREATE ROLE audit_owner NOLOGIN;
  END IF;
END
$$;