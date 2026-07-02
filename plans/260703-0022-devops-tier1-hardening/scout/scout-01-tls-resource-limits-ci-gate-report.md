# Scout Report: TLS Strategy, Resource Limits, CI Gate Wiring

## 1. TLS strategy reconciliation

**Live compose file:** `Jenkinsfile:15` sets `COMPOSE = 'docker compose -f docker/docker-compose.prod.tls.yml --env-file /secrets/.env.production'`, used by every stage (`Jenkinsfile:56-58,62,72`). The `docker-compose.prod.tls.yml` header itself says "Authoritative file for the live VPS (erp.cmcvn.edu.vn + hoc.cmcvn.edu.vn)" while `docker-compose.prod.yml:1-3` is explicitly the sibling "single-origin HTTP file for local prod-like runs" — **not deployed by Jenkins**.

**docker-compose.prod.yml (250 lines):** services `postgres`, `redis`, `api`, `api-migrate`, `api-seed`, `admin`, `lms`, `minio` (profile `minio`), `minio-init` (profile `minio`), `nginx`. Only `nginx` publishes a port: `'${NGINX_PORT:-80}:80'` (line 235), mounting `./nginx.conf:/etc/nginx/conf.d/default.conf:ro` (line 237) — a different, non-TLS nginx.conf (not read here, out of scope). No cert volumes present.

**docker-compose.prod.tls.yml (182 lines):** same core services plus `certbot`. `nginx` (lines 147-165) publishes `'80:80'` and `'443:443'`, mounts three volumes: `/root/cmcnew/docker/nginx-prod.conf:/etc/nginx/conf.d/default.conf:ro` (an absolute host path, chosen — per comment lines 153-154 — because Jenkins runs from an ephemeral `cleanWs()`-scrubbed workspace), `letsencrypt:/etc/letsencrypt:ro`, `certbot_www:/var/www/certbot:ro`. `certbot` service (168-176) runs `certbot renew --webroot -w /var/www/certbot --quiet` every 12h. Named volumes `letsencrypt`, `certbot_www` declared at 181-182 (plus `pgdata`, `redisdata`).

**scripts/prod-tls-bootstrap.sh (29 lines):** one-time, run manually before nginx starts (port 80 must be free): checks `ss -tlnp` for port 80 in use, then runs `certbot/certbot certonly --standalone` for both domains into `cmcnew-prod_letsencrypt`/`cmcnew-prod_certbot_www` volumes — genuine Let's Encrypt path, invoked manually, not from Jenkinsfile.

**scripts/prod-server-deploy.sh (53 lines):** run manually on the server (`bash scripts/prod-server-deploy.sh`), 5 steps: rename scp'd `prodenv.txt`→`.env.production`; create `cmcnew-prod_letsencrypt` volume and, if `live/erp.cmcvn.edu.vn/fullchain.pem` absent, generate a **self-signed** SAN cert via `openssl req -x509` (lines 24-29, comment: "Behind Cloudflare (proxied)... accepted by Cloudflare 'Full' mode"); bring up postgres/redis; run `api-migrate`; align `cmc_app` password; run `api-seed`; `up -d --build`.

