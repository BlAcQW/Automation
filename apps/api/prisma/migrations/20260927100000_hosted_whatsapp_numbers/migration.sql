-- Phase 6 — Bookly-hosted WhatsApp numbers.
--
-- A hosted number lives on Bookly's OWN WhatsApp Business Account, which means
-- Meta bills Bookly for that tenant's messages and Bookly rebills the tenant in
-- local currency. This is the only arrangement a Mobile-Money-only business can
-- complete, because Meta itself accepts neither MTN MoMo nor its peers.
--
-- Existing tenants are all bring-your-own (Embedded Signup, tenant owns the WABA
-- and pays Meta directly), so FALSE is the correct default and no backfill is
-- needed. `whatsappNumberStatus` stays NULL for those rows: a BYO number is live
-- the moment it connects, whereas a hosted number passes through PENDING_CODE
-- before reaching REGISTERED.

ALTER TABLE "Tenant" ADD COLUMN "whatsappHosted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "whatsappNumberStatus" TEXT;

ALTER TABLE "Tenant" ADD COLUMN "whatsappRegistrationPin" TEXT;
