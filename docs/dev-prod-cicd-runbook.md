# Dev/Prod CI/CD Runbook — CMCnew

Two live environments share one VPS and one edge nginx: **prod** (`cmcnew-prod`) serves
`erp.cmcvn.edu.vn` + `teacher.cmcvn.edu.vn` + `hoc.cmcvn.edu.vn`; **dev** (`cmcnew-dev`) serves
`deverp.cmcvn.edu.vn` + `devteacher.cmcvn.edu.vn` + `devlms.cmcvn.edu.vn`. Decision:
[`docs/decisions/0032-dev-prod-cicd-environment-split.md`](decisions/0032-dev-prod-cicd-environment-split.md).

## Environment map

| | Prod | Dev |
| --- | --- | --- |
| Compose project | `cmcnew-prod` | `cmcnew-dev` |
| Compose file | `docker/docker-compose.prod.tls.yml` | `docker/docker-compose.dev.tls.yml` |
| Env file (VPS, chmod 600) | `/root/cmcnew/.env.production` | `/root/cmcnew/.env.dev` |
| ERP host | `erp.cmcvn.edu.vn` | `deverp.cmcvn.edu.vn` |
| Teacher host | `teacher.cmcvn.edu.vn` | `devteacher.cmcvn.edu.vn` |
| LMS host | `hoc.cmcvn.edu.vn` | `devlms.cmcvn.edu.vn` |
| Deploy branch | `main` | `develop` |
| DB / Redis | `cmcnew-prod_default` (isolated) | `cmcnew-dev_default` (isolated) |
| Staff session cookie | `cmc.session` | `cmc.dev.session` |
| LMS session cookie | `cmc.lms` | `cmc.dev.lms` |
| SSO redirect URI | `https://erp.cmcvn.edu.vn/api/auth/sso/callback`, `https://teacher.cmcvn.edu.vn/api/auth/sso/callback` | `https://deverp.cmcvn.edu.vn/api/auth/sso/callback`, `https://devteacher.cmcvn.edu.vn/api/auth/sso/callback` |
| Seed mode | `bootstrap` (super_admin + 2 directors) | `full` (all personas get a password) |
| Data | real | synthetic/demo only |

Both app tiers join the shared external network **`cmcnew-edge`**; the one prod nginx routes
`deverp`/`devteacher`/`devlms` to the dev app tier (aliases `cmcnew-dev-api/-admin/-lms`) over it. Dev
`dev-postgres`/`dev-redis` are **not** on `cmcnew-edge` and publish no host ports, so the dev
database is unreachable from the edge, from prod, and from the public internet. `ci.cmcvn.edu.vn`
(Jenkins) stays on `cmcnew-prod_default`; the prod nginx is attached to both networks.

## Branch deploy policy

- **Pull request** → lint + typecheck + integration tests, **no deploy**.
- **`develop`** → lint + typecheck + integration, then deploy `cmcnew-dev` + smoke `deverp`/`devteacher`/`devlms`.
- **`main`** → lint + typecheck + integration, then deploy `cmcnew-prod` + smoke `erp`/`hoc`.

Encoded in `Jenkinsfile` (single multibranch job, one executor). A red lint/typecheck/integration
stage aborts the pipeline before any deploy on both branches.

## First-time dev VPS setup

```bash
# 1. Edge network (external; both stacks reference it, deploy scripts also create it idempotently)
docker network create cmcnew-edge

# 2. Attach the running prod nginx to the edge network (zero-downtime; durable via compose file)
docker network connect cmcnew-edge cmcnew-prod-nginx-1

# 3. Dev secrets — copy the template and fill FRESH dev values (never reuse prod secrets)
cp /root/cmcnew/.env.dev.example /root/cmcnew/.env.dev && chmod 600 /root/cmcnew/.env.dev
#    Entra: the dev app may share the org's Entra registration (same tenant/client), but the
#    dev callback URIs (https://deverp.cmcvn.edu.vn/api/auth/sso/callback and
#    https://devteacher.cmcvn.edu.vn/api/auth/sso/callback) must be registered on it.

# 4. Verify the Entra credential non-interactively BEFORE relying on SSO (no MFA needed):
TID=...; CID=...; SEC=...   # from .env.dev
curl -s -X POST "https://login.microsoftonline.com/$TID/oauth2/v2.0/token" \
  --data-urlencode "client_id=$CID" --data-urlencode "client_secret=$SEC" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "scope=https://graph.microsoft.com/.default" | grep -q access_token && echo OK
```

Note: the dev stack builds from the **`develop`** tree. On the VPS the checkout is single-branch
`main`; fetch develop explicitly for a manual first bring-up:
`git -C /root/cmcnew fetch origin develop:refs/remotes/origin/develop && git -C /root/cmcnew worktree add -f /root/cmcnew-devsrc origin/develop`.
Jenkins does this automatically (it checks out the branch it builds). Once this branch is merged to
`develop`, the automated `develop` deploy replaces the manual bring-up.

## Dev deploy (what the Jenkins `develop` build runs)

