# Watzup - Teacher CMCVN LMS Bridge

**Date**: 2026-07-06 03:13
**Branch**: `develop`
**Head**: `2c5ee68`
**Worktree**: dirty
**Status**: Mostly done; pending interactive Microsoft SSO callback/MFA

## Current State

Implemented teacher host bridge + LMS visibility checks. Production smoke passed on VPS for ERP, teacher, and hoc health/routes. Entra authorize pre-login accepts ERP and teacher redirect URIs. Local focused verification now passes for API, UI, and LMS browser flows.

## Latest Evidence

- `pnpm --filter @cmc/api typecheck` passed.
- `pnpm --filter @cmc/ui typecheck` passed.
- Focused API integration passed: 3 files, 22 tests.
- `pnpm --filter @cmc/e2e exec playwright test tests/lms-smoke.spec.ts tests/session-evidence-publish.spec.ts tests/lms-autosave-and-parent-readonly.spec.ts --workers=1` passed: 7 tests.
- `.\scripts\bin\harness-cli.exe story verify TEACHER-CMCVN-LMS-BRIDGE` passed after wiring `scripts/verify-teacher-cmcvn-lms-bridge.ps1` and live smoke. 2026-07-06 rerun fixed fail-fast behavior so a failed Playwright command now fails the verify script instead of continuing to live smoke.
- Live smoke passed for `erp.cmcvn.edu.vn`, `teacher.cmcvn.edu.vn`, `hoc.cmcvn.edu.vn` with deploy marker `manual-teacher-sso-host-20260705203155`.
- Live smoke caught and fixed direct teacher SSO fallback: teacher direct `/api/auth/sso/login` now uses `redirect_uri=https://teacher.cmcvn.edu.vn/api/auth/sso/callback`.
- Live smoke also checks Microsoft authorize pre-login for ERP/teacher and fails on `AADSTS50011` or `AADSTS900971`; latest run passed, so redirect URI registration is accepted before login.
- VPS sync confirmed after using SSH `IdentityAgent=none`: `/root/cmcnew` has the fail-fast verifier and corrected session-evidence E2E fixture. Server-side curl smoke from VPS passed health/root plus ERP/teacher SSO callback and host-only cookie checks.
- Added operator-assisted interactive SSO verifier:
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-interactive-sso.ps1`.
  It now supports `SSO_ORIGINS` for sequential `teacher` + `erp` proof in one headed browser session.
  Syntax/help check passed; it still needs real Microsoft login/MFA to close the final proof gap.
- Synced `plans/260706-0136-teacher-cmcvn-lms-bridge/` phase statuses with actual evidence:
  completed/verified phases are marked explicitly. Parent external email/Brevo readiness is now
  verified on production: `.env.production` has Brevo API key/sender fields set, and
  `email_outbox` shows `brevo|sent|4`, `failed=0`, `queued=0`.
- Patched production config parity:
  `docker/docker-compose.prod.yml` now passes `GRAPH_CLIENT_SECRET` and Brevo runtime variables,
  and `scripts/prod-build-env.sh` now carries Brevo fields into generated `.env.production` with
  presence-only reporting.
- Follow-up objective audit found the one-form PH+HS requirement was only partially proven. The
  new-student receipt form now captures parent phone, parent name, parent email, student name,
  optional student DOB, and optional class in one surface, then keeps provisioning at receipt
  approval per decision 0033.
- Deployed the form update by rebuilding production `admin` on the VPS. `scripts/verify-teacher-cmcvn-live-smoke.ps1`
  passed after restoring the API deploy marker to `manual-teacher-intake-form-20260706021200`
  (`2026-07-06T02:12:00Z`). Production admin bundle contains `Email phụ huynh`.
- Resolved DT intake authz narrowly: `giam_doc_dao_tao` now has draft-only `finance.receiptCreate`
  and matching `crm.opportunityLookup`, but still lacks `receiptApprove`, finance list/send/reconcile/cancel,
  revenue report, and CRM board gates. The GĐĐT cockpit links to the one-form intake; the finance panel
  hides finance-list/pricing/voucher/discount cards when the caller only has create.
- Validation after DT intake change: permission-parity 27/27, admin nav tests 16/16, api/auth/admin typecheck
  passed, admin build passed, production `api`/`admin` rebuilt on VPS, live smoke passed with marker
  `manual-teacher-dt-intake-20260706092700` (`2026-07-06T02:27:00Z`), and production bundle contains
  `Tiếp nhận phụ huynh + học sinh` / `Tạo phiếu nháp`.

## Key Files

- `apps/api/src/index.ts`
- `apps/api/src/lib/teaching-authz.ts`
- `apps/api/src/routers/attendance.ts`
- `apps/api/src/routers/session-evidence.ts`
- `apps/api/src/routers/grade.ts`
- `packages/ui/src/login-gate.tsx`
- `apps/e2e/tests/lms-smoke.spec.ts`
- `apps/e2e/tests/session-evidence-publish.spec.ts`
- `apps/e2e/tests/lms-autosave-and-parent-readonly.spec.ts`
- `docs/stories/TEACHER-CMCVN-LMS-BRIDGE/validation.md`
- `scripts/verify-teacher-cmcvn-lms-bridge.ps1`
- `scripts/verify-teacher-cmcvn-live-smoke.ps1`
- `scripts/verify-teacher-cmcvn-interactive-sso.ps1`
- `scripts/verify-teacher-cmcvn-interactive-sso.mjs`
- `plans/260706-0136-teacher-cmcvn-lms-bridge/plan.md`

## Need Next

1. Run final `gitnexus detect_changes` before commit.
2. Verify interactive Microsoft callback with real Microsoft login/MFA:
   `$env:SSO_ORIGINS='https://teacher.cmcvn.edu.vn,https://erp.cmcvn.edu.vn'; powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-interactive-sso.ps1`
3. Run final scope checks and commit/PR through the normal `develop` workflow after callback proof.

## Unresolved Questions

- Real staff/MFA account available for callback smoke?
