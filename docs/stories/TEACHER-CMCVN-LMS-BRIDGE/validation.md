# Validation

## Proof Strategy

Use focused API tests for changed contracts, then browser smoke for the teacher-domain bridge and parent/student visibility. Existing workflows should be reused and only fixed when evidence shows a launch blocker.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Host/origin allowlist helpers, any extracted teacher ownership guard. |
| Integration | SSO return host, director intake handoff, duplicate/race handling, teacher other-session mutation denial, parent/student isolation. |
| E2E | Teacher host login/landing, director setup path, teacher evidence/grading, parent sees teacher interaction, student submits homework. |
| Platform | `teacher.cmcvn.edu.vn` nginx/CORS/cookie/Cloudflare smoke; `devteacher.cmcvn.edu.vn` must route to dev API/DB and pass CORS/SSO/cert smoke; existing `erp/hoc/deverp/devlms` regression smoke. |
| Performance | No new heavy job in request path; notification reconcile idempotent if changed. |
| Logs/Audit | No raw parent phone/email in new human-readable audit/report bodies. |

## Fixtures

- Director KD.
- Director DT.
- Teacher assigned to class.
- Same-facility unassigned teacher for negative tests.
- Parent with email and normalized phone.
- Student linked to parent and class.
- Curriculum unit/exercise and submitted homework.

## Commands

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter api test <focused integration tests>
curl -fsS https://teacher.cmcvn.edu.vn/api/health
curl -fsS -o /dev/null https://teacher.cmcvn.edu.vn/
curl -fsS https://devteacher.cmcvn.edu.vn/api/health
curl -fsSI https://devteacher.cmcvn.edu.vn/api/auth/sso/login
```

## Acceptance Evidence

### Local Focused Verification - 2026-07-06

- `pnpm --filter @cmc/api typecheck` passed.
- `pnpm --filter @cmc/ui typecheck` passed.
- DB-backed focused integration passed against throwaway Postgres on port 55432:
  - `test/attendance-report-markall.int.test.ts`
  - `test/session-evidence-publish-to-lms.int.test.ts`
  - `test/lms-security-invariants.int.test.ts`
  - Result: 3 files, 22 tests passed.
- LMS browser smoke passed against throwaway Postgres on port 55432:
  - `pnpm --filter @cmc/e2e exec playwright test tests/lms-smoke.spec.ts`
  - Result: 4 tests passed.
  - Notes: ran with `CI=1` so Playwright did not reuse stale dev servers; `JWT_SECRET` must be at least 32 chars or successful login cannot mint the LMS session token.
- Focused LMS browser suite passed together against a fresh throwaway Postgres on port 55432:
  - `pnpm --filter @cmc/e2e exec playwright test tests/lms-smoke.spec.ts tests/session-evidence-publish.spec.ts tests/lms-autosave-and-parent-readonly.spec.ts --workers=1`
  - Result: 7 tests passed.
  - Coverage: LMS smoke, student fallback-code login, parent OTP login, staff/admin session evidence publish, student visibility, parent visibility, student PDF homework autosave without manual save, parent read-only drawn-work view, guardian PDF fetch.
  - Notes: Playwright specs avoid importing workspace TypeScript packages directly; they use local Prisma/JWT helpers so Vitest/Vite-only module formats do not block browser E2E execution.
- Harness story verification passed after replacing the stale markdown verify command with executable proof:
  - `.\scripts\bin\harness-cli.exe story verify TEACHER-CMCVN-LMS-BRIDGE`
  - Runs `scripts/verify-teacher-cmcvn-lms-bridge.ps1`, including `scripts/verify-teacher-cmcvn-live-smoke.ps1`.
  - Result: pass.
  - 2026-07-06 rerun fixed a verification integrity issue: PowerShell external-command failures now
    throw, so failed E2E cannot be followed by live smoke and reported as pass. The
    session-evidence E2E fixture now uses today's local date at UTC midnight with `00:00-00:01`
    so the schedule list sees the session and the post-class controls are enabled. Rerun result:
    7 focused browser tests passed plus live smoke passed.
- Equivalent `scripts/ci-integration-tests.sh` could not run directly from WSL bash because Docker Desktop WSL integration is off; the same migrate/seed/test steps were run natively in PowerShell.
- Follow-up objective audit tightened the one-form parent/student intake surface:
  - `apps/admin/src/finance-panel.tsx` new-student receipt form now requires parent phone, parent name, parent email, and student name in one form, with optional student DOB/class.
  - It passes `parentEmail` to `finance.receiptCreate`, preserving the existing draft/provisioning handoff and decision 0037 union response handling.
  - `pnpm --filter @cmc/admin typecheck` passed after the UI change.
  - Production admin was rebuilt on the VPS; root/API live smoke passed with marker `manual-teacher-intake-form-20260706021200`, built at `2026-07-06T02:12:00Z`.
  - Production admin bundle contains the `Email phụ huynh` field text.
- Follow-up authz/UI audit resolved education-director access to the draft intake path:
  - `packages/auth/src/permissions.ts` grants `giam_doc_dao_tao` only `finance.receiptCreate` and matching `crm.opportunityLookup`; `finance.receiptApprove`, list, send, reconcile, cancel, revenue, and CRM board gates remain denied.
  - `apps/admin/src/edu-director-cockpit-panel.tsx` adds a GĐĐT cockpit shortcut to the intake form; `apps/admin/src/finance-panel.tsx` renders only permitted finance cards so a draft-only caller does not trigger finance-list/approval APIs.
  - `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` passed: 27 tests.
  - `pnpm --filter @cmc/admin test -- src/__tests__/nav-director-dt-cockpit-consolidation.test.ts src/__tests__/nav-consistency.test.ts` passed: 16 tests.
  - `pnpm --filter @cmc/api typecheck`, `pnpm --filter @cmc/auth typecheck`, `pnpm --filter @cmc/admin typecheck`, and `pnpm --filter @cmc/admin build` passed.
  - Production API/admin were rebuilt on the VPS; live smoke passed with marker `manual-teacher-dt-intake-20260706092700`, built at `2026-07-06T02:27:00Z`.
  - Production admin bundle contains `Tiếp nhận phụ huynh + học sinh` and the intake route marker.

### Pending Live Verification

- Non-interactive Microsoft authorize pre-login now accepts both prod staff redirect URIs without
  `AADSTS50011` or `AADSTS900971`:
  - `https://erp.cmcvn.edu.vn/api/auth/sso/callback`
  - `https://teacher.cmcvn.edu.vn/api/auth/sso/callback`
