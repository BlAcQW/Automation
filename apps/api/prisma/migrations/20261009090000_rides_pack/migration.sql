-- RIDES pack (TURBO, R1). Additive only: new enums and tables, no change to existing rows.
-- RidePassEntry is an append-only balance log (application code never updates or deletes it);
-- its UNIQUE(rideId) makes a completed ride deduct at most once.

-- CreateEnum
CREATE TYPE "RidePassStatus" AS ENUM ('HELD', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RidePassEntryType" AS ENUM ('PURCHASE', 'RIDE', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RideKind" AS ENUM ('PACKAGE', 'PAYG');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('PENDING_PAYMENT', 'REQUESTED', 'ASSIGNED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RideSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "packagePriceMinor" INTEGER NOT NULL DEFAULT 96000,
    "packageRides" INTEGER NOT NULL DEFAULT 60,
    "validityDays" INTEGER NOT NULL DEFAULT 60,
    "maxKm" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "foundingCap" INTEGER NOT NULL DEFAULT 50,
    "holdMinutes" INTEGER NOT NULL DEFAULT 30,
    "paygOpen" BOOLEAN NOT NULL DEFAULT true,
    "paygDailyLimit" INTEGER NOT NULL DEFAULT 10,
    "paygFares" JSONB NOT NULL DEFAULT '[{"upToKm":6,"fareMinor":2500},{"upToKm":10,"fareMinor":3500}]',
    "roadFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "driverSms" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Accra',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideDestination" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RidePass" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "status" "RidePassStatus" NOT NULL DEFAULT 'HELD',
    "ridesTotal" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "maxKm" DOUBLE PRECISION NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "holdExpiresAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidAmountMinor" INTEGER,
    "providerTransactionId" TEXT,
    "paymentChannel" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "expiryReminderSentAt" TIMESTAMP(3),
    "lowBalanceReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RidePass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RidePassEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "type" "RidePassEntryType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "rideId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RidePassEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" "RideKind" NOT NULL,
    "status" "RideStatus" NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "passId" TEXT,
    "driverId" TEXT,
    "pickupLabel" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "destinationLabel" TEXT NOT NULL,
    "destinationLat" DOUBLE PRECISION NOT NULL,
    "destinationLng" DOUBLE PRECISION NOT NULL,
    "destinationId" TEXT,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "fareMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "paymentReference" TEXT,
    "paymentExpiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidAmountMinor" INTEGER,
    "providerTransactionId" TEXT,
    "paymentChannel" TEXT,
    "paygDay" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "enRouteAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaygDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaygDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RideSettings_tenantId_key" ON "RideSettings"("tenantId");

-- CreateIndex
CREATE INDEX "RideDestination_tenantId_active_sort_idx" ON "RideDestination"("tenantId", "active", "sort");

-- CreateIndex
CREATE INDEX "Driver_tenantId_active_idx" ON "Driver"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RidePass_paymentReference_key" ON "RidePass"("paymentReference");

-- CreateIndex
CREATE INDEX "RidePass_tenantId_status_idx" ON "RidePass"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RidePass_tenantId_customerId_idx" ON "RidePass"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "RidePass_status_holdExpiresAt_idx" ON "RidePass"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "RidePass_status_expiresAt_idx" ON "RidePass"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RidePassEntry_rideId_key" ON "RidePassEntry"("rideId");

-- CreateIndex
CREATE INDEX "RidePassEntry_tenantId_passId_idx" ON "RidePassEntry"("tenantId", "passId");

-- CreateIndex
CREATE UNIQUE INDEX "Ride_paymentReference_key" ON "Ride"("paymentReference");

-- CreateIndex
CREATE INDEX "Ride_tenantId_status_createdAt_idx" ON "Ride"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Ride_tenantId_customerId_createdAt_idx" ON "Ride"("tenantId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Ride_status_paymentExpiresAt_idx" ON "Ride"("status", "paymentExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ride_tenantId_ref_key" ON "Ride"("tenantId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "PaygDay_tenantId_day_key" ON "PaygDay"("tenantId", "day");

-- AddForeignKey
ALTER TABLE "RideSettings" ADD CONSTRAINT "RideSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideDestination" ADD CONSTRAINT "RideDestination_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePass" ADD CONSTRAINT "RidePass_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePass" ADD CONSTRAINT "RidePass_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePassEntry" ADD CONSTRAINT "RidePassEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RidePassEntry" ADD CONSTRAINT "RidePassEntry_passId_fkey" FOREIGN KEY ("passId") REFERENCES "RidePass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_passId_fkey" FOREIGN KEY ("passId") REFERENCES "RidePass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaygDay" ADD CONSTRAINT "PaygDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

