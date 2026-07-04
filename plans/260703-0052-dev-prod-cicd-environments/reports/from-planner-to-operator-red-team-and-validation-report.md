---
type: red-team-validation
date: 2026-07-03
plan: plans/260703-0052-dev-prod-cicd-environments/plan.md
intake: 60
lane: high-risk
---

# Red Team And Validation Report

## Summary

Plan reviewed with three adversarial lenses: security, assumptions, and failure modes.
Six findings were accepted and propagated into `plan.md` plus relevant phase files.
`ck plan validate --strict` passed during validation.

## Accepted Findings

| # | Severity | Finding | Evidence | Plan update |
|---|---|---|---|---|
| 1 | Critical | `develop` deploy could skip integration. | `Jenkinsfile:36-44` only gates integration on `main` or `changeRequest()`. | Phase 4 now requires integration on `develop` before dev deploy. |
| 2 | High | `LMS_APP_ORIGIN` is not a proven runtime routing contract. | `packages/ui/src/client.ts:5-12` uses `VITE_API_URL`; cookies are in `apps/api/src/context.ts:5-7`. | Phase 2 now uses `LMS_COOKIE_NAME` and same-origin `/api`; `LMS_APP_ORIGIN` is not required unless a consumer is proven. |
| 3 | Medium | SSO transaction cookie was not in cookie-collision validation. | `apps/api/src/index.ts:411-429` hard-codes `cmc.sso_tx`. | Phase 5 now requires Set-Cookie inspection for staff, LMS, and SSO transaction cookies. |
| 4 | High | TLS mode was under-specified for Cloudflare Full Strict. | `scripts/prod-server-deploy.sh:20-29` creates self-signed erp/hoc only; `docker/nginx-prod.conf:133-136` reuses that cert for CI. | Phases 1 and 3 now require cert/SAN evidence for all prod, CI, and dev hostnames when using Full Strict. |
| 5 | High | New edge network could break Jenkins vhost. | `docker/nginx-prod.conf:140-141` proxies to `cmcnew-jenkins`; `docker/docker-compose.jenkins.yml:42-54` joins `cmcnew-prod_default`. | Phases 2 and 3 now require preserving or rejoining Jenkins network resolution. |
| 6 | High | Missing durable decision record for high-risk architecture/validation change. | `docs/FEATURE_INTAKE.md:90-95`, `docs/HARNESS.md:317-328`. | Plan and phases now require `docs/decisions/0020-dev-prod-cicd-environment-split.md`. |

## Validation Results

- Tier: Full.
- Claims checked: 31.
- Verified: 25.
- Failed: 0.
- Unverified: 6 operator/runtime confirmations.
- CLI syntax: pass, `ck plan validate --strict`.

## Remaining Operator Confirmations

- Confirm ERP dev domain: `deverp.cmcvn.edu.vn` vs earlier `deverp.edu.vn`.
- Confirm who adds Entra redirect URI.
- Confirm Cloudflare SSL mode.
- Confirm origin/public certificate coverage.
- Confirm VPS `.env.dev` secret availability.
- Confirm real-browser SSO/cookie behavior after dev exists.

## Recommendation

Plan is materially stronger and ready for implementation handoff after the
operator confirms the ERP dev domain and Entra redirect ownership.