**Jenkinsfile TLS handling (lines 50-55):** the live deploy stage does its own self-signed-cert bootstrap inline (duplicating `prod-server-deploy.sh`'s logic, not calling the script): `docker volume create cmcnew-prod_letsencrypt` then copies `nginx-prod.conf` from the ephemeral workspace to `/root/cmcnew/docker/`. **It does not call `openssl req -x509`** itself — it relies on the volume/cert already existing from a prior manual run of `prod-server-deploy.sh` (or `prod-tls-bootstrap.sh`). If the volume is fresh and no cert exists, Jenkins' `$COMPOSE up -d --build` would fail (nginx has no cert to load) since Jenkinsfile has no fallback cert-generation step.

**docker/nginx-prod.conf (152 lines):** references `/etc/letsencrypt/live/erp.cmcvn.edu.vn/fullchain.pem` and `.../privkey.pem` for both the `erp.cmcvn.edu.vn` vhost (lines 51-52) and `hoc.cmcvn.edu.vn` vhost (lines 92-93), plus a third vhost `ci.cmcvn.edu.vn` (127-152) reusing the same cert to proxy to `cmcnew-jenkins:8080`. Comment at top (lines 6-13) documents the LE `--standalone` bootstrap; file itself is cert-path-agnostic to self-signed vs LE (same path either way).

**Both self-signed and LE paths are live, but neither is exercised automatically by Jenkins**: `prod-tls-bootstrap.sh` (LE) and `prod-server-deploy.sh` (self-signed) are two different, mutually exclusive one-time bootstrap procedures — whichever ran last on the VPS determines what's actually in the `letsencrypt` volume. Jenkins deploy only "ensures the volume exists," never picks a cert strategy.

**Gap:** Two contradictory manual bootstrap procedures exist (Let's Encrypt vs self-signed) for the same volume/path, and Jenkinsfile silently assumes one already ran — there is no automated proof of which cert is actually live, nor CI validation of TLS bootstrap state.
**Constraint:** Reconciling requires a one-time VPS-side decision + re-bootstrap (LE needs port 80 free and public DNS; self-signed requires Cloudflare "Full" not "Full (strict)") — not fixable by touching only Jenkinsfile/compose.

## 2. Resource limits

**docker-compose.prod.tls.yml:** grepped for `deploy:`/`resources:` — **none of the 8 services** (`postgres`, `redis`, `api`, `api-migrate`, `api-seed`, `admin`, `lms`, `nginx`, `certbot`) declare a `deploy.resources` block. Confirmed by full read above — no such keys anywhere in the 182 lines.

**docker-compose.jenkins.yml:** the single `jenkins` service **does** have limits (lines 36-40):
```
deploy:
  resources:
    limits:
      cpus: '1.5'
      memory: 3g
```
This is the only resource-limited service in the whole stack.

**VPS specs** — found in `plans/reports/brainstorm-260703-0044-dev-domains-vps-capacity-deploy-policy-report.md:30-46` (dated observation 2026-07-02T17:43:28Z): host `152.42.167.189`, image `ubuntu-s-2vcpu-8gb-160gb-intel-sgp1` (DigitalOcean droplet naming) → **2 vCPU, 7.8 GiB RAM total (2.4 GiB used, 5.4 GiB available), 154 GiB disk (137 GiB free), no swap**. At-idle usage: Jenkins 1.33 GiB/3 GiB cap, API ~109 MiB, Postgres ~46 MiB. No other doc/README/deploy-script mentions VPS specs (grep for vCPU/RAM/GB/provider across repo only hit this brainstorm report and unrelated code/docs matches on "GB" as a data unit).

**Postgres tuning:** grepped `shared_buffers|max_connections|POSTGRES_.*ARGS|command:.*postgres` across the repo — **no matches**. `postgres` service in both compose files uses the stock `postgres:16-alpine` image with no `command:` override and no mounted `postgresql.conf` — i.e., it runs entirely on image defaults (which auto-scale `shared_buffers`/`max_connections` conservatively based on container-visible memory, not a fixed low value), so a memory limit added now isn't fighting an existing explicit high setting, but also means there's no documented floor to size a cgroup limit against.

**Gap:** no `deploy.resources` on any app/db service — a runaway container (Postgres, api, or a future dev stack per the brainstorm report) can consume all 7.8 GiB and starve Jenkins/other services; no documented Postgres memory floor to set a safe limit above.
**Constraint:** VPS only has 2 vCPU / ~5.4 GiB free at idle — limits must be set conservatively (the brainstorm report already proposes dev API 512 MiB / dev Postgres 512 MiB–1 GiB as a reference point) and Jenkins' existing 1.5 CPU/3 GiB cap leaves only 0.5 vCPU for everything else if fully utilized.

## 3. Jenkins→GitHub required-check wiring

**docs/decisions/0019-cicd-observability.md** (57 lines, re-verified against current files): Accepted decision implemented `GET /api/health` commit/builtAt exposure and added `blueocean` + `github-checks` to `jenkins-plugins.txt` (lines 26-28). Explicitly **deferred** (lines 29-37): "Jenkins → GitHub commit-status (`publishChecks`): requires a GitHub token credential in Jenkins + a GitHub server entry in `jenkins-casc.yaml`, then a `post{}` publishChecks step." Follow-up (line 58): "Create the GitHub token credential + casc server, then add `publishChecks`."

**Current state check:**
- `docker/jenkins-plugins.txt:12-13` confirms `blueocean` and `github-checks` are listed as install targets — plugin **is** declared for install (not yet confirmed installed on the running controller; that requires a VPS rebuild per the decision doc's follow-up).
- `Jenkinsfile` (86 lines, full read): **no** `publishChecks`, no `GITHUB_TOKEN` env reference, no credentials binding step anywhere in any of the 4 stages or the `post{}` block (lines 82-85 only run `cleanWs()` and an `echo` on failure).
- `docker/docker-compose.jenkins.yml:18-20`: `env_file: /root/jenkins.env` (gitignored, server-only) is documented to hold `${GITHUB_TOKEN}` and `${JENKINS_ADMIN_PASSWORD}` for CASC — confirms a token is expected to exist on the VPS already, since `jenkins-casc.yaml` consumes it.
- `docker/jenkins-casc.yaml:16-25`: **a GitHub token credential already exists** — `credentials.system.domainCredentials` defines a `usernamePassword` credential `id: github-token`, `username: manhquydev`, `password: "${GITHUB_TOKEN}"`, used today for SCM checkout/multibranch discovery (`jenkins-casc.yaml:44` `credentialsId('github-token')`). This is the same credential the deferred `publishChecks` step would reuse — it does **not** need a brand-new credential, just the same one plumbed into a `publishChecks`/GitHub-server config.
- No separate "GitHub server" CASC block (e.g. `unclassified.githubPluginConfig` / `github-checks` app registration) exists in `jenkins-casc.yaml` — only `unclassified.location.url` is set (lines 27-31).

**What's missing to wire `publishChecks`:** (a) a Jenkinsfile code addition — add a `post{}` (or per-stage) `publishChecks` step referencing the existing `github-token` credential; (b) confirm the `github-checks` plugin is actually installed on the running controller (requires the VPS rebuild noted in 0019's Follow-Up — not yet done as of this read, since only the plugin list file was updated); (c) GitHub PAT scope check — a plain `usernamePassword` PAT credential is being reused for SCM; `github-checks`/Checks API typically needs a GitHub App or a PAT with `checks:write`/repo scope, and the current `github-token` was created for SCM+"checks" per its description comment (`jenkins-casc.yaml:25` says "GitHub PAT (SCM + checks)"), suggesting scope was anticipated but is unverified from the repo alone.

**Gap:** `publishChecks` is absent from the Jenkinsfile entirely; the credential and plugin declaration exist but the plugin's actual installation on the live controller and the PAT's checks-write scope are both unverified from repo state alone.
**Constraint:** the credential itself is already scripted via CASC (no new manual token creation needed), but confirming plugin installation requires a VPS-side `docker compose -f docker/docker-compose.jenkins.yml up -d --build` rebuild, and if the existing PAT lacks `checks:write` scope, regenerating it is a manual, non-scriptable one-time GitHub UI step.