- Interactive SSO callback smoke from a real browser/MFA account.
  - Operator-assisted verifier is available:
    `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-interactive-sso.ps1`
  - To prove both production staff hosts in one browser session:
    `$env:SSO_ORIGINS='https://teacher.cmcvn.edu.vn,https://erp.cmcvn.edu.vn'; powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-interactive-sso.ps1`
  - It opens a headed browser, waits for manual Microsoft login/MFA, then verifies return to
    each selected staff host, authenticated staff shell visibility, and a host-scoped
    `cmc.session` cookie.

### Live Smoke - 2026-07-06

- Deployed manually to VPS `152.42.167.189` from `/root/cmcnew`.
- `https://erp.cmcvn.edu.vn/api/health` returned `{"ok":true,"commit":"manual-teacher-bridge-20260705193000","builtAt":"2026-07-05T19:30:00Z"}`.
- `https://teacher.cmcvn.edu.vn/api/health` returned the same deploy marker.
- `https://hoc.cmcvn.edu.vn/api/health` returned the same deploy marker.
- `https://teacher.cmcvn.edu.vn/` returned 200.
- `https://hoc.cmcvn.edu.vn/` returned 200.
- Teacher SSO start returned 302 to Microsoft with `redirect_uri=https://teacher.cmcvn.edu.vn/api/auth/sso/callback` and a host-only `cmc.sso_tx` cookie.
- ERP SSO start returned 302 to Microsoft with `redirect_uri=https://erp.cmcvn.edu.vn/api/auth/sso/callback`.

