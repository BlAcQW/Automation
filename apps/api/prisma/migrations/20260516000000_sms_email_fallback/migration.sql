-- Phase 5 — SMS (Arkesel) + Email (Gmail SMTP) fallback channels.

-- AlterTable: Tenant — per-tenant SMS + email connection credentials.
ALTER TABLE "Tenant" ADD COLUMN "arkeselApiKey"    TEXT;
ALTER TABLE "Tenant" ADD COLUMN "arkeselSenderId"  TEXT;
ALTER TABLE "Tenant" ADD COLUMN "gmailUser"        TEXT;
ALTER TABLE "Tenant" ADD COLUMN "gmailAppPassword" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "gmailFromName"    TEXT;

-- AlterTable: Booking + Order — optional customer email. When set, the
-- worker's email fallback can deliver to it; otherwise email layer is skipped.
ALTER TABLE "Booking" ADD COLUMN "customerEmail" TEXT;
ALTER TABLE "Order"   ADD COLUMN "customerEmail" TEXT;
