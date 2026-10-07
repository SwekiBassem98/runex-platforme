-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('SUPER_ADMIN', 'ADMIN_GENERAL', 'DISPATCHER', 'MAGASINIER', 'CAISSIER', 'EXPEDITEUR_ADMIN', 'EXPEDITEUR_USER', 'LIVREUR');

-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('NORMAL', 'EXCHANGE', 'REPORTED', 'RETURN');

-- CreateEnum
CREATE TYPE "PackageSize" AS ENUM ('LEGERE', 'MOYENNE', 'LOURDE', 'VOLUMINEUSE');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('CREE', 'RAMASSAGE_PROGRAMME', 'RAMASSE', 'RECU_DEPOT', 'EN_LOT_INTER_DEPOT', 'EN_TRANSIT_INTER_DEPOT', 'RECU_DEPOT_DESTINATION', 'AFFECTE_RUNSHEET', 'EN_COURS_LIVRAISON', 'LIVRE', 'LIVRAISON_PARTIELLE', 'REPORTE', 'ECHEC_LIVRAISON', 'RETOUR_DEPOT', 'EN_RUNSHEET_RETOUR', 'RETOURNE_EXPEDITEUR', 'ANNULE');

-- CreateEnum
CREATE TYPE "DeliveryAttemptResult" AS ENUM ('REUSSIE', 'LIVRAISON_PARTIELLE', 'REPORTEE', 'REFUSEE', 'INJOIGNABLE', 'ADRESSE_INCORRECTE', 'PAS_D_ARGENT');

-- CreateEnum
CREATE TYPE "RunsheetStatus" AS ENUM ('BROUILLON', 'EN_ATTENTE', 'VALIDEE_DEPART', 'EN_COURS', 'RETOUR_DEPOT', 'CLOTUREE_CONFORME', 'CLOTUREE_DEFICIT', 'ANNULEE');

-- CreateEnum
CREATE TYPE "RunsheetType" AS ENUM ('DISTRIBUTION', 'RAMASSAGE', 'RETOUR_EXPEDITEUR', 'TRANSFERT_DEPOT');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('A_CONFIRMER', 'EN_ATTENTE', 'ASSIGNE', 'EN_COURS', 'EFFECTUE', 'ANNULE');

-- CreateEnum
CREATE TYPE "InterDepotStatus" AS ENUM ('EN_PREPARATION', 'EXPEDIE', 'EN_TRANSIT', 'RECEPTIONNE_CONFORME', 'RECEPTIONNE_ANOMALIE', 'ANNULE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ESPECE', 'CHEQUE', 'VIREMENT', 'TRAITE');

