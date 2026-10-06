-- Atomic once-only event publishing without scanning JSON payloads.
-- Additive: a nullable column and a unique index (NULLs are distinct, so
-- ordinary events are unaffected).
ALTER TABLE "DomainEvent" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "DomainEvent_tenantId_dedupeKey_key" ON "DomainEvent"("tenantId", "dedupeKey");
