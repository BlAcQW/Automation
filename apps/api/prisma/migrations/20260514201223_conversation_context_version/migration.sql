-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "contextVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Order_paymentReference_idx" ON "Order"("paymentReference");
