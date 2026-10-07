-- Types de notification des transferts inter-dépôts.
-- `ALTER TYPE ... ADD VALUE` est autorisé hors transaction ; la colonne
-- Notification n'est pas touchée, la migration reste sans risque.
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFERT_CREE';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFERT_RECEPTIONNE';
