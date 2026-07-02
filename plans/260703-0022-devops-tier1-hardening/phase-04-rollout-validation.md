# Phase 4 — Staged prod rollout + validation

## Goal

Land all three items on the LIVE VPS in an order that fails safe. No staging exists → every step must be independently reversible and low-blast-radius-first.

## Why order matters

Each item touches live prod. The dangerous failure modes are: (a) a required check enabled before it posts → all PRs blocked; (b) an under-sized memory limit → OOMKill outage; (c) a cert-verify that rejects a valid cert → deploys blocked; (d) a `publishChecks` DSL call with no plugin → pipeline dies. The sequence below defuses each before it can bite.

## Rollout sequence

### Step 0 — Operator pre-flight (before any merge)
1. On VPS: `docker compose -f docker/docker-compose.jenkins.yml up -d --build` → installs `github-checks` plugin. Verify: Jenkins → Manage Plugins shows `github-checks` installed.
2. Verify `github-token` PAT has `repo`/`checks:write` (Phase 3 §2, using the corrected pre-flight command). Fix + reload CASC if missing.
3. **(Finding 10, accepted)** Confirm `deploy.resources` is ACTUALLY enforced on this VPS's installed
   Compose version, not just declared: `docker inspect cmcnew-jenkins --format '{{.HostConfig.Memory}}
   {{.HostConfig.NanoCpus}}'` — must show non-zero values matching `docker-compose.jenkins.yml:36-40`
   (3 GiB / 1.5 CPU). If it shows `0`/empty, the VPS's Compose version predates non-swarm
   `deploy.resources` support — STOP, Phase 2's entire mechanism would silently no-op; upgrade Compose
   before proceeding with Step 4.
