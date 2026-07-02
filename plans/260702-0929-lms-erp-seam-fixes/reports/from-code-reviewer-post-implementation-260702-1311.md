# Post-Implementation Review — LMS/ERP Seam Fixes (uncommitted work tree)

Reviewer: code-reviewer · 2026-07-02 · branch `develop` @ d62e181 (53 files, +1157/−795, plus untracked)

## Verdict: FIX-FIRST

Core implementation is solid (migrations, exercise auto-open, write guards, UI strip, de-cast), but the payroll KPI domain guard contradicts its own updated integration tests, creates a confirm→approve deadlock in the real 3-heads org, and none of the int tests could be run (DB unavailable). Fix the KPI-guard contradiction and the DEBT.md destructive rewrite before landing.

## Commands run

| Command | Result |
|---|---|
| `pnpm typecheck` (monorepo) | PASS (exit 0) |
| `pnpm --filter @cmc/domain-academic test --run` | PASS (3 files, 19 tests) |
| `pnpm --filter @cmc/domain-grading test --run` | PASS (1 file, 16 tests) |
| `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` | PASS (23 tests) |
| Int tests (`*.int.test.ts`) | NOT RUN — Postgres at localhost:5433 unavailable |
| `prisma migrate reset` + `migrate diff` (0-drift replay) | NOT RUN — no DB |

## Findings

| # | Severity | Location | Issue | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | `apps/api/test/kpi-multiactor-and-list.int.test.ts:519-555` vs `apps/api/src/routers/payroll.ts` (kpiEvalApprove) | Test expects `giam_doc_dao_tao` to approve a **sale** KPI → SUCCESS. `assertCanManagePayrollTarget` forbids DT→business targets, so this test WILL FAIL the moment int tests run against a DB. Suite is internally inconsistent and shipped unvalidated. | Decide the contract: either exempt `kpiEvalConfirm`/`kpiEvalApprove` from domain scoping (executive-board cross-domain sign-off, decision 0011 model) or rewrite the test. Then run int tests. |
| 2 | CRITICAL | `apps/api/src/routers/payroll.ts` (kpiEvalConfirm + kpiEvalApprove guards) | Workflow deadlock in the real org: domain scoping means only ONE director can touch a given staff's KPI, but SoD forbids confirmer==approver. With exactly one KD and one DT director (3-heads org), no staff KPI can ever reach `approved` without super_admin. Telling symptom: `director-kpi-and-welcome.int.test.ts` had to invent a **second education director** (`otherEduDirId`) that does not exist in production to make the flow pass. | Product decision required. Options: (a) allow cross-domain approve (either director approves, domain scoping only on confirm/payroll writes), (b) accept super_admin as routine approver and document it in decision 0023. Do not land silently. |
| 3 | HIGH | `apps/api/test/kpi-evaluation-workflow.int.test.ts:286-288` | Comment claims "eduDirId (giam_doc_dao_tao) can manage BUSINESS_PAYROLL_ROLES including sale" — factually false per `canManagePayrollTarget`. Classic hallucinated-comment pattern; will mislead the next maintainer about the guard's semantics. | Correct the comment to match the actual domain matrix. |
| 4 | HIGH | `DEBT.md` | Destructive rewrite: open debts were DELETED, not closed — MinIO object store (close-before-prod), receipt print-to-PDF HTML, CI/CD Jenkins note, and the ACCEPTED security record for identity-table RLS loosening. The debt ledger lost un-repaid loans. | Restore prior entries; append the new seam-fix section instead of replacing the file. |
| 5 | HIGH | `apps/api/src/index.ts:129-146` (`/files/exercise/:ref`) | Stale security comment: says authorization "reuses the exercise RLS policy as the single source of truth (staff→facility, parent/student→enrolled class)". Exercise RLS is now DISABLED, so the check `exercise.findFirst({basePdfRef, archivedAt: null})` matches for ANY authenticated principal — including **draft** exercises. Behavior is accepted by decision 0022 (any-authenticated, no PII), but the comment is now false and draft-PDF exposure was not part of the decision text. | Update the comment; consider adding `status: 'published'` to the visibility check for LMS principals (staff may still need drafts). |
| 6 | MEDIUM | `apps/api/test/` (C2 coverage) | Plan C2 required int tests for "cross-class + before-open denied" on `draftSave`/`submit`. Present negatives cover only unpublished + retracted-to-draft. No test where a session exists but has NOT ended, and no cross-class (student not enrolled in any batch teaching the unit) denial. | Add both negatives to `lms-security-invariants.int.test.ts` (fixtures already support it — future-dated session at line 129 is unused for this). |
| 7 | MEDIUM | `apps/admin/src/course-exercise-manager.tsx:61-63` | N+1: `exercise.listByUnit` fired once per curriculum unit in `Promise.all` — a 100-unit course = 100 parallel tRPC calls on every load/save. Admin-only and bounded, but avoidable. | Add `exercise.listByCourse({courseId})` (one query, `curriculumUnit: {courseId}`) and group client-side. |
| 8 | MEDIUM | `apps/admin/src/shallow-trpc.ts` | The M6 "de-cast" partially reintroduces type erasure: `trpc.payroll as unknown as {...}` / `trpc.compensation as unknown as {...}`. Procedure names verified to exist server-side (roster…kpiEvalGet, payslipOverrideVariablePay, kpiOverride, kpiEvalSubmit all present), but input/output shape drift is no longer compiler-checked. Acknowledged in DEBT.md; acceptable as a TS2589 workaround, but it is a hand-maintained shadow contract. | Keep the DEBT entry; when router output types are simplified, delete this file. Meanwhile any payroll input change must update this file manually. |
| 9 | MEDIUM | `apps/api/src/routers/payroll.ts` (payslipBulkMarkPaid) | Facility/period bulk-pay silently drops payslips outside the caller's domain and returns only `paidCount` — operator cannot tell which slips were skipped. The by-id variant (`payslipBulkPay`) correctly reports `failed[]`. | Return skipped count/ids from `payslipBulkMarkPaid` too, or surface in UI. |
| 10 | MEDIUM | `apps/api/src/routers/exercise.ts` (upsert) | (a) Arbitrary status transitions allowed — `published → draft/closed` with existing submissions is only handled downstream by the open-check (acceptable but undocumented). (b) Upserting into a soft-archived row updates it but leaves `archivedAt` set, so the "saved" exercise stays invisible in every list (`archivedAt: null` filters). Confusing silent no-op for the director. | Clear `archivedAt: null` in the update branch, or exclude archived rows from the unique-slot upsert. |
| 11 | LOW | `apps/api/src/routers/payroll.ts` (canManagePayrollTarget) | super_admin bypass is ordered before the self-check, so super_admin CAN self-write payroll. Decision 0023 lists both "super_admin bypasses scope checks" and "No actor can mutate their own payroll" — ambiguous. Implementation is a reasonable reading; flag only for the decision record. | Add one clarifying line to decision 0023. |
| 12 | LOW | `packages/db/prisma/schema.prisma` Exercise | `@@index([curriculumUnitId])` is redundant — the composite unique `(curriculumUnitId, type)` prefix covers it. Harmless write overhead. | Optional cleanup in a later migration; not worth churn now. |
| 13 | LOW | `apps/api/src/lib/exercise-open.ts:87` | `facilityId` for the submission comes from `sessions.find(...)` in arbitrary DB order — nondeterministic if a student has ended sessions for the same unit in two facilities (multi-enrollment). Cosmetic tenancy skew on the submission row. | Sort by session end asc before `.find`, or pick the enrollment's batch facility. |
| 14 | LOW | `apps/api/src/routers/exercise.ts` (upsert) | Concurrent first-create of the same (unit,type) slot → Prisma P2002 surfaces as unmapped 500. Two-director race is rare. | Optionally catch P2002 → CONFLICT. |
| 15 | LOW | `apps/admin/src/course-exercise-manager.tsx` | Old CreateExerciseModal had a visible "file must be PDF" check; new editor relies only on `accept="application/pdf"`. Server side presumably still validates on upload. | Restore the inline hint if upload endpoint doesn't reject non-PDF. |