```bash
cd <develop checkout>            # Jenkins workspace, or /root/cmcnew-devsrc for a manual run
export APP_COMMIT=$(git rev-parse HEAD)      # ALWAYS set — else /health reports commit "unknown"
export APP_BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export COMPOSE_PARALLEL_LIMIT=1              # 2-vCPU box: serialize image builds
docker network create cmcnew-edge 2>/dev/null || true
DEV="docker compose -f docker/docker-compose.dev.tls.yml --env-file /root/cmcnew/.env.dev"
$DEV up -d dev-postgres dev-redis
$DEV --profile migrate run --rm --build dev-api-migrate
# align cmc_app RLS role password (idempotent; required on a fresh dev DB):
DBP=$(grep -m1 '^DB_APP_PASSWORD=' /root/cmcnew/.env.dev | cut -d= -f2-)
$DEV exec -T dev-postgres psql -U cmc -d cmc -c "ALTER ROLE cmc_app PASSWORD '$DBP';"
$DEV up -d --build dev-api dev-admin dev-lms
docker exec cmcnew-prod-nginx-1 nginx -s reload   # re-resolve recreated dev containers' new IPs
```

First-install only (keeps test state on later deploys): `$DEV --profile seed run --rm dev-api-seed`.

## Prod deploy

`main` build runs the prod deploy stage (unchanged): `scripts/prod-server-deploy.sh` or the
Jenkins `Build + Deploy (prod)` stage — ensure-origin-cert, edge-network create, `$COMPOSE up`,
migrate, `cmc_app` align, seed, nginx restart. See `docs/prod-deploy-security-runbook.md`.

## Smoke checks

```bash
for h in erp teacher hoc deverp devteacher devlms; do curl -sS "https://$h.cmcvn.edu.vn/api/health"; echo; done
# erp/teacher/hoc must return the main commit; deverp/devteacher/devlms must return the develop commit (markers DIFFER).
curl -s -o /dev/null -w '%{http_code}\n' https://ci.cmcvn.edu.vn/login          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://deverp.cmcvn.edu.vn/api/auth/sso/login   # 302 → login.microsoftonline.com
curl -s -o /dev/null -w '%{http_code}\n' https://devteacher.cmcvn.edu.vn/api/auth/sso/login # 302 → login.microsoftonline.com
```

## Rollback

- **Dev only** (never touches prod): `docker compose -p cmcnew-dev -f docker/docker-compose.dev.tls.yml --env-file /root/cmcnew/.env.dev down`
  then redeploy a known-good commit, or `git -C /root/cmcnew-devsrc checkout <sha>` and redeploy.
- **Prod deploy failure**: re-run the Jenkins job on the previous good commit (compose does not
  switch traffic on a failed build — the old containers keep serving).
- **nginx routing broke**: timestamped backups sit next to the config —
  `cp /root/cmcnew/docker/nginx-prod.conf.bak.<stamp> /root/cmcnew/docker/nginx-prod.conf`
  then `docker exec cmcnew-prod-nginx-1 nginx -t && docker exec cmcnew-prod-nginx-1 nginx -s reload`.
- **Edge-network attach on prod nginx** cannot be undone by a file restore alone (it is a runtime
  attach); if it must be reverted: `docker network disconnect cmcnew-edge cmcnew-prod-nginx-1`.

## SSO redirect checklist

- Dev SSO start (`/api/auth/sso/login`) must 302 to `login.microsoftonline.com` with
  host-correct `redirect_uri` for `deverp` and `devteacher`, and set a host-only
  `cmc.sso_tx` cookie (HttpOnly, Secure, SameSite=Lax). Prod must use the `erp` redirect URI.
- **Full interactive login is human-only** (MFA-gated): open `https://deverp.cmcvn.edu.vn` and
  `https://devteacher.cmcvn.edu.vn` in a
  browser, sign in with a real `@cmcvn.edu.vn` staff account, confirm the callback lands and a
  `cmc.dev.session` cookie is set. To force the SSO lane (not password) for this test: set
  `STAFF_PASSWORD_LOGIN=false` in `.env.dev`, `docker compose ... up -d --no-deps --force-recreate dev-api`,
  reload nginx, test, then restore `STAFF_PASSWORD_LOGIN=true` and recreate again (with `APP_COMMIT` set).

## Data isolation checklist

- `dev-postgres`/`dev-redis` on `cmcnew-dev_default` only, no `cmcnew-edge`, no published host ports.
- Dev uses its own `.env.dev` — never `.env.production`; fresh DB/JWT secrets.
- Dev cookies (`cmc.dev.session`/`cmc.dev.lms`) never collide with prod (`cmc.session`/`cmc.lms`).
- Dev holds synthetic/demo data only. No raw prod clone without an anonymization step + new decision.

## Gotchas

- **Windows CRLF**: shell scripts scp'd from a Windows checkout break `bash` (`set -o pipefail`).
  Run `sed -i 's/\r$//' <script>` after copying `*.sh` to the VPS.
- **Upstream IP caching**: recreating any container the prod nginx proxies to (dev app tier, or
  `cmcnew-jenkins`) gives it a new IP; reload nginx (`nginx -s reload`, zero-downtime) to re-resolve.
- **`APP_COMMIT` on manual recreate**: a bare `up -d dev-api` without exporting `APP_COMMIT` resets
  `/health` to `commit: "unknown"`. Jenkins always exports it; set it manually too.
- **Memory**: 2-vCPU / 8 GiB box; keep `COMPOSE_PARALLEL_LIMIT=1` and watch `docker stats` / OOM
  when a `develop` build runs while prod serves and dev is up.
