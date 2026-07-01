-- Capture schema changes applied to the dev DB via `prisma db push` that were
-- never written as migrations: the employment_profile.manager_id reporting-line
-- column (+index), the receipt->student FK onDelete=SetNull, and dropping stray
-- id column defaults on email_outbox/login_otp. Brings a from-migrations deploy
-- to parity with schema.prisma (verified: post-apply migrate diff is empty).

-- DropForeignKey
ALTER TABLE "receipt" DROP CONSTRAINT "receipt_student_id_fkey";

-- AlterTable
ALTER TABLE "email_outbox" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employment_profile" ADD COLUMN     "manager_id" UUID;

-- AlterTable
ALTER TABLE "login_otp" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "employment_profile_manager_id_idx" ON "employment_profile"("manager_id");

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

