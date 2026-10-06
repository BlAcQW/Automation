-- AlterTable: Message.handledAt marks an inbound message whose turn completed.
ALTER TABLE "Message" ADD COLUMN "handledAt" TIMESTAMP(3);

-- AlterTable: reply outbox. replyToId links an OUTBOUND agent reply to the
-- inbound message it answers; sendState is PENDING | SENT | SUPPRESSED so a
-- reply whose send failed can be re-sent verbatim on retry (never re-generated).
ALTER TABLE "Message" ADD COLUMN "replyToId" TEXT;
ALTER TABLE "Message" ADD COLUMN "sendState" TEXT;
ALTER TABLE "Message" ADD COLUMN "sendClaimedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");

-- Backfill: every inbound message that exists now was already answered (or
-- deliberately not) under the old flow. Without this, the first redelivery of
-- an old message would be treated as "stored but unhandled" and re-answered.
UPDATE "Message" SET "handledAt" = "createdAt" WHERE "direction" = 'INBOUND';

-- CreateTable
CREATE TABLE "WebhookInbox" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAlert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "PlatformAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookInbox_status_receivedAt_idx" ON "WebhookInbox"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookInbox_status_nextAttemptAt_idx" ON "WebhookInbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookInbox_status_claimedAt_idx" ON "WebhookInbox"("status", "claimedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAlert_dedupeKey_key" ON "PlatformAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "PlatformAlert_resolvedAt_severity_lastSeenAt_idx" ON "PlatformAlert"("resolvedAt", "severity", "lastSeenAt");

-- CreateIndex
CREATE INDEX "PlatformAlert_tenantId_idx" ON "PlatformAlert"("tenantId");