4. **(Finding 3, accepted)** Read the ACTUAL live cert's issuer before Phase 1's certbot-profile
   change can be trusted — do not rely on Phase 1's source-only reasoning about which cert type is
   live: `docker run --rm -v cmcnew-prod_letsencrypt:/le alpine sh -c "apk add --no-cache openssl
   >/dev/null; openssl x509 -in /le/live/erp.cmcvn.edu.vn/fullchain.pem -noout -issuer -enddate"`.
   - If issuer shows a real CA (Let's Encrypt) — the live cert is genuinely LE-issued, contradicting
     Phase 1's assumption. Do NOT gate `certbot` behind `profiles: ['le']` as designed; either keep
     `certbot` on by default (renewal must keep running for the real LE cert already deployed), or
     deliberately regenerate a self-signed cert first (accepting a manual cert swap) before disabling
     renewal. Revisit Phase 1 §4 with whichever is chosen.
   - If issuer shows the self-signed CN/SAN pattern from `prod-server-deploy.sh:24-29` — Phase 1's
     assumption holds, proceed as designed.
5. **(Finding 15, accepted)** Confirm the live Cloudflare zone's actual SSL/TLS mode is "Full" (not
   "Full (strict)") via `curl -s https://api.cloudflare.com/client/v4/zones/{id}/settings/ssl` or the
   dashboard — a self-signed cert under "Full (strict)" gets rejected at Cloudflare's edge (Error 526,
   full site outage) the moment `ensure-origin-cert.sh` first regenerates on an empty volume. If it's
   "Full (strict)", either switch the zone to "Full" first, or use a Cloudflare Origin CA cert instead
   of self-signed (Phase 1's documented upgrade path) — do not proceed with self-signed as canonical
   under "Full (strict)".
> Gate: do not proceed until 1-5 are all confirmed. This blocks failure modes (d), the version-support
> gap, and both of Step 3/Step 4's silent-failure risks up front rather than discovering them live.

### Step 1 — Item 3 Jenkinsfile publishChecks (report-only, NO required check yet)
1. **(Finding 8, accepted — resolves a contradiction the original plan text had between this step and
   Step 3)** Merge ONLY the `publishChecks` hunk of the Jenkinsfile (Phase 3 §1) in this step. Do
   **NOT** merge Phase 1's deploy-stage cert-step edit here, even though both touch `Jenkinsfile` —
   Phase 1's edit references `scripts/ensure-origin-cert.sh`, a file that doesn't exist until Step 3.
   Landing both "jointly" here (as the original plan text ambiguously allowed) would deploy a
   Jenkinsfile referencing a nonexistent script and break every subsequent `main` deploy. If authoring
   both phases' Jenkinsfile edits on one branch for convenience, split the commit/merge so ONLY the
   publishChecks hunk lands now; the cert-step hunk waits for Step 3.
2. Open a throwaway PR; confirm the `CMCnew CI` check appears on it and reflects the build result. Record the EXACT context string GitHub shows.
3. Force a red build (e.g. trivial lint error on a scratch branch) → confirm check goes FAILURE. Then green → SUCCESS.
> At this point the check reports but does NOT gate. Lowest blast radius: if publishChecks misbehaves, catchError keeps the pipeline green and nothing is blocked.

### Step 2 — Item 3 branch protection (enable the gate)
1. Run `scripts/setup-github-required-check.sh` with `contexts:["<exact string from Step 1>"]` — the
   corrected GET-first version (Phase 3 §3 Finding 2 fix) prints current protection and requires
   explicit confirmation before applying.
2. Confirm on an open PR: merge blocked while `CMCnew CI` pending/failing, allowed on success.
3. **(Finding 5, runbook note added)** Record in the ops runbook: "if a PR is stuck un-mergeable and
   Jenkins itself shows the build as green/unstable, check `gh api
   repos/manhquydev/CMCnew/commits/<sha>/check-runs` before assuming it's a code problem — the
   catchError-wrapped publishChecks call can fail silently on its COMPLETED call specifically."
> Defuses failure mode (a): the check is already proven to post before it becomes required.

### Step 3 — Item 1 TLS reconciliation (deploy-path change)
1. Merge Phase 1 in full now (helper script `scripts/ensure-origin-cert.sh` + the Jenkinsfile
   deploy-step hunk withheld from Step 1 + `COMPOSE_PARALLEL_LIMIT=1` addition + certbot profile +
   docs/decision) — this is the ONLY step that lands Phase 1's Jenkinsfile edit, resolving Finding 8's
   ambiguity. PR now runs through the Step-2 gate — dogfoods the gate.
2. **Fresh-volume dry-run** on the VPS in a scratch compose project (NOT `cmcnew-prod`): empty volume → `ensure-origin-cert.sh` generates + verifies. Then corrupt the cert → confirm it fails loud. This proves failure mode (c) is fail-safe, not fail-blocking, without touching the live volume.
3. Let the next real `main` deploy exercise the new deploy step against the existing (already-populated) live `letsencrypt` volume — helper sees the cert present, verifies, proceeds. No cert regen on the live volume. **This step's safety now rests on Step 0.4/0.5 having already confirmed which cert type is live and that Cloudflare's mode matches** — do not treat this step as self-verifying that ambiguity, it was resolved earlier.
> Blast radius contained: the live cert already exists, so the helper's happy path is "verify + pass". The risky path (regen) only triggers on an empty volume, which live prod is not.

### Step 4 — Item 2 resource limits (soak, then lock)
1. Merge Phase 2 limits. Deploy in a **low-traffic window** (applying limits recreates containers → brief per-service restart/blip).
2. **(Finding 4, accepted)** During THIS specific deploy (not the later soak), watch host-level memory
   (`free -h` or `htop` in a second SSH session) through the full `$COMPOSE --profile migrate run --rm
   api-migrate` + `$COMPOSE up -d --build` window — this is the build-time spike Phase 2's steady-state
   arithmetic doesn't cover, and it only happens during deploys, not during the later soak.
3. **Soak ≥ 48h** (or one full business cycle): `docker stats` sampling + `docker events --filter event=oom` + `dmesg | grep -i oom`. Watch postgres (under seed/migrate + read load) and api (peak requests) especially.
4. **(Finding 10, accepted)** Additionally, during the same deploy, `docker inspect` the transient
   `api-migrate` container (`docker inspect $(docker ps -aqf name=api-migrate --latest) --format
   '{{.HostConfig.Memory}}'`) to confirm its 768m limit actually attached — `docker compose run --rm`
   applying `deploy.resources` identically to `up` is unverified and this is the only real-world
   confirmation available.
5. If any OOMKilled → raise that ceiling and redeploy; repeat until clean. Only then consider the numbers locked.
> Item 2 goes LAST because it is the only one whose failure is a silent latent outage (OOM under future load) rather than an immediate visible error. Soak-observe before trusting.

## Validation matrix

| Item | Unit / offline | Integration | Live end-to-end |
|------|----------------|-------------|-----------------|
| TLS | `ensure-origin-cert.sh` against scratch volume (empty / valid / corrupt) | `compose config` parses | Fresh-volume dry-run + next real main deploy verifies live cert |
| Limits | `compose config` parses; arithmetic sum < budget | — | 48h `docker stats`/oom-events soak under real load |
| CI gate | — | throwaway PR shows check | red build blocks merge, green unblocks |

## Rollback (per item, independent)

| Item | Rollback |
|------|----------|
| TLS | Revert 5 file edits + delete new script/decision. Live `letsencrypt` volume untouched → running stack unaffected. |
| Limits | Delete `deploy.resources` blocks (+ redis command), redeploy → unlimited. Brief restart blip. |
| CI gate | `gh api --method DELETE .../branches/main/protection` (remove gate) and/or revert Jenkinsfile publishChecks (stop reporting). Independent. |

## Blast-radius summary (what breaks the live site if X goes wrong)

- **TLS wrong** → deploys refuse (fail-safe, site stays on last good stack; `Jenkinsfile:84` already leaves the stack at previous state on failed build). Not a live-site outage.
- **Limits wrong** → OOMKill of a live container = real outage. Highest-severity → last + soaked.
- **CI gate wrong** → PRs blocked (developer friction), NOT a live-site outage; instantly reversible via `gh api DELETE`.

## Docs to update on completion

- `docs/decisions/0029-*.md` (created Phase 1) — mark accepted.
- `docs/system-architecture.md` if it documents the deploy/TLS flow — reflect canonical self-signed + resource limits + CI gate.
- Register the decision + any story via `scripts/bin/harness-cli.exe`.

## Done =

All three items live and validated in the fail-safe order; each has a rehearsed rollback; resource numbers locked after a clean soak; CI gate proven to block a red PR.
