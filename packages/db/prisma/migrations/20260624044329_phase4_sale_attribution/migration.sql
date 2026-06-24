-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('new', 'renewal');

-- AlterTable
ALTER TABLE "opportunity" ADD COLUMN     "owner_id" UUID;

-- AlterTable
ALTER TABLE "receipt" ADD COLUMN     "kind" "ReceiptKind",
ADD COLUMN     "opportunity_id" UUID,
ADD COLUMN     "sold_by_id" UUID;

-- CreateIndex
CREATE INDEX "opportunity_owner_id_idx" ON "opportunity"("owner_id");

-- CreateIndex
CREATE INDEX "receipt_sold_by_id_status_idx" ON "receipt"("sold_by_id", "status");
