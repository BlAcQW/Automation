-- Platform promo codes: created by admins, redeemed by tenants from Settings.
CREATE TYPE "PromoKind" AS ENUM ('TRIAL_EXTENSION', 'PLAN_GRANT');

CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "days" INTEGER NOT NULL,
    "planId" TEXT,
    "description" TEXT,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");
CREATE INDEX "PromoCode_isActive_idx" ON "PromoCode"("isActive");
ALTER TABLE "PromoCode"
    ADD CONSTRAINT "PromoCode_createdByAdminId_fkey"
    FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effect" JSONB,
    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromoRedemption_promoCodeId_tenantId_key" ON "PromoRedemption"("promoCodeId", "tenantId");
CREATE INDEX "PromoRedemption_tenantId_idx" ON "PromoRedemption"("tenantId");
ALTER TABLE "PromoRedemption"
    ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey"
    FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromoRedemption"
    ADD CONSTRAINT "PromoRedemption_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
