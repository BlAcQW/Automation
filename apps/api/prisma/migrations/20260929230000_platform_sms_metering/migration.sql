-- Per-tenant meter for SMS sent on Bookly's own Arkesel account.
--
-- Counted separately from messageCount because it is Bookly's money rather
-- than the tenant's plan allowance. Without a per-tenant cap, one busy tenant
-- spends the whole budget and every other tenant's reminders stop.

ALTER TABLE "TenantUsage" ADD COLUMN "platformSmsCount" INTEGER NOT NULL DEFAULT 0;
