-- Mask customer contact details from staff.
--
-- A tenant's customer list is the most valuable asset in their account. Until
-- now any STAFF user could read and copy every customer's phone number from the
-- dashboard, so the whole book left with them when they did.
--
-- Defaulting to TRUE is deliberate: the safe behaviour should be the one you
-- get without doing anything. Owners who need staff to have raw numbers can
-- switch it off per tenant.

ALTER TABLE "Tenant" ADD COLUMN "maskCustomerContact" BOOLEAN NOT NULL DEFAULT true;
