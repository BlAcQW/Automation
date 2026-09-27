-- Concurrent booking capacity.
--
-- Until now the availability engine modelled every business as a single
-- resource: one booking per time slot, full stop. A three-chair salon could
-- therefore only ever be offered one appointment at a time, so two thirds of
-- its capacity was invisible to customers — lost revenue, not a cosmetic gap.
--
-- Default 1 reproduces exactly the previous behaviour, so no existing tenant
-- changes until they raise it themselves.

ALTER TABLE "Tenant" ADD COLUMN "bookingCapacity" INTEGER NOT NULL DEFAULT 1;
