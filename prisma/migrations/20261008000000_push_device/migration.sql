-- Table multi-appareils pour la notification poussée.
-- Un utilisateur peut posséder plusieurs jetons (téléphone, tablette,
-- réinstallation) : chaque jeton est une ligne distincte. La table remplace
-- l'usage exclusif de `User.pushToken` (conservé en repli) et complète
-- `Session.fcmToken` (trace par session).
CREATE TABLE "PushDevice" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "platform" VARCHAR(30) NOT NULL DEFAULT 'android',
    "deviceId" VARCHAR(255),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- Un jeton ne peut être actif que chez un seul utilisateur à la fois : la
-- réinstallation d'un appareil chez un autre compte désactive l'ancien.
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");
CREATE INDEX "PushDevice_isActive_idx" ON "PushDevice"("isActive");
CREATE INDEX "PushDevice_token_idx" ON "PushDevice"("token");

ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
