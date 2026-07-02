# Phase 2 — Prod Docker resource limits

## Goal

Bound every prod service so a single runaway container cannot exhaust the 7.8 GiB (no swap) box and trigger the host OOMKiller against a critical service.

## Context / verified facts

- `docker-compose.prod.tls.yml` — none of its services declare `deploy.resources` (confirmed by full read; grep for `deploy:`/`resources:` = 0 hits).
- Services: `postgres`, `redis`, `api`, `api-migrate` (profile `migrate`, `restart: no`), `api-seed` (profile `seed`, `restart: no`), `admin`, `lms`, `nginx`, `certbot` (→ profile `le` after Phase 1).
- Only limited service today: `docker-compose.jenkins.yml:36-40` → jenkins `limits: cpus 1.5 / memory 3g`.
- Box: **2 vCPU, 7.8 GiB total, ~5.4 GiB free at idle, no swap.** Idle usage: Jenkins 1.33 GiB, api ~109 MiB, postgres ~46 MiB (from `brainstorm-260703-0044...report.md:30-46`).
- Postgres runs stock `postgres:16-alpine`, no `command:`/`postgresql.conf` override. **Correction
  (Finding 13, accepted — the original claim was factually wrong, verified empirically by 2 red-team
  reviewers):** the stock image does NOT auto-scale `shared_buffers`/`max_connections` off
  container-visible memory — it ships fixed `initdb` defaults (`shared_buffers=128MB`,
  `max_connections=100`) regardless of any `--memory` limit. The sizing numbers below are still safe
  (real footprint is smaller than assumed, so there's more headroom than the wrong rationale implied),
  but the ceiling is a safety cap, not a tuning target — most of the 1g ceiling is unused headroom,
  not usable cache, unless a future pass adds an explicit `command:`/`postgresql.conf` override.
- Failure asymmetry: **memory limit breach = OOMKilled (hard kill); CPU limit = throttled (soft, no kill).** → memory ceilings must be generous enough not to kill a healthy service; CPU ceilings can be tighter since they only slow, never kill.

## Sizing arithmetic (do NOT copy research's 4vCPU/8GB numbers)

Research baseline was for a 4vCPU/8GB box (postgres 2 GiB, api 1 GiB). This box is smaller AND already gives Jenkins up to 3 GiB / 1.5 CPU. Budget:

```
Total RAM ...................... 7.8 GiB
- OS + docker daemon ........... ~0.8 GiB (reserve, unallocated)
- Jenkins worst case ........... 3.0 GiB (existing cap)
= left for app stack ........... ~4.0 GiB  (only when Jenkins is at full tilt, e.g. during a deploy build)
```

Memory `limits` are ceilings, not reservations — real idle usage is far below (api 109 MiB, pg 46 MiB). Size ceilings so the **steady-state sum ≤ ~2.8 GiB**, leaving margin under the ~4 GiB app budget even with Jenkins spiking.

**Critical correction (Finding 4, accepted — flagged independently by 2 red-team reviewers from
different angles):** the budget above only covers steady-state **runtime containers**. It is entirely
blind to the memory consumed by `docker build`/BuildKit itself, which is NOT governed by
`deploy.resources` at all (that key only bounds the resulting container, not the build process that
produces its image). Two distinct places in the deploy sequence hit this gap:

1. **`Jenkinsfile:58` runs `$COMPOSE up -d --build` on every `main` merge** — Compose v2 parallelizes
   builds by default, so `api` (full-workspace `pnpm install --frozen-lockfile` + `prisma generate`),
   `admin`, and `lms` (Vite/esbuild bundling — commonly 500 MB–1.5 GB peak per process) can all build
   **concurrently, while the OLD containers are still live and serving traffic** (Compose only
   stops/recreates a service after its new image finishes building).
2. **`Jenkinsfile:47` runs `$COMPOSE --profile migrate run --rm api-migrate` BEFORE the `--build`
   step** — this forces the `api` image's build to happen here too if the image is stale, stacking
   directly on top of `postgres`+`redis` already running.

Real worst case: old steady-state stack (~2.64 GiB) + Jenkins (up to 3 GiB) + OS (~0.8 GiB) +
**3 concurrent unbounded build processes** (host-level, not cgroup-bound) — the claimed 1.4 GiB
headroom can vanish entirely during the few minutes of every deploy's build window, triggering a
**host-level OOMKiller** (which can kill ANY process — Postgres, the Jenkins JVM, not just the
offending build) rather than a contained per-container OOMKill.

**Fix, applied to this phase's scope (not deferred):**
- Document this build-time window explicitly as a SEPARATE risk bucket from steady-state (added to
  the Risks table below) — the steady-state arithmetic above is still correct for its stated purpose,
  it just isn't the whole picture.
- Reduce build concurrency to bound the spike: add `COMPOSE_PARALLEL_LIMIT=1` to the environment of
  the Jenkinsfile's existing `$COMPOSE up -d --build` invocation — mechanical, cheap, directly reduces
  the worst-case concurrent-build memory by roughly 3x for a small build-time-duration cost. **Do NOT
  add this as a new Phase 2 edit to `Jenkinsfile`** (that file is already jointly owned by Phase 1
  and Phase 3 — see plan.md's file-ownership note; a 3rd independent editor raises the same
  merge-conflict risk Finding 1 already flagged for cross-plan collisions). Instead, this one-line env
  addition is folded into **Phase 1's existing deploy-stage Jenkinsfile hunk** (Phase 1 already
  touches the same `$COMPOSE up -d --build` line for the cert step) — see phase-01's Design §2.
