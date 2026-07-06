# Teacher CMCVN LMS Bridge Validation

**Date**: 2026-07-06 03:13
**Component**: Staff SSO, teacher domain, LMS parent/student surfaces, production deploy
**Status**: Implemented and locally/live-smoke validated; interactive Microsoft SSO callback still pending

## What Happened

Built the `teacher.cmcvn.edu.vn` staff-host bridge so staff can start SSO from ERP or teacher host and return to the same host after callback. Added host/origin allowlist handling, host-aware login UI, production nginx/docker wiring, teacher ownership guards for attendance/evidence/grading, and focused security tests for teacher mutation boundaries.

Production VPS was manually updated from `/root/cmcnew`. Live smoke passed for:

- `https://erp.cmcvn.edu.vn/api/health`
- `https://teacher.cmcvn.edu.vn/api/health`
- `https://hoc.cmcvn.edu.vn/api/health`
- `https://teacher.cmcvn.edu.vn/`
- `https://hoc.cmcvn.edu.vn/`

Deploy marker: `manual-teacher-bridge-20260705193000`, built at `2026-07-05T19:30:00Z`.

## Validation Added

Local focused verification passed:

- `pnpm --filter @cmc/api typecheck`
- `pnpm --filter @cmc/ui typecheck`
- Focused API integration: 3 files, 22 tests passed.
- Focused LMS browser suite: 7 tests passed together on fresh throwaway Postgres.
- Harness story verification now passes with executable proof:
  - `.\scripts\bin\harness-cli.exe story verify TEACHER-CMCVN-LMS-BRIDGE`
  - command: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-lms-bridge.ps1`
  - 2026-07-06 rerun exposed and fixed a gate bug: PowerShell did not fail on a nonzero Playwright
    exit code, so the script could continue to live smoke. The verify script now throws on any
    external command failure, and the session-evidence E2E date fixture was corrected. Direct script
    run and Harness story verify both pass after the fix.
- Live smoke is now part of the same verify script and passed after redeploy:
  - marker `manual-teacher-sso-host-20260705203155`
  - `teacher.cmcvn.edu.vn/api/auth/sso/login` redirects with `redirect_uri=https://teacher.cmcvn.edu.vn/api/auth/sso/callback`.
  - Microsoft authorize pre-login for ERP and teacher did not return `AADSTS50011` or
    `AADSTS900971`.

Browser E2E coverage now includes:

- LMS smoke.
- Student fallback-code login.
- Parent OTP login.
- Staff/admin session evidence publish.
- Student sees session evidence.
- Parent sees session evidence.
- Student PDF homework autosaves without manual save.
- Parent sees published drawn work read-only.
- Guardian principal can fetch exercise PDF per decision 0022.

## Important Fix During Validation

Two Playwright specs were blocked by direct imports from workspace TypeScript packages. Browser E2E now uses local Prisma/JWT/hash helpers inside the spec files instead of importing Vite/Vitest-oriented packages. This keeps the test focused on real browser behavior and avoids module-format failures unrelated to the LMS workflows.

Live smoke also caught a production-only SSO edge: direct teacher-domain SSO start had no `returnOrigin`, `Origin`, or `Referer`, so it fell back to ERP callback even though the UI login button path was host-aware. The API now falls back to the forwarded request host before ERP fallback. This was redeployed to VPS and verified.

## Live State

Teacher SSO start redirects to Microsoft with:

- `redirect_uri=https://teacher.cmcvn.edu.vn/api/auth/sso/callback`
- host-only `cmc.sso_tx` cookie

ERP SSO start still redirects with:

- `redirect_uri=https://erp.cmcvn.edu.vn/api/auth/sso/callback`

Microsoft authorize pre-login accepts both ERP and teacher redirect URIs without `AADSTS50011` or
`AADSTS900971`. This proves the Entra redirect URI registration at the pre-login step only; it does
not prove account login, MFA, token exchange, session cookie, or final callback return.

VPS sync follow-up succeeded after bypassing the local Windows SSH agent with `IdentityAgent=none`.
The fail-fast verifier script, live-smoke script, session-evidence E2E fixture, and evidence docs are
present under `/root/cmcnew`. Server-side curl smoke from the VPS confirms health/root for
`erp`, `teacher`, and `hoc`, and ERP/teacher SSO start routes to the expected callback with a
host-only `cmc.sso_tx` cookie.

