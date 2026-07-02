# Phase 1 — TLS strategy reconciliation

## Goal

Collapse the two competing cert-bootstrap procedures into one canonical, self-healing, verified path so a Jenkins deploy never silently depends on VPS tribal knowledge.

## Context / verified facts

- `Jenkinsfile:43-65` Build+Deploy stage (main-only). Lines 50-55 currently: `docker volume create cmcnew-prod_letsencrypt` + sync `nginx-prod.conf` to `/root/cmcnew/docker/`. It does NOT generate a cert; if the volume is fresh, `$COMPOSE up -d --build` fails because nginx has no cert to load.
- `scripts/prod-tls-bootstrap.sh` — real Let's Encrypt via `certbot certonly --standalone` (needs port 80 free + public DNS), manual, never auto-invoked.
- `scripts/prod-server-deploy.sh:24-29` — self-signed SAN cert (`openssl req -x509`, 10y, CN=erp, SAN erp+hoc) into the same volume, comment: "accepted by Cloudflare Full mode". Manual.
- `docker-compose.prod.tls.yml:169-176` — in-compose `certbot` service runs `certbot renew` every 12h (only meaningful for the LE path).
- `docker/nginx-prod.conf` references `/etc/letsencrypt/live/erp.cmcvn.edu.vn/{fullchain,privkey}.pem` — path is identical for both strategies, so nginx is cert-strategy-agnostic.
- Project memory: prod is Cloudflare-proxied (`erp+hoc.cmcvn.edu.vn` behind Cloudflare).
- Jenkins deploy runs from the workspace BEFORE `cleanWs()` (post/always), so `bash scripts/*.sh` from the checkout is available during the deploy stage.

## Red-team corrections applied (2026-07-03)

- **Finding 3 (Critical, accepted):** this phase's premise — that self-signed is what's currently
  live in the `cmcnew-prod_letsencrypt` volume — is unverified from source alone.
  `docker-compose.prod.tls.yml:6-13`'s own current header still documents Let's Encrypt
  (`prod-tls-bootstrap.sh`) as canonical step 1, directly contradicting this phase's assumption. If
  the live cert is actually a real 90-day LE cert, gating `certbot renew` off (§4 below) silently
  stops renewal and causes a delayed full-site outage (~90 days out) with no deploy-time signal —
  `ensure-origin-cert.sh`'s verify step (presence/parse/SAN) passes identically for either cert type,
  so it cannot catch this. **Fix: Phase 4 now has a mandatory pre-flight step (before this phase's
  certbot-profile change lands) that reads the ACTUAL live cert's issuer on the VPS** — do not trust
  this phase's source-only reasoning alone. See phase-04 §Step 0.
- **Finding 15 (Medium, accepted):** the Cloudflare "Full" (not "Full strict") premise is verified
  correct as a general protocol fact, but the plan never confirmed the LIVE zone's actual configured
  SSL/TLS mode. If it's actually "Full (strict)", the first self-signed cert regen on an empty volume
  gets rejected at Cloudflare's edge (Error 526, full outage) — undetectable by this phase's own
  verify step since the failure happens at Cloudflare, not in the deploy. **Fix: Phase 4 §Step 0 also
  confirms the live zone's SSL/TLS mode via Cloudflare API/dashboard before the first regen.**
- **Decision-number collision:** phase §6 below computed `0029` as the next-free decision number on
  2026-07-02. A second, unrelated plan created the same session (email-brevo-external-routing) also
  computed `0029` independently — whichever plan's decision doc is actually written to disk first
  claims it; the other must re-check `ls docs/decisions` and bump to the actual next-free number at
  write time. Do not hardcode `0029` as final; treat it as "next-free as of planning time, re-verify
  before creating the file" (already this repo's standing convention for decision numbering).

## Decision: canonical = self-signed origin cert behind Cloudflare "Full"

Reasoning (weighed both, per task):

