# Plan 3 E2E gap closure — completion report

Date: 2026-07-02

## Scope

Close the 3-flow Playwright gap from `phase-06-validation.md`:

1. sale draft-receipt → director approve → O5
2. new-staff onboarding → SSO login
3. director monthlyReport drill-down (server-side aggregate, no FORBIDDEN)

## Result summary

| Flow | Status | File |
| --- | --- | --- |
| #1 commission chain | **NEW spec, passes live** | `apps/e2e/tests/admin-commission-chain.spec.ts` |
| #2 onboarding→SSO | **Already covered** — no new file | `apps/e2e/tests/admin-create-staff.spec.ts` (existing) |
| #3 monthlyReport drill-down | **NEW spec, syntactically correct, blocked from live run** by a pre-existing environment bug | `apps/e2e/tests/admin-monthly-report-drilldown.spec.ts` |

## Flow #1 — commission chain (DONE, verified live)

`apps/e2e/tests/admin-commission-chain.spec.ts`. Logs in as `admin@cmc.local` (super_admin bypasses
all role checks per `packages/auth/src/permissions.ts`, so one session legitimately drives both the
sale-side create and the director-side approve while still exercising the real business logic —
decision 0024's auto-O5 advance is server-side and unconditional on caller role).

Steps: create an O1 opportunity via the CRM form → click its kanban card (pipeline defaults to
kanban view per `view-defaults.ts`, so the card is a `role="button"` div, not a table row) →
`opportunity-detail.tsx`'s "Tạo phiếu thu" button → fill the course Select in the "Tạo phiếu thu từ
cơ hội" modal → submit draft → approve it from `finance-panel.tsx` → navigate back to the opportunity
record page and assert the status badge reads "Thành công" and the O5 stage button is active.

**Command:** `pnpm --filter @cmc/e2e test tests/admin-commission-chain.spec.ts`
**Result:** 1 passed (3.9s).

### Blocker found + resolved (test-data only, no app/source change)

First run failed: the dev DB had **zero rows in `course_price`** — `CRS_10512_5483` (the
`TEST_PRICED_COURSE` default already used by `admin-receipt-provision.spec.ts`) didn't exist at all.
This is a pre-existing gap in `packages/db/src/seed.ts` (no seed ever creates a priced course), and it
already blocked the **existing** `admin-receipt-provision.spec.ts` identically — confirmed by running
it before my fix (same `locator.click: Test timeout … getByRole('option', { name: /CRS_10512_5483/ })`
failure).

I seeded the missing fixture directly via `withRls(SUPER, …)` (course `CRS_10512_5483` + a
`coursePrice` row at facility 1, amount 10,000,000, effective 2020-01-01) — pure test data, no schema
or app-source change. Re-ran both specs after seeding: **both now pass live**
(`admin-receipt-provision.spec.ts`: 1 passed 8.7s; `admin-commission-chain.spec.ts`: 1 passed 3.9s).
This fixture is durable in the dev DB (not per-test-suffixed), so it now unblocks the whole
`TEST_PRICED_COURSE`-dependent E2E surface going forward.

## Flow #2 — onboarding → SSO (already covered, no new file)

Read `admin-create-staff.spec.ts` (creates a staff member through the SSO-only "Tạo người dùng" form,
asserts no password field exists) and `unified-staff-shell.spec.ts` / `admin-fail-closed-login.spec.ts`.
`admin-create-staff.spec.ts` already proves the onboarding half (form → user created, no password
field per the SSO-only regression guard). The "→ SSO login" half isn't separately E2E-tested (SSO login
itself is an external IdP flow, not something Playwright can drive without a mocked IdP), and no such
mock exists in this repo. Per the task brief, I did not invent a new mock/test path for this — it would
require inventing infrastructure outside the stated scope (STOP-and-report territory, not a real gap
in what's testable). Judged: adequately covered as-is.

## Flow #3 — monthlyReport drill-down (spec written, BLOCKED from live run)

`apps/e2e/tests/admin-monthly-report-drilldown.spec.ts`. Seeds a director who is **deliberately NOT**
the target employee's manager (a separate `otherManager` holds `managerId`), plus the exact shift/punch
fixture already proven correct in `attendance-payroll-deduction.int.test.ts`
(22:00–23:00 shift, punches at 22:15/22:40 ICT → lateMinutes=15, earlyMinutes=20,
penaltyAmount=27_500). Uses `mintStaffSession` + a manually-injected `cmc.session` cookie (same pattern
as the existing `work-shift-manual-punch-approval.spec.ts`) to log in as that director without a
password. Navigates directly to `/payroll-checkin` (App.tsx's `/:section` route accepts any section by
URL even though the nav link is only rendered for teacher-only accounts — confirmed by reading
`shell.tsx:456` `visible: isTeacherOnly` vs `App.tsx:808` `<Route path="/:section" .../>`), opens the
"Báo cáo công" tab, loads the period, and asserts:
- no FORBIDDEN error toast,
- the employee's row shows the exact aggregate (15p / 20p / 27.500đ),
- the drill-down ("Xem") shows the per-day breakdown with the shift name.

This directly proves the M5 fix documented in `phase-04-attendance-payroll.md`: `monthlyReport` is a
server-side facility-scoped aggregate that does **not** call `canViewStaffPunch` (which only allows
hr/self/direct-manager) — a non-manager director must not get FORBIDDEN.

### Blocker (pre-existing, NOT introduced by this task, NOT fixable within file-ownership scope)

`apps/e2e/tests/work-shift-manual-punch-approval.spec.ts` (already in the repo, unmodified) fails
identically:

```
SyntaxError: Cannot use 'import.meta' outside a module
  at ..\..\..\packages\db\src\index.ts:6
```

Root cause: `packages/db/src/index.ts` re-exports `seed-curriculum.ts`
(`packages/db/src/seed-curriculum.ts:14,225` use `import.meta.url`, added in commit `64bce29`).
`apps/e2e/package.json` has **no `"type": "module"`**, so Playwright's Node-transform loads e2e spec
files as CommonJS by default; when a spec imports `@cmc/auth` (which imports `@cmc/db`), the CJS
transform hits `import.meta` and throws — Node's CJS loader has no equivalent for it. This is a
pre-existing gap between `packages/db`'s ESM-only surface (`"type": "module"`) and `apps/e2e`'s
CJS-default Playwright config, exposed by the recent curriculum-seed addition. It blocks **every**
spec that imports `@cmc/auth`/`@cmc/db` for direct-session-injection (mine, plus the already-committed
`work-shift-manual-punch-approval.spec.ts`) — confirmed by running the existing spec in isolation and
getting the exact same stack trace.

**I did not patch this** — `apps/e2e/package.json` and `packages/db/src` are both outside my file
ownership for this task (only NEW files under `apps/e2e/tests/` were in scope), and the fix (adding
`"type": "module"` to `apps/e2e/package.json`, or making `seed-curriculum.ts`'s `import.meta` usage
lazy/optional) is an app-infrastructure change, not a validation-writing one.

**Verification done instead:**
- `pnpm exec tsc --noEmit` against the file (run from `apps/e2e/`, extending the repo's
  `tsconfig.base.json`) reports zero errors specific to my code — the only diagnostics are
  `Cannot find module '@cmc/auth'/'@cmc/db'` and two `implicit any` on `tx` params, both artifacts of
  my ad-hoc tsconfig not resolving pnpm workspace symlinks the same way the real build does (the
  sibling `work-shift-manual-punch-approval.spec.ts` uses the identical `withRls(SUPER, (tx) => …)`
  pattern with no type annotation, so this is not a new problem).
- The spec's logic mirrors two already-passing, already-reviewed sources verbatim: the session-cookie
  pattern from `work-shift-manual-punch-approval.spec.ts` and the exact shift/punch/expected-numbers
  fixture from `attendance-payroll-deduction.int.test.ts` (`lateMinutes: 15`, `earlyMinutes: 20`,
  `attendanceDeduction: 27_500`), which is a live-integration-tested, currently-passing assertion of
  the same math the UI renders.

## Commands run

```
pnpm --filter @cmc/e2e test tests/admin-commission-chain.spec.ts        # 1 passed (3.9s)
pnpm --filter @cmc/e2e test tests/admin-receipt-provision.spec.ts       # 1 passed (8.7s) — was failing before the course-price seed fix
pnpm --filter @cmc/e2e test tests/admin-monthly-report-drilldown.spec.ts  # blocked, see above
pnpm --filter @cmc/e2e test tests/work-shift-manual-punch-approval.spec.ts  # blocked identically, confirms pre-existing
```

## Files touched

- NEW `apps/e2e/tests/admin-commission-chain.spec.ts` — flow #1, verified passing live.
- NEW `apps/e2e/tests/admin-monthly-report-drilldown.spec.ts` — flow #3, syntactically correct,
  blocked from live execution by the pre-existing ESM/CJS gap described above.
- No existing spec or app source file was modified.
- Dev-DB side effect (data only, not code): seeded `course.code = 'CRS_10512_5483'` +
  `coursePrice { facilityId: 1, amount: 10_000_000, effectiveFrom: 2020-01-01 }` — this is the fixture
  `admin-receipt-provision.spec.ts` already assumed existed; it did not, and now does.

## Unresolved / follow-up for the orchestrator

1. **Flow #3 cannot be verified live until someone in-scope for `apps/e2e/package.json` /
   `packages/db/src` fixes the ESM/CJS mismatch.** Cheapest fix candidates (not evaluated in depth,
   out of my scope): add `"type": "module"` to `apps/e2e/package.json`, or make
   `seed-curriculum.ts:14`'s `import.meta.url` resolution lazy (inside the function body it already is
   — the break is Playwright's static CJS transform of the whole module graph, not evaluation order).
2. Recommend adding the `CRS_10512_5483` course+price to `packages/db/src/seed.ts` proper (currently
   only patched live in the dev DB by me) so a fresh `pnpm db:seed` doesn't silently re-break both
   commission-chain and receipt-provision specs.
3. Flow #2 (SSO login itself) has no feasible Playwright coverage without a mock IdP; flagging as a
   permanent gap rather than leaving it silently unaddressed.

Status: DONE_WITH_CONCERNS
Summary: Flow #1 written and passing live; flow #2 confirmed already covered; flow #3 written and logically verified but blocked from live execution by a pre-existing ESM/CJS import.meta bug that also breaks the already-existing work-shift-manual-punch-approval.spec.ts (not caused by this task, out of file-ownership scope to fix).
Concerns/Blockers: pre-existing @cmc/db/@cmc/auth ESM import.meta break in Playwright's CJS transform (apps/e2e/package.json missing "type":"module"); missing course-price seed fixture (now patched as test data, recommend promoting to packages/db/src/seed.ts).
