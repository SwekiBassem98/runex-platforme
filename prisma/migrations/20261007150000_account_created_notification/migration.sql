-- Migration additive : une seule valeur d'énumération.
--
-- Aucune colonne ajoutée, retirée ou retypée ; aucune contrainte modifiée ; les
-- lignes existantes ne sont pas touchées. `ADD VALUE` ne réécrit pas la table et
-- n'invalide aucun index : les notifications déjà enregistrées continuent de
-- porter leur type d'origine.
--
-- `IF NOT EXISTS` rend la migration rejouable : un environnement où la valeur a
-- déjà été ajoutée à la main ne tombe pas en erreur au déploiement.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ACCOUNT_CREATED';
