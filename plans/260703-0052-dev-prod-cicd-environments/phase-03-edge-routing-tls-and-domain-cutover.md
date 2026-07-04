---
phase: 3
title: "Edge routing TLS and domain cutover"
status: pending
priority: P1
dependencies: [2]
---

# Phase 03: Edge routing TLS and domain cutover

## Overview

Update nginx and TLS so prod domains route to prod services and dev domains
route to the dev services. The critical proof is that dev and prod health
responses can show different commit markers when branches diverge.

<!-- Updated: Red Team + Validation Session 1 - certificate SAN and CI route preservation clarified. -->

## Requirements

- Functional: add dev vhosts for ERP and LMS, keep existing prod and Jenkins routes, proxy API consistently.
- Non-functional: support Cloudflare TLS, avoid downtime, keep rollback simple.

## Architecture

Target routing:

```text
erp.cmcvn.edu.vn
  /api -> prod api
  /    -> prod admin

hoc.cmcvn.edu.vn
  /api -> prod api
  /    -> prod lms

deverp.cmcvn.edu.vn
  /api -> dev api
  /    -> dev admin

devlms.cmcvn.edu.vn
  /api -> dev api
  /    -> dev lms
```

Keep `ci.cmcvn.edu.vn` routing to Jenkins unchanged.

## Related Code Files

- Modify: `docker/nginx-prod.conf`
- Modify: `scripts/prod-server-deploy.sh`
- Modify: `scripts/ensure-origin-cert.sh` (created by 260703-0022 Phase 1 — extend its hardcoded SAN list from `erp.cmcvn.edu.vn,hoc.cmcvn.edu.vn` to also cover `deverp.cmcvn.edu.vn,devlms.cmcvn.edu.vn`; added 2026-07-03 cross-plan reconciliation, was missing from this phase's original file list)
- Possibly modify: `docker/docker-compose.prod.tls.yml`
- Read: `docs/prod-deploy-security-runbook.md`
- Read: `docs/decisions/0029-*.md` (260703-0022's TLS strategy decision — this phase must match it, not re-decide)

## Implementation Steps

0. **(2026-07-04 validation Session 2, added)** Before any edit: `cp
   /root/cmcnew/docker/nginx-prod.conf /root/cmcnew/docker/nginx-prod.conf.bak.$(date +%Y%m%d%H%M%S)`
   on the VPS. Rollback = restore this file and reload.
1. Add upstreams or direct proxy targets for dev API, dev admin, and dev LMS through the edge network aliases.
2. Add server blocks for `deverp.cmcvn.edu.vn` and `devlms.cmcvn.edu.vn`.
3. Ensure `/api/` handling matches the existing prod route behavior so browser clients can use same-origin API calls.
4. Ensure SPA fallback rules match existing admin/LMS rules.
5. **(2026-07-03 reconciliation: this step is now deterministic, not conditional)** Cloudflare mode is
   "Full" per 260703-0022's already-locked decision (`docs/decisions/0029-*`) — do not re-decide.
   Extend `scripts/ensure-origin-cert.sh`'s self-signed SAN list to add `deverp.cmcvn.edu.vn` and
   `devlms.cmcvn.edu.vn` (keeping `erp.cmcvn.edu.vn`/`hoc.cmcvn.edu.vn` from 0022). If Phase 1's
   pre-flight discovers the live zone is somehow NOT "Full" (contradicting 0022's own pre-flight, which
   should have already caught this before 0022 shipped) — stop and treat that as a 260703-0022
   regression to fix there, not a reason to switch to Full Strict here.
6. Preserve `ci.cmcvn.edu.vn` by proving nginx can still resolve `cmcnew-jenkins:8080`.
7. Run `nginx -t` inside the nginx container before reload.
8. Reload nginx, not full restart, where possible.
9. Smoke each route:
   - `https://erp.cmcvn.edu.vn/api/health`
   - `https://hoc.cmcvn.edu.vn/api/health`
   - `https://deverp.cmcvn.edu.vn/api/health`
   - `https://devlms.cmcvn.edu.vn/api/health`
   - `https://ci.cmcvn.edu.vn`

## Success Criteria

- [ ] `nginx -t` passes.
- [ ] Prod ERP and LMS stay reachable.
- [ ] Jenkins host stays reachable.
- [ ] Dev ERP and LMS reach the dev API.
- [ ] Dev and prod health commit markers can differ.
- [ ] No dev DB or Redis endpoint is reachable from the public internet.
- [ ] TLS/certificate mode confirmed as Cloudflare "Full" (matching 260703-0022's locked decision), self-signed origin cert SAN-extended to cover all 5 hostnames.

## Risk Assessment

- Risk: dev hostnames keep hitting prod due default server behavior.
  Mitigation: add explicit server blocks and verify commit markers, not only HTTP 200.
- Risk: TLS certificate mismatch.
  Mitigation: update origin certificate/SANs before Cloudflare Full Strict enforcement; include CI hostname, not only app hostnames.
- Risk: nginx route reload breaks prod.
  Mitigation: test config first and keep rollback copy of previous nginx config.
- Risk: `ci.cmcvn.edu.vn` breaks because nginx can no longer resolve `cmcnew-jenkins`.
  Mitigation: smoke CI route and verify Docker network membership before cutover.