### Live Smoke Regression Catch - 2026-07-06

- `scripts/verify-teacher-cmcvn-live-smoke.ps1` initially caught a live regression: direct `https://teacher.cmcvn.edu.vn/api/auth/sso/login` fell back to the ERP callback when no `returnOrigin`, `Origin`, or `Referer` header was present.
- Fixed API SSO start to derive staff origin from `x-forwarded-proto` + `x-forwarded-host` / `host` as a final fallback, then redeployed API on VPS.
- New live deploy marker: `manual-teacher-sso-host-20260705203155`, built at `2026-07-05T20:31:55Z`.
- `.\scripts\bin\harness-cli.exe story verify TEACHER-CMCVN-LMS-BRIDGE` passed after the fix, including local focused proof plus live prod smoke.
- Live smoke now verifies:
  - `erp`, `teacher`, and `hoc` health return 200 with the same deploy marker.
  - `erp`, `teacher`, and `hoc` roots return 200.
  - ERP SSO start redirects to Microsoft with ERP callback.
  - Teacher SSO start redirects to Microsoft with teacher callback.
  - SSO tx cookie is host-only.
  - Microsoft authorize pre-login for ERP and teacher does not return `AADSTS50011` or
    `AADSTS900971`; this proves the redirect URI is accepted before login, but does not replace
    the full interactive browser/MFA callback smoke.
- VPS sync follow-up: copied the fail-fast verifier script, live-smoke script, session-evidence E2E
  fixture, and evidence docs to `/root/cmcnew`; grep on the server confirmed `Invoke-VerifyCommand`
  and `todayLocalDateKey`. A server-side curl smoke from the VPS confirmed health/root for
  `erp`, `teacher`, `hoc`, plus ERP/teacher SSO start callback routing and host-only tx cookie.
- Added `scripts/verify-teacher-cmcvn-interactive-sso.ps1` +
  `scripts/verify-teacher-cmcvn-interactive-sso.mjs` for the remaining operator-assisted Microsoft
  callback/MFA proof. The verifier supports `SSO_ORIGINS` for sequential ERP + teacher host proof.
  Syntax/help validation passes; final pass requires a real staff account.

### Live SPA Identity Regression Catch - 2026-07-06

- User-visible production regression was real: `teacher.cmcvn.edu.vn` and `erp.cmcvn.edu.vn`
  returned the LMS title/asset, while `hoc.cmcvn.edu.vn` returned the admin title/asset.
- Container inspection proved the images were not swapped:
  - `cmcnew-prod-admin-1` served `<title>CMC ERP | Cổng nhân sự</title>`.
  - `cmcnew-prod-lms-1` served `<title>Học tập CMC EDU</title>`.
- Root cause: prod nginx was older than the recreated app containers and had cached stale upstream
  IPs. Restarting `cmcnew-prod-nginx-1` forced upstream re-resolution.
- Live verification after restart:
  - `https://erp.cmcvn.edu.vn/` title `CMC ERP | Cổng nhân sự`, asset `/assets/index-BNwowYVw.js`.
  - `https://teacher.cmcvn.edu.vn/` title `CMC ERP | Cổng nhân sự`, asset `/assets/index-BNwowYVw.js`.
  - `https://hoc.cmcvn.edu.vn/` title `Học tập CMC EDU`, asset `/assets/index-DY8flxOM.js`.
- `scripts/verify-teacher-cmcvn-live-smoke.ps1` now asserts root SPA identity markers, not only
  status 200. Jenkins prod/dev smoke also asserts `CMC ERP` for staff hosts and `CMC EDU` for LMS
  hosts, so a future upstream swap fails the pipeline.

### Teacher Console Surface Correction - 2026-07-06

- Product audit found the previous `teacher.cmcvn.edu.vn` result was still an ERP-looking staff
  shell. That was not enough for the teacher/director system intent.
