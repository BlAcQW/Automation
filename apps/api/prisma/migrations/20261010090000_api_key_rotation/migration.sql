-- API key rotation with overlap: a key rotated with a grace period keeps
-- working until expiresAt; rotatedFromId links a replacement to the key it
-- replaced. Both nullable, no default, no backfill: existing keys are
-- unaffected (NULL expiresAt = never expires). Metadata-only change on Postgres.
ALTER TABLE "ApiKey" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN "rotatedFromId" TEXT;
