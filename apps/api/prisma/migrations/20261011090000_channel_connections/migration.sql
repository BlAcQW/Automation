-- Channel connections: who connected WhatsApp / Messenger / Instagram, how,
-- and when; plus WhatsApp health refreshed by the whatsapp-health sweeper.
-- Every column is nullable with no default, so the ADDs are metadata-only on
-- Postgres. Tokens are never stored here (whatsappAccessToken is unchanged).

ALTER TABLE "Tenant" ADD COLUMN "whatsappConnectionMode" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappConnectedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "whatsappConnectedByUserId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappVerifiedName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappNameStatus" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappCodeMethod" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappCodeSentAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "whatsappQualityRating" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappMessagingLimit" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappMetaStatus" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappHealthProblem" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "whatsappHealthCheckedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "whatsappTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "facebookConnectedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "facebookConnectedByUserId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "instagramConnectedAt" TIMESTAMP(3);

-- OTP sends to Bookly-hosted destinations, for per-destination and global caps.
CREATE TABLE "WhatsappOtpSend" (
    "id" TEXT NOT NULL,
    "destinationHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappOtpSend_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WhatsappOtpSend_destinationHash_createdAt_idx" ON "WhatsappOtpSend"("destinationHash", "createdAt");
CREATE INDEX "WhatsappOtpSend_createdAt_idx" ON "WhatsappOtpSend"("createdAt");

-- Backfill the mode for numbers connected before this column existed: a hosted
-- number is on Bookly's WABA, anything else came through the owner's own
-- account (Embedded Signup or manual; the two cannot be told apart afterwards).
UPDATE "Tenant"
SET "whatsappConnectionMode" = CASE WHEN "whatsappHosted" THEN 'BOOKLY_HOSTED' ELSE 'OWN_ACCOUNT' END
WHERE "whatsappPhoneNumberId" IS NOT NULL;

-- Best-effort connectedAt / connectedBy from the audit trail: the latest
-- connect event for each still-connected tenant. Tenants with no such event
-- keep NULL ("connected before records were kept").
UPDATE "Tenant" t
SET "whatsappConnectedAt" = a."createdAt",
    "whatsappConnectedByUserId" = a."actorId"
FROM (
    SELECT DISTINCT ON ("tenantId") "tenantId", "createdAt", "actorId"
    FROM "AuditLog"
    WHERE "action" IN ('whatsapp.connected', 'whatsapp.hosted_registered')
      AND "tenantId" IS NOT NULL
    ORDER BY "tenantId", "createdAt" DESC
) a
WHERE a."tenantId" = t."id" AND t."whatsappPhoneNumberId" IS NOT NULL;

UPDATE "Tenant" t
SET "facebookConnectedAt" = a."createdAt",
    "facebookConnectedByUserId" = a."actorId",
    "instagramConnectedAt" = CASE WHEN t."instagramUserId" IS NOT NULL THEN a."createdAt" ELSE NULL END
FROM (
    SELECT DISTINCT ON ("tenantId") "tenantId", "createdAt", "actorId"
    FROM "AuditLog"
    WHERE "action" = 'channels.facebook_connected' AND "tenantId" IS NOT NULL
    ORDER BY "tenantId", "createdAt" DESC
) a
WHERE a."tenantId" = t."id" AND t."facebookPageId" IS NOT NULL;
