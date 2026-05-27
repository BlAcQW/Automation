-- Phase 4c — per-tenant 30-day quota cycle anchor.
--
-- The previous quota was keyed by calendar month, so a tenant who paid mid-
-- month (e.g. May 12) got their fresh 5,000 messages on the calendar 1st —
-- effectively two cycles' worth of quota for a single payment. The cycle now
-- runs N*30 days from each tenant's signup, so 5,000 messages = 30 days
-- regardless of when the tenant joined.
--
-- The column is nullable so legacy tenants (createdAt is used as fallback in
-- the application code) keep working. For tenants that already exist we
-- backfill quotaCycleStart = createdAt so their first cycle reflects when
-- they actually signed up.

ALTER TABLE "Tenant" ADD COLUMN "quotaCycleStart" TIMESTAMP(3);

UPDATE "Tenant" SET "quotaCycleStart" = "createdAt" WHERE "quotaCycleStart" IS NULL;