- **Cloudflare already owns the browser-trusted edge cert.** The origin cert only secures the Cloudflare↔origin hop; it does not need public trust.
- **Self-signed is generatable fully offline inside the deploy** — no DNS, no port-80 exposure, no LE rate limits, no renewal-failure surface. On a single 2-vCPU box with no staging, fewer moving parts = fewer unattended failures. This lets the Jenkins deploy become hermetic and self-healing.
- **Let's Encrypt cannot be embedded in an idempotent deploy** — HTTP-01 needs the box publicly reachable on port 80 and nginx stopped, which conflicts with a running prod stack. LE stays a deliberate manual procedure.
- **Trade-off accepted:** origin traffic encrypted but not authenticated (CF "Full", not "Full (strict)"). Acceptable — Cloudflare proxy is the trust boundary and the box is single-tenant. Documented upgrade path: drop a Cloudflare Origin CA cert (15y, CF-trusted) at the same path → "Full (strict)", zero code change.

## Design

### 1. New single-source cert helper — `scripts/ensure-origin-cert.sh` (DRY)

Idempotent. Extracts the exact self-signed logic currently duplicated in `prod-server-deploy.sh:24-29` so it lives in exactly one place, called by both the script and Jenkins.

Behavior:
1. `docker volume create cmcnew-prod_letsencrypt` (no-op if exists).
2. **Verify FIRST, before touching any package manager** (Finding 12, accepted — the original design
   ran `apk add openssl` unconditionally on every deploy, an unnecessary availability + supply-chain
   risk on a step that's a no-op verify 99% of the time): if `live/erp.cmcvn.edu.vn/fullchain.pem`
   already exists, skip straight to step 3's verify using a pinned-digest `alpine` image (pin the
   image digest, not just `alpine:latest`, so the verify step's `apk add openssl` — needed even for
   verify, since the base image has no openssl — pulls a reproducible, previously-tested image rather
   than whatever the tag currently resolves to).
3. If `fullchain.pem` absent → generate self-signed RSA-2048 SAN cert (`DNS:erp.cmcvn.edu.vn,DNS:hoc.cmcvn.edu.vn`, 3650d) into the volume via the same pinned-digest `alpine`+`openssl` container.
4. **Verify (fail-loud):** run `openssl x509 -in fullchain.pem -noout -checkend 0` AND assert both SANs are present. On any failure `echo` an actionable message (`"origin cert missing/invalid in cmcnew-prod_letsencrypt — run scripts/prod-tls-bootstrap.sh for LE, or delete the volume to regenerate self-signed"`) and `exit 1`.
5. Success → `echo` the cert subject + notAfter for the deploy log.

This converts the silent gap into either a self-heal (fresh volume → cert generated) or a loud stop (cert present but corrupt/mismatched → deploy refuses).

### 2. Jenkinsfile deploy stage

Replace the bare `docker volume create cmcnew-prod_letsencrypt` (`Jenkinsfile:51`) with `bash scripts/ensure-origin-cert.sh`. Keep the existing `nginx-prod.conf` sync (lines 52-55) unchanged. Net: deploy self-provisions + verifies the origin cert every run; no VPS pre-bootstrap required for the self-signed path.

Also (folded in from Phase 2's Finding 4 — build-time memory not modeled by resource limits, and
Phase 2 must not become a 3rd independent editor of this already-jointly-owned file): add
`COMPOSE_PARALLEL_LIMIT=1` to the environment of this same stage's `$COMPOSE up -d --build` call, to
bound concurrent image-build memory (api/admin/lms building in parallel while old containers still
serve traffic) — see phase-02's sizing arithmetic for the full rationale.

> **Jenkinsfile joint-ownership note:** Phase 3 also edits `Jenkinsfile`. Author both edits on one branch (or land Phase 1 first, then Phase 3) to avoid a merge conflict.

### 3. `scripts/prod-server-deploy.sh`

