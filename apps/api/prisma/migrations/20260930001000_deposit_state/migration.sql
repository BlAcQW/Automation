-- Deposit lifecycle, separate from the booking's own status.
--
-- A refund takes about a second at the provider, and its ledger entry is only
-- written once that returns. During that window the ledger still shows the
-- money as pending, so a clearing that lands in between released the SAME
-- deposit to the salon: the customer got refunded AND the salon kept it, with
-- pending driven negative.
--
-- Whoever wins an atomic conditional update on this column owns the deposit.
-- The loser stops. NULL means still held, which is correct for every existing
-- row.

ALTER TABLE "Booking" ADD COLUMN "depositState" TEXT;
ALTER TABLE "Order" ADD COLUMN "depositState" TEXT;
