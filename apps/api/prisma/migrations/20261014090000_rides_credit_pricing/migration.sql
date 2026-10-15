-- RIDES pack (TURBO): fares by distance band and the Founding Package as GHS credit.
-- Additive: new nullable/defaulted columns, two backfills, and RidePassEntry.delta made nullable
-- (legacy ride count). No existing column is dropped or renamed; old code keeps working against it.

-- RideSettings: the fare reference point (unset = price from the pickup), package fares and the
-- flat fares beyond the last tier (null = not offered).
ALTER TABLE "RideSettings" ADD COLUMN "paygOverFareMinor" INTEGER DEFAULT 5000;
ALTER TABLE "RideSettings" ADD COLUMN "packageFares" JSONB NOT NULL DEFAULT '[{"upToKm":6,"fareMinor":1600},{"upToKm":10,"fareMinor":2500}]';
ALTER TABLE "RideSettings" ADD COLUMN "packageOverFareMinor" INTEGER DEFAULT 4000;
ALTER TABLE "RideSettings" ADD COLUMN "fareRefLabel" TEXT;
ALTER TABLE "RideSettings" ADD COLUMN "fareRefLat" DOUBLE PRECISION;
ALTER TABLE "RideSettings" ADD COLUMN "fareRefLng" DOUBLE PRECISION;

-- RidePass: the GHS credit bought. Backfilled for activated passes; code reads creditMinor ?? priceMinor.
ALTER TABLE "RidePass" ADD COLUMN "creditMinor" INTEGER;
UPDATE "RidePass" SET "creditMinor" = "priceMinor" WHERE "activatedAt" IS NOT NULL AND "creditMinor" IS NULL;

-- RidePassEntry: the balance log in signed pesewas. Old ride-count rows are converted at the
-- package's average price per ride: PURCHASE = the price paid, any other entry = delta x round(price / rides).
ALTER TABLE "RidePassEntry" ADD COLUMN "amountMinor" INTEGER;
UPDATE "RidePassEntry" AS e
SET "amountMinor" = CASE
        WHEN e."type" = 'PURCHASE' THEN p."priceMinor"
        ELSE COALESCE(e."delta", 0) * ROUND(p."priceMinor"::numeric / GREATEST(p."ridesTotal", 1))::INTEGER
    END
FROM "RidePass" AS p
WHERE p."id" = e."passId" AND e."amountMinor" IS NULL;
-- Every entry has its pass (FK, cascade); this only guards the NOT NULL below.
UPDATE "RidePassEntry" SET "amountMinor" = 0 WHERE "amountMinor" IS NULL;
ALTER TABLE "RidePassEntry" ALTER COLUMN "amountMinor" SET NOT NULL;
ALTER TABLE "RidePassEntry" ALTER COLUMN "delta" DROP NOT NULL;

-- Ride: how the fare was priced and how a package ride is paid (balance, top-up, waiver), and
-- what completion deducted. All null on rows from before this change.
ALTER TABLE "Ride" ADD COLUMN "priceDistanceKm" DOUBLE PRECISION;
ALTER TABLE "Ride" ADD COLUMN "priceBasis" TEXT;
ALTER TABLE "Ride" ADD COLUMN "fareBand" TEXT;
ALTER TABLE "Ride" ADD COLUMN "balanceAppliedMinor" INTEGER;
ALTER TABLE "Ride" ADD COLUMN "topupMinor" INTEGER;
ALTER TABLE "Ride" ADD COLUMN "waivedMinor" INTEGER;
ALTER TABLE "Ride" ADD COLUMN "deductedMinor" INTEGER;
ALTER TABLE "Ride" ADD COLUMN "balanceAfterMinor" INTEGER;
