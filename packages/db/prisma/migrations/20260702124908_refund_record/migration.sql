-- CreateTable
CREATE TABLE "refund_record" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_record_receipt_id_idx" ON "refund_record"("receipt_id");

-- CreateIndex
CREATE INDEX "refund_record_facility_id_idx" ON "refund_record"("facility_id");

-- AddForeignKey
ALTER TABLE "refund_record" ADD CONSTRAINT "refund_record_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
