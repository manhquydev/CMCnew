---
phase: 1
title: Schema migration & backfill
status: completed
priority: P1
dependencies: []
effort: M
---

# Phase 1: Schema migration & backfill

## Overview

Thêm cột `EmploymentProfile.employeeCode @unique`, bảng đếm global 1-dòng, và migration backfill hồ sơ hiện có.

## Requirements

- Functional: cột unique nullable; counter global; backfill theo `createdAt ASC` gán CMC0001…; idempotent.
- Non-functional: migration tuyến tính, chạy được trên dev + prod-mirror; không sửa migration cũ; giữ RLS.

## Architecture

**Schema (`packages/db/prisma/schema.prisma`):**

```prisma
model EmploymentProfile {
  // …fields hiện có…
  employeeCode String? @unique @map("employee_code") /// CMC + đệm 4 số, cấp 1 lần khi tạo hồ sơ
}

/// Bộ đếm mã nhân sự — global 1 dòng (id cố định = 1). Theo pattern ShiftCodeCounter.
model EmployeeCodeCounter {
  id      Int @id @default(1)
  lastSeq Int @default(0) @map("last_seq")
  @@map("employee_code_counter")
}
```

Chọn `EmploymentProfile` (không phải `AppUser`) vì "chỉ nhân sự" = người có hồ sơ HR; sinh tại nơi HR tạo hồ sơ. Counter **global** (không facility-scoped) vì mã tăng theo toàn hệ thống ("theo nhân sự được tạo ở hệ thống").

**Migration SQL (backfill idempotent, deterministic theo createdAt):**

```sql
-- 1. cột + unique
ALTER TABLE employment_profile ADD COLUMN employee_code text;
CREATE UNIQUE INDEX employment_profile_employee_code_key ON employment_profile(employee_code);

-- 2. bảng đếm
CREATE TABLE employee_code_counter (id int PRIMARY KEY DEFAULT 1, last_seq int NOT NULL DEFAULT 0);

-- 3. backfill theo thứ tự tạo (tie-break id để ổn định)
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM employment_profile WHERE employee_code IS NULL
)
UPDATE employment_profile ep
SET employee_code = 'CMC' || LPAD(ordered.rn::text, 4, '0')
FROM ordered WHERE ep.id = ordered.id;

-- 4. set counter = số hồ sơ đã có mã
INSERT INTO employee_code_counter (id, last_seq)
VALUES (1, (SELECT COUNT(*) FROM employment_profile WHERE employee_code IS NOT NULL))
ON CONFLICT (id) DO UPDATE SET last_seq = EXCLUDED.last_seq;
```

**RLS:** `employee_code_counter` là bảng hệ thống — cân nhắc cho phép ghi qua `withRls` giống các counter khác (kiểm policy `ShiftCodeCounter` để làm theo, tránh RLS chặn `INSERT…ON CONFLICT`).

## Related Code Files

- Modify: `packages/db/prisma/schema.prisma` (thêm field + model)
- Create: `packages/db/prisma/migrations/<timestamp>_employee_code/migration.sql`

## Implementation Steps

1. Thêm `employeeCode` + model `EmployeeCodeCounter` vào schema.
2. `prisma migrate dev --name employee_code` để sinh migration; thay phần backfill bằng SQL ở trên (thứ tự: column → index → counter table → backfill → set counter).
3. Kiểm RLS/grant cho `employee_code_counter` theo pattern `shift_code_counter` (nếu migration RLS cũ có GRANT/policy cho counter thì thêm tương tự).
4. Chạy migrate trên dev, rồi prod-mirror; verify 0-drift (`prisma migrate status`).

## Success Criteria

- [ ] Migration chạy sạch dev + prod-mirror; `migrate status` 0-drift.
- [ ] Mọi hồ sơ cũ có `employee_code` duy nhất, liên tục CMC0001…CMC000N theo createdAt.
- [ ] `employee_code_counter.last_seq` = số hồ sơ đã cấp.
- [ ] Rerun migration/backfill không đổi mã đã gán (idempotent nhờ `WHERE employee_code IS NULL`).

## Risk Assessment

- **Hard-gate data model** — bắt buộc thử prod-mirror trước prod; backup trước.
- Uniqueness race khi cấp mã đồng thời (Phase 2 xử lý qua counter atomic) — Phase 1 chỉ backfill tĩnh, an toàn.
- Không sửa migration đã merge (bài học journals work-shift) — luôn thêm migration mới.
- Nếu `employment_profile.created_at` trùng nhau nhiều → tie-break bằng `id` đảm bảo deterministic.
