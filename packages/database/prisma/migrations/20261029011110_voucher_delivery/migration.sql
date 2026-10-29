-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "checkoutUrl" VARCHAR(500);

-- CreateTable
CREATE TABLE "voucher_deliveries" (
    "voucherId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "codeEnc" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revealCount" INTEGER NOT NULL DEFAULT 0,
    "lastRevealedAt" TIMESTAMPTZ(3),

    CONSTRAINT "voucher_deliveries_pkey" PRIMARY KEY ("voucherId")
);

-- CreateIndex
CREATE INDEX "voucher_deliveries_expiresAt_idx" ON "voucher_deliveries"("expiresAt");

-- AddForeignKey
ALTER TABLE "voucher_deliveries" ADD CONSTRAINT "voucher_deliveries_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_deliveries" ADD CONSTRAINT "voucher_deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
