-- Assistant knowledge base and staff notes on customers.
--
-- 1. BusinessKnowledge: what the owner tells the assistant about the business
--    (Settings > Your assistant). One row per tenant, created on first save.
--    No backfill: a tenant with no row gets exactly the prompt it had before.
-- 2. Customer.notes (+ who/when): a staff-only note per customer. Nullable,
--    no default, no backfill; a metadata-only change on Postgres.
--
-- Purely additive, so it is safe to deploy before or after the API that reads it.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "notes" VARCHAR(1000),
ADD COLUMN     "notesUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "notesUpdatedByUserId" TEXT;

-- CreateTable
CREATE TABLE "BusinessKnowledge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "about" VARCHAR(500),
    "specialties" VARCHAR(500),
    "audience" VARCHAR(500),
    "team" JSONB,
    "address" VARCHAR(500),
    "directions" VARCHAR(500),
    "mapsUrl" VARCHAR(500),
    "parking" VARCHAR(500),
    "minimumNotice" VARCHAR(500),
    "advanceBooking" VARCHAR(500),
    "walkIns" VARCHAR(500),
    "groupBookings" VARCHAR(500),
    "lateArrival" VARCHAR(500),
    "homeService" VARCHAR(500),
    "paymentMethods" VARCHAR(500),
    "cancellationPolicy" VARCHAR(1000),
    "preparation" VARCHAR(1000),
    "aftercare" VARCHAR(1000),
    "offer" VARCHAR(1000),
    "offerEndsOn" DATE,
    "faqs" JSONB,
    "tone" VARCHAR(500),
    "languages" VARCHAR(500),
    "notes" VARCHAR(2000),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessKnowledge_tenantId_key" ON "BusinessKnowledge"("tenantId");

-- AddForeignKey
ALTER TABLE "BusinessKnowledge" ADD CONSTRAINT "BusinessKnowledge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