Replace inline openssl block (lines 24-29) with `bash scripts/ensure-origin-cert.sh`. Removes the duplication; the full-server manual bootstrap now shares the canonical cert logic.

### 4. `docker-compose.prod.tls.yml` — dormant certbot

The `certbot renew` loop is meaningless for a self-signed 10-year cert. Profile-gate it behind an `le` profile so it only runs when the operator deliberately chooses the LE path:
- add `profiles: ['le']` to the `certbot` service (lines 169-176).
- effect: default deploys (`$COMPOSE up -d --build`, no `--profile le`) skip certbot → one fewer idle container on the 2-vCPU box. `certbot_www` volume + nginx's ro mount stay valid (empty volume is fine).
- update the file header (lines 1-13) to document self-signed as canonical and LE (`--profile le` + `prod-tls-bootstrap.sh`) as the alternate.

### 5. `scripts/prod-tls-bootstrap.sh` — keep, mark alternate

Do NOT delete. Add a header line: "ALTERNATE PATH (not the default). Use only for real Let's Encrypt origin certs / Cloudflare Full (strict). Default is self-signed via scripts/ensure-origin-cert.sh." Legitimate future use: operator wanting genuine LE origin certs without a Cloudflare Origin CA cert. Harmless (manual-only, never auto-invoked).

### 6. Decision record

Create `docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md` from `docs/templates/decision.md` (next free number confirmed = 0029). Record: canonical self-signed choice, CF "Full" trade-off, LE alternate, "Full (strict)" upgrade path. Register with `scripts/bin/harness-cli.exe decision add`. Required because this is a high-risk (TLS/external/prod) change per `docs/FEATURE_INTAKE.md`.

## Files

- CREATE `scripts/ensure-origin-cert.sh`
- MODIFY `Jenkinsfile` (deploy stage cert step, line 51)
- MODIFY `scripts/prod-server-deploy.sh` (lines 24-29 → call helper)
- MODIFY `docker/docker-compose.prod.tls.yml` (certbot `profiles: ['le']` + header)
- MODIFY `scripts/prod-tls-bootstrap.sh` (header comment only)
- CREATE `docs/decisions/0029-canonical-origin-tls-self-signed-behind-cloudflare.md`

## Data flow

Deploy trigger → `ensure-origin-cert.sh` → (volume exists? cert present? SAN ok? notAfter future?) → self-heal OR fail-loud → `$COMPOSE up -d --build` → nginx loads verified cert → Cloudflare "Full" edge.

## Tests / validation

- Unit-ish: run `ensure-origin-cert.sh` against (a) empty volume → cert created + verify passes; (b) pre-existing valid cert → no regen, verify passes; (c) volume with a truncated/garbage `fullchain.pem` → exit 1 with clear message. Test in a scratch docker volume, NOT `cmcnew-prod_letsencrypt`.
- `docker compose -f docker/docker-compose.prod.tls.yml config` parses after certbot profile change.
- Full prod validation deferred to Phase 4 (fresh-volume deploy dry-run).

## Risks / rollback

| Risk | Mitigation |
|------|-----------|
| Verify step too strict, blocks a valid cert | Verify presence + parse + SAN only; no issuer/CN-identity assertion |
| Helper regenerates over a real LE cert | Guard is `if fullchain.pem absent` — never overwrites an existing cert; LE cert (if present) is left intact and passes verify |
| certbot profile change breaks nginx mount | `certbot_www` volume still declared; nginx ro mount to an empty volume is valid |

Rollback: revert the 5 file edits + delete the new script/decision. The `letsencrypt` volume on the VPS is untouched by a revert (cert persists), so reverting cannot break a running stack.

## Done =

Jenkins deploy provisions+verifies the origin cert with zero manual pre-step; corrupt/missing cert stops the deploy loudly; certbot dormant unless `--profile le`; LE path documented as alternate; decision recorded.
