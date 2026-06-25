-- CreateEnum
CREATE TYPE "KpiStatus" AS ENUM ('draft', 'submitted', 'confirmed', 'approved');

-- AlterTable
ALTER TABLE "kpi_score" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" UUID,
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by_id" UUID,
ADD COLUMN     "criterion_scores" JSONB,
ADD COLUMN     "status" "KpiStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "submitted_by_id" UUID;
