# Work-Shift Feature Missing CREATE TABLE Migrations

**Date**: 2026-07-01 19:47
**Severity**: High
**Component**: Database Migrations, Work-Shift System
**Status**: Ongoing (tables defined in schema.prisma, migrations missing)

## What Happened

Work-shift system shipped with 4 new tables in schema.prisma but CREATE TABLE migrations never committed. Tables created locally via prisma migrate dev, but no .sql migration files exist.

When deploying to fresh database, RLS policy migrations fail with "relation does not exist" because tables have not been created.

## The Brutal Truth

Classic footgun: development convenience vs production reliability. Running prisma migrate dev locally creates tables automatically but if you skip writing CREATE TABLE migration file explicitly, you ship code that cannot bootstrap on fresh database.

The frustrating part: code is in schema.prisma, so CI system thinks it is under migration control. But it is not. Any fresh deployment would fail at RLS step. The error message would confuse anyone unfamiliar with the history. This is the kind of gotcha that costs hours of debugging at 2am.

## Technical Details

**Missing Migrations**:
- No .sql file for ShiftGroup, ShiftTemplate, ShiftRegistrationEntry, TimePunch, FacilityNetwork creation
- Existing RLS migrations reference tables that do not exist:
  - 20260630140000_work_shift_rls/migration.sql
  - 20260701000000_shift_entry_rls/migration.sql

**Error**: ERROR: relation "shift_group" does not exist (SQL: ALTER TABLE shift_group ...)

**Evidence**:
- packages/db/prisma/schema.prisma defines all 4 tables correctly
- packages/db/prisma/migrations/ has 140+ files but none create these tables
- App code assumes tables exist and fails at runtime on fresh DB

## Root Cause Analysis

**Primary**: No explicit migration file written for initial schema definition. During prisma migrate dev, Prisma silently created tables in local DB without writing .sql file.

**Secondary**: No bootstrap validation in CI. Test running prisma migrate deploy against fresh PostgreSQL would catch this.

**Tertiary**: Assumption that prisma migrate dev handles everything.

## Lessons Learned

1. prisma migrate dev is for development, not version control. Verify .sql files exist after schema changes.
2. Fresh-database bootstrap must be tested in CI. Any schema inconsistency surfaces immediately.
3. Migration files are source of truth. Reconcile against schema.prisma.
4. Document migration sequences in commit messages.
5. RLS migrations depend on table existence. Never ship without CREATE TABLE migrations.

## Next Steps

1. **Immediate**: Run prisma migrate diff to generate missing CREATE TABLE migration
2. **Test**: prisma migrate deploy against fresh PostgreSQL instance
3. **Deploy**: To cmcnew-prod-postgres-1 alongside RBAC rollout
4. **Medium-Term**: Add fresh-database bootstrap test to CI
5. **Long-Term**: Consider schema-as-code tools (Atlas, Squawk)

## Files Affected

- packages/db/prisma/schema.prisma — 4 new models defined but no migrations
- packages/db/prisma/migrations/20260630140000_work_shift_rls/migration.sql — depends on CREATE TABLE
- packages/db/prisma/migrations/20260701000000_shift_entry_rls/migration.sql — depends on CREATE TABLE
- (Missing): packages/db/prisma/migrations/20260701xxxxx_create_work_shift_tables/migration.sql
