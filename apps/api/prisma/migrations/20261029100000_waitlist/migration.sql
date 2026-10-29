-- Waitlist while self sign-up is closed (REGISTRATION_OPEN unset = closed).
-- Purely additive: one new enum and one new table, nothing else is touched, no backfill.
-- Safe to deploy before or after the API that uses it: the old build never reads this table.
-- The invite token is never stored, only its SHA-256 hex (inviteTokenHash).

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('NEW', 'CONTACTED', 'INVITED', 'JOINED', 'DECLINED');

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "businessName" VARCHAR(120) NOT NULL,
    "businessType" VARCHAR(32) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "heardFrom" VARCHAR(120),
    "message" VARCHAR(500),
    "status" "WaitlistStatus" NOT NULL DEFAULT 'NEW',
    "adminNotes" VARCHAR(2000),
    "inviteTokenHash" VARCHAR(64),
    "invitedAt" TIMESTAMP(3),
    "inviteExpiresAt" TIMESTAMP(3),
    "invitedByAdminId" TEXT,
    "inviteUsedAt" TIMESTAMP(3),
    "joinedTenantId" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_email_key" ON "WaitlistEntry"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_inviteTokenHash_key" ON "WaitlistEntry"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "WaitlistEntry_status_createdAt_idx" ON "WaitlistEntry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_businessType_idx" ON "WaitlistEntry"("businessType");

-- CreateIndex
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_joinedTenantId_idx" ON "WaitlistEntry"("joinedTenantId");
