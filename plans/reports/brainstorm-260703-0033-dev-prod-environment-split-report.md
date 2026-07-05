---
type: brainstorm-report
date: 2026-07-03
lane: normal
intake: 57
skills: [ck:brainstorm, ck:devops, ck:project-organization]
mode: markdown
---

# Dev/prod environment split for CMCnew

## Summary

Recommendation: adopt a selective two-environment flow, but keep it simple:

- `develop` auto-deploys to `dev.cmcvn.edu.vn`.
- `main` auto-deploys to current prod domains: `erp.cmcvn.edu.vn`, `hoc.cmcvn.edu.vn`.
- Dev and prod must have separate compose project names, env files, DB volumes, Redis volumes, app secrets, seed accounts, and smoke checks.
- Keep one VPS for now only if CPU/RAM/disk headroom is acceptable. Do not add Kubernetes.
- Use the dev environment as realistic acceptance/smoke proof, not as a place for real users or real payroll/payment data.

Important current finding: `https://dev.cmcvn.edu.vn/api/health` currently returns the same payload as `https://erp.cmcvn.edu.vn/api/health`:

```json
{"ok":true,"commit":"ce59f4c338d1c51041986b0bc0378c1a60e627ff","builtAt":"2026-06-30T04:38:17Z"}
```

So DNS exists, but the environment is not separated yet. Treat `dev.cmcvn.edu.vn` as unsafe for testing until nginx + compose + env separation is implemented.

## Problem-first diagnosis

The proposed solution is "deploy branch develop to dev.cmcvn.edu.vn, then merge PR to main to deploy prod." The real problem underneath:

- local/prod-like Docker checks prove a lot, but not Cloudflare, TLS, real nginx routing, cookies, SSO redirect, public health checks, and deployment scripts.
- `main` deploy currently carries too much first-real-environment risk.
- current prod domains are also described in old plans as interim/test deployment, which blurs "test vs real prod."
- CI proof is partly code-complete but still has operator-verification gaps: backup cron/drill and red-PR Jenkins demo.

## Scout findings

- Stack: TypeScript monorepo, pnpm/turbo, Hono+tRPC API, Vite admin/LMS, Postgres+RLS, Redis, Docker Compose.
- CI/CD: Jenkins multibranch (`docker/jenkins-casc.yaml`) posts GitHub status; GitHub Actions is billing-blocked/noise.
- Current deploy: `Jenkinsfile` deploys only `main`; integration tests run on `main` and PR via `changeRequest()`.
- Prod compose: `docker/docker-compose.prod.tls.yml`, fixed project name `cmcnew-prod`, services `postgres`, `redis`, `api`, `admin`, `lms`, `nginx`, `certbot`.
- Prod nginx: `docker/nginx-prod.conf` routes `erp`, `hoc`, `ci`; no `dev.cmcvn.edu.vn` vhost yet.
- Auth/SSO: Entra redirect URIs must be configured per environment; docs explicitly say each env needs its own callback URI.
- Ops hardening: pino structured logs done; backup/restore scripts done; operator still must install cron + run restore drill.

## Evaluated approaches

### Option A — same VPS, second compose project, same nginx front door

Shape:

- Add `docker/docker-compose.dev.tls.yml`, project name `cmcnew-dev`.
- Add `/root/cmcnew-dev/.env.dev` or `/root/cmcnew/.env.dev`.
- Add dev services: `dev-postgres`, `dev-redis`, `dev-api`, `dev-admin`, `dev-lms` via compose project isolation.
- Add nginx vhost:
  - `dev.cmcvn.edu.vn` -> dev admin
  - `dev.cmcvn.edu.vn/api/` -> dev api
  - optional `dev.cmcvn.edu.vn/lms/` -> dev LMS, or a separate `dev-hoc.cmcvn.edu.vn` later.
- Jenkins:
  - `develop` -> migrate dev DB -> deploy dev stack -> smoke `https://dev.cmcvn.edu.vn/api/health`
  - `main` -> deploy prod stack -> smoke prod domains.

Pros:

- fastest and cheapest.
- fits current repo and VPS topology.
- lets the team validate real Cloudflare/TLS/cookie/nginx behavior before main.
- no new platform/mental model.

Cons:

- same physical host means dev can compete with prod for CPU/RAM/disk.
- shared nginx means bad config can affect prod if edited carelessly.
- both stacks need strict compose names and volume separation.

Best if: this is still pre-real-prod / low concurrent user load.

### Option B — same VPS, dev and prod nginx separated by compose network

Shape:

- Keep prod nginx authoritative for public 80/443.
- Add dev stack without exposing ports directly.
- Add dev upstreams to prod nginx, but keep dev compose network attached read-only to nginx.
- Alternative: add a second internal nginx for dev and proxy to it from prod nginx.

Pros:

- isolates app services better than Option A.
- dev stack can be restarted without touching prod app containers.

Cons:

- more network plumbing.
- still one host and one public nginx blast radius.
- more complex for little gain right now.

Best if: wanting a bit more isolation while staying on one VPS.

### Option C — separate VPS for dev

Shape:

