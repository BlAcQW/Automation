-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('UTILITY', 'MARKETING', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "TemplatePurpose" AS ENUM ('BOOKING_CONFIRMATION', 'BOOKING_REMINDER', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED', 'ORDER_CONFIRMATION', 'ORDER_SHIPPED', 'ORDER_DELIVERED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "lastInboundAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "category" "TemplateCategory" NOT NULL,
    "purpose" "TemplatePurpose" NOT NULL,
    "bodyPreview" TEXT,
    "variableCount" INTEGER NOT NULL DEFAULT 0,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_tenantId_lastInboundAt_idx" ON "Conversation"("tenantId", "lastInboundAt");

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_idx" ON "MessageTemplate"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_name_language_key" ON "MessageTemplate"("tenantId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_tenantId_purpose_key" ON "MessageTemplate"("tenantId", "purpose");

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
