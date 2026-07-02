# Plan 7 (ops-hardening) Verification Report

**Date:** 2026-07-02 14:47  
**Scope:** Validation of all 5 phases, uncommitted changes  
**Status:** ✅ READY (all 6 verification items PASS)

---

## 1. TypeCheck — `pnpm typecheck`

**Result: ✅ PASS**

- `pnpm --filter @cmc/api typecheck`: **0 errors** (tsc --noEmit succeeded)
- `pnpm -r typecheck` (full workspace): **0 errors** across 13 workspace projects
- All modified/new files (logger.ts, error-alert.ts, index.ts, email-templates.ts) compile without type errors

---

## 2. Lint — `pnpm lint`

**Result: ✅ PASS (no new errors in touched code)**

- `pnpm --filter @cmc/api lint src/lib/logger.ts src/lib/error-alert.ts src/index.ts src/services/email-templates.ts`: **0 errors, 0 warnings** on Plan 7 files
- Pre-existing unrelated warnings in @cmc/api (emit-staff-notif.ts, shift-registration.ts): **2 warnings** — not touched by Plan 7, not regressions
- `pnpm -r lint` (full workspace): only pre-existing errors in packages/ui (3 unused-vars errors, not touched)
- **Verdict: No new linting issues introduced by Plan 7 changes**

---

## 3. Integration Tests — `pnpm --filter @cmc/api test:integration`

**Result: ✅ PASS**

- **Test suites:** 80 files
- **Tests:** 410 total
- **Duration:** 41.66s (setup + collect + execute)
- **Failures:** 0
- **Coverage:** All critical domains exercise (auth, payroll, LMS, assessment, RLS, email-outbox, etc.)

### Email-outbox specific checks:
- `test/email-outbox.int.test.ts`: **7 tests PASSED** (613ms)
  - Confirms exhaustive renderTemplate switch for all EmailTemplateKind values
  - New 'ops_error_alert' template is properly rendered and integrated
  - No regressions in existing email template logic (payslip, otp, account_welcome, parent_meeting, lms_account_ready, account_security_alert)

---

## 4. Shell Script Syntax

**Result: ✅ PASS**

- `bash -n scripts/backup-db.sh`: **Valid** (no syntax errors)
- `bash -n scripts/db-restore.sh`: **Valid** (no syntax errors)
- Scripts are not executed (safe to validate on dev without touching docker/postgres)

---

## 5. ESLint Guard (RLS-bypass prevention)

**Result: ✅ PASS (guard is active and real)**

- Created temp file `/d/project/CMCnew/apps/api/src/temp-eslint-guard-test.ts` with `import { prisma } from '@cmc/db';`
- Ran `pnpm --filter @cmc/api exec eslint src/temp-eslint-guard-test.ts`
- **Expected error appeared:**
  ```
  D:\project\CMCnew\apps\api\src\temp-eslint-guard-test.ts
    2:10  error  'prisma' import from '@cmc/db' is restricted. Import withRls, not the raw prisma singleton — it bypasses RLS  @typescript-eslint/no-restricted-imports
  ```
- Deleted temp file
- **Verdict: Guard is not dead; correctly prevents raw prisma imports in app source**

---

## 6. Email-Outbox Regression Check

**Result: ✅ PASS**

- Modified: `apps/api/src/services/email-templates.ts`
  - Added `'ops_error_alert'` to `EmailTemplateKind` union (line 12)
  - Added `ops_error_alert` renderer to exhaustive `renderers` object (lines 221–230)
  - Added `TemplatePayloads['ops_error_alert']` type (lines 119–123)
- TypeScript enforces exhaustive match on `{ [K in EmailTemplateKind]: Renderer<K> }` — all kinds must have a renderer
- Test compilation: **0 errors** (fixtures auto-updated via generated type)
- Runtime: `test/email-outbox.int.test.ts` **7 tests PASS** ✓

---

## Summary

| Item | Result | Evidence |
|------|--------|----------|
| TypeCheck | ✅ PASS | tsc --noEmit (0 errors) |
| Lint | ✅ PASS | eslint on touched files (0 new errors) |
| Integration tests | ✅ PASS | 410/410 tests PASS (41.66s) |
| Shell syntax | ✅ PASS | bash -n validation OK |
| ESLint guard | ✅ PASS | Temp file caught; error message confirmed |
| Email-outbox regression | ✅ PASS | 7 tests PASS; exhaustive renderTemplate verified |

**Overall Verdict: ✅ READY**

All phases are code-complete, tested, and safe to commit. No blocking issues. Pre-existing linting warnings in unrelated code are accepted baseline.

---

## Notes

- Postgres dev container (cmcnew-postgres-dev) was already running; `pnpm db:up` not needed
- ESLint guard applies to: `apps/api/src/**`, `apps/admin/src/**`, `apps/lms/src/**`
- Test isolation verified: `beforeEach` + `afterAll` cleanup in email-outbox suite
