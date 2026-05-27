-- AlterTable: Tenant — add Paystack credentials + payment currency
ALTER TABLE "Tenant" ADD COLUMN "paystackSecretKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "paystackPublicKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "paymentCurrency" TEXT NOT NULL DEFAULT 'NGN';

-- AlterTable: Order — track Paystack transaction reference + paid timestamp
ALTER TABLE "Order" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentAuthorizationUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentReference_key" ON "Order"("paymentReference");
