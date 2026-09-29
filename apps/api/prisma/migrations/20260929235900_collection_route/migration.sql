-- Record server-side which Paystack account collected a payment.
--
-- Whether money reached Bookly was previously inferred from the transaction
-- reference prefix and the provider's metadata. Both become attacker-
-- controlled the moment a tenant connects their own Paystack key: they could
-- mint a transaction in their own account carrying a platform-looking
-- reference, have it verified against their own key, and have Bookly credit a
-- wallet for money that never arrived — then withdraw it from Bookly's real
-- balance.
--
-- Existing rows stay NULL, which fails closed: no wallet is credited for any
-- payment taken before this column existed. Every one of those went through a
-- tenant's own gateway, so that is correct rather than merely safe.

ALTER TABLE "Booking" ADD COLUMN "collectionRoute" TEXT;
ALTER TABLE "Order" ADD COLUMN "collectionRoute" TEXT;
