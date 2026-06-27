# Phase 02 — Data Integrity (DB constraints + logic bugs)

**Risk:** HIGH (schema, migrations, money/grades) | **Depends:** none (needs live DB to apply/verify)

## Requirements

Đóng các lỗ idempotency, ràng buộc unique, cascade nguy hiểm, và bug logic làm sai số liệu lương/điểm.

## Schema / Migration Changes (`packages/db/prisma/`)

### C5 — StarTransaction partial unique (theo Q5)
- Raw SQL migration `*_star_txn_partial_unique`:
  ```sql
  DROP INDEX IF EXISTS "star_transaction_type_reference_key";
  CREATE UNIQUE INDEX "star_transaction_type_reference_key"
    ON "star_transaction"("type","reference") WHERE "reference" IS NOT NULL;
  ```
- schema.prisma: bỏ `@@unique([type, reference])`, thêm `@@index([type, reference])` + comment trỏ migration.
- Pre-check: `SELECT type,COUNT(*) FROM star_transaction WHERE reference IS NULL GROUP BY type;` kỳ vọng 0 rows.

### H9 — CoursePrice unique
- `@@unique([facilityId, courseId, effectiveFrom])`.

### H10 — SalaryRate unique
- `@@unique([userId, effectiveFrom])`.

### H11 — Opportunity.contact cascade
- `onDelete: Cascade` → `Restrict` (bảo vệ commission history).

### H12 — Exercise.batch cascade
- `ClassBatch→Exercise onDelete` Cascade → `Restrict` (chặn xóa dây chuyền grades).

### H13 — ParentAccount identifier check
- Raw SQL: `ALTER TABLE parent_account ADD CONSTRAINT chk_parent_has_identifier CHECK (email IS NOT NULL OR phone IS NOT NULL);`

### C6 (DB part) — record_event NULL facility RLS
- ALTER POLICY: rows `facility_id IS NULL` chỉ super_admin đọc.

### H15 — record_follower RLS
- `ALTER TABLE record_follower ENABLE ROW LEVEL SECURITY;` + policy self-or-superadmin. Cần set `app.user_id` GUC trong `withRls`.

## Logic Bug Fixes (`apps/api/src/routers/`)

| Bug | File | Fix |
|-----|------|-----|
| H1 dup enrollment | `enrollment.ts:32-46` | `findFirst({classBatchId,studentId,archivedAt:null})` → CONFLICT |
| H2 grade period | `assessment.ts:100-119` | filter grade+attendance theo date range từ `periodKey` |
| H3 re-submit graded | `submission.ts:150-165` | status guard (`!=='draft'`→CONFLICT) + P2025→NOT_FOUND |
| H4 reopen WON | `crm.ts:198-216` | block `stage==='O5_ENROLLED' && closedAt` |
| H5 markLost WON | `crm.ts:177` | tách guard WON vs LOST |
| H6 workdays>standard | `payroll.ts:178` | `.refine(workdays<=standardDays)` |
| H7 slot time | `schedule.ts:23-48` | `.refine(startTime<endTime)` |
| H8 reopen sessions | `class-batch.ts:197-243` | restore cancelled future sessions |

## Seed

- `packages/db/src/seed-demo.ts`: thêm `CompensationPolicy` row (payroll throws nếu thiếu).

## Validation

- `prisma migrate dev` apply sạch trên DB test; pre-check NULL = 0 trước star migration.
- Int-tests: extend `star-redeem`, `enrollment`, `assessment-final-grade`, `crm-hooks`; new cho workdays/slot validation.
- `pnpm --filter @cmc/db generate` + api typecheck green.

## Risks / Rollback

- Cascade→Restrict có thể làm fail delete đang dựa vào cascade → kiểm caller của contact/exercise delete trước.
- Unique constraint có thể đụng dữ liệu seed trùng → pre-check trước migrate.
- CHECK constraint fail nếu có parent_account rỗng cả 2 field → query kiểm trước.
- Cần DB live; nếu chưa có DB, dừng & báo user (memory: migration chưa apply được).