- Phase 4's soak (§Step 4) must explicitly sample host-level (not just container-level) memory
  DURING an actual deploy's build window, not just the post-deploy steady-state — see phase-04 update.

### Proposed limits

| Service | mem limit | mem reservation | cpu limit | cpu resv | Rationale |
|---------|-----------|-----------------|-----------|----------|-----------|
| postgres | 1g | 512m | 0.75 | 0.25 | Half the research's 2g; idle 46 MiB, 1g covers connections+cache on stock config. OOM-sensitive → reservation floor. |
| api (Node) | 1g | 384m | 0.75 | 0.25 | Idle 109 MiB; Node under load is the other OOM-sensitive service → generous 1g ceiling + reservation. |
| redis | 256m | — | 0.25 | — | **Correction (Finding 11, accepted):** `apps/api/src/rate-limit.ts` confirms redis is currently entirely UNUSED — the API's rate limiter is in-process (`Map`-based), and its own code comment calls `REDIS_URL` "declared-but-unused." The 200mb/allkeys-lru numbers below are a placeholder ceiling, not tuned against real session/cache traffic (there is none yet). Set `--maxmemory 200mb --maxmemory-policy allkeys-lru` via `command:` so redis self-evicts before the cgroup OOMKills it once it IS wired up — but this ceiling MUST be re-reviewed against real traffic patterns the first time redis is actually connected (link this note to `rate-limit.ts`'s comment as the trigger), not treated as "tuned-and-locked" by this phase's soak. |
| nginx | 128m | 32m | 0.25 | — | Reverse proxy, tiny. |
| admin | 128m | — | 0.25 | — | Static SPA server (built image), tiny runtime. |
| lms | 128m | — | 0.25 | — | Static SPA server, tiny runtime. |
| certbot | 128m | — | 0.25 | — | Sleep-loop (and dormant under `le` profile post-Phase 1). |
| api-migrate | 768m | — | 0.5 | — | One-shot (`restart: no`), runs before main api is up → has headroom; prisma migrate is moderate. |
| api-seed | 768m | — | 0.5 | — | One-shot, transient, runs isolated. |

**Steady-state mem ceiling sum** (excludes one-shot migrate/seed, excludes dormant certbot): `postgres 1g + api 1g + redis 256m + nginx 128m + admin 128m + lms 128m = 2.64 GiB`. Under the ~4 GiB app budget → OK with Jenkins at 3 GiB + OS 0.8 GiB ≈ **6.4 GiB worst case, ~1.4 GiB headroom.** ✅

**CPU:** app cpu-limit sum = 3.0 vs 2 physical cores → intentional oversubscription. Fine: limits only bite under contention and no single service can monopolize; idle services don't consume their ceiling. Jenkins's 1.5 leaves ~0.5 core for the app during a build — acceptable because app steady-state CPU is near-idle and CPU is throttled (not killed).

### Compose v2 reservation caveat (document, don't over-rely)

