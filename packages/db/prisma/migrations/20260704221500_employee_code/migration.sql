-- Mã nhân sự CMC + đệm 4 số (CMC0001…), cấp một lần khi tạo hồ sơ EmploymentProfile, không đổi khi
-- update. Counter global 1 dòng, theo pattern ShiftCodeCounter/ReceiptCodeCounter (decision Plan B).

-- 1. cột + unique
ALTER TABLE "employment_profile" ADD COLUMN "employee_code" TEXT;
CREATE UNIQUE INDEX "employment_profile_employee_code_key" ON "employment_profile"("employee_code");

-- 2. bảng đếm
CREATE TABLE "employee_code_counter" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "last_seq" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "employee_code_counter_pkey" PRIMARY KEY ("id")
);

-- 3. backfill theo thứ tự tạo (tie-break id để ổn định); idempotent nhờ WHERE employee_code IS NULL
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM "employment_profile" WHERE "employee_code" IS NULL
)
UPDATE "employment_profile" ep
SET "employee_code" = 'CMC' || LPAD(ordered.rn::text, 4, '0')
FROM ordered WHERE ep.id = ordered.id;

-- 4. set counter = số hồ sơ đã có mã
INSERT INTO "employee_code_counter" ("id", "last_seq")
VALUES (1, (SELECT COUNT(*) FROM "employment_profile" WHERE "employee_code" IS NOT NULL))
ON CONFLICT ("id") DO UPDATE SET "last_seq" = EXCLUDED."last_seq";

-- 5. RLS: bảng hệ thống, không facility_id — mọi staff principal ghi/đọc được (giống
-- parent_account/student_account, xem 20260624090000_identity_system_wide_rls).
ALTER TABLE "employee_code_counter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_code_counter_staff_rw" ON "employee_code_counter"
  USING (app_is_super_admin() OR app_principal_kind() = 'staff')
  WITH CHECK (app_is_super_admin() OR app_principal_kind() = 'staff');
