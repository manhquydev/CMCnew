# Code Review — Director KPI Authority + SSO Welcome Email

Date: 2026-06-27
Branch: develop (uncommitted diff)
Reviewer: code-reviewer
Scope: authorization (KPI), public contract (role dropdown), external email (welcome), test isolation

## Verdict

DONE_WITH_CONCERNS — no authorization regression, no password leak, no contract weakening.
All findings are LOW / informational. Nothing blocking.

## Scope reviewed

- `packages/auth/src/permissions.ts` (KPI grants + assignableRoles)
- `apps/api/src/routers/payroll.ts` (SoD enforcement — read only)
- `apps/api/src/routers/user.ts` (welcome email, ROLE_LABELS, loginUrl)
- `apps/api/src/services/email-templates.ts` (account_welcome)
- `apps/api/src/services/email-outbox.ts` (enqueue dedup — read only)
- `apps/admin/src/App.tsx` (role dropdown)
- Tests: permission-parity, director-kpi-and-welcome.int, email-outbox.int, email-otp-login.int
- `packages/auth/package.json` (subpath export)

## Verification results (all requested checks PASS)

1. No authz regression — directors gain ONLY the 4 KPI actions.
   - `permissions.ts:169-175`: confirm/approve/get/list now include the two director roles. `kpiEvalStart`, `kpiAutoPrefill`, `kpiSetAuto` remain `['hr','ke_toan']` (unchanged). Snapshot fixture matches. Parity test explicitly asserts directors are NOT in start/prefill/setAuto.
   - Grepped director roles across the file: they appear only where intended; no silent additions elsewhere beyond the existing director permission blocks.

2. SoD intact — `payroll.ts:876-878`: `if (row.confirmedById === ctx.session.userId) throw FORBIDDEN`. The check is per-userId, so both directors holding confirm+approve does NOT bypass it — directorA confirms, directorB approves; same director on both is rejected. Int test covers both the happy path (two distinct directors) and the FORBIDDEN path (same director).

3. Welcome email cannot leak password and cannot roll back the create.
   - `user.ts:127-150`: create commits inside `withRls(SYSTEM_CTX)`; `emailWelcome()` runs AFTER the tx returns, in its OWN super-scoped tx wrapped in try/catch (`console.error` on failure). Mail failure cannot undo the create.
   - Payload (`email-templates.ts` account_welcome) renders only `displayName`, `loginUrl`, `roleLabel`. No password field exists on the template type. Int test asserts `bodyHtml` does NOT contain the plaintext password and DOES contain "CMC EDU".

4. Dropdown change does not weaken backend enforcement.
   - `user.ts:76,93`: `create` is `requirePermission('user','create')` and re-derives `assignableRoles(ctx.session)`, rejecting any role outside the caller's grant set (`badRoles` → FORBIDDEN) plus facility scope. The UI dropdown is cosmetic; backend remains authoritative. The previous hardcoded `ROLES` array was actually MORE restrictive than the backend (it omitted the two director roles), so this is a sync, not a loosening.
   - Confirmed every role from the old hardcoded list (super_admin, quan_ly, head_teacher, giao_vien, ke_toan, hr, sale, cskh, ctv_mkt, bgd) still appears as a PERMISSIONS value, so super_admin's derived dropdown loses no previously-assignable role; it gains the two director roles (intended).
   - `@cmc/auth/permissions` subpath export exists (`package.json` exports map); `permissions.ts` has no Prisma runtime import, safe for the browser bundle. `me.roles`/`me.isSuperAdmin` already used elsewhere in App.tsx, so the session shape is valid.

5. Test-isolation fixes do not mask product behavior.
   - email-otp-login + email-outbox clear ambient `GRAPH_*/ENTRA_*` so the dev-fallback / Graph-unconfigured assertions are deterministic on a box whose real `.env` configures email. They restore env afterward. This exercises the same product code path; it only removes env nondeterminism.
   - email-outbox `deleteMany({})` (whole-table wipe) is justified by the GLOBAL drainer semantics and relies on serial execution — confirmed `vitest.config.ts` sets `fileParallelism:false`, `pool:'forks'`, `singleFork:true`.

## Findings

### LOW

- L1 — Whole-table outbox wipe couples to serial test config. `email-outbox.int.test.ts` `beforeEach`/`afterAll` now `deleteMany({})`. Correct only while `fileParallelism:false` + `singleFork:true` hold. If anyone later enables parallelism, this silently destroys other suites' outbox rows. Currently safe; consider a comment guard or asserting the config invariant. (Already documented in an inline comment — acceptable.)

- L2 — `loginUrl()` falls back to `http://localhost:5173`. `user.ts:loginUrl()` returns localhost when `ADMIN_APP_ORIGIN` is unset. If prod ever ships without that env var, the welcome email CTA points at localhost. Low impact (prod sets it), but a missing-env email to a real staff member is user-visible. Mirrors existing `erpOrigin()` default, so consistent with prior art.

- L3 — Stable dedupKey blocks re-send after delete+recreate. `account_welcome:<email>` is stable per email. If a user is deleted and re-created with the same email while the old outbox row still exists, P2002 is swallowed and no new welcome email is sent. Edge case; acceptable given idempotency intent.

### Informational / non-issues

- N1 — Single-director availability (not a security issue). With legacy `bgd` unseeded, if only ONE director exists and they confirm a sheet, SoD blocks them from approving it. `quan_ly` can still confirm as the fallback path, so approval stays reachable. Process note, not a regression.
- N2 — `me.roles as string[]` cast in App.tsx is benign (Role union is assignable to string[]); matches the existing cast at the nav-group call site.
- N3 — super_admin dropdown order changes (now `.sort()`ed) and newly lists director roles — intended UX sync, not a contract break.
- N4 — Welcome email sends on every `user.create` including director-created staff, to the operator-supplied `input.email`. No recipient-ownership verification, but that matches existing staff-onboarding pattern (admin enters the address); SSO is the actual auth gate.

## Tests

- New parity tests assert directors ARE in confirm/approve/get/list and NOT in start/prefill/setAuto — real behavioral assertions, not phantom.
- `director-kpi-and-welcome.int.test.ts` proves: two-director SoD happy path, same-director FORBIDDEN, panel load, and no-password welcome enqueue. Solid coverage of the change.
- Context: 324 integration + 38 unit/parity reported green.

## Unresolved questions

- Is `ADMIN_APP_ORIGIN` guaranteed set in prod? (L2) — confirm in deploy env, otherwise welcome emails link to localhost.
- Intended that super_admin can now assign `super_admin`/director roles via the UI dropdown (backend already permitted it)? Assumed yes per 3-heads intent.
