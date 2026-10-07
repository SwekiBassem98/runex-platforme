-- Reclassement de l'historique des notifications, registre des diffusions et
-- point d'accroche du canal poussé.
--
-- Dépend de `20261002093000_notification_centre`, qui a introduit les nouvelles
-- valeurs. L'ordre n'est pas négociable : PostgreSQL n'autorise pas l'usage
-- d'une valeur d'énumération dans la transaction qui l'ajoute.

-- 1. Reclassement de l'historique vers le vocabulaire courant.
--
-- Les notifications déjà enregistrées décrivent des faits vrais ; on ne les
-- supprime pas, on leur redonne le nom qui correspond aujourd'hui. Seuls le
-- type change : ni le titre, ni le contenu, ni la date, de sorte que la
-- notification reste exactement celle qui a été reçue ce jour-là.
--
-- Le même UPDATE ne peut pas affecter deux fois la même colonne, d'où une
-- passe par type. Les valeurs sans équivalent — une demande de ramassage, la
-- clôture d'une tournée — gardent leur nom d'origine : elles ne sont plus
-- émises, et l'écran les affiche sous leur libellé brut.
UPDATE "Notification" SET type = 'NEW_COLIS_CREATED'      WHERE type = 'COLIS_CREE';
UPDATE "Notification" SET type = 'COLIS_ASSIGNED'         WHERE type = 'COLIS_ASSIGNE';
UPDATE "Notification" SET type = 'AMOUNT_CHANGED'         WHERE type = 'PRIX_MODIFIE_URGENT';
UPDATE "Notification" SET type = 'DELIVERY_POSTPONED'     WHERE type = 'COLIS_REPORTE';
UPDATE "Notification" SET type = 'DELIVERY_STATUS_CHANGED' WHERE type = 'COLIS_LIVRE';
UPDATE "Notification" SET type = 'RAMASSAGE_ASSIGNED'     WHERE type = 'RAMASSAGE_AFFECTE';
UPDATE "Notification" SET type = 'PAYMENT_VALIDATED'      WHERE type = 'PAIEMENT_DISPONIBLE';
UPDATE "Notification" SET type = 'INTER_DEPOT_RECEIVED'   WHERE type = 'TRANSFERT_RECEPTIONNE';

-- 2. Registre des diffusions : une ligne par notification et par canal.
--
-- La notification reste la vérité de ce que l'utilisateur a reçu. Cette table
-- répond à l'autre question, celle que rien ne permettait de trancher : lui a-t-on
-- bien envoyé, et par quel canal ?
--
-- Elle ne sert encore à rien. `in_app` réussit toujours et `socket` part au fil
-- de l'eau. Elle existe parce que le canal « push » ne pourra pas être comme
-- ça : une notification poussée part alors que l'application est fermée, et si
-- l'envoi échoue il faut pouvoir le constater et le rejouer plus tard — sans
-- faire sonner l'utilisateur deux fois.
CREATE TABLE "NotificationDelivery" (
  "id"             UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "channel"        VARCHAR(30) NOT NULL,
  "status"         VARCHAR(20) NOT NULL DEFAULT 'pending',
  "externalId"     VARCHAR(255),
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt"  TIMESTAMPTZ(6),
  "deliveredAt"    TIMESTAMPTZ(6),
  "lastError"      VARCHAR(500),
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- Un canal ne tente qu'une fois par notification : c'est cette contrainte qui
-- empêche, plus tard, un rejeu de push de doublonner l'alerte.
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_channel_key"
  ON "NotificationDelivery"("notificationId", "channel");

-- Ces deux index répondent à la seule question que posera le canal poussé :
-- « quelles notifications dois-je réessayer, sur quel canal ? »
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");
CREATE INDEX "NotificationDelivery_channel_status_idx"
  ON "NotificationDelivery"("channel", "status");

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Jeton de notification poussée.
--
-- Rien ne l'alimente encore. Brancher FCM ou APNs consistera à renseigner ces
-- deux colonnes et à enregistrer un canal de diffusion supplémentaire, sans
-- toucher aux appelants métier ni au modèle des notifications.
ALTER TABLE "User" ADD COLUMN "pushToken" VARCHAR(255);
ALTER TABLE "User" ADD COLUMN "pushEnabled" BOOLEAN NOT NULL DEFAULT false;