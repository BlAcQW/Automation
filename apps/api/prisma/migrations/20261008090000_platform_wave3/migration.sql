-- Wave 3. Additive only. One data step: backfill Admin.role from isSuperAdmin.

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'OWNER',
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecretEnc" TEXT;

-- Data step: existing super admins stay OWNER; everyone else becomes SUPPORT
-- (least privilege that still lets them work). New rows default to OWNER.
UPDATE "Admin" SET "role" = CASE WHEN "isSuperAdmin" THEN 'OWNER' ELSE 'SUPPORT' END;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "outboundPausedAt" TIMESTAMP(3),
ADD COLUMN     "pauseReason" TEXT,
ADD COLUMN     "payoutsPausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "refundAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundLastError" TEXT,
ADD COLUMN     "refundNextAttemptAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SupportSession" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingTerms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "setupFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "monthlyFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "unitPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "unitEventType" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingTerms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportSession_tenantId_createdAt_idx" ON "SupportSession"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportSession_adminId_createdAt_idx" ON "SupportSession"("adminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingTerms_tenantId_key" ON "BillingTerms"("tenantId");

-- CreateIndex
CREATE INDEX "Booking_depositState_refundNextAttemptAt_idx" ON "Booking"("depositState", "refundNextAttemptAt");

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportSession" ADD CONSTRAINT "SupportSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingTerms" ADD CONSTRAINT "BillingTerms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
