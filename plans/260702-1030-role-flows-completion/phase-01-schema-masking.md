# Phase 1 — Schema: EmploymentProfile new columns + migration + sensitive mask/authz helper design

## Context links
- Brainstorm §2 Mạch người, D4; plan.md dependency graph.
- Schema anchor: `packages/db/prisma/schema.prisma:1324-1345` (EmploymentProfile — has managerId :1337, startedAt :1338; NO address/CCCD/bank).
- Migration lesson: `docs/journals/260701-2254-work-shift-migration-chain-fix-critical.md`.

## Overview
Add the 4 missing HR record columns to EmploymentProfile and design (not yet wire) the mask + role-gated read + audit helper for the two sensitive columns. Pure schema + migration + helper module; no UI, no procedure input changes here (P2 consumes them).

## Key Insights
- `managerId` (:1337) and `startedAt` (:1338) columns ALREADY exist — the gap is API input, not schema. Do NOT re-add them.
- Only 4 NEW columns needed: `address`, `nationalId` (CCCD), `bankAccount`, `bankName`. All nullable (existing rows have none).
- No column-encryption helper exists in the repo (grep: 0 hits for encrypt/pgcrypto/cipher). Per KISS → **mask-only + role-gate + audit**; encryption deferred to DEBT (decision 0026 records the tradeoff).
- Loose-UUID / no-FK convention for AppUser refs (see managerId comment :1336) — keep new columns as plain scalars.

## Requirements
- 4 new nullable columns on `employment_profile`.
- A pure helper `maskSensitive(value)` (e.g. CCCD → `•••••••• 1234`, bank acct → last 4) and an authz predicate `canReadSensitiveHr(session)` = super_admin OR giam_doc_kinh_doanh OR giam_doc_dao_tao.
- Migration replays 0-drift from empty DB.

## Architecture
- Data in: none at runtime (schema only). Migration transforms DB shape.
- New columns snake_case mapped: `address`, `national_id`, `bank_account`, `bank_name`.
- Helper lives beside existing HR/auth helpers — place `maskSensitive` in a shared util reachable by `apps/api/src/routers/{user,payroll}.ts`; place `canReadSensitiveHr` next to `requirePermission` consumers (reuse role constants from `packages/auth`). Decide exact file in-phase by locating the existing role-predicate helpers; do NOT invent a new package.

## Related code files
- `packages/db/prisma/schema.prisma:1324-1345` — add columns (modify).
- `packages/db/prisma/migrations/<new>/migration.sql` — create.
- helper util module (locate existing util; create small fn only) — create/modify.

## Implementation Steps
1. Add `address String? @map("address")`, `nationalId String? @map("national_id")`, `bankAccount String? @map("bank_account")`, `bankName String? @map("bank_name")` to EmploymentProfile.
2. `prisma migrate dev` → generate additive `ALTER TABLE employment_profile ADD COLUMN ...` (all nullable, no default backfill needed).
3. Add `maskSensitive` + `canReadSensitiveHr` helpers with unit tests (pure fns).
4. Verify 0-drift: `prisma migrate reset` then `prisma migrate diff` = empty.

## Todo list
- [ ] Add 4 columns to schema
- [ ] Generate migration (additive, nullable)
- [ ] maskSensitive + canReadSensitiveHr helpers + unit tests
- [ ] 0-drift replay verify on prod-mirror

## Success Criteria
- `prisma migrate reset` replays whole chain with 0 drift including new migration.
- Helper unit tests pass (mask format + role predicate matrix).
- `pnpm typecheck` clean.

## Risk Assessment
- New columns wrong-typed / RLS mismatch — Low×Med. EmploymentProfile is facility-scoped RLS already; new columns inherit table policy, no new policy needed. Verify RLS unchanged.
- Migration drift (recurring failure mode) — Med×High. Mitigate with mandatory 0-drift replay before merge.

## Security Considerations
- CCCD/bank stored plaintext this round (decision 0026 documents residual risk + encryption-deferred tradeoff). No value ever logged — helpers must never emit raw value to logEvent (audit records field-changed, not value).

## Rollback
- DB: additive nullable columns → safe to leave; if reverting, `ALTER TABLE ... DROP COLUMN` (no data dependency yet since P2 not landed). Never edit historical migrations.

## Next steps
- P2 consumes columns in profileUpsert input + onboarding form + masking on read.
- NOTE (C1): `Payslip.attendanceDeduction` (+ override columns) is a SEPARATE schema change owned by **P4**, serialized AFTER this P1 migration (P4 depends on P1 → no parallel schema.prisma collision). This phase owns EmploymentProfile columns only; do not add Payslip columns here.
