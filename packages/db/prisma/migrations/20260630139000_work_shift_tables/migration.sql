-- Baseline for the work-shift feature schema. These tables were created on the
-- dev DB via `prisma db push` but never captured in a migration, so fresh/prod
-- deploys reached work_shift_rls (ALTER TABLE ... ENABLE ROW LEVEL SECURITY)
-- with the tables absent and failed there. Create the 7 tables + their enums
-- ahead of the RLS migration, and backfill the StaffNotifEvent values the staff
-- notification emitter relies on for shift registration / manual punch events.

-- Backfill StaffNotifEvent values used by shift-registration + manual-punch notifs
ALTER TYPE "StaffNotifEvent" ADD VALUE IF NOT EXISTS 'shift_reg_submitted';
ALTER TYPE "StaffNotifEvent" ADD VALUE IF NOT EXISTS 'shift_reg_approved';
ALTER TYPE "StaffNotifEvent" ADD VALUE IF NOT EXISTS 'shift_reg_rejected';
ALTER TYPE "StaffNotifEvent" ADD VALUE IF NOT EXISTS 'manual_punch_pending';

-- CreateEnum
CREATE TYPE "ShiftRegStatus" AS ENUM ('draft', 'submitted', 'approved', 'cancelled');

-- CreateEnum
CREATE TYPE "ShiftEntryType" AS ENUM ('work', 'leave');

-- CreateTable
CREATE TABLE "shift_group" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selection_mode" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_template" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "shift_group_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_registration" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "code" TEXT,
    "user_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "status" "ShiftRegStatus" NOT NULL DEFAULT 'draft',
    "shift_group_id" UUID NOT NULL,
    "manager_id" UUID,
    "next_manager_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" UUID,
    "reject_reason" TEXT,
    "superseded_by_id" UUID,
    "superseded_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_registration_entry" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_template_id" UUID NOT NULL,
    "type" "ShiftEntryType" NOT NULL DEFAULT 'work',
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_registration_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_punch" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT,
    "method" TEXT NOT NULL DEFAULT 'ip',
    "shift_template_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_punch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_network" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "ip_address" TEXT NOT NULL,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_network_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_code_counter" (
    "facility_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shift_code_counter_pkey" PRIMARY KEY ("facility_id","year")
);

-- CreateIndex (work-shift tables)
CREATE INDEX "shift_group_facility_id_idx" ON "shift_group"("facility_id");
CREATE UNIQUE INDEX "shift_group_facility_id_code_key" ON "shift_group"("facility_id", "code");
CREATE INDEX "shift_template_facility_id_idx" ON "shift_template"("facility_id");
CREATE INDEX "shift_template_shift_group_id_idx" ON "shift_template"("shift_group_id");
CREATE UNIQUE INDEX "shift_template_shift_group_id_code_key" ON "shift_template"("shift_group_id", "code");
CREATE UNIQUE INDEX "shift_template_shift_group_id_start_time_key" ON "shift_template"("shift_group_id", "start_time");
CREATE INDEX "shift_registration_facility_id_user_id_idx" ON "shift_registration"("facility_id", "user_id");
CREATE INDEX "shift_registration_facility_id_status_idx" ON "shift_registration"("facility_id", "status");
CREATE INDEX "shift_registration_user_id_from_date_to_date_idx" ON "shift_registration"("user_id", "from_date", "to_date");
CREATE UNIQUE INDEX "shift_registration_facility_id_code_key" ON "shift_registration"("facility_id", "code");
CREATE INDEX "shift_registration_entry_registration_id_idx" ON "shift_registration_entry"("registration_id");
CREATE INDEX "shift_registration_entry_date_idx" ON "shift_registration_entry"("date");
CREATE UNIQUE INDEX "shift_registration_entry_registration_id_date_shift_templat_key" ON "shift_registration_entry"("registration_id", "date", "shift_template_id");
CREATE INDEX "time_punch_facility_id_user_id_timestamp_idx" ON "time_punch"("facility_id", "user_id", "timestamp");
CREATE INDEX "time_punch_user_id_timestamp_idx" ON "time_punch"("user_id", "timestamp");
CREATE INDEX "time_punch_shift_template_id_idx" ON "time_punch"("shift_template_id");
CREATE INDEX "facility_network_facility_id_idx" ON "facility_network"("facility_id");
CREATE UNIQUE INDEX "facility_network_facility_id_ip_address_key" ON "facility_network"("facility_id", "ip_address");

-- AddForeignKey (work-shift tables)
ALTER TABLE "shift_template" ADD CONSTRAINT "shift_template_shift_group_id_fkey" FOREIGN KEY ("shift_group_id") REFERENCES "shift_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_registration" ADD CONSTRAINT "shift_registration_shift_group_id_fkey" FOREIGN KEY ("shift_group_id") REFERENCES "shift_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_registration_entry" ADD CONSTRAINT "shift_registration_entry_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "shift_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_registration_entry" ADD CONSTRAINT "shift_registration_entry_shift_template_id_fkey" FOREIGN KEY ("shift_template_id") REFERENCES "shift_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_punch" ADD CONSTRAINT "time_punch_shift_template_id_fkey" FOREIGN KEY ("shift_template_id") REFERENCES "shift_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
