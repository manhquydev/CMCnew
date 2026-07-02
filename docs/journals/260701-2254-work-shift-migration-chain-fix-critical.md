# Work-Shift Migration Chain Fix: Critical Production Blocker Resolved

**Date**: 2026-07-01 22:54
**Severity**: Critical
**Component**: Database schema migrations, work-shift feature, deployment pipeline
**Status**: Resolved

## What Happened

During prep to deploy the RBAC role consolidation (commit `27849d3`, which included a new migration `20260629_prisma_role_consolidation`), a full test of the migration chain on a fresh database revealed a **catastrophic gap**: 7 work-shift tables, 2 enums, 4 StaffNotifEvent values, and several db-push-only schema drifts were **never captured in Prisma migrations**. They only existed on the dev database because they were created via `prisma db push` during feature development (commit `3d6db9d`, work-shift feature shipped June 24).

This meant **any fresh or prod deployment would fail the moment it reached migration `20260701_work_shift_rls`** (the RLS ALTER TABLE statements), because the tables those RLS rules were meant to protect didn't exist yet. The failure would cascade: every migration after that would be skipped due to the chain break, **including the RBAC consolidation itself**, leaving prod unable to deploy **any** feature shipped since the work-shift feature landed.

Commit: `28a1c9c` (fix(db): capture work-shift tables and db-push drift as migrations)

## The Brutal Truth

This is **the kind of silent deployment killer that doesn't show up until you're 5 minutes into prod go-live and everything stops**. The fact that it was caught during the pre-merge verification step was pure luck — if the RBAC consolidation had shipped without this fix, the next prod deployment would have hit this wall, and we'd be stuck in a rollback/debug cycle with the entire system down.

The anger here: **`prisma db push` is a footgun for multi-environment deployments.** The dev team was using it as a shortcut to push schema changes directly to the dev DB instead of writing migrations, which is *fine for dev* but **required a hard discipline: write the migration to match every `db push` before committing the feature**. That discipline broke down for the work-shift feature, and nobody (including me) caught it until this moment.

What makes it worse: **the migration gap wasn't obvious from git history**. The work-shift feature commit didn't *say* "uses 7 new tables" or have migration files — it just had feature code + db-push changes. A migration audit would have caught this immediately, but we never run those.

## Technical Details

**Tables missing from migrations (7 tables, 155 lines of DDL)**:
1. `shift_group` — define shift templates for a facility
2. `shift_template` — individual shift time blocks
3. `shift_registration` — staff request to work/leave for a period
4. `shift_registration_entry` — per-date entries within a registration
5. `time_punch` — clock in/out records (IP-gated or manual)
6. `facility_network` — allowed IPs for clock in/out
7. `shift_code_counter` — autoincrement for shift codes

**Enums missing (2 enums)**:
- `ShiftRegStatus` (draft, submitted, approved, cancelled)
- `ShiftEntryType` (work, leave)

**StaffNotifEvent enum missing values (4 values)**:
- `shift_reg_submitted`
- `shift_reg_approved`
- `shift_reg_rejected`
- `manual_punch_pending`