- Implemented host-aware Teacher Console mode inside the existing admin bundle:
  - `teacher.cmcvn.edu.vn` renders `CMC Teacher Portal` before login.
  - Login copy says it is for schedule, classes, LMS comments, and training operations.
  - Topbar brand becomes `CMC Teacher` / `Teacher Console`.
  - Teacher-host nav labels are focused on `Lịch & buổi học`, `Lớp & bài tập`, `Học viên`,
    `Điều phối đào tạo`, `Tiếp nhận`, `Công ca`, and `Cá nhân`; ERP-only CRM/HR labels are not
    the teacher-host surface.
  - A visible `Mở ERP đầy đủ` escape remains for authorized staff who need the full ERP.
- Local proof:
  - `pnpm --filter @cmc/admin typecheck` passed.
  - `pnpm --filter @cmc/ui typecheck` passed.
  - `pnpm --filter @cmc/admin test -- src/__tests__/nav-teacher-consolidation.test.ts src/__tests__/nav-director-dt-cockpit-consolidation.test.ts src/__tests__/nav-consistency.test.ts` passed: 24 tests.
  - `pnpm --filter @cmc/admin build` passed.
  - `scripts/verify-teacher-cmcvn-rendered-surface.mjs` against local preview passed with title
    `CMC Teacher Portal`.
- Production proof after rebuilding only `cmcnew-prod-admin` and restarting nginx:
  - `scripts/verify-teacher-cmcvn-live-smoke.ps1` passed.
  - Rendered browser proof returned title `CMC Teacher Portal`, `hasTeacherBrand=true`.
  - `teacher.cmcvn.edu.vn` admin bundle contains marker `CMC Teacher`.
  - Screenshot: `plans/reports/teacher-surface-live.png`.

### Teacher Surface Scope Correction - 2026-07-06

- Product audit found the Teacher Console was still too close to ERP for director accounts:
  the surface relabeled `finance` as intake, but still routed to the full `FinancePanel`.
  That exposed finance-oriented screens beyond the temporary LMS operations brief.
- Corrected the teacher surface scope:
  - `teacher.cmcvn.edu.vn` no longer allows the `finance` section in the teacher surface
    route allowlist.
  - Added `family-intake` as a teacher-surface-only route for the one-form parent+student
    draft handoff.
  - `family-intake` reuses the accepted `finance.receiptCreate` backend contract, preserving
    the receipt/provisioning invariant without rendering price list, vouchers, receipt list,
    revenue report, reconcile, payroll, HR, CRM, or work-shift modules in the teacher surface.
  - Teacher surface nav now focuses on teaching day, class/course material, students/parents,
    director coordination, and parent+student intake.
  - `family-intake` now renders an intake-only variant of the shared receipt draft card:
    teacher surface copy says `Thông tin phụ huynh + học sinh` / `Tạo hồ sơ nháp`, hides
    voucher/discount/prepay finance fields, and keeps full receipt wording in the ERP finance
    panel only.
  - Full ERP remains available only through the explicit `Mở ERP đầy đủ` escape.
- Local proof:
  - `pnpm --filter @cmc/admin typecheck` passed.
  - `pnpm --filter @cmc/admin test -- src/__tests__/nav-teacher-consolidation.test.ts src/__tests__/nav-consistency.test.ts src/__tests__/nav-director-dt-cockpit-consolidation.test.ts src/__tests__/nav-director-kd-cockpit-consolidation.test.ts` passed: 30 tests.
  - `pnpm --filter @cmc/admin build` passed.
  - After the intake-only copy correction, `pnpm --filter @cmc/admin typecheck` passed, focused
    teacher/director nav tests passed 21 tests, `pnpm --filter @cmc/admin build` passed, and
    `scripts/verify-teacher-cmcvn-lms-bridge.ps1` passed again with 13 Playwright tests.
  - `.\scripts\bin\harness-cli.exe story verify TEACHER-CMCVN-LMS-BRIDGE` now includes
    `tests/teacher-nav-consolidation.spec.ts` before the LMS parent/student specs. It passed
    13 Playwright tests total, including authenticated Teacher Console checks for:
    - `giao_vien`: teaching/LMS nav only, no finance/CRM/HR/work-shift groups.
    - `giam_doc_dao_tao`: coordination plus `family-intake`, no full finance.
    - `giam_doc_kinh_doanh`: direct `/finance?surface=teacher` rejected back to intake surface.
