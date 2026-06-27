-- CreateEnum
CREATE TYPE "StaffNotifEvent" AS ENUM ('class_cancelled', 'enrollment_new', 'receipt_pending_approval', 'kpi_pending_review');

-- CreateTable
CREATE TABLE "staff_notification" (
    "id" TEXT NOT NULL,
    "recipient_id" UUID NOT NULL,
    "event" "StaffNotifEvent" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "facility_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_notification_recipient_id_read_at_idx" ON "staff_notification"("recipient_id", "read_at");

-- CreateIndex
CREATE INDEX "staff_notification_facility_id_idx" ON "staff_notification"("facility_id");

-- AddForeignKey
ALTER TABLE "staff_notification" ADD CONSTRAINT "staff_notification_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_notification" ADD CONSTRAINT "staff_notification_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