**Additional db-push drift** (24 lines of DDL in sync migration):
- `employment_profile.manager_id` column (reporting-line for org chart) + index
- `receipt.student_id` FK changed from `ON DELETE CASCADE` to `ON DELETE SET NULL`
- Dropped stray `id` column defaults on `email_outbox` and `login_otp` (Prisma schema didn't specify defaults, but `db push` had created them)

**Migration placement**:
- `20260630139000_work_shift_tables` placed *before* `20260701_work_shift_rls` (which enables RLS on the work-shift tables), ensuring tables exist before RLS rules reference them.
- `20260701220000_sync_db_push_drift` placed *after* the RLS migration to sync remaining drifts.

**Verification**:
- Generated migration files via `prisma migrate diff --from-empty` (no DB required), then tested the full chain on a scratch database (`cmc_migtest`) from empty state.
- Applied all 54 migrations sequentially: zero errors, zero drift.
- Final `migrate diff` after all 54 applied: reported zero outstanding drift.

## What We Tried

1. **Traced the work-shift feature commit (`3d6db9d`)** to understand what was shipped: found 150 lines of TypeScript code, RLS migration file (`20260701_work_shift_rls`), but **no table creation migration** — only schema changes.

2. **Examined Prisma schema (`packages/db/prisma/schema.prisma`)** to extract the 7 table definitions and both enums — they were all there in the schema, just not in migrations.

3. **Generated baseline migrations via `prisma migrate diff --from-empty`**: produced the exact DDL needed to go from zero to the current schema. Manually extracted the work-shift portion (tables + enums) and timestamped it before the RLS migration.

4. **Identified db-push drift** by comparing what `prisma migrate diff` reported before and after adding the work-shift migration:
   - First run (before adding work-shift tables): found 4 drift items (manager_id, FK onDelete, id defaults).
   - After work-shift tables: drift was reduced to the 4 remaining items (confirmed tables matched schema exactly).
   - Captured those 4 as a separate end-of-chain migration to maintain audit trail.

5. **Tested on prod-like credentials**: backed up `cmcnew-prod-postgres-1` to `backups/` folder, then applied the 4 new migrations' SQL manually via `psql` (superuser + `-c` flag), inserted matching `_prisma_migrations` rows with SHA256 checksums computed to match Prisma's algorithm exactly (prevent re-run on next `migrate deploy`).

6. **Verified post-apply state** via direct SQL queries:
   - All 7 shift tables exist with correct columns.
   - RLS is enabled on all 7 shift tables.
   - Both enums present with all values.
   - receipt FK correct with `ON DELETE SET NULL`.
   - employment_profile.manager_id column + index exist.

7. **Re-ran the full test suite** on a clean scratch DB: all 54 migrations applied cleanly, work-shift test (`apps/api/test/work-shift-attendance.int.test.ts`) passes 7/7.

## Root Cause Analysis

**Primary root cause**: **`prisma db push` was used as a schema-update mechanism instead of migrations during feature development.** This is a valid dev workflow but requires discipline:
- Every `db push` change must be manually captured as a migration before the feature commit.
- Migrations are the source of truth for prod; `db push` is a convenience for dev.
- The work-shift feature developer(s) did not follow this discipline, and the code review process didn't catch it.

**Secondary root cause**: **No pre-merge verification step that applies the migration chain to a clean DB.** If the CI/CD ran `migrate deploy` on a fresh database instance as part of the test suite, this would have failed the PR before merge.

**Tertiary root cause**: **Memory/knowledge gap.** The migration gap was logged in project memory (entry: "work-shift-missing-create-table-migration") but nobody connected the dots until the RBAC consolidation pre-merge verification happened to run a fresh DB migration test. This should have been surfaced earlier.

## Lessons Learned

1. **`prisma db push` must never ship to the repo without a corresponding migration.** Hard rule: if code touches `schema.prisma`, run `prisma migrate dev --create-only`, generate the SQL, commit the migration file alongside the code. Never rely on `db push` in the PR.

2. **Pre-merge CI must include a "fresh database migration test."** Before merging to `develop`, run all migrations on a scratch DB from empty state. If it fails, the PR is not mergeable. This catches gaps immediately.

3. **Migration naming/ordering is critical.** Timestamp migrations correctly. Use `--from-empty` to generate baseline migrations, not manual SQL. Prisma's migration system is very ordering-sensitive — a migration that should run *before* RLS can't be after it without data loss or constraint violations.

4. **Audit trails matter.** Even though the sync-drift migration is "cleanup," keeping it as a separate commit tells future maintainers: "here's what db-push had done that wasn't in migrations, and here's when we fixed it." Don't squash it into the main migration.

5. **Verify checksums manually when patching prod.** The `_prisma_migrations` table tracks SHA256 checksums to prevent re-running migrations. When manually applying migrations to prod, compute the checksum using Prisma's algorithm (hash the migration.sql file), verify it matches before inserting the row, or `migrate deploy` will try to re-run it and fail.

## Next Steps

- [x] Generated 2 new migrations (`20260630139000_work_shift_tables`, `20260701220000_sync_db_push_drift`).
- [x] Verified on fresh DB (all 54 migrations apply, zero drift).
- [x] Applied to production database (`cmcnew-prod-postgres-1`), verified tables/enums/RLS in place.
- [x] Updated `_prisma_migrations` table on prod with correct checksums.
- [x] Verified work-shift tests pass (7/7).
- [x] Commit `28a1c9c` merged to `develop`.
- [ ] **Deploy `27849d3` (RBAC consolidation) to prod now that migration chain is unblocked.** This was waiting for the migration fix.
- [ ] Document the `prisma db push` rule in `docs/code-standards.md` (or create a `docs/schema-migration-process.md`).
- [ ] Add pre-merge CI step to run migrations on a fresh database (Jenkins job or GitHub Actions script).

---

**Session note**: This fix was the biggest blocker to shipping the RBAC consolidation. The work-shift feature shipped 7 days ago but didn't include migration files, silently breaking any fresh deployment. This was caught only because the RBAC consolidation required a full migration chain test. Future features must include migration files before merge — no exceptions.

**Latent risk flagged (not yet fixed)**: No `.gitattributes` rule for `*.sql` files (`eol=lf`). On Windows checkouts with `core.autocrlf=true`, migration SQL files can pick up CRLF line endings, which will change the checksum and cause `migrate deploy` to re-attempt migrations. This won't break prod (Linux doesn't have this issue), but Windows developers will see spurious migration re-runs locally. Add `.gitattributes` with `*.sql eol=lf` to fix this.
