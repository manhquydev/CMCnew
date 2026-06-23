-- CreateEnum
CREATE TYPE "BadgeSource" AS ENUM ('auto', 'manual');

-- CreateTable
CREATE TABLE "badge" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon_url" TEXT,
    "unlock_criteria" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_badge" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "badge_id" UUID NOT NULL,
    "source" "BadgeSource" NOT NULL DEFAULT 'auto',
    "awarded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_badge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "badge_facility_id_idx" ON "badge"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "badge_facility_id_code_key" ON "badge"("facility_id", "code");

-- CreateIndex
CREATE INDEX "student_badge_student_id_idx" ON "student_badge"("student_id");

-- CreateIndex
CREATE INDEX "student_badge_facility_id_idx" ON "student_badge"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_badge_student_id_badge_id_key" ON "student_badge"("student_id", "badge_id");

-- AddForeignKey
ALTER TABLE "student_badge" ADD CONSTRAINT "student_badge_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_badge" ADD CONSTRAINT "student_badge_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (principal-aware). `badge` is a facility catalog: readable by ANY principal whose
-- facility set includes it (parents/students need name/icon for the shelf), writable by staff
-- only. `student_badge` is student-owned (staff→facility, parent/student→student_id ∈
-- app.student_ids); writes are staff/system only (auto-award runs in the teacher's tx, and
-- manual grant is staff) so a parent/student can never mint a badge. cmc_app DML granted by
-- ALTER DEFAULT PRIVILEGES (rls_tenancy migration).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "badge" ENABLE ROW LEVEL SECURITY;
CREATE POLICY badge_isolation ON "badge"
  USING (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
  WITH CHECK (app_is_super_admin() OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())));

ALTER TABLE "student_badge" ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_badge_isolation ON "student_badge"
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
    OR (app_principal_kind() <> 'staff' AND student_id = ANY (app_student_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids()))
  );
