-- Ajout du vocabulaire d'événements notifiés.
--
-- Cette migration est volontairement réduite à l'ajout des valeurs de
-- l'énumération. PostgreSQL interdit d'utiliser une valeur ajoutée dans la
-- même transaction qui l'introduit : les notifications existantes ne peuvent
-- donc pas être reclassées ici. C'est l'objet de la migration suivante, qui
-- s'exécute une fois celle-ci validée.
--
-- Les anciennes valeurs ne sont pas retirées. Des notifications déjà
-- enregistrées les portent, et ces faits passés restent vrais : les effacer
-- laisserait un historique illisible pour un gain de place qu'il ne vaut pas.

ALTER TYPE "NotificationType" ADD VALUE 'NEW_COLIS_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'COLIS_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'COLIS_MODIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'AMOUNT_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'QUANTITY_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_POSTPONED';
ALTER TYPE "NotificationType" ADD VALUE 'COLIS_RETURNED';
ALTER TYPE "NotificationType" ADD VALUE 'PARTIAL_DELIVERY';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_VALIDATED';
ALTER TYPE "NotificationType" ADD VALUE 'RUNSHEET_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'RAMASSAGE_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'INTER_DEPOT_RECEIVED';

-- Le filtrage par type devient une interrogation courante : le centre de
-- notifications filtre dessus à chaque ouverture.
CREATE INDEX "Notification_type_idx" ON "Notification"("type");