-- Payaza as a second per-organisation payment provider (next to Paystack).
-- Purely additive: two new enums, four new Tenant columns with defaults (every existing tenant
-- stays on PAYSTACK, Payaza not connected, TEST mode) and two nullable columns recording which
-- provider took a ride payment. Safe to deploy before or after the API that uses it: the old build
-- never reads these columns.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'PAYAZA');

-- CreateEnum
CREATE TYPE "PayazaMode" AS ENUM ('TEST', 'LIVE');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "payazaMode" "PayazaMode" NOT NULL DEFAULT 'TEST',
ADD COLUMN     "payazaPublicKey" TEXT,
ADD COLUMN     "payazaSecretKey" TEXT,
ADD COLUMN     "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK';

-- AlterTable
ALTER TABLE "RidePass" ADD COLUMN     "paymentProvider" TEXT;

-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "paymentProvider" TEXT;
