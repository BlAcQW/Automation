-- Phase 4b — Tenant SaaS subscription lifecycle.

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable: subscription state lives directly on Tenant — single-tenant single-sub.
ALTER TABLE "Tenant" ADD COLUMN "subscriptionStatus"       "SubscriptionStatus";
ALTER TABLE "Tenant" ADD COLUMN "subscriptionRef"          TEXT;
ALTER TABLE "Tenant" ADD COLUMN "subscriptionEmailToken"   TEXT;
ALTER TABLE "Tenant" ADD COLUMN "subscriptionCustomerCode" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "currentPeriodEnd"         TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt"              TIMESTAMP(3);