`docker compose up` (v2, non-swarm) reliably applies `limits` (`--memory`, `--cpus`) — this was
empirically verified by 2 red-team reviewers running a real Compose v5.1.4 test (`deploy.resources`
correctly mapped to `HostConfig.Memory`/`NanoCpus`/`MemoryReservation`; `reservations.cpus` confirmed
a genuine no-op, matching this document's existing caveat). `reservations.memory` maps to
`--memory-reservation` (soft). **`reservations.cpus` may be a no-op outside Swarm.** → treat
reservations as best-effort OOM-priority hints on postgres/api only; correctness relies on `limits`.
Do not add cpu reservations expecting hard enforcement.

**Two verification gaps found by red-team (Finding 10, accepted — merged from 2 independent
angles), neither fixable from the repo alone:**
1. The empirical test above used `docker compose up`. **`api-migrate`/`api-seed` use `docker compose
   run --rm`** (`Jenkinsfile:47`), not `up` — whether `run --rm` applies `deploy.resources.limits`
   identically to `up` is UNVERIFIED (Compose CLI behavior has differed across minor versions
   historically). If it doesn't, the 768m ceiling on these two services silently doesn't bind.
2. The plan's only "proof this pattern works in prod" is that Jenkins already has `deploy.resources`
   declared (`docker-compose.jenkins.yml:36-40`) — but nobody has confirmed the VPS's actual installed
   Compose version enforces it there either; a stale/old Compose release predating non-swarm
   `deploy.resources` support would mean all 9 new blocks parse cleanly (`compose config` succeeds)
   while providing zero actual protection — a config that LOOKS correct but does nothing.

Both gaps require a live-VPS check, added as a mandatory Phase 4 pre-flight (see phase-04 §Step 0)
BEFORE trusting this mechanism for the other 8 services: `docker inspect cmcnew-jenkins --format
'{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}'` (confirms the EXISTING Jenkins limit is actually
enforced, not just declared) and, after Phase 2 lands, `docker inspect` the transient `api-migrate`
container during a real deploy's `run --rm` invocation to confirm its limit attached too.

## Files

- MODIFY `docker/docker-compose.prod.tls.yml` — add a `deploy.resources` block per service (9 blocks); add `command:` maxmemory to `redis`.

Region-disjoint from Phase 1's edits to the same file (Phase 1 = certbot service + header). Land Phase 1 first if parallel-authored.

## Tests / validation

- `docker compose -f docker/docker-compose.prod.tls.yml config` parses.
- Full validation is a Phase 4 soak: deploy limits, run `docker stats` + `docker events --filter event=oom` across a real-traffic window, confirm no OOMKilled and headroom holds. **Do not lock numbers until observed.**
- Explicitly watch: postgres under a seed/migrate + concurrent read load, and api under peak request load — the two 1g services most likely to need tune-up.

## Risks / rollback

| Risk | L×I | Mitigation |
|------|-----|-----------|
| api/postgres 1g too low → OOMKill → outage | Med×High | Soak-observe before locking; tune ceiling up on first OOM event; apply in low-traffic window |
| **Correction (Finding 14, accepted):** not just 1 but THREE unbounded CI containers can run concurrently on this box, none capped: (a) `Jenkinsfile:26` node:22-alpine for Lint+Typecheck, (b) a second node:22-alpine inside `scripts/ci-integration-tests.sh` (its own `pnpm install`+`prisma generate`/`migrate`), (c) a full ephemeral `postgres:16-alpine` bound to host port 55432 for integration tests. `disableConcurrentBuilds()` only prevents same-branch concurrency, NOT a PR build running alongside a `main` deploy (distinct multibranch jobs) — so a PR opened during a `main` deploy can stack all 3 of these on top of the just-bounded prod stack + Jenkins. | Med×Med | Out of scope to FIX in this phase (these are CI-invocation `docker run` calls, not part of the compose stack this phase modifies) — but now flagged accurately (3 containers, not 1) as a follow-up. Cheapest fix when picked up: add `--memory`/`--cpus` flags to the 3 `docker run` invocations in `Jenkinsfile`/`ci-integration-tests.sh` — a few lines, not new scope, deferred only because it's a different file surface (CI script, not prod compose) than this phase's stated boundary. |
| redis maxmemory too low → cache evictions/session loss | Low×Med | 200mb generous for session use; monitor eviction stats |

Rollback: delete the `deploy.resources` blocks (+ redis `command:`) and redeploy — instant return to unlimited. Applying/removing limits recreates containers → a brief per-service restart (nginx/api blip); schedule in low-traffic window.

## Done =

All 8 (+certbot) services bounded; steady-state ceiling sum < app budget with headroom; a Phase-4 soak shows zero OOMKilled under normal load; numbers tuned-and-locked (not guessed-and-shipped).
