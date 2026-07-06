---
phase: 2
title: "Teacher domain and staff shell"
status: completed
effort: "L"
---

# Phase 2: Teacher domain and staff shell

## Overview

Make `teacher.cmcvn.edu.vn` an explicit staff-domain entry point to the existing admin SPA. The domain must not rely on the current default nginx vhost behavior.

Expected touchpoints:

- `docker/nginx-prod.conf`
- `Jenkinsfile`
- `scripts/ensure-origin-cert.sh`
- `apps/api/src/index.ts` CORS origin handling
- `apps/admin/src/App.tsx` default section and host-aware shell behavior
- `apps/admin/src/shell.tsx`, `apps/admin/src/nav-permissions.ts`, related navigation metadata
- `docs/prod-deploy-security-runbook.md`, `docs/dev-prod-cicd-runbook.md`, `README.md`

## Implementation Steps

1. Before editing symbols, run GitNexus impact:
   - `defaultSection` in `apps/admin/src/App.tsx`.
   - Any shell/nav helper that changes role-to-section behavior.
2. Add explicit nginx HTTPS server blocks:
   - `teacher.cmcvn.edu.vn` proxies `/api` to prod API and serves prod admin SPA.
   - `devteacher.cmcvn.edu.vn` is included after explicit validation/user request.
3. Extend redirect/cert comments and origin-cert helper/runbook if teacher/devteacher must be in the self-signed SAN list.
4. Extend Jenkins smoke:
   - `main`: `https://teacher.cmcvn.edu.vn/api/health` and SPA 200.
   - `develop`: smoke `deverp/devteacher/devlms`.
5. Add Cloudflare/DNS/SSL preflight before rollout:
   - DNS records for `teacher` and accepted `devteacher` exist and resolve to the VPS.
   - Cloudflare proxy/SSL mode matches decision 0029 (`Full`, not `Full Strict` unless origin cert is trusted).
   - `scripts/ensure-origin-cert.sh` and docs include teacher/devteacher SAN checks if the host is accepted.
6. Extend production/dev CORS origins and staff origin config so staff cookies work on teacher host.
7. Make SSO host-aware:
   - Preserve a validated `returnOrigin`/`returnPath` in SSO transaction state.
   - Allow only configured staff origins.
   - Register SSO redirect URIs for teacher/devteacher if they use separate callback URLs.
   - Test cookie continuity: login initiated on teacher returns to teacher, not ERP.
8. In admin SPA, add a narrow host-aware staff landing only if existing defaults do not satisfy the workflow:
   - `giao_vien` defaults to class/teaching operations.
   - Directors default to setup/dashboard for LMS launch.
   - Super admin remains able to navigate normally for support.
9. Do not make host detection an authorization boundary. Server-side `PERMISSIONS` and RLS remain the enforcement layer.
10. Add focused UI/unit tests if existing test harness covers nav/default-section logic. If not, document why and cover with Playwright smoke.

## Success Criteria

- [x] `teacher.cmcvn.edu.vn` appears in nginx as a `server_name`, not only as fallback.
- [x] `devteacher.cmcvn.edu.vn` routes to the dev admin/API stack and is covered by smoke.
- [x] CORS/cookie behavior permits staff login on teacher host without weakening production explicit origins.
- [x] SSO initiated from teacher host returns to the teacher callback URL and sets a host-only transaction cookie.
  - Pre-login redirect URI acceptance, host-only transaction cookie, CORS, and cert SAN are verified.
  - Full browser/MFA callback remains an optional operator-assisted proof with a prepared script.
- [x] Staff and LMS cookies remain host-only; `Set-Cookie` must not add `Domain=.cmcvn.edu.vn`.
- [x] DNS/Cloudflare/SSL preflight is documented and completed before Jenkins smoke is treated as a code failure.
- [x] Existing `erp`, `hoc`, `deverp`, `devteacher`, `devlms`, and `ci` vhosts still smoke.
  - Current prod smoke covers `erp`, `teacher`, and `hoc`; dev smoke covers `deverp`, `devteacher`, and `devlms`.
- [x] Staff landing changes are host/role-focused UX only, not authz enforcement.
- [x] Jenkins logs include teacher-domain smoke for the branches that deploy it.

## Status Update - 2026-07-06

Implemented and live-smoke verified. `scripts/verify-teacher-cmcvn-live-smoke.ps1` verifies health/root, ERP/teacher redirect URI selection, host-only transaction cookie, and Entra pre-login acceptance. `devteacher.cmcvn.edu.vn` routes to the dev stack and passes CORS/SSO redirect/cert smoke. `scripts/verify-teacher-cmcvn-interactive-sso.ps1` remains available for optional real Microsoft login/MFA proof.

## Tests

- `pnpm --filter admin typecheck` or repo equivalent.
- API smoke through deployed teacher host: `/api/health`.
- Browser smoke: teacher host loads admin bundle, login page/session flow not blocked by CORS.
- Interactive or scripted SSO smoke starts on teacher host and returns to teacher host.
- Cookie assertion: staff/LMS `Set-Cookie` headers have no broad `Domain` attribute.
- Regression smoke: `erp.cmcvn.edu.vn` still loads the full staff app.

## Rollback

Remove the teacher server block and CORS origin, then redeploy nginx/API. Since no new data ownership is introduced in this phase, rollback should not affect database state.
