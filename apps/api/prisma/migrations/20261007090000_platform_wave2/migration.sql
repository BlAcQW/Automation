-- Wave 2. Additive only: new nullable Tenant/Conversation/Booking/Order columns, new tables. No backfill.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "activeFlowKey" TEXT,
ADD COLUMN     "conversationMode" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "FlowDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "vertical" "Vertical",
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "FlowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalApp" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "signingSecretEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secretEnc" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowDefinition_tenantId_key_isActive_idx" ON "FlowDefinition"("tenantId", "key", "isActive");

-- CreateIndex
CREATE INDEX "FlowDefinition_vertical_key_idx" ON "FlowDefinition"("vertical", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FlowDefinition_tenantId_key_version_key" ON "FlowDefinition"("tenantId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalApp_tenantId_key" ON "ExternalApp"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "DomainEvent_tenantId_createdAt_idx" ON "DomainEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "DomainEvent_type_createdAt_idx" ON "DomainEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookSubscription_tenantId_idx" ON "WebhookSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_claimedAt_idx" ON "WebhookDelivery"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_idx" ON "WebhookDelivery"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_eventId_idx" ON "WebhookDelivery"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_subscriptionId_eventId_key" ON "WebhookDelivery"("subscriptionId", "eventId");

-- CreateIndex
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");

-- CreateIndex
CREATE INDEX "Conversation_customerId_idx" ON "Conversation"("customerId");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalApp" ADD CONSTRAINT "ExternalApp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

