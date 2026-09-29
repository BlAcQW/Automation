-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('EXTERNAL', 'TENANT_PENDING', 'TENANT_AVAILABLE', 'PAYOUT_PENDING', 'PLATFORM_FEE');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('DEPOSIT_RECEIVED', 'FUNDS_CLEARED', 'REFUND_ISSUED', 'PAYOUT_REQUESTED', 'PAYOUT_SETTLED', 'PAYOUT_REVERSED', 'PLATFORM_FEE_TAKEN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- DropIndex
DROP INDEX "Message_billingCategory_createdAt_idx";

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "cachedAvailableMinor" INTEGER NOT NULL DEFAULT 0,
    "cachedPendingMinor" INTEGER NOT NULL DEFAULT 0,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "bookingId" TEXT,
    "orderId" TEXT,
    "payoutId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRecipient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "providerCode" TEXT,
    "usableFrom" TIMESTAMP(3) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "recipientId" TEXT NOT NULL,
    "providerRef" TEXT,
    "failureReason" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_tenantId_key" ON "Wallet"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerMovement_idempotencyKey_key" ON "LedgerMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerMovement_tenantId_createdAt_idx" ON "LedgerMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_account_idx" ON "LedgerEntry"("tenantId", "account");

-- CreateIndex
CREATE INDEX "LedgerEntry_movementId_idx" ON "LedgerEntry"("movementId");

-- CreateIndex
CREATE INDEX "PayoutRecipient_tenantId_idx" ON "PayoutRecipient"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRequest_providerRef_key" ON "PayoutRequest"("providerRef");

-- CreateIndex
CREATE INDEX "PayoutRequest_tenantId_status_idx" ON "PayoutRequest"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "LedgerMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "PayoutRecipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

