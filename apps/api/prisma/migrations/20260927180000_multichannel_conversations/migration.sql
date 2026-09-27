-- Multi-channel conversations: WhatsApp, Instagram, Messenger.
--
-- Conversations were identified by phone number, which only exists on WhatsApp.
-- Instagram and Messenger identify people by an opaque scoped id, so identity
-- moves to (channel, externalId) and the phone becomes optional display data.
--
-- The backfill is the careful part: every existing row is WhatsApp, and its
-- externalId is exactly the phone it was already keyed on, so the new unique
-- reproduces the old one for existing data.

CREATE TYPE "ConversationChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'MESSENGER');

ALTER TABLE "Conversation" ADD COLUMN "channel" "ConversationChannel" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "Conversation" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "customerHandle" TEXT;

-- Existing rows: the phone was the identity, so it becomes the externalId.
UPDATE "Conversation" SET "externalId" = "customerPhone" WHERE "externalId" IS NULL;

ALTER TABLE "Conversation" ALTER COLUMN "externalId" SET NOT NULL;
ALTER TABLE "Conversation" ALTER COLUMN "customerPhone" DROP NOT NULL;

DROP INDEX IF EXISTS "Conversation_tenantId_customerPhone_key";
CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalId_key"
  ON "Conversation"("tenantId", "channel", "externalId");
CREATE INDEX "Conversation_tenantId_channel_idx" ON "Conversation"("tenantId", "channel");

-- Facebook Page + Instagram credentials. One Page token serves both channels.
ALTER TABLE "Tenant" ADD COLUMN "facebookPageId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "facebookPageName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "facebookPageToken" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "instagramUserId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "instagramUsername" TEXT;
CREATE UNIQUE INDEX "Tenant_facebookPageId_key" ON "Tenant"("facebookPageId");
CREATE UNIQUE INDEX "Tenant_instagramUserId_key" ON "Tenant"("instagramUserId");
