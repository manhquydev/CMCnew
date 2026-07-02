-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('LESSON', 'REVIEW');

-- AlterTable
ALTER TABLE "class_session" ADD COLUMN     "curriculum_unit_id" UUID;

-- AlterTable
ALTER TABLE "course" ADD COLUMN     "level_code" TEXT;

-- CreateTable
-- curriculum_unit is a global framework table (like "course"): no facility_id, no RLS.
-- It is readable app-wide through the schema default privileges granted to cmc_app.
CREATE TABLE "curriculum_unit" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "unit_code" TEXT NOT NULL,
    "seq_in_level" INTEGER NOT NULL,
    "order_global" INTEGER NOT NULL,
    "unit_type" "UnitType" NOT NULL,
    "assessment" TEXT,
    "theme" TEXT NOT NULL,
    "content" TEXT,
    "thinking_goal" TEXT,
    "sessions" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_unit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_unit_unit_code_key" ON "curriculum_unit"("unit_code");

-- CreateIndex
CREATE INDEX "curriculum_unit_course_id_order_global_idx" ON "curriculum_unit"("course_id", "order_global");

-- AddForeignKey
ALTER TABLE "curriculum_unit" ADD CONSTRAINT "curriculum_unit_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_curriculum_unit_id_fkey" FOREIGN KEY ("curriculum_unit_id") REFERENCES "curriculum_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