-- CreateEnum
CREATE TYPE "PaymentVoucherStatus" AS ENUM ('EN_ATTENTE', 'CONFIRME', 'PAYE', 'ANNULE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('COLIS_CREE', 'COLIS_ASSIGNE', 'PRIX_MODIFIE_URGENT', 'COLIS_REPORTE', 'COLIS_LIVRE', 'RAMASSAGE_DEMANDE', 'RUNSHEET_CLOTUREE', 'PAIEMENT_DISPONIBLE', 'SYSTEM_ALERT');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" VARCHAR(500),
    "lastLoginAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "companyId" UUID,
    "branchId" UUID,
    "depositId" UUID,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "name" "RoleType" NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(255) NOT NULL,
    "userAgent" VARCHAR(255),
    "ipAddress" VARCHAR(45),
    "fcmToken" VARCHAR(500),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "legalName" VARCHAR(150) NOT NULL,
    "taxRegistration" VARCHAR(50),
    "headquarters" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(30) NOT NULL,
    "contactEmail" VARCHAR(255) NOT NULL,
    "currencyCode" VARCHAR(5) NOT NULL DEFAULT 'TND',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "governorate" VARCHAR(50) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "email" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isMainHub" BOOLEAN NOT NULL DEFAULT false,
    "governorate" VARCHAR(50) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" VARCHAR(30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" UUID NOT NULL,
    "depositId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "governorate" VARCHAR(50) NOT NULL,
    "delegation" VARCHAR(100) NOT NULL,
    "postalCodes" TEXT[],
    "baseDeliveryFee" DECIMAL(10,3) NOT NULL DEFAULT 7.000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipper" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "companyName" VARCHAR(150) NOT NULL,
    "brandName" VARCHAR(100),
    "taxId" VARCHAR(50),
    "phone" VARCHAR(30) NOT NULL,
    "phoneSecondary" VARCHAR(30),
    "email" VARCHAR(255) NOT NULL,
    "governorate" VARCHAR(50) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Shipper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipperConfig" (
    "id" UUID NOT NULL,
    "shipperId" UUID NOT NULL,
    "defaultDeliveryFee" DECIMAL(10,3) NOT NULL DEFAULT 7.000,
    "defaultReturnFee" DECIMAL(10,3) NOT NULL DEFAULT 3.000,
    "defaultExchangeFee" DECIMAL(10,3) NOT NULL DEFAULT 8.000,
    "withholdingTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.010,
    "secretPaymentCode" VARCHAR(100) NOT NULL,
    "bankName" VARCHAR(100),
    "bankRib" VARCHAR(30),
    "canOpenPackage" BOOLEAN NOT NULL DEFAULT false,
    "allowPartialDelivery" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ShipperConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipperUser" (
    "id" UUID NOT NULL,
    "shipperId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipperUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "primaryPhone" VARCHAR(30) NOT NULL,
    "secondaryPhone" VARCHAR(30),
    "email" VARCHAR(255),
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklistReason" VARCHAR(255),
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "successOrders" INTEGER NOT NULL DEFAULT 0,
    "returnedOrders" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPhone" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "phoneNumber" VARCHAR(30) NOT NULL,
    "label" VARCHAR(50),
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "zoneId" UUID,
    "governorate" VARCHAR(50) NOT NULL,
    "delegation" VARCHAR(100) NOT NULL,
    "locality" VARCHAR(100),
    "streetAddress" VARCHAR(255) NOT NULL,
    "postalCode" VARCHAR(10),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "deliveryNotes" VARCHAR(255),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "driverCode" VARCHAR(30) NOT NULL,
    "vehicleType" VARCHAR(50) NOT NULL,
    "licensePlate" VARCHAR(30),
    "cashCeiling" DECIMAL(12,3) NOT NULL DEFAULT 2000.000,
    "currentBalance" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "rating" DECIMAL(3,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" UUID NOT NULL,
    "trackingNumber" VARCHAR(50) NOT NULL,
    "barcode" VARCHAR(50) NOT NULL,
    "shipperReference" VARCHAR(100),
    "shipperId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerAddressId" UUID NOT NULL,
    "assignedDriverId" UUID,
    "originDepositId" UUID NOT NULL,
    "currentDepositId" UUID NOT NULL,
    "destinationDepositId" UUID NOT NULL,
    "currentRunsheetId" UUID,
    "interDepotTransferId" UUID,
    "paymentVoucherId" UUID,
    "packageType" "PackageType" NOT NULL DEFAULT 'NORMAL',
    "status" "PackageStatus" NOT NULL DEFAULT 'CREE',
    "sizeCategory" "PackageSize" NOT NULL DEFAULT 'MOYENNE',
    "pieceCount" INTEGER NOT NULL DEFAULT 1,
    "weightKg" DECIMAL(8,3),
    "contentSummary" VARCHAR(255) NOT NULL,
    "allowOpen" BOOLEAN NOT NULL DEFAULT false,
    "declaredValue" DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    "totalPrice" DECIMAL(10,3) NOT NULL,
    "collectedAmount" DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    "deliveryFee" DECIMAL(10,3) NOT NULL,
    "returnFee" DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    "shipperNotes" VARCHAR(500),
    "driverNotes" VARCHAR(500),
    "internalNotes" VARCHAR(500),
    "scheduledDeliveryDate" TIMESTAMPTZ(6),
    "lastDeliveryAttemptAt" TIMESTAMPTZ(6),
    "deliveryAttemptsCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageItem" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "sku" VARCHAR(100),
    "description" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,3),
    "sizeCategory" "PackageSize" NOT NULL DEFAULT 'LEGERE',
    "isDelivered" BOOLEAN NOT NULL DEFAULT true,
    "isReturned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageTimeline" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "status" "PackageStatus" NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "locationName" VARCHAR(150),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "runsheetNumber" VARCHAR(50),
    "transferNumber" VARCHAR(50),
    "operatorName" VARCHAR(150) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "runsheetId" UUID,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "result" "DeliveryAttemptResult" NOT NULL,
    "reasonCode" VARCHAR(50),
    "driverComment" VARCHAR(500),
    "rescheduledFor" TIMESTAMPTZ(6),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "callDurationSeconds" INTEGER DEFAULT 0,
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartialDelivery" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "deliveredDescription" VARCHAR(500) NOT NULL,
    "returnedDescription" VARCHAR(500) NOT NULL,
    "deliveredSize" "PackageSize" NOT NULL DEFAULT 'MOYENNE',
    "returnedSize" "PackageSize" NOT NULL DEFAULT 'MOYENNE',
    "originalAmount" DECIMAL(10,3) NOT NULL,
    "amountCollected" DECIMAL(10,3) NOT NULL,
    "amountReturned" DECIMAL(10,3) NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "validatedByDriverId" UUID NOT NULL,
    "validatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartialDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRecord" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "newPackageBarcode" VARCHAR(50) NOT NULL,
    "oldPackageBarcode" VARCHAR(50) NOT NULL,
    "returnedItemSummary" VARCHAR(255) NOT NULL,
    "isOldItemReceived" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAtDepositId" UUID,
    "validatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Runsheet" (
    "id" UUID NOT NULL,
    "runsheetNumber" VARCHAR(50) NOT NULL,
    "depositId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "RunsheetType" NOT NULL DEFAULT 'DISTRIBUTION',
    "status" "RunsheetStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "tourDate" DATE NOT NULL,
    "totalPackages" INTEGER NOT NULL DEFAULT 0,
    "totalPieces" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "postponedCount" INTEGER NOT NULL DEFAULT 0,
    "returnedCount" INTEGER NOT NULL DEFAULT 0,
    "expectedCash" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "collectedCash" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "collectedChecks" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "deficitAmount" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "departureTime" TIMESTAMPTZ(6),
    "closureTime" TIMESTAMPTZ(6),
    "closedByUserId" UUID,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Runsheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunsheetItem" (
    "id" UUID NOT NULL,
    "runsheetId" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "isHandled" BOOLEAN NOT NULL DEFAULT false,
    "statusAtClose" "PackageStatus",
    "collectedAmount" DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    "scannedAtDeparture" TIMESTAMPTZ(6),
    "scannedAtReturn" TIMESTAMPTZ(6),

    CONSTRAINT "RunsheetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupAppointment" (
    "id" UUID NOT NULL,
    "referenceNumber" VARCHAR(50) NOT NULL,
    "shipperId" UUID NOT NULL,
    "assignedDriverId" UUID,
    "scheduledDate" DATE NOT NULL,
    "timeSlotStartHour" INTEGER NOT NULL,
    "timeSlotEndHour" INTEGER NOT NULL,
    "pickupAddress" VARCHAR(255) NOT NULL,
    "contactPerson" VARCHAR(100) NOT NULL,
    "contactPhone" VARCHAR(30) NOT NULL,
    "packageEstimate" INTEGER NOT NULL DEFAULT 1,
    "actualPickedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "PickupStatus" NOT NULL DEFAULT 'A_CONFIRMER',
    "notes" VARCHAR(500),
    "confirmedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PickupAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterDepotTransfer" (
    "id" UUID NOT NULL,
    "transferNumber" VARCHAR(50) NOT NULL,
    "sourceDepositId" UUID NOT NULL,
    "destinationDepositId" UUID NOT NULL,
    "transporterDriverId" UUID,
    "sealNumber" VARCHAR(50),
    "totalPackages" INTEGER NOT NULL DEFAULT 0,
    "receivedPackages" INTEGER NOT NULL DEFAULT 0,
    "status" "InterDepotStatus" NOT NULL DEFAULT 'EN_TRANSIT',
    "dispatchNotes" VARCHAR(255),
    "receptionNotes" VARCHAR(255),
    "shippedAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InterDepotTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentVoucher" (
    "id" UUID NOT NULL,
    "voucherNumber" VARCHAR(50) NOT NULL,
    "shipperId" UUID NOT NULL,
    "status" "PaymentVoucherStatus" NOT NULL DEFAULT 'CONFIRME',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'ESPECE',
    "scheduledDate" DATE,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "returnedCount" INTEGER NOT NULL DEFAULT 0,
    "grossCashCollected" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "grossChecksCollected" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "deliveryFeesTotal" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "returnFeesTotal" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "withholdingTaxTotal" DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    "netPayable" DECIMAL(12,3) NOT NULL,
    "secretCodeVerified" BOOLEAN NOT NULL DEFAULT false,
    "transactionRef" VARCHAR(100),
    "paidAt" TIMESTAMPTZ(6),
    "validatedByUserId" UUID,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRecord" (
    "id" UUID NOT NULL,
    "returnNumber" VARCHAR(50) NOT NULL,
    "packageId" UUID NOT NULL,
    "returnDepositId" UUID NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "isPhysicalChecked" BOOLEAN NOT NULL DEFAULT false,
    "checkCondition" VARCHAR(100),
    "checkedByUserId" UUID,
    "checkedAt" TIMESTAMPTZ(6),
    "restoredToShipperAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "relatedEntity" VARCHAR(50),
    "relatedEntityId" VARCHAR(100),
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "reason" VARCHAR(255),
    "previousValues" JSONB,
    "newValues" JSONB,
    "userId" UUID,
    "userIp" VARCHAR(45),
    "userAgent" VARCHAR(255),
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "User_depositId_idx" ON "User"("depositId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_module_idx" ON "Permission"("module");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_userId_idx" ON "UserRoleAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_roleId_idx" ON "UserRoleAssignment"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_roleId_key" ON "UserRoleAssignment"("userId", "roleId");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_refreshTokenHash_idx" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "Branch_companyId_idx" ON "Branch"("companyId");

-- CreateIndex
CREATE INDEX "Branch_governorate_idx" ON "Branch"("governorate");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_code_key" ON "Deposit"("code");

-- CreateIndex
CREATE INDEX "Deposit_companyId_idx" ON "Deposit"("companyId");

-- CreateIndex
CREATE INDEX "Deposit_isMainHub_idx" ON "Deposit"("isMainHub");

-- CreateIndex
CREATE INDEX "Deposit_governorate_idx" ON "Deposit"("governorate");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryZone_code_key" ON "DeliveryZone"("code");

-- CreateIndex
CREATE INDEX "DeliveryZone_depositId_idx" ON "DeliveryZone"("depositId");

-- CreateIndex
CREATE INDEX "DeliveryZone_governorate_delegation_idx" ON "DeliveryZone"("governorate", "delegation");

-- CreateIndex
CREATE UNIQUE INDEX "Shipper_code_key" ON "Shipper"("code");

-- CreateIndex
CREATE INDEX "Shipper_companyName_idx" ON "Shipper"("companyName");

-- CreateIndex
CREATE INDEX "Shipper_phone_idx" ON "Shipper"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "ShipperConfig_shipperId_key" ON "ShipperConfig"("shipperId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipperUser_userId_key" ON "ShipperUser"("userId");

-- CreateIndex
CREATE INDEX "ShipperUser_shipperId_idx" ON "ShipperUser"("shipperId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_primaryPhone_idx" ON "Customer"("primaryPhone");

-- CreateIndex
CREATE INDEX "Customer_fullName_idx" ON "Customer"("fullName");

-- CreateIndex
CREATE INDEX "CustomerPhone_customerId_idx" ON "CustomerPhone"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPhone_phoneNumber_idx" ON "CustomerPhone"("phoneNumber");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAddress_governorate_delegation_idx" ON "CustomerAddress"("governorate", "delegation");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_driverCode_key" ON "Driver"("driverCode");

-- CreateIndex
CREATE INDEX "Driver_driverCode_idx" ON "Driver"("driverCode");

-- CreateIndex
CREATE UNIQUE INDEX "Package_trackingNumber_key" ON "Package"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Package_barcode_key" ON "Package"("barcode");

-- CreateIndex
CREATE INDEX "Package_trackingNumber_idx" ON "Package"("trackingNumber");

-- CreateIndex
CREATE INDEX "Package_barcode_idx" ON "Package"("barcode");

-- CreateIndex
CREATE INDEX "Package_status_idx" ON "Package"("status");

-- CreateIndex
CREATE INDEX "Package_shipperId_idx" ON "Package"("shipperId");

-- CreateIndex
CREATE INDEX "Package_customerId_idx" ON "Package"("customerId");

-- CreateIndex
CREATE INDEX "Package_assignedDriverId_idx" ON "Package"("assignedDriverId");

-- CreateIndex
CREATE INDEX "Package_currentDepositId_idx" ON "Package"("currentDepositId");

-- CreateIndex
CREATE INDEX "Package_currentRunsheetId_idx" ON "Package"("currentRunsheetId");

-- CreateIndex
CREATE INDEX "Package_paymentVoucherId_idx" ON "Package"("paymentVoucherId");

-- CreateIndex
CREATE INDEX "Package_createdAt_idx" ON "Package"("createdAt");

-- CreateIndex
CREATE INDEX "PackageItem_packageId_idx" ON "PackageItem"("packageId");

-- CreateIndex
CREATE INDEX "PackageTimeline_packageId_idx" ON "PackageTimeline"("packageId");

-- CreateIndex
CREATE INDEX "PackageTimeline_createdAt_idx" ON "PackageTimeline"("createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_packageId_idx" ON "DeliveryAttempt"("packageId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_driverId_idx" ON "DeliveryAttempt"("driverId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_attemptedAt_idx" ON "DeliveryAttempt"("attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartialDelivery_packageId_key" ON "PartialDelivery"("packageId");

-- CreateIndex
CREATE INDEX "PartialDelivery_packageId_idx" ON "PartialDelivery"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRecord_packageId_key" ON "ExchangeRecord"("packageId");

-- CreateIndex
CREATE INDEX "ExchangeRecord_packageId_idx" ON "ExchangeRecord"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "Runsheet_runsheetNumber_key" ON "Runsheet"("runsheetNumber");

-- CreateIndex
CREATE INDEX "Runsheet_runsheetNumber_idx" ON "Runsheet"("runsheetNumber");

-- CreateIndex
CREATE INDEX "Runsheet_depositId_idx" ON "Runsheet"("depositId");

-- CreateIndex
CREATE INDEX "Runsheet_driverId_idx" ON "Runsheet"("driverId");

-- CreateIndex
CREATE INDEX "Runsheet_status_idx" ON "Runsheet"("status");

-- CreateIndex
CREATE INDEX "Runsheet_tourDate_idx" ON "Runsheet"("tourDate");

-- CreateIndex
CREATE INDEX "RunsheetItem_runsheetId_idx" ON "RunsheetItem"("runsheetId");

-- CreateIndex
CREATE INDEX "RunsheetItem_packageId_idx" ON "RunsheetItem"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "RunsheetItem_runsheetId_packageId_key" ON "RunsheetItem"("runsheetId", "packageId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupAppointment_referenceNumber_key" ON "PickupAppointment"("referenceNumber");

-- CreateIndex
CREATE INDEX "PickupAppointment_referenceNumber_idx" ON "PickupAppointment"("referenceNumber");

-- CreateIndex
CREATE INDEX "PickupAppointment_shipperId_idx" ON "PickupAppointment"("shipperId");

-- CreateIndex
CREATE INDEX "PickupAppointment_assignedDriverId_idx" ON "PickupAppointment"("assignedDriverId");

-- CreateIndex
CREATE INDEX "PickupAppointment_scheduledDate_idx" ON "PickupAppointment"("scheduledDate");

-- CreateIndex
CREATE INDEX "PickupAppointment_status_idx" ON "PickupAppointment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InterDepotTransfer_transferNumber_key" ON "InterDepotTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "InterDepotTransfer_transferNumber_idx" ON "InterDepotTransfer"("transferNumber");

-- CreateIndex
CREATE INDEX "InterDepotTransfer_sourceDepositId_idx" ON "InterDepotTransfer"("sourceDepositId");

-- CreateIndex
CREATE INDEX "InterDepotTransfer_destinationDepositId_idx" ON "InterDepotTransfer"("destinationDepositId");

-- CreateIndex
CREATE INDEX "InterDepotTransfer_status_idx" ON "InterDepotTransfer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentVoucher_voucherNumber_key" ON "PaymentVoucher"("voucherNumber");

-- CreateIndex
CREATE INDEX "PaymentVoucher_voucherNumber_idx" ON "PaymentVoucher"("voucherNumber");

-- CreateIndex
CREATE INDEX "PaymentVoucher_shipperId_idx" ON "PaymentVoucher"("shipperId");

-- CreateIndex
CREATE INDEX "PaymentVoucher_status_idx" ON "PaymentVoucher"("status");

-- CreateIndex
CREATE INDEX "PaymentVoucher_createdAt_idx" ON "PaymentVoucher"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRecord_returnNumber_key" ON "ReturnRecord"("returnNumber");

-- CreateIndex
CREATE INDEX "ReturnRecord_returnNumber_idx" ON "ReturnRecord"("returnNumber");

-- CreateIndex
CREATE INDEX "ReturnRecord_packageId_idx" ON "ReturnRecord"("packageId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipperConfig" ADD CONSTRAINT "ShipperConfig_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipperUser" ADD CONSTRAINT "ShipperUser_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipperUser" ADD CONSTRAINT "ShipperUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPhone" ADD CONSTRAINT "CustomerPhone_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_customerAddressId_fkey" FOREIGN KEY ("customerAddressId") REFERENCES "CustomerAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_originDepositId_fkey" FOREIGN KEY ("originDepositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_currentDepositId_fkey" FOREIGN KEY ("currentDepositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_destinationDepositId_fkey" FOREIGN KEY ("destinationDepositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_currentRunsheetId_fkey" FOREIGN KEY ("currentRunsheetId") REFERENCES "Runsheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_interDepotTransferId_fkey" FOREIGN KEY ("interDepotTransferId") REFERENCES "InterDepotTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_paymentVoucherId_fkey" FOREIGN KEY ("paymentVoucherId") REFERENCES "PaymentVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageTimeline" ADD CONSTRAINT "PackageTimeline_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_runsheetId_fkey" FOREIGN KEY ("runsheetId") REFERENCES "Runsheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartialDelivery" ADD CONSTRAINT "PartialDelivery_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRecord" ADD CONSTRAINT "ExchangeRecord_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runsheet" ADD CONSTRAINT "Runsheet_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runsheet" ADD CONSTRAINT "Runsheet_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunsheetItem" ADD CONSTRAINT "RunsheetItem_runsheetId_fkey" FOREIGN KEY ("runsheetId") REFERENCES "Runsheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunsheetItem" ADD CONSTRAINT "RunsheetItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupAppointment" ADD CONSTRAINT "PickupAppointment_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupAppointment" ADD CONSTRAINT "PickupAppointment_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterDepotTransfer" ADD CONSTRAINT "InterDepotTransfer_sourceDepositId_fkey" FOREIGN KEY ("sourceDepositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterDepotTransfer" ADD CONSTRAINT "InterDepotTransfer_destinationDepositId_fkey" FOREIGN KEY ("destinationDepositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterDepotTransfer" ADD CONSTRAINT "InterDepotTransfer_transporterDriverId_fkey" FOREIGN KEY ("transporterDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentVoucher" ADD CONSTRAINT "PaymentVoucher_shipperId_fkey" FOREIGN KEY ("shipperId") REFERENCES "Shipper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRecord" ADD CONSTRAINT "ReturnRecord_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