Added the remaining interactive SSO callback verifier:

- `scripts/verify-teacher-cmcvn-interactive-sso.ps1`
- `scripts/verify-teacher-cmcvn-interactive-sso.mjs`

It launches a headed Playwright browser, waits for manual Microsoft login/MFA, then verifies callback
to the selected staff host, authenticated staff shell visibility, and host-scoped `cmc.session`.
The verifier now supports `SSO_ORIGINS` so the final operator run can prove both production staff
hosts in one browser session:

```powershell
$env:SSO_ORIGINS='https://teacher.cmcvn.edu.vn,https://erp.cmcvn.edu.vn'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-interactive-sso.ps1
```

Syntax/help validation passed; final pass still needs real staff credentials/MFA.

The plan files under `plans/260706-0136-teacher-cmcvn-lms-bridge/` were synced after validation:
completed/verified phases are marked from current evidence. The remaining SSO gap is explicitly
the interactive Microsoft callback; parent external email/Brevo readiness was checked in the
follow-up below.

Follow-up production Brevo readiness check is now closed without printing secrets:

- `.env.production`: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and `BREVO_SENDER_NAME` are set.
- `email_outbox`: `brevo|sent|4`, `failed=0`, `queued=0`.
- `docker/docker-compose.prod.yml` now passes `GRAPH_CLIENT_SECRET` and Brevo runtime variables for parity with TLS compose.
- `scripts/prod-build-env.sh` now copies Brevo source variables into generated `.env.production` and reports presence only.

Follow-up intake audit found the original one-form PH+HS requirement was only partially proven. Direct active parent+student intake was not added; the story preserves the existing receipt/provisioning path unless a new decision is accepted later. The supported receipt/provisioning intake now captures parent phone, parent name, parent email, student name, optional student DOB, and optional class in the same new-student form, so parent email is available before `receiptApprove` queues `lms_account_ready`.

The form update was deployed by rebuilding the production `admin` service on the VPS. Live smoke passed after restoring the API deploy marker:

- marker `manual-teacher-intake-form-20260706021200`
- built at `2026-07-06T02:12:00Z`
- `erp`, `teacher`, and `hoc` health/root pass
- ERP/teacher SSO start still uses the expected callback URI and Entra pre-login accepts both redirects
- production admin bundle contains `Email phụ huynh`

Follow-up DT intake authz was resolved narrowly. `giam_doc_dao_tao` now has draft-only `finance.receiptCreate` plus the matching `crm.opportunityLookup` gate, while `receiptApprove`, finance list/send/reconcile/cancel, revenue, and CRM board gates remain closed. The GĐĐT cockpit links to the one-form intake, and the finance panel hides non-permitted finance cards for draft-only callers.

Validation after the DT intake change:

- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`: 27 tests passed.
- `pnpm --filter @cmc/admin test -- src/__tests__/nav-director-dt-cockpit-consolidation.test.ts src/__tests__/nav-consistency.test.ts`: 16 tests passed.
- `pnpm --filter @cmc/api typecheck`, `pnpm --filter @cmc/auth typecheck`, `pnpm --filter @cmc/admin typecheck`, and `pnpm --filter @cmc/admin build` passed.
- Production `api` and `admin` were rebuilt on the VPS; live smoke passed with marker `manual-teacher-dt-intake-20260706092700`, built at `2026-07-06T02:27:00Z`.
- Production admin bundle contains `Tiếp nhận phụ huynh + học sinh` and `Tạo phiếu nháp`.

## Notes For Next Session

Do not mark the whole goal complete until interactive Microsoft callback is verified with a real account/MFA. Pre-login redirect URI acceptance is already covered for:

- `https://erp.cmcvn.edu.vn/api/auth/sso/callback`
- `https://teacher.cmcvn.edu.vn/api/auth/sso/callback`

Run GitNexus `detect_changes` before commit. `npx gitnexus analyze --embeddings` already refreshed the stale index in this session. Harness story verify passed after replacing the stale markdown command and after the fail-fast verifier fix.

## Unresolved Questions

- Which real staff account should be used for final interactive SSO callback smoke?
