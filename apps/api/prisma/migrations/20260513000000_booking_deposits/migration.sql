-- Extend the BookingStatus enum with PENDING_PAYMENT.
-- Postgres ADD VALUE is non-transactional but safe for additive changes.
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_PAYMENT' BEFORE 'CONFIRMED';

-- Service: per-service deposit (null = no deposit required)
ALTER TABLE "Service" ADD COLUMN "depositAmount" DECIMAL(10,2);

-- Booking: payment fields mirror Order's shape + a snapshot of the deposit
-- that was in effect when the booking was created (so a later price change
-- doesn't retroactively alter a held booking).
ALTER TABLE "Booking" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "Booking" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "Booking" ADD COLUMN "paymentAuthorizationUrl" TEXT;
ALTER TABLE "Booking" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "depositAmount" DECIMAL(10,2);

CREATE UNIQUE INDEX "Booking_paymentReference_key" ON "Booking"("paymentReference");
CREATE INDEX "Booking_paymentReference_idx" ON "Booking"("paymentReference");
