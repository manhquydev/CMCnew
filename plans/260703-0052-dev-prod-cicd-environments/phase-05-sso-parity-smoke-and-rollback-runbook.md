---
phase: 5
title: "SSO parity smoke and rollback runbook"
status: pending
priority: P1
dependencies: [3, 4]
---

# Phase 05: SSO parity smoke and rollback runbook

## Overview

Prove the finished split behaves like production where it should, while still
isolating dev state. Then document the repeatable deploy, smoke, and rollback
commands for future operators.

<!-- Updated: Red Team + Validation Session 1 - SSO transaction cookie and durable decision proof added. -->

## Requirements

- Functional: dev SSO login works, dev and prod cookies do not collide, smoke checks cover ERP and LMS.
- Non-functional: runbook is usable without hidden context; rollback does not depend on local developer state.

## Architecture

SSO and cookies:

```text
dev ERP browser
  -> https://deverp.cmcvn.edu.vn/api/auth/sso/start
  -> Entra
  -> https://deverp.cmcvn.edu.vn/api/auth/sso/callback
  -> dev API
  -> dev session cookie

prod ERP browser
  -> prod redirect URI
  -> prod API
  -> prod session cookie
```

LMS should use the dev API/session boundary intended by the app. If the LMS
does not support its own cookie/env split today, record the exact limitation
before enabling staff testing.

## Related Code Files

- Create: `docs/dev-prod-cicd-runbook.md`
- Modify: `docs/prod-deploy-security-runbook.md`
- Possibly modify: `.env.production.example`
- Possibly modify: `.env.dev.example`
- Read: `docs/auth-sso-otp-redirection.md`

## Implementation Steps

1. Create a runbook with these sections:
   - environment map
   - branch deploy policy
   - first-time dev VPS setup
   - dev deploy
   - prod deploy
   - smoke checks
   - rollback
   - SSO redirect checklist
   - data isolation checklist
   - Harness decision record link
2. Add exact smoke commands for health endpoints and browser login checks.
3. Add rollback commands:
   - Jenkins rebuild previous commit where possible.
   - `docker compose --project-name cmcnew-dev ... down` for dev-only rollback.
   - restore previous nginx config and reload if routing fails.
4. **Validate dev SSO login with a real staff account, with the check MECHANICALLY forced, not
   honor-system (2026-07-04 red-team: the original step had no enforcement — nothing stopped this
   from being satisfied via the password lane instead and the checkbox ticked anyway).** Temporarily
   set `STAFF_PASSWORD_LOGIN=false` in `.env.dev` and restart `dev-api` for the duration of this one
   test — this forces the login form down the real Entra path with no shortcut available. Confirm a
   successful redirect + callback + session cookie. Then restore `STAFF_PASSWORD_LOGIN=true` and
   restart `dev-api` again before continuing to step 5 (password login is dev's intended permanent
   posture per Phase 2 — this is a one-test-only exception, not a policy change).
5. Validate prod SSO still works after dev redirect is added.
6. Validate cookie separation by logging into prod and dev in the same browser profile or by inspecting cookie names/domains.
7. Inspect Set-Cookie headers for staff session, LMS session, and the SSO transaction cookie. Confirm dev/prod cookies are host-only or otherwise non-colliding. The SSO transaction cookie is currently named `cmc.sso_tx`, so this evidence is required.
8. Validate LMS dev reaches dev API and not prod API.
9. Verify the durable decision record exists and is registered with Harness.
10. Record final evidence in the plan or a scoped report.

## Success Criteria

- [ ] Dev ERP SSO login works with the dev redirect URI, exercised via a real Entra login on
  `deverp.cmcvn.edu.vn` — do not substitute the dev `STAFF_PASSWORD_LOGIN` lane (added Phase 2,
  2026-07-04) for this check. Password login exists for operator/test convenience; it must not
  become a shortcut that skips proving the plan's actual SSO-parity goal.
- [ ] Prod ERP SSO login still works.
- [ ] Dev and prod cookies do not overwrite each other.
- [ ] SSO transaction cookie does not collide across prod/dev hosts.
- [ ] LMS dev calls dev API.
- [ ] Runbook exists and contains rollback commands.
- [ ] Decision record link is included in the runbook.
- [ ] Final smoke evidence includes URLs, commits, and timestamps.
- [ ] Current unsafe state, dev domains hitting prod, is resolved.

## Risk Assessment

- Risk: real SSO against dev grants access to real-looking test workflows.
  Mitigation: dev DB uses synthetic data and visible environment labeling should be added if not already present.
- Risk: cookie collision causes confusing auth behavior.
  Mitigation: use separate staff/LMS cookie names and verify staff, LMS, and SSO transaction cookies in browser or response headers.
- Risk: rollback guidance is incomplete during a routing incident.
  Mitigation: test nginx config rollback procedure before marking phase complete.

## Unresolved Questions

- Does the VPS `.env.dev` set `LMS_COOKIE_NAME=cmc.dev.lms` before enabling dev LMS testing?
- Should a visible dev environment badge be added to ERP/LMS UI as a follow-up after routing is complete?
