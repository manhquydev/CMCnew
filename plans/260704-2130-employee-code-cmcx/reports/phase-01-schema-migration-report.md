# Phase 1 — Schema migration & backfill — completion report

## Files modified/created

- Modified: `packages/db/prisma/schema.prisma`
  - Added `EmploymentProfile.employeeCode String? @unique @map("employee_code")`
  - Added new model `EmployeeCodeCounter` (`id Int @id @default(1)`, `lastSeq Int @default(0) @map("last_seq")`, `@@map("employee_code_counter")`)
- Created: `packages/db/prisma/migrations/20260704221500_employee_code/migration.sql`

## Migration SQL summary

Order: add column → unique index → counter table → backfill (`ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC)`, guarded `WHERE employee_code IS NULL`) → set counter via `INSERT ... ON CONFLICT (id) DO UPDATE` → RLS.

## RLS finding

`employee_code_counter` has no `facility_id` (global, single-row table), so the `shift_code_counter` / `receipt_code_counter` facility-scoped RLS pattern (`facility_id = ANY(app_facility_ids())`) doesn't apply directly. Found the correct precedent instead: `20260624090000_identity_system_wide_rls` uses a **staff-wide** policy for other global/system-wide identity tables (`parent_account`, `student_account`) with no facility scoping:

```sql
USING (app_is_super_admin() OR app_principal_kind() = 'staff')
WITH CHECK (app_is_super_admin() OR app_principal_kind() = 'staff')
```

Applied the identical pattern to `employee_code_counter` (any staff principal can read/write the global counter; parents/students cannot). This is the right call since HR staff creating an `EmploymentProfile` in any facility needs to bump this counter, and it holds no PII — only a running sequence.

## DB verification (dev DB, docker `cmcnew-postgres-dev`, localhost:5433)

- `prisma migrate deploy` — applied cleanly, no errors.
- `prisma migrate status` — "Database schema is up to date!" (0 drift).
- Backfill result: 46/46 `employment_profile` rows now have a unique `employee_code`, sequential `CMC0001`..`CMC0046` ordered by `created_at ASC, id ASC`.
- `employee_code_counter.last_seq` = 46 (matches count of coded profiles).
- Idempotency: manually re-ran the backfill UPDATE + counter upsert SQL directly against the DB — `UPDATE 0` rows changed, counter stayed at 46. Confirms rerun-safety via the `WHERE employee_code IS NULL` guard.
- `prisma validate` — schema valid.

## Environment note (unrelated to schema correctness)

- Root `node_modules` was only partially installed at task start (dependencies present in the pnpm store but not linked into `packages/db/node_modules`), so `prisma` wasn't resolvable via `npx`/`pnpm exec`. Ran `pnpm install --force` at repo root to relink workspace deps — this was a plain dependency-linking fix, no lockfile or version changes.
- `prisma migrate dev` refused to run in this non-interactive shell ("environment is non-interactive"), so the migration file was authored by hand with the exact SQL from the phase spec (same effect as `migrate dev --create-only` + manual edit) and applied via `prisma migrate deploy`.
- `prisma generate` currently fails with `EPERM: ... query_engine-windows.dll.node` — a Windows file-lock, almost certainly because a running dev server process still holds the previously generated client DLL open. Did not kill any processes to force this (didn't want to disturb other agents' running work). Whoever owns Phase 2 (touches `payroll.ts`, needs the regenerated `EmploymentProfile.employeeCode` field in `@prisma/client` types) should stop the API dev server first, then run `pnpm --filter @cmc/db exec prisma generate`.

## Success criteria checklist (from phase file)

- [x] Migration chạy sạch dev; `migrate status` 0-drift. (prod-mirror not attempted — out of scope for a dev-only phase-1 pass; flag for whoever runs the prod-mirror step before prod deploy per the plan's hard-gate.)
- [x] Mọi hồ sơ cũ có `employee_code` duy nhất, liên tục CMC0001…CMC0046 theo createdAt.
- [x] `employee_code_counter.last_seq` = 46 (số hồ sơ đã cấp).
- [x] Rerun idempotent — verified directly against DB.

Status: DONE_WITH_CONCERNS
Summary: Schema + migration + backfill implemented and verified on dev DB (0-drift, 46/46 backfilled, idempotent rerun confirmed); RLS policy added following the correct global (non-facility) staff-wide precedent rather than the facility-scoped counter pattern.
Concerns/Blockers:
- `prisma generate` blocked by a Windows file lock (EPERM on query_engine-windows.dll) — likely a running dev server; needs to be regenerated before Phase 2 code can use `employeeCode` in typed Prisma client calls.
- Prod-mirror run not performed (dev-only in this pass) — required before prod per the plan's hard-gate on data-model changes.