- `dev.cmcvn.edu.vn` points to a second low-cost VPS.
- Jenkins deploys over SSH or Docker context to dev server for `develop`.
- Prod server only runs prod.

Pros:

- best safety isolation.
- dev load cannot hurt prod.
- dev deploy mistakes do not change prod nginx/certs/volumes.

Cons:

- extra server cost and ops surface.
- duplicate backup/security/monitoring work.
- probably overkill until real users depend on prod.

Best if: prod is already used by real staff/parents, or dev tests need destructive data resets often.

## Recommendation

Use Option A first, with hard guardrails:

1. Separate compose project: `cmcnew-dev`, never reuse `cmcnew-prod`.
2. Separate env file: `/root/cmcnew/.env.dev`, never mount `/root/cmcnew/.env.production` into dev.
3. Separate DB name/passwords/volumes. Do not connect dev app to prod Postgres.
4. Separate cookies: use a distinct `AUTH_COOKIE_NAME`, e.g. `cmc.dev.session`, and LMS cookie if configured.
5. Separate SSO redirect URI: add `https://dev.cmcvn.edu.vn/api/auth/sso/callback` in Entra before enabling SSO on dev.
6. Dev seed is demo/synthetic only. No real payroll/payment/PII in dev.
7. Jenkins deploy conditions:
   - PR: lint + typecheck + integration only. No deploy.
   - `develop`: lint + typecheck + integration + deploy dev + smoke dev.
   - `main`: lint + typecheck + integration + deploy prod + smoke prod.
8. Smoke must verify commit match, not only `"ok":true`.

## Proposed pipeline

```text
feature/fix work
  -> merge/commit to develop
  -> Jenkins develop build
      - lint/typecheck
      - integration tests with ephemeral DB
      - deploy cmcnew-dev
      - migrate dev DB
      - smoke https://dev.cmcvn.edu.vn/api/health
      - optional Playwright smoke against dev
  -> human checks dev domain
  -> PR develop -> main
  -> Jenkins PR check
      - lint/typecheck
      - integration tests
  -> merge main
  -> Jenkins main build
      - deploy cmcnew-prod
      - migrate prod DB
      - smoke erp/hoc prod
```

## Files likely touched in implementation

- `Jenkinsfile`
- `docker/docker-compose.dev.tls.yml` (new)
- `docker/nginx-prod.conf`
- `.env.dev.example` or `docs/dev-environment-runbook.md`
- `docs/prod-deploy-security-runbook.md` or a new `docs/dev-prod-cicd-runbook.md`
- optionally `scripts/dev-server-deploy.sh`

No app source code should be needed unless cookie naming, LMS base URL, or health response needs a small config addition.

## Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Dev accidentally uses prod DB | Data corruption / privacy breach | separate env file, DB name, volume, smoke prints env name, never mount prod env in dev |
| Shared host resource contention | dev deploy can slow prod | single Jenkins executor already helps; add compose resource limits before real prod |
| Nginx config mistake breaks prod | one front door | add `nginx -t` in Jenkins before restart; keep config additive |
| SSO redirect mismatch | dev login fails | add Entra redirect for dev callback |
| Cookie collision between dev/prod | sessions overwrite between subdomains | distinct cookie names; keep host-only cookie behavior |
| Migration runs on dev first but still breaks prod later | dev data may not cover prod edge cases | keep backup/restore proof and forward-compatible migrations |
| Branch protection unavailable | private repo plan limits technical enforcement | treat Jenkins checks + human PR discipline as process control; consider GitHub plan upgrade later |

## Acceptance criteria

Dev env is ready when:

- `https://dev.cmcvn.edu.vn/api/health` returns `{ ok: true, commit: <develop commit>, builtAt, environment: "dev" }` or equivalent evidence.
- `https://erp.cmcvn.edu.vn/api/health` remains on prod commit and is not changed by develop deploy.
- Dev DB has independent seed/demo data.
- Jenkins `develop` build deploys dev automatically and smoke fails if commit mismatch.
- Jenkins `main` build still deploys prod only.
- PR builds do not deploy anything.

## Non-goals

- No Kubernetes.
- No Traefik migration.
- No real user data in dev.
- No replacing Jenkins with GitHub Actions.
- No full blue/green prod deploy yet.
- No e2e-on-every-PR unless dev env proves stable and runtime cost is acceptable.

## Suggested next plan

Use `/ck:plan --tdd` or normal `/ck:plan` after approval. This is infra/config with high blast radius if done carelessly, but not a product behavior change. I recommend a normal plan with explicit operator checkpoints:

1. Dev compose/env design.
2. Nginx vhost + certificate/SNI behavior.
3. Jenkins branch logic.
4. Dev smoke and commit verification.
5. Runbook + rollback notes.

## Unresolved questions

- Do we keep LMS under `dev.cmcvn.edu.vn/lms/`, or create `dev-hoc.cmcvn.edu.vn` for parity with prod?
- Is the current VPS capacity enough to run prod + dev + Jenkins together under load?
- Should dev SSO use the real Entra tenant or stay break-glass/demo-login only until later?
- Do you want `develop` deploy on every push, or manual deploy button after tests pass?