## Red-team fix checklist (C1-C4 / M1-M6)

| Fix | Status | Evidence |
|---|---|---|
| C1 — DROP POLICY + explicit `DISABLE ROW LEVEL SECURITY`, no edit to historical enable-loop | **IMPLEMENTED** | `20260702093300_exercise_global_no_rls`: both statements present; enable-loop in `20260623071949` untouched. |
| C2 — submission draftSave/submit re-check unit-opened + enrollment-derived facilityId | **PARTIAL** | Guards implemented (`assertExerciseOpenForStudent` wired into both paths, facilityId from ended session). Required int tests "cross-class + before-open denied" MISSING (finding #6). |
| C3 — hard-delete legacy; migration order add-col → purge → NOT NULL+unique → no-RLS/drop-cols → drop grading_threshold | **IMPLEMENTED** | 5 migrations 093000→093400 in exactly that order; replay-safe on empty DB (purge is a no-op); 0-drift NOT verified (no DB). |
| C4 — strip grading.tsx create/publish, keep read+grade | **IMPLEMENTED** | CreateExerciseModal + publish mutation removed; SubmissionsPanel/GradePdfModal intact; teacher read via reshaped `listByClass`. |
| M1 — rewrite 8 old-shape Exercise test files + lifecycle e2e + security-invariants #1 | **IMPLEMENTED (unverified)** | All 8 files updated to curriculumUnit shape; lifecycle rewritten to `exercise.upsert` + ended-session auto-open; none executed (no DB). One file updated INCONSISTENTLY (finding #1). |
| M2 — composite unique (unit,type); seed hw+test per unit | **IMPLEMENTED** | Schema `@@unique([curriculumUnitId, type])`; `seed-lms.ts` maps hw + test_periodic to one REVIEW unit; assessment split untouched. |
| M3 — purge dueAt everywhere | **IMPLEMENTED** | Grep for `dueAt` across apps/packages: zero code hits; column dropped in 093300; student-view "Hạn nộp" column removed; upsert input has no due field. |
| M4 — exclude cancelled sessions; first-session-end rule | **IMPLEMENTED** | `openedUnitIdsFor`/`assertExerciseOpenForStudent` filter `status: {not: 'cancelled'}` (mirrors `schedule.ts` sessionsForStudent). "Any ended session" is mathematically equivalent to "first non-cancelled session ended". ICT conversion correct (UTC date + endTime − 7h; no DST in ICT). |
| M5 — block self-target on profileUpsert/rateCreate + matrix test + Decision B | **PARTIAL** | Guard implemented on all payroll writes (broader than asked), Decision 0023 recorded. But no focused matrix int test for self-write/domain denial exists (DEBT.md itself admits this), and the KPI guard contradiction (findings #1-2) is unresolved. |
| M6 — de-cast 15 casts across 6 files incl. checkin-panel | **IMPLEMENTED (with caveat)** | Zero `as any` remaining in apps/admin + apps/lms; checkin-panel, shift-reg-detail, terms-panel, kpi-evaluation-panel genuinely de-cast (real trpc types + type guards). Payroll/compensation casts CONSOLIDATED into `shallow-trpc.ts` `as unknown as` — centralized type erasure, not elimination (finding #8, DEBT-acknowledged). |

## Global success criteria check (plan §Global)

1. Director upload → auto-open after own class session end: implemented (exercise.upsert + openedUnitIdsFor); e2e proof pending DB.
2. Teacher create/publish gone, dead buttons replaced by indicator: DONE (`grading.tsx`, `schedule-detail.tsx` SessionExerciseIndicator).
3. Directors create profile+rate, domain-scoped, no cross: guard DONE; test-enforced claim NOT yet true (findings #1, #6, M5 partial).
4. `pnpm typecheck` clean: VERIFIED. No `as any` around tRPC: true literally, but `as unknown as` survives in shallow-trpc.ts. Parity green: VERIFIED (23). Int + e2e + migration 0-drift: NOT RUN (env).

## Additional verifications

- `loginParent` fully removed: router, `packages/auth` export, implementation, and all test consumers migrated to `mintParentSession` (OTP path). No residue (grep clean).
- LMS RLS compatibility of the new open-check: `class_session` policy is plain facility-scope (`app_facility_ids()`), and `lmsRlsContextOf` sets the student's facilities → `openedUnitIdsFor` works under LMS context. `enrollment` policy admits `student_id = ANY(app_student_ids())` for the relation filter. OK.
- Snapshot ↔ registry parity: snapshot JSON matches permissions.ts exactly for exercise + all 22 payroll keys; parity test passes.
- Audit: `logEvent` accepts `facilityId: null` (checked `packages/audit/src/index.ts:29`); exercise audit rows become facility-NULL (visible to all staff per record_event policy) — consistent with global-asset semantics.
- `/showcase` DEV gate: `import.meta.env.DEV` + null-lazy in App.tsx and student-shell; production bundle exclusion previously verified by implementer via dist grep.
- Seeds: `seed-demo.ts` thresholds removed with model; `seed-lms.ts` unit-bound exercises idempotent under composite unique; course codes fixed to real `UCREA-L1`/`BRIGHT_IG-J`.

## Recommended actions (priority order)

1. Resolve the KPI confirm/approve domain-scope contradiction (findings #1-2): pick the contract, align `payroll.ts` + `kpi-multiactor-and-list.int.test.ts` + decision 0023, then run the full int suite against a DB before commit.
2. Restore the deleted DEBT.md entries (finding #4).
3. Fix the false comment in `kpi-evaluation-workflow.int.test.ts` and the stale RLS comment on `/files/exercise/:ref` (findings #3, #5).
4. Add the two missing C2 negative int tests (finding #6).
5. Before landing: `prisma migrate reset` + `migrate diff` on prod-mirror (0-drift), full `test:int`, e2e teacher-nav — all currently blocked on DB availability and explicitly still owed by plan P7.

## Unresolved questions

- Is super_admin expected to be the routine second signature for KPI approval in single-director domains, or should approve be cross-domain? (blocks finding #2)
- Should LMS principals be able to fetch DRAFT exercise PDFs by ref via `/files/exercise/:ref`? (finding #5)
- Harness checkpoints (intake/story/decision rows via harness-cli) not verified by this review — confirm they were recorded for the high-risk lane.
