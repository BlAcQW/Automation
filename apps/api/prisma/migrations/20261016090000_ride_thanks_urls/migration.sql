-- Thank-you pages after a ride payment: where Payaza (redirect_url) and Paystack (callback_url)
-- send the customer once they have paid. Purely additive: two nullable columns, no default, no
-- backfill. Null keeps today's behaviour (the wa.me link back into the WhatsApp chat), so it is
-- safe to deploy before or after the API that reads them.

-- AlterTable
ALTER TABLE "RideSettings" ADD COLUMN     "packageThanksUrl" VARCHAR(500),
ADD COLUMN     "rideThanksUrl" VARCHAR(500);
