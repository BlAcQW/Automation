-- Widen MessageType to every kind WhatsApp can carry, and record what Meta
-- actually billed each outbound message as.
--
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction from v12, as
-- long as the new values are not USED in the same transaction. Nothing below
-- writes them, so this is safe to run as one migration.

-- AlterEnum: additional message types
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'VIDEO';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'AUDIO';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'STICKER';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'LOCATION';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CONTACT';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'REACTION';

-- CreateEnum: delivery state from Meta's status webhook
DO $$ BEGIN
    CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: delivery state + what Meta billed it as
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "status" "MessageStatus";
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "billingCategory" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "billable" BOOLEAN;

-- Billing reports scan by category over a period.
CREATE INDEX IF NOT EXISTS "Message_billingCategory_createdAt_idx"
    ON "Message"("billingCategory", "createdAt");
