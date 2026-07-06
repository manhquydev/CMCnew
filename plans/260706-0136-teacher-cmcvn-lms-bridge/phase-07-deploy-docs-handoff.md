---
phase: 7
title: "Deploy docs handoff"
status: completed
effort: "L"
---

# Phase 7: Deploy docs handoff

## Overview

Ship the validated teacher-domain work through the existing branch/deploy rules, update operator docs, then produce journal and handoff.

Deployment must follow repo policy: no direct code/commit on `main`; work is on `develop` or feature branch from `develop`, then PR path to `main`.

## Implementation Steps

1. Before finishing code work, run:
   - `gitnexus_detect_changes` with expected scope.
   - focused integration tests from phases 3-6.
   - repo typecheck/lint/build commands discovered from README/package scripts.
2. Deploy dev first:
   - Verify DNS/Cloudflare/SSL preflight for accepted dev/prod teacher hosts before treating public curl failures as app regressions.
   - Push/merge to `develop` per current workflow.
   - Jenkins deploys `cmcnew-dev`.
   - Smoke existing `deverp` and `devlms`.
   - Smoke `https://devteacher.cmcvn.edu.vn/api/health` and SPA only if `devteacher` is explicitly accepted.
3. Promote to prod only after green review:
   - PR into `main`.
   - Jenkins deploys `cmcnew-prod`.
   - Smoke `https://teacher.cmcvn.edu.vn/api/health`, SPA, and existing `erp`/`hoc`.
   - Smoke staff SSO/password login path on teacher host.
   - Verify parent external email delivery/drain state if the release includes parent welcome/notification mail.
4. Use SSH to inspect VPS only when needed:
   - `ssh -i C:\Users\manhquy\.ssh\cmc_vps_root root@152.42.167.189`
   - Check docker compose services, nginx config, Jenkins result, and logs.
5. Update docs only for actual shipped behavior:
   - `README.md` domain table.
   - `docs/dev-prod-cicd-runbook.md`.
   - `docs/prod-deploy-security-runbook.md`.
   - `docs/guides/e2e-walkthrough/README.md`.
   - decision index if new decision exists.
6. Produce final reports:
   - code-review report if high-risk implementation changes landed.
   - test report with exact commands/results.
   - journal entry in `docs/journals/`.
   - watzup/handoff summary with unresolved questions at end.

## Success Criteria

- [x] `develop` deployment smoke passes for `deverp`, `devteacher`, and `devlms`.
- [x] Production deployment smoke passes for `teacher`, `erp`, and `hoc`.
- [x] Cloudflare/DNS/SSL preflight is recorded for all new hosts.
- [x] Teacher-host login start returns to the teacher host and sets a host-only transaction cookie.
  - Non-interactive SSO-start proof passes for ERP, Teacher, and Devteacher. Real Microsoft
    login/MFA callback remains optional operator-assisted proof.
- [x] Parent external email transport is ready, or release notes call it blocked before launch.
  - Production redacted check shows Brevo config set and `email_outbox` has `brevo|sent|4`, `failed=0`, `queued=0`.
- [x] No Jenkins/GitHub/SSH deploy step is left half-running.
- [x] Docs describe the actual teacher-domain behavior and do not claim untested flows.
- [x] Final handoff includes commit/deploy identifiers, test commands, and unresolved questions.

## Status Update - 2026-07-06

Production non-interactive smoke passes on live domains with deploy marker `manual-teacher-dt-intake-20260706092700`, built at `2026-07-06T02:27:00Z`. Devteacher routes to the dev stack and passes CORS/SSO redirect/cert smoke. VPS sync is complete for verifier scripts and evidence docs. Parent external email readiness is verified through Brevo config presence plus sent outbox rows. Education-director access to the parent+student intake path is resolved through draft-only `finance.receiptCreate` and matching `crm.opportunityLookup`; money approval remains restricted to `ke_toan` and `giam_doc_kinh_doanh`. Final interactive SSO/MFA callback proof is optional operator-assisted evidence, not a verifier blocker.

## Tests And Commands

- Use the repo's existing scripts first:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - focused `pnpm --filter api test ...` commands for touched API tests.
- Harness:
  - `.\scripts\bin\harness-cli.exe trace ...`
  - `.\scripts\bin\harness-cli.exe query matrix`
- VPS smoke:
  - `curl -fsS https://teacher.cmcvn.edu.vn/api/health`
  - `curl -fsS -o /dev/null https://teacher.cmcvn.edu.vn/`
  - host-aware SSO/password login smoke for teacher domain.
  - existing prod/dev health commands from runbooks.

## Rollback

Rollback route:

1. Revert teacher vhost/CORS/nav changes.
2. Redeploy previous known-good Jenkins build or revert commit via normal PR flow.
3. If new direct intake rows exist because the expanded option was explicitly accepted, do not delete them blindly. Use the accepted provenance/draft records and correct via supported admin operations or explicit DBA plan.
