# Verify: DB-Migrations (03) + Harness-Ops-Tests (10) Findings

Date: 2026-06-27 | Branch: develop | Mode: READ-ONLY adversarial re-verification against CURRENT code.
Source reports generated ~10:33, BEFORE the recent fix wave. Line numbers in source reports are stale (schema shifted); verified against live code below.

## Report 03 — Database, Migrations, Integrity

| # | Finding | Verdict | Evidence (current) | Severity | Fix |
|---|---------|---------|--------------------|----------|-----|
| 03-1 | Payroll RLS doesn't enforce payroll secrecy (facility-wide staff policy) | INTENTIONAL (documented) | `migrations/20260623184505_phase4_payroll/migration.sql:86-100` policy = super OR (staff AND facility). Comment explicitly: secrecy enforced at tRPC `requireRole hr/ke_toan`, "no role GUC for RLS to key on". Router gates confirmed: `apps/api/src/routers/payroll.ts:21` imports `requirePermission`; mgmt procs use it, `myPayslips` IDOR-guarded (test PAY-MYSLIP). | Was High → **Low** | Accept as defense-in-depth gap. If wanted: add a `payroll_view` GUC + policy. No SQL path bypasses tRPC today. |
| 03-2 | Facility-scoped counters collide with GLOBAL-unique codes | **REAL** | `ClassBatch.code String @unique` (schema.prisma:193, global); `Receipt.code String? @unique` (schema.prisma:938, global). Counters keyed `(facilityId, year)`: `batch-code.ts:12-16`, `receipt-code.ts:12-16`. Format excludes facility: `formatBatchCode`→`B-${year}-${seq}` (domain-academic/src/code.ts:6), `formatReceiptCode`→`PT-${year}-${seq}` (domain-finance/src/pricing.ts:87). Facility A & B both start seq=1 → identical code → unique violation. | **High** (latent; fires on 2nd facility's first class/receipt each year) | Make uniqueness `@@unique([facilityId, code])` on both models, OR embed facility code in the string. Add cross-facility collision int-test. |
| 03-3 | `GradingTemplate` nullable `level` defeats uniqueness | **REAL** | `level String?` + `@@unique([facilityId, program, level])` (schema.prisma:763,774). Migration index plain, no `NULLS NOT DISTINCT`: `20260623140553_s2_grading_models/migration.sql:74`. Postgres treats NULL as distinct → duplicate default templates allowed. Code itself admits it: `seed-demo.ts:45` "the (facility,program,level) unique can't dedupe on a NULL level". | **Medium** | Add partial unique index `WHERE level IS NULL`, or `NULLS NOT DISTINCT` (PG15+), or sentinel `''` for default. |
| 03-4 | Receipt/class course consistency is API-only | REAL (mitigated) | `Receipt.courseId` + `classBatchId` both nullable-linked (schema.prisma:943,980); no DB constraint tying batch.courseId == receipt.courseId. App guard + test present: `apps/api/test/receipt-batch-course-guard.int.test.ts` exists. | Was Medium → **Low** | Acceptable; cross-row equality needs a trigger. Keep app guard + test. Optional CHECK via trigger if paranoid. |
| 03-5 | Core numeric ranges lack DB CHECK constraints | **REAL** | Grep of all migrations: every `CHECK` is an RLS `WITH CHECK` policy — zero column value CHECKs. No range guard on voucher.percent (0..100), receipt money/discount, grade score/maxScore, KPI score. Enforced only by Zod app-layer. | **Medium** (mitigated by Zod) | Add `CHECK` constraints (e.g. `percent BETWEEN 0 AND 100`, `net_amount >= 0`) for defense-in-depth against non-API writes/seeds. |

## Report 10 — Harness, Ops, Tests

| # | Finding | Verdict | Evidence (current) | Severity | Fix |
|---|---------|---------|--------------------|----------|-----|
| 10-1 | App topology docs stale after retiring `apps/teaching` | **REAL** | `apps/` now = admin, api, e2e, lms (no teaching dir). `README.md:38` live broken cmd `pnpm --filter @cmc/teaching dev`. `docs/project-charter.md:17,73,78` use "Teaching/ERP" as surface label (stale terminology). | Was High → **Medium** | Fix README dev command (→ admin). Update charter wording to "ERP/staff (admin app)". |
| 10-2 | Test matrix marks `implemented` where proof is planned/missing & cites retired app | **REAL** | `docs/TEST_MATRIX.md:11` implemented = "proof exists". Rows BELL-NOTIF(:45), TEACH-SHELL(:47), TEACH-PAGINATE(:49) = status `implemented` but E2E col = "planned — *.spec.ts" AND evidence points to retired `apps/teaching/src/shell.tsx` / `App.tsx`. (HR-PANEL-UI partial: `admin-hr-panel.spec.ts` now actually exists.) | **High** (governance integrity) | Re-status TEACH-* rows to `retired`/`changed`; fix BELL-NOTIF evidence to `apps/admin`; flip E2E once specs land. |
| 10-3 | CI runs neither lint nor Playwright E2E | **REAL** | `.github/workflows/ci.yml` steps = install, prisma generate, migrate, seed, verify-rls, typecheck, `pnpm -r test`, `@cmc/api test:int`, build. No `pnpm lint`, no `pnpm test:e2e`. Both scripts exist (`package.json:12,15`). Roadmap gate (`docs/roadmap.md:71`) requires E2E smoke PASS. | **Medium-High** | Add `pnpm lint` step; add Playwright E2E job (admin-smoke, lms-smoke, unified-staff-shell). Note: GH Actions billing blocked → CI not executing regardless. |
| 10-4 | Root `pnpm test` is incomplete local verification | **REAL** | `package.json:14` test = `turbo run test`; `turbo.json` `test` task ≠ `test:int`. API invariant suite is `@cmc/api test:int` (separate). CI runs it separately (ci.yml:70); local `pnpm test` omits it. | **Medium** | Add a `verify` script chaining `test` + `@cmc/api test:int` (+ verify-rls), or document the full local command. |
| 10-5 | Prod auth/email docs not reflected in env template/compose | **REAL** | Ops guide documents `SSO_ENABLED`, `ENTRA_*`, `GRAPH_CLIENT_SECRET/SENDER_NOTIFY/TENANT_ID` (`docs/operate-and-test-guide.md:305-314,401`). `.env.production.example` has none (only SEED_*). `docker/docker-compose.prod.yml:75-128` passes only JWT/COOKIE/SEED. | **Medium** | Add SSO/ENTRA/GRAPH vars to `.env.production.example` + compose env passthrough (guarded/optional since some are forward-looking/deferred). |
| 10-6 | Roadmap records retired teaching / E2E evidence | **REAL** | `docs/roadmap.md:50` "Teaching shell fully wired"; `:54,:81,:85,:86` cite `teaching-smoke` E2E + TEACH-SHELL/TEACH-PAGINATE harness IDs. No `teaching-smoke.spec.ts` in `apps/e2e/tests/` (only admin-hr-panel, admin-smoke, lms-smoke, unified-staff-shell). | **Medium** | Drop teaching-smoke refs; remap TEACH-* evidence to unified-staff-shell/admin-smoke or mark retired. |
| 10-7 | Screenshots easy to accidentally add | **REAL** | `.gitignore:28-29` ignores `*-verify.png` / `*-verify.yml` only. Untracked `admin-dashboard.png`, `teaching-full.png`, `lms-app.png` etc. are NOT matched. | **Low** | Add `*.png` (with `!docs/**` allowlist if needed) or a `screenshots/` ignored dir. |

## Headline-claim scrutiny (as requested)
- Facility counters vs global-unique codes: **CONFIRMED REAL** for both ClassBatch and Receipt (03-2).
- Grading template nullable uniqueness: **CONFIRMED REAL** (03-3), acknowledged in code.
- DB CHECK constraints for money/score: **CONFIRMED ABSENT** (03-5) — only RLS WITH CHECK exists.
- Test matrix / roadmap overstate E2E proof: **CONFIRMED** (10-2, 10-6); also cite retired `apps/teaching`.
- CI omits lint + Playwright: **CONFIRMED** (10-3).
- Docs reference retired apps/teaching: **CONFIRMED** live in README:38, TEST_MATRIX rows, roadmap (not just comments).

## Counts
- Verified: 12 findings (5 DB + 7 ops; the 10-report's self-resolved index item excluded).
- REAL: 9 (03-2, 03-3, 03-4*, 03-5, 10-1, 10-2, 10-3, 10-4, 10-5, 10-6, 10-7) — *03-4 real but well-mitigated.
- INTENTIONAL: 1 (03-1 payroll RLS, documented + app-gated).
- FALSE / ALREADY-FIXED: 0 fully false; partial already-fixed inside 10-2 (admin-hr-panel.spec.ts now exists).

## Top 3 confirmed-REAL
1. **03-2 Facility counters collide with global-unique codes (High):** `ClassBatch.code`/`Receipt.code` are globally `@unique` but counters are `(facility,year)` and the formatted code omits facility — second facility's first class/receipt each year throws a unique violation. Fix: `@@unique([facilityId, code])`.
2. **10-2/10-6 Governance overstates proof + cites retired apps/teaching (High):** TEST_MATRIX rows marked `implemented` while E2E is `planned`, with evidence pointing at deleted `apps/teaching/src/*`; roadmap cites non-existent `teaching-smoke`.
3. **10-3 CI enforces neither lint nor Playwright (Medium-High):** `ci.yml` has no `pnpm lint` and no E2E step despite both scripts and a roadmap E2E gate existing.

## Unresolved questions
- Is the deployment actually multi-facility at launch? 03-2 is latent under single-facility but a hard blocker the moment a 2nd facility exists.
- Are SSO/Graph (`ENTRA_*`/`GRAPH_*`) wired in code yet, or forward-looking? Affects whether 10-5 is a template gap or also a code gap.

Status: DONE
