-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "publicToken" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "publicToken" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "outOfWindowMessagesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_publicToken_key" ON "Booking"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicToken_key" ON "Order"("publicToken");
