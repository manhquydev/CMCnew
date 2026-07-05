# DevOps research — go-live CI/CD applicability

Date: 2026-07-03
Input: `D:\Downloads\go-live-slides.md`
Scope: CMCnew CI/CD, deployment, backup, observability
Mode: read-only assessment, no pipeline/code changes

## Verdict

The slide material is highly applicable, but CMCnew already implemented many primitives. Do not restart from scratch. Use the slides as an ops maturity checklist.

Best next moves:

1. Add immutable image artifact flow: registry + SHA tags + image scan.
2. Make rollback explicit and tested, not just "rerun compose".
3. Finish operator proof: backup cron + restore drill, red-PR Jenkins demo.
4. Add observability collectors/dashboard only if live ops needs it: Loki/Prometheus/Grafana or a lighter hosted equivalent.
5. Register deploy-verification tooling in Harness so deploy checks are discoverable.

## Already aligned

- Prod is not localhost: real domains `erp.cmcvn.edu.vn`, `hoc.cmcvn.edu.vn`, CI domain `ci.cmcvn.edu.vn`; deployment report verified public HTTPS, health, login, SSO redirect, containers.
- Single VPS + Compose is intentional and right-sized. Repo docs reject Kubernetes for current 2-vCPU single-node ERP.
- Public ports are limited by ops report: 22/80/443 only; DB and Jenkins are not directly public.
- Runtime secrets are injected from `/root/cmcnew/.env.production` / `/secrets/.env.production`, not baked into images.
- Health endpoint exists: `GET /health` returns `{ ok, commit, builtAt }`; Jenkins smoke hits both internal API health and public HTTPS.
- Production compose has healthchecks, restart policies, TLS nginx, certbot, DB/Redis persistence.
- Structured logging exists via pino, with secret redaction; production outputs JSON.
- Backup/restore scripts exist and include DB + local blob stores.
- Jenkins PR gate and GitHub PR status were implemented after the older "GH Actions blocked" note.

## Partially aligned / needs adaptation

### 1. Docker image artifact

Slides recommend GitHub Actions -> registry -> server pulls verified SHA image. CMCnew currently builds on the VPS via Jenkins + `docker compose up -d --build`.

Apply this. Build once, scan once, push once, deploy by digest/SHA. Benefits: traceability, faster deploys, easier rollback, less build pressure on 2-vCPU VPS.

Recommended shape:

- Jenkins builds `ghcr.io/<org>/cmc-api:<sha>`, `cmc-admin:<sha>`, `cmc-lms:<sha>`.
- Run Trivy/Grype scan on images before push/deploy.
- Production compose consumes `image:` values from env, not `build:`.
- Keep local `build:` compose for dev/prod-like local runs.

### 2. Rollback

Slides frame rollback as `APP_IMAGE=<old_sha> compose up -d`. CMCnew has commit markers but no explicit `prod-current/prod-previous` or rollback script.

Apply this, with migration caveat:

- Store release record: commit, image tags, deployed_at, previous image tags, health result.
- Add `scripts/prod-rollback.sh` or runbook section.
- Only promise fast rollback for app-only releases.
- For DB migrations, require forward-compatible expand/contract style before deploy.

Concern: `Jenkinsfile` failure message says previous stack is left intact, but smoke runs after `compose up -d --build`. If smoke fails after containers switched, prod may already be on the new build. Fix wording or deploy strategy before relying on that claim.

### 3. Observability stack

Slides use Grafana + Loki + Prometheus + cAdvisor + Node Exporter. CMCnew has structured app logs and email alerting, but no log aggregation/metrics stack in compose.

Apply selectively:

- Minimum next step: collect Docker stdout logs, container restarts, disk, CPU, memory, `/api/health`.
- If staying single-VPS: add Loki/Promtail or Grafana Alloy + Prometheus/node-exporter/cAdvisor.
- If avoiding ops load: use hosted monitoring/logging instead.

Do not add Tempo/Mimir now.

### 4. Backup proof

Slides emphasize restore-tested backups. CMCnew has `backup-db.sh`, `db-restore.sh`, restore drill template, and a runbook. Plan 7 says code is done but operator verification remains.

Apply as a hard go-live condition:

- Install cron on VPS.
- Run a restore drill into `cmc_drill`.
- Record evidence in `docs/ops/restore-drill-<date>.md`.
- Add off-box copy. Local VPS backups only protect against app mistakes, not server loss.

### 5. Harness tool registry

Harness query showed no present provider for `deploy-verification` or `impact-analysis`, even though GitNexus MCP is live in this session and deploy checks exist informally.

Apply:

- Register a `deploy-verification` CLI that runs public health, current commit check, and smoke URLs.
- Optionally register GitNexus as `impact-analysis` if the scan target is stable.

## Not worth applying directly

- Do not replace nginx with Traefik just because slides use Traefik. CMCnew already has nginx + Cloudflare-compatible TLS and security headers.
- Do not move to Kubernetes now. Current docs correctly keep KISS for one ERP on one VPS.
- Do not resurrect GitHub Actions as the primary gate while billing is blocked and Jenkins is posting PR status.
- Do not expose Postgres, Prometheus, Grafana, or Jenkins directly to the public internet.

## Suggested priority order

P0 before real go-live:

1. VPS backup cron installed + restore drill passed + off-box copy decided.
2. Jenkins red-PR demo verified on live Jenkins.
3. Smoke check compares `/api/health.commit` with the Jenkins commit SHA, not just `"ok":true`.

P1 next:

1. Registry/SHA images + vulnerability scan.
2. Explicit rollback runbook/script with previous release metadata.
3. Observability dashboard for health/version/restarts/CPU/memory/disk/5xx/log errors.

P2 later:

1. Managed Postgres/RDS or offsite replicated backups if customer dependency grows.
2. Cloudflare Full Strict origin cert hardening if not already done.
3. More detailed metrics/tracing only after logs + health + host metrics are useful.

## Evidence read

- `D:\Downloads\go-live-slides.md`
- `README.md`
- `docs/HARNESS.md`
- `docs/FEATURE_INTAKE.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTEXT_RULES.md`
- `docs/TOOL_REGISTRY.md`
- `docs/CK_WORKFLOW.md`
- `docs/prod-deploy-security-runbook.md`
- `docs/decisions/0019-cicd-observability.md`
- `Jenkinsfile`
- `.github/workflows/ci.yml`
- `docker/docker-compose.prod.yml`
- `docker/docker-compose.prod.tls.yml`
- `docker/docker-compose.jenkins.yml`
- `docker/nginx-prod.conf`
- `apps/api/src/index.ts`
- `apps/api/src/lib/logger.ts`
- `scripts/backup-db.sh`
- `scripts/db-restore.sh`
- `scripts/ci-integration-tests.sh`
- `plans/260630-0919-cicd-observability/plan.md`
- `plans/260702-1109-ops-hardening/plan.md`
- `plans/reports/completion-260628-0220-prod-deployment-verified-report.md`
- `plans/reports/pm-260702-1450-ops-hardening-syncback-report.md`
- `plans/reports/tester-260702-1444-plan7-ops-hardening-validation-report.md`

## Unresolved questions

- Is GHCR acceptable for private production images, or should the registry be another provider?
- Should observability be self-hosted on the VPS or hosted to reduce ops load?
- Is Cloudflare currently Full or Full Strict in production?
- Where should off-box backups land: object storage, another VPS, or managed backup provider?
