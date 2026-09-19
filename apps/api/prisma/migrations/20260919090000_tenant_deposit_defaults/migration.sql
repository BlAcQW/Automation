-- Business-level deposit policy. Defaults mean every existing tenant starts
-- requiring a GHS 50 (their currency) deposit, which is the product decision:
-- a booking is not complete until the deposit is paid.
ALTER TABLE "Tenant"
    ADD COLUMN "depositRequired" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "defaultDepositAmount" DECIMAL(10,2) NOT NULL DEFAULT 50;