- Production proof after rebuilding `cmcnew-prod-admin` and restarting nginx:
  - `scripts/verify-teacher-cmcvn-live-smoke.ps1` passed.
  - Rendered browser proof returned title `CMC Teacher Portal`, `hasTeacherBrand=true`.
  - Live teacher/admin bundle asset `/assets/index-fou0Ms-B.js` contains the `family-intake`
    marker; the rendered teacher host shows the Teacher-branded surface instead of the ERP shell.

### Dev Teacher Environment Correction - 2026-07-06

- Production-safety audit found `devteacher.cmcvn.edu.vn` was not a dev Teacher Console host:
  it returned the same deploy marker as prod `teacher.cmcvn.edu.vn`.
- Added `devteacher.cmcvn.edu.vn` to the dev environment rather than using prod:
  - nginx routes `devteacher` to `cmcnew-dev-admin` and `/api` to `cmcnew-dev-api`.
  - dev compose passes `STAFF_APP_ORIGINS` into `dev-api`, so SSO origin allowlist includes
    `devteacher`.
  - `.env.dev.example` includes `devteacher` in `CORS_ORIGINS` and `STAFF_APP_ORIGINS`.
  - `scripts/ensure-origin-cert.sh` verifies/regenerates the shared origin cert with `devteacher`
    in the SAN set.
  - Jenkins `develop` smoke now checks `devteacher` health marker, Teacher bundle markers,
    CORS preflight, and SSO redirect URI.
- Live VPS proof:
  - `deverp`, `devteacher`, and `devlms` all returned dev marker
    `manual-devteacher-20260706071803`.
  - `erp`, `teacher`, and `hoc` kept prod marker `manual-teacher-dt-intake-20260706092700`.
  - Rendered browser proof for `https://devteacher.cmcvn.edu.vn/` passed with title
    `CMC Teacher Portal`.
  - CORS preflight for origin `https://devteacher.cmcvn.edu.vn` returned
    `access-control-allow-origin: https://devteacher.cmcvn.edu.vn`.
  - SSO start redirected to Microsoft with
    `redirect_uri=https://devteacher.cmcvn.edu.vn/api/auth/sso/callback` and a host-only
    `cmc.sso_tx` cookie.
  - Microsoft authorize pre-login did not return `AADSTS50011` or `AADSTS900971`.
  - Shared origin cert SAN contains `devteacher.cmcvn.edu.vn`.
  - `cmcnew-dev-dev-postgres-1` and `cmcnew-dev-dev-redis-1` have no published host ports and do
    not appear on `cmcnew-edge`.

### Family Intake Draft Visibility Fix - 2026-07-06

- Production/dev audit confirmed the user-visible bug: `/family-intake` returned a success toast
  while the created parent/student intake remained only as a `receipt` draft; `Student`,
  `ParentAccount`, `Guardian`, and `Enrollment` are created later by `finance.receiptApprove`.
- Live DB proof was masked/aggregate only:
  - Dev had 1 intake `draft` with parent email/phone and no `student_id`.
  - Prod had 1 intake `draft` with parent email/phone and no `student_id`; older
    approved/reconciled intake receipts did have `student_id`.
- Corrected the Teacher Console workflow without changing the approved receipt/provisioning
  invariant:
  - `FamilyIntakePanel` now loads `finance.receiptListOwn` and renders `Hồ sơ tiếp nhận gần đây`.
  - Success toast includes a durable short receipt reference (`HSO-<id-prefix>` for draft).
  - GĐĐT can read only receipts they created through `receiptListOwn`; they still cannot call
    full `receiptList`, approve, send, reconcile, cancel, revenue, or finance module screens.
  - Actors that already hold `finance.receiptApprove` see `Duyệt & kích hoạt` in the intake queue.
