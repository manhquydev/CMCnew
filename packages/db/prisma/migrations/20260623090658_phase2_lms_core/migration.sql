-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('homework', 'test_entrance', 'test_periodic');

-- CreateEnum
CREATE TYPE "ExerciseStatus" AS ENUM ('draft', 'published', 'closed');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('draft', 'submitted', 'graded');

-- CreateEnum
CREATE TYPE "StarTxnType" AS ENUM ('homework_completed', 'gift_redeemed', 'gift_rejected_refund', 'manual');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "GuardianRelation" AS ENUM ('father', 'mother', 'guardian');

-- CreateTable
CREATE TABLE "parent_account" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_account" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "login_code" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "parent_account_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "relation" "GuardianRelation" NOT NULL DEFAULT 'guardian',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "class_batch_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "base_pdf_ref" TEXT,
    "max_score" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "due_at" TIMESTAMP(3),
    "type" "ExerciseType" NOT NULL DEFAULT 'homework',
    "status" "ExerciseStatus" NOT NULL DEFAULT 'draft',
    "created_by_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "exercise_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "answer_text" TEXT,
    "annotation_layer" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "submission_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "max_score" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "feedback" TEXT,
    "rubric" JSONB,
    "annotation_layer" JSONB,
    "graded_by_id" UUID,
    "graded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "stars_required" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT -1,
    "program" "Program",
    "min_level" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "star_transaction" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "StarTxnType" NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "star_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER NOT NULL,
    "student_id" UUID NOT NULL,
    "gift_id" UUID NOT NULL,
    "stars_spent" INTEGER NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "facility_id" INTEGER,
    "recipient_type" TEXT NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parent_account_email_key" ON "parent_account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "parent_account_phone_key" ON "parent_account"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "student_account_student_id_key" ON "student_account"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_account_login_code_key" ON "student_account"("login_code");

-- CreateIndex
CREATE INDEX "guardian_facility_id_idx" ON "guardian"("facility_id");

-- CreateIndex
CREATE INDEX "guardian_student_id_idx" ON "guardian"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_parent_account_id_student_id_key" ON "guardian"("parent_account_id", "student_id");

-- CreateIndex
CREATE INDEX "exercise_facility_id_idx" ON "exercise"("facility_id");

-- CreateIndex
CREATE INDEX "exercise_class_batch_id_idx" ON "exercise"("class_batch_id");

-- CreateIndex
CREATE INDEX "submission_facility_id_idx" ON "submission"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_exercise_id_student_id_key" ON "submission"("exercise_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_submission_id_key" ON "grade"("submission_id");

-- CreateIndex
CREATE INDEX "grade_facility_id_idx" ON "grade"("facility_id");

-- CreateIndex
CREATE INDEX "gift_facility_id_idx" ON "gift"("facility_id");

-- CreateIndex
CREATE INDEX "star_transaction_student_id_created_at_idx" ON "star_transaction"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "star_transaction_facility_id_idx" ON "star_transaction"("facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "star_transaction_type_reference_key" ON "star_transaction"("type", "reference");

-- CreateIndex
CREATE INDEX "reward_student_id_idx" ON "reward"("student_id");

-- CreateIndex
CREATE INDEX "reward_facility_id_idx" ON "reward"("facility_id");

-- CreateIndex
CREATE INDEX "notification_recipient_type_recipient_id_read_at_idx" ON "notification"("recipient_type", "recipient_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_facility_id_idx" ON "notification"("facility_id");

-- AddForeignKey
ALTER TABLE "student_account" ADD CONSTRAINT "student_account_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "parent_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_class_batch_id_fkey" FOREIGN KEY ("class_batch_id") REFERENCES "class_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission" ADD CONSTRAINT "submission_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "star_transaction" ADD CONSTRAINT "star_transaction_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward" ADD CONSTRAINT "reward_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward" ADD CONSTRAINT "reward_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — Phase 2. Facility-scoped tables use the standard tenant-isolation policy.
-- notification.facility_id is nullable (global broadcast) → allow NULL like record_event.
-- Identity tables (parent_account, student_account) are super_admin-only: read by trusted
-- identity/system code under an elevated context, exactly like app_user. A facility-scoped
-- staff/parent management policy can be added later (mirrors app_user_facility_roster).
-- ALTER DEFAULT PRIVILEGES (rls_tenancy) already grants cmc_app DML on these new tables.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guardian','exercise','submission','grade','gift','star_transaction','reward']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %1$s_isolation ON %1$I
        USING (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
        WITH CHECK (app_is_super_admin() OR facility_id = ANY (app_facility_ids()))
    $f$, t);
  END LOOP;
END$$;

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_isolation ON notification
  USING (app_is_super_admin() OR facility_id IS NULL OR facility_id = ANY (app_facility_ids()))
  WITH CHECK (app_is_super_admin() OR facility_id IS NULL OR facility_id = ANY (app_facility_ids()));

ALTER TABLE parent_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY parent_account_admin_only ON parent_account
  USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

ALTER TABLE student_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY student_account_admin_only ON student_account
  USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
