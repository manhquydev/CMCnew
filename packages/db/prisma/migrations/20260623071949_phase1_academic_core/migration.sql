-- CreateEnum
CREATE TYPE "Program" AS ENUM ('UCREA', 'BRIGHT_IG', 'BLACK_HOLE');

-- CreateEnum
CREATE TYPE "StudentLifecycle" AS ENUM ('admitted', 'active', 'on_hold', 'transferred', 'withdrawn', 'completed');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('planned', 'open', 'running', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('planned', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('active', 'completed', 'reserved', 'transferred', 'withdrawn');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late');

-- CreateEnum
CREATE TYPE "RecordEventType" AS ENUM ('created', 'updated', 'status_changed', 'archived', 'restored', 'note');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'head_teacher';
ALTER TYPE "Role" ADD VALUE 'bgd';

-- CreateTable
CREATE TABLE "course" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "program" "Program" NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "program" "Program" NOT NULL,
    "level" TEXT,
    "lifecycle" "StudentLifecycle" NOT NULL DEFAULT 'admitted',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_batch" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "capacity" INTEGER,
    "status" "ClassStatus" NOT NULL DEFAULT 'planned',
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_slot" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "class_batch_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "room_id" UUID,
    "teacher_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_session" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "class_batch_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "room_id" UUID,
    "teacher_id" UUID,
    "status" "SessionStatus" NOT NULL DEFAULT 'planned',
    "is_makeup" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "class_batch_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
    "opportunity_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "class_session_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "excused" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "marked_by_id" UUID,
    "marked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_code_counter" (
    "facility_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "batch_code_counter_pkey" PRIMARY KEY ("facility_id","year")
);

-- CreateTable
CREATE TABLE "record_event" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "type" "RecordEventType" NOT NULL,
    "changes" JSONB,
    "body" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_follower" (
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_follower_pkey" PRIMARY KEY ("entity_type","entity_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_code_key" ON "course"("code");

-- CreateIndex
CREATE UNIQUE INDEX "student_student_code_key" ON "student"("student_code");

-- CreateIndex
CREATE INDEX "student_facility_id_idx" ON "student"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_batch_code_key" ON "class_batch"("code");

-- CreateIndex
CREATE INDEX "class_batch_facility_id_idx" ON "class_batch"("facility_id");

-- CreateIndex
CREATE INDEX "room_facility_id_idx" ON "room"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_facility_id_code_key" ON "room"("facility_id", "code");

-- CreateIndex
CREATE INDEX "schedule_slot_facility_id_idx" ON "schedule_slot"("facility_id");

-- CreateIndex
CREATE INDEX "schedule_slot_class_batch_id_idx" ON "schedule_slot"("class_batch_id");

-- CreateIndex
CREATE INDEX "class_session_facility_id_idx" ON "class_session"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_session_class_batch_id_session_date_start_time_key" ON "class_session"("class_batch_id", "session_date", "start_time");

-- CreateIndex
CREATE INDEX "enrollment_facility_id_idx" ON "enrollment"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_class_batch_id_student_id_key" ON "enrollment"("class_batch_id", "student_id");

-- CreateIndex
CREATE INDEX "attendance_facility_id_idx" ON "attendance"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_class_session_id_enrollment_id_key" ON "attendance"("class_session_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "record_event_entity_type_entity_id_idx" ON "record_event"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "record_event_facility_id_idx" ON "record_event"("facility_id");

-- AddForeignKey
ALTER TABLE "class_batch" ADD CONSTRAINT "class_batch_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_class_batch_id_fkey" FOREIGN KEY ("class_batch_id") REFERENCES "class_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_class_batch_id_fkey" FOREIGN KEY ("class_batch_id") REFERENCES "class_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_class_batch_id_fkey" FOREIGN KEY ("class_batch_id") REFERENCES "class_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_class_session_id_fkey" FOREIGN KEY ("class_session_id") REFERENCES "class_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS for Phase 1 facility-scoped tables ──
-- (Course is GLOBAL by design → no RLS. record_follower is non-sensitive metadata → no RLS.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student','class_batch','room','schedule_slot','class_session','enrollment','attendance','batch_code_counter']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
        WITH CHECK (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
    $f$, t);
  END LOOP;
END$$;

-- record_event: facility_id is nullable (null = global record like Course); allow those to all staff.
ALTER TABLE record_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY record_event_isolation ON record_event
  USING (app_is_super_admin() OR facility_id IS NULL OR facility_id = ANY (app_facility_ids()))
  WITH CHECK (app_is_super_admin() OR facility_id IS NULL OR facility_id = ANY (app_facility_ids()));