- Local proof:
  - `pnpm --filter @cmc/admin typecheck` passed.
  - `pnpm --dir apps/api exec vitest run test/permission-parity.test.ts --reporter=verbose`
    passed: 27 tests.
  - `pnpm --dir apps/api exec vitest run --config vitest.integration.config.ts
    test/role-flows-commission-chain.int.test.ts --reporter=verbose` passed: 7 tests, including
    `education director intake draft is durable and visible through receiptListOwn only`.
  - `pnpm --dir apps/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts
    src/__tests__/nav-director-dt-cockpit-consolidation.test.ts --reporter=verbose` passed:
    15 tests.
- Live proof after rebuilding `dev-api/dev-admin` and `api/admin`, then reloading nginx:
  - `https://devteacher.cmcvn.edu.vn/` returned 200; `/api/health` returned `ok:true`.
  - `https://teacher.cmcvn.edu.vn/` returned 200; `/api/health` returned `ok:true`.
  - Dev and prod admin bundles contain `Hồ sơ tiếp nhận gần đây`, `Đã ghi hồ sơ`, and
    `Duyệt & kích hoạt`.

### Full Teacher/LMS Verifier Coverage Expansion - 2026-07-06

- Completion audit found the story verifier was too narrow for the original teacher objective:
  it proved the Teacher host, attendance, session evidence, LMS smoke, and autosave flows, but
  did not directly gate class-code generation, exercise upload RBAC, parent/student provisioning,
  intake draft visibility, or teacher-role grading.
- Strengthened the executable story verifier (`scripts/verify-teacher-cmcvn-lms-bridge.ps1`) to
  include the following API integration proofs before the Playwright and live smoke gates:
  - `test/schedule-my-sessions.int.test.ts`: teachers see only their assigned sessions; GĐĐT sees
    facility teaching sessions.
  - `test/teacher-bridge-staff-setup.int.test.ts`: GĐĐT can create a `giao_vien` staff account
    in ERP scope, the created teacher has the expected role/facility and can use staff teaching
    APIs; GĐKD cannot create a teacher role.
  - `test/batch-code-atomicity.int.test.ts` and `test/class-batch-create-multislot.int.test.ts`:
    directors create classes through the current class structure, with generated
    `HQ-UCR-YY-NNNN` class codes and multi-slot schedule validation.
  - `test/upload-exercise-pdf-rbac.int.test.ts`: GĐĐT can upload curriculum exercise PDFs while
    unauthorized staff cannot.
  - `test/student-provisioning-approve.int.test.ts`: approving an intake receipt creates
    `Student`, `ParentAccount`, `Guardian`, and `Enrollment`; the test now asserts parent email
    is persisted for notification use.
  - `test/role-flows-commission-chain.int.test.ts`: GĐĐT `/family-intake` drafts are durable and
    visible via `receiptListOwn` only, not through the full finance list/approve permissions.
  - `test/lms-full-lifecycle-e2e.int.test.ts`: intake → LMS login → director exercise upsert →
    student submission → `giao_vien` grade/publish → student sees published grade. The grader is
    now a real teacher-role actor assigned to the session, not a default super-admin staff caller.
  - `test/submission-version-conflict.int.test.ts` and `test/submission-guardian-layer.int.test.ts`:
    LMS submission autosave concurrency, unpublished grade redaction, and parent read-only view of
    published teacher annotation layer.
- Direct verifier proof on a throwaway Postgres container:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify-teacher-cmcvn-lms-bridge.ps1`
    passed in 89.6s before adding the staff-setup proof, then passed again in 80.4s after
    `test/teacher-bridge-staff-setup.int.test.ts` was added to the verifier.
  - The run applied 74 migrations, seeded the DB, passed API/UI typechecks, generated Prisma,
    ran 13 API integration files, passed 13 Playwright tests, and passed the live
    `https://teacher.cmcvn.edu.vn/` smoke with title `CMC Teacher Portal`.
