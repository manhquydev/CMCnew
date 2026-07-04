---
phase: 3
title: "Dev verification"
status: pending
priority: P1
dependencies: [2]
---

# Phase 3: Dev verification

## Overview

Merge the integration PR into `develop`, let CI auto-deploy the dev stack, and prove the new UI +
behavior work on the live dev env BEFORE any prod exposure. This is the safety tier that de-risks prod.

## Requirements
- Functional: `deverp`/`devlms` serve the new UI and pass happy→edge + persona/E2E checks; webhook confirmed.
- Non-functional: prod (`erp`/`hoc`) stays `84ff0d22` throughout; watch memory/OOM during the dev build.

## Related Code Files
- Read: `docs/dev-prod-cicd-runbook.md` (dev deploy + smoke + gotchas).
- Read: `docs/test-matrix*` / E2E specs under the repo for the persona suite.
- No source edits (verification only; fixes, if any, branch off and re-enter Phase 2 flow).

## Implementation Steps
1. Merge the Phase 2 PR into `develop`. This is the first REAL push that should trigger the webhook →
   watch Jenkins auto-start `cmcnew/develop` (confirms webhook works — do NOT hand-trigger unless it
   fails to fire within ~1 min; if it doesn't fire, note it and trigger via API as fallback).
2. Monitor the develop build: lint→typecheck→integration→Build+Deploy(dev)→Smoke(dev). Watch VPS
   `docker stats`/`free`/OOM during image builds (peak). Confirm build = SUCCESS and it checked out
   the merged develop HEAD (not a stale revision).
3. Verify dev health markers: `deverp`/`devlms` `/api/health` = the new develop commit; prod unchanged.
4. Functional happy→edge on the live dev env: password login (seeded persona), `auth.me`, SSO-start
   302 (dev redirect URI), bad-cred 401, no-enumeration, dev cookie `cmc.dev.session`, DB isolation.
5. UI confirmation (the user's original symptom): confirm nav rail + horizontal sub-tab, datetime
   pickers, student phone login flow are present/rendering on `deverp`/`devlms`.
6. Run the persona/E2E suite against dev and **record ACTUAL pass/fail — do not assume green**
   (red-team M3). Preconditions to confirm first: `TEST_ADMIN_*`/`TEST_COCKPIT_*` creds present in
   the env the suite uses; dev DB is seeded (the `develop` Jenkins build does NOT re-seed by default
   — dev was seeded once in plan 0052; no schema changed here so existing seed is valid, but confirm
   the personas the new UI needs exist). The non-super_admin password-login path has been fragile
   historically; dev sets `STAFF_PASSWORD_LOGIN=true` so it should pass — verify, don't assert.
7. If any regression/broken workflow: STOP, report with options (do not patch silently). Fix via a
   branch → PR → re-verify (re-enter this phase), never directly on develop.

## Success Criteria
- [ ] Webhook auto-triggered the develop build (or fallback documented).
- [ ] Develop build SUCCESS on the merged HEAD; deverp/devlms serve the new commit + new UI.
- [ ] Happy→edge functional checks pass; persona/E2E suite result recorded (green or triaged).
- [ ] Prod stayed `84ff0d22`; no OOM; ci reachable.
- [ ] Go/No-Go for prod promote is explicitly recorded.

## Risk Assessment
- Risk: dev build OOM under the bigger UI codebase. Mitigation: `COMPOSE_PARALLEL_LIMIT=1`, watch
  stats; if pressure, stop and report (don't raise caps blindly).
- Risk: new UI has a runtime regression only visible at runtime. Mitigation: this phase exists to
  catch exactly that on dev, not prod; E2E + manual UI check.
- Risk: smoke race (seen before) re-appears. Mitigation: the health-wait fix is already on develop.
