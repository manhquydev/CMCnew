-- AlterTable
ALTER TABLE "payslip" ADD COLUMN     "variable_pay_override" INTEGER,
ADD COLUMN     "variable_pay_override_by_id" UUID,
ADD COLUMN     "variable_pay_override_reason" TEXT;
