-- Phase 4a — SaaS plan id + monthly outbound-message usage counter.

-- AlterTable: Tenant plan id
ALTER TABLE "Tenant" ADD COLUMN "planId" TEXT NOT NULL DEFAULT 'free';

-- CreateTable: TenantUsage (one row per tenant per month)
CREATE TABLE "TenantUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantUsage_tenantId_idx" ON "TenantUsage"("tenantId");

-- CreateIndex (compound unique drives the upsert)
CREATE UNIQUE INDEX "TenantUsage_tenantId_month_key" ON "TenantUsage"("tenantId", "month");

-- AddForeignKey
ALTER TABLE "TenantUsage" ADD CONSTRAINT "TenantUsage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
