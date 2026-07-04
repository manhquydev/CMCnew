---
phase: 4
title: "Prod promote gate"
status: pending
priority: P1
dependencies: [3]
---

# Phase 4: Prod promote gate

# HIGHEST-RISK PHASE — touches live prod (erp/hoc). Requires explicit human go-ahead.

## Overview

Promote the verified `develop` to `main`, deploying the full UI rebuild + A/B/C/D to the live prod
stack. Gated on Phase 3 being green. Backup → deploy → verify → rollback-if-fail.

**Red-team C1 — the promote is NOT app-only.** `git diff main..develop` also lands the CI/CD-split
infra onto `main` for the first time: `Jenkinsfile` (+71, branch-split prod stage), the compose
files, `nginx-prod.conf` (+94, dev vhosts), `scripts/*`. Treat this as first-class. **Mitigating
fact (verified 2026-07-04):** that infra is ALREADY LIVE on the VPS (applied during plan 0052) and
develop's tracked `nginx-prod.conf` is **byte-identical** to the live prod nginx — so the new prod
deploy-stage's infra steps (ensure-origin-cert, network create, cp nginx + restart) are idempotent
no-ops against already-live infra; the genuine runtime change is the rebuilt app images (new UI).
Still: review the infra diff line-by-line and `nginx -t` before any reload — do not treat it as invisible.

## Requirements
- Functional: `main` deploys `cmcnew-prod`; `erp`/`hoc` serve the new UI; health+smoke green.
- Non-functional: minimal downtime; a rehearsed rollback; prod data untouched (no new migrations).

## Related Code Files
- Read: `docs/prod-deploy-security-runbook.md`, `docs/dev-prod-cicd-runbook.md`.
- No source edits (this is a merge + deploy).

## Implementation Steps
0. **Human go-ahead checkpoint (red-team H3):** capture explicit approval BEFORE the merge click —
   merging to `main` = immediate, automatic, irreversible prod deploy (the only abort point is a
   failing build). Ideally after the ops-hardening backup restore-drill is green.
1. **Infra-diff review (red-team C1):** `git diff origin/main origin/develop -- Jenkinsfile docker/ scripts/`
   read line-by-line; confirm it matches the known plan-0052 CI/CD split (no surprises).
2. **Drift gate (red-team M2):** confirm develop's tracked `docker/nginx-prod.conf` == live
   `/root/cmcnew/docker/nginx-prod.conf` on the VPS (verified identical 2026-07-04) so the deploy's
   nginx step is a no-op; re-check at execution time in case live drifted since.
3. Pre-change backup on VPS: DB dump (`scripts/backup-db.sh`), timestamped `cp` of live
   `nginx-prod.conf`, record current prod commit (`84ff0d22`) + `/api/health`. Confirm
   `backup/main-preintegration` tag exists (Phase 1).
4. Open **PR `develop → main`**; confirm mergeable (only the GH Actions billing check should be red).
5. Merge to `main` → webhook (events:[push], covers main) triggers `cmcnew/main` build. **Fallback
   (red-team H3):** if no build starts within ~1 min, trigger via Jenkins API (same as Phase 3).
   Pipeline: lint→typecheck→integration→Build+Deploy(prod)→Smoke(prod). Confirm `api-migrate` = no
   pending migrations (verified: all 69 identical). `nginx -t` before the reload step.
6. Monitor build + VPS memory/OOM; prod compose does not switch traffic on a failed build.
7. Verify prod: `erp`/`hoc` `/api/health` = new main commit; smoke the new UI (nav rail, pickers,
   phone login); prod SSO-start 302 (prod redirect URI); `ci` still 200; dev (`deverp`/`devlms`)
   still reachable (promote must not disturb the co-located dev stack).
8. **Rollback (red-team H2 — CORRECTED):** do NOT rebuild `84ff0d22`'s pipeline — its Jenkinsfile is
   the pre-split single-env one and its compose predates `cmcnew-edge`, so re-running it could break
   the live dev-stack routing. Instead roll back by **reverting the promote merge on `main`**
   (`git revert -m 1 <merge>` → new main commit that keeps the post-split CI/CD infra but drops the
   feature app code) → let CI redeploy prod app images at pre-feature state; restore the nginx backup
   + `nginx -s reload` if routing is implicated. Verify prod healthy + dev stack intact. Report before retry.

## Success Criteria
- [ ] Explicit human go-ahead recorded BEFORE merge; infra-diff reviewed; nginx drift == identical.
- [ ] Pre-change DB + nginx backups taken; `backup/main-preintegration` tag confirmed.
- [ ] `main` build SUCCESS (webhook or API fallback); `api-migrate` no-op; `nginx -t` passed pre-reload.
- [ ] `erp`/`hoc` serve the new UI; health+smoke green; prod SSO works; ci 200; dev stack still up.
- [ ] Rollback path (revert-merge, NOT stale-pipeline) documented and validated (exercised or ready).
- [ ] LMS phone-login back-compat on real prod accounts confirmed (M1 below).

## Risk Assessment
- Risk: new UI runtime regression hits live users. Mitigation: Phase 3 dev verification first;
  rollback via revert-merge (keeps CI/CD infra), not the stale 84ff0d22 pipeline.
- Risk (red-team H2): rollback to 84ff0d22 re-runs pre-split pipeline + pre-edge compose → could
  break live dev routing. Mitigation: rollback = revert-merge on main + nginx-backup reload; never
  rebuild 84ff0d22.
- Risk (red-team M1 — PRODUCT decision, needs owner confirm): Plan C ships a fixed, publicly-derivable
  default LMS credential (receipt phone + `Cmc2026@`, decision 0033) to REAL families on promote; dev
  (synthetic data) can't test real-account back-compat. Mitigation: confirm with product owner this
  cutover is intended for this window; verify already-provisioned prod student accounts remain
  resolvable under phone-identity login; consider a forced-reset follow-up. NOT a defect to reverse.
- Risk: build/deploy OOM building the larger UI. Mitigation: `COMPOSE_PARALLEL_LIMIT=1`, watch stats; abort→rollback.
- Risk: unexpected migration. Mitigation: verified none (all 69 identical); `api-migrate` no-op is the check.
- Risk: staff cookie/session change (Plan C). Mitigation: prod cookie names unchanged (`cmc.session`/
  `cmc.lms`); LMS token shape preserved (red-team verified) → live sessions survive; verify login post-deploy.
