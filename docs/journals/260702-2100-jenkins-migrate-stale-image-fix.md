# Jenkins deploy applied a schema-changing commit's app code before its own migration

**Date**: 2026-07-02 21:00
**Severity**: High (caught before user-facing impact, but a real prod/DB schema mismatch existed briefly)
**Component**: Jenkinsfile (Build + Deploy stage)
**Status**: Resolved

## What Happened

Merging PR #17 (Brevo email transport split, adds `EmailOutbox.transport` column) to `main`
triggered a green Jenkins deploy build. The deployed API health check confirmed the new commit was
live. But `docker exec cmcnew-prod-postgres-1 psql ... '\d email_outbox'` showed no `transport`
column — the migration had not actually applied, even though Jenkins' own migrate step logged
"All migrations have been successfully applied" and, on the actual prod `api-migrate` run,
"45 migrations found in prisma/migrations... No pending migrations to apply" (main has 70).

Any code path touching `EmailOutbox.transport` (enqueue, drain, the backfill script) would have
thrown a Postgres "column does not exist" error the moment it ran, against a live database, for a
feature that ships with the DB migration bundled — a schema/code mismatch that a health check alone
cannot detect.

## Root Cause

`Jenkinsfile`'s `Build + Deploy` stage ran, in order:

```
$COMPOSE --profile migrate run --rm api-migrate      # step A — no --build flag
$COMPOSE up -d --build                                # step B — builds api/admin/lms
```

`docker compose run` (step A, no `--build`) reuses whatever `api` image already exists locally from
the *previous* deploy — it does not detect that the current commit's Dockerfile build context
(including `packages/db/prisma/migrations/`) has new files. So `api-migrate` ran `prisma migrate
deploy` inside a stale image that had never seen the new migration file — reporting (correctly, for
that stale image) "no pending migrations." Step B then rebuilt the api/admin/lms images fresh with
the new commit's code and migration files bundled, and started the app containers running that new
code — but the migration those containers' Prisma Client expects had never actually run against the
database.

This is functionally the same class of bug as
`docs/journals/260630-1535-prod-lost_note-migration-fix.md` (deployment path skipping migrations),
but a subtler variant: this time the migrate step exists and runs, it just runs against the wrong
(stale) image.

## What We Did

1. Confirmed via `docker exec cmcnew-prod-api-1 env | grep APP_COMMIT` that the running api
   container was on the new commit, with the new schema baked into its Prisma Client.
2. Ran `prisma migrate deploy` directly inside that already-rebuilt container (which has the correct
   migration files bundled) against the live database — idempotent, safe. It applied 21 pending
   migrations (`20260630139000_work_shift_tables` through `20260702200510_email_outbox_transport`),
   confirming this staleness gap predates this session and had been silently accumulating.
3. Verified the `transport` column now exists, ran the new backfill script (0 in-flight rows —
   outbox only had already-`sent` history), and re-confirmed prod health.
4. Fixed `Jenkinsfile`: added `--build` to the `api-migrate run` invocation, so the migrate step
   always runs against a freshly-built image bundling the current commit's migrations. The
   subsequent `up -d --build` still runs (cheap, Docker layer-cached after the first build).

## Lessons Learned

1. **`docker compose run` without `--build` silently trusts a possibly-stale cached image** — this
   is not obvious from reading the compose invocation alone; it looks like it "runs the current
   code" but doesn't rebuild unless told to.
2. **A green Jenkins build and a passing health check do not prove the DB schema matches the deployed
   code** — only inspecting `_prisma_migrations` count (or the live table schema) proves that. The
   June 30 incident's own "Next Steps" (a migration-count pre-flight check) would have caught this
   too and is still not implemented — worth prioritizing now that this has recurred in a different
   form.
3. **Every deploy path (`Jenkinsfile`, `scripts/prod-server-deploy.sh`) needs its migrate step
   audited for this exact pattern** — `prod-server-deploy.sh`'s migrate step is safe by different
   means (fresh-VPS bootstrap, no pre-existing image to go stale against), but that's incidental,
   not a designed invariant.

## Next Steps

- [ ] Add a post-deploy assertion (e.g., compare `_prisma_migrations` row count against
  `prisma migrate status`'s expected count) that fails the Jenkins build loudly if they diverge,
  rather than relying on a human noticing a missing column later.
- [ ] Consider whether Compose's `pull_policy`/build-cache behavior should be tightened globally
  (e.g., `--build` on every `run --rm` invocation in the deploy path, not just `api-migrate`) — audit
  `api-seed`'s `run --rm` invocation for the same class of staleness risk.
