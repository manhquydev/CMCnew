ALTER TABLE "payslip"
  ADD COLUMN "attendance_deduction" INTEGER,
  ADD COLUMN "attendance_deduction_override" INTEGER,
  ADD COLUMN "attendance_deduction_override_reason" TEXT,
  ADD COLUMN "attendance_deduction_override_by_id" UUID;
