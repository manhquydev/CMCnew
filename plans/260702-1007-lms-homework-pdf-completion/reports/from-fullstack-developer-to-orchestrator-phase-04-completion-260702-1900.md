# Phase 04 completion report — MinIO/S3 blob store driver

## Status: DONE

## Files changed
- `apps/api/src/services/pdf-store.ts` — rewritten in place: extracted disk impl behind an
  internal function pair, added an S3/MinIO impl using `@aws-sdk/client-s3`, driver selected by
  `PDF_STORE_DRIVER` (`disk` default, `s3` opt-in). Public API unchanged: `putPdf(buf): Promise<string>`,
  `pdfExists(ref): Promise<boolean>`, `readPdf(ref): Promise<Buffer>` (bare Buffer), `PdfStoreError`,
  `MAX_PDF_BYTES`. No `pdf-store-v2` duplicate created.
- `apps/api/package.json` — added `@aws-sdk/client-s3@^3.1078.0` (confirmed not previously present
  via `pnpm-lock.yaml` grep before adding).
- `docker/docker-compose.dev.yml` — added `minio` service (port 9000/9001, healthcheck) + `minio-init`
  one-shot bucket-bootstrap service (creates `cmc-pdf-dev`, private) + `cmcnew_miniodata` volume.
  Existing `postgres`/`redis` services untouched.
- `docker/docker-compose.prod.yml` — added `S3_*`/`PDF_STORE_DRIVER`/`PDF_STORE_DIR` env vars to the
  `api` service (all default to empty/`disk`, so behavior is unchanged unless explicitly set), added
  `minio` + `minio-init` services under a `minio` compose profile (idle unless opted in), added
  `miniodata` volume. Existing services (`postgres`, `redis`, `api`, `admin`, `lms`, `nginx`, `api-migrate`,
  `api-seed`) untouched apart from the additive env block.
- `.env.example` — added `PDF_STORE_DRIVER` (default `"disk"`) and `S3_ENDPOINT`/`S3_BUCKET`/
  `S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_REGION`/`S3_FORCE_PATH_STYLE` with dev-friendly defaults; no
  secrets committed (`S3_ACCESS_KEY`/`S3_SECRET_KEY` left empty).
- New: `apps/api/scripts/migrate-pdf-blobs-to-s3.ts` — one-shot migration script. **Note**: placed
  under `apps/api/scripts/`, not repo-root `scripts/` as the phase file's example path suggested.
  Reason: pnpm's strict (non-hoisted) node_modules means a script outside `apps/api` cannot resolve
  `@aws-sdk/client-s3` (an api-only dependency) via ESM import resolution — verified this fails with
  `ERR_MODULE_NOT_FOUND` when run from repo-root `scripts/`. Nesting it under `apps/api/scripts/`
  fixes resolution with no dependency duplication. Run via:
  `pnpm --filter @cmc/api exec tsx scripts/migrate-pdf-blobs-to-s3.ts` (env vars passed directly or via
  `--env-file=../../.env`). Script is COPY-only (verified via HeadObject after each PutObject), skips
  objects that already exist (dedup/idempotent — verified by two consecutive runs, see below), and logs
  copied/skipped/failed counts with non-zero exit on any failure.

## Exact commands run + results
1. `pnpm --filter @cmc/api add @aws-sdk/client-s3` → added cleanly, no peer conflicts.
2. `pnpm --filter @cmc/api typecheck` (`tsc --noEmit`) → **pass, clean**, no errors.
3. Standalone `tsc --noEmit` of `apps/api/scripts/migrate-pdf-blobs-to-s3.ts` with the same compiler
   flags as `tsconfig.base.json` (this file is intentionally outside the `src/**/*.ts` `include` of
   `apps/api/tsconfig.json`, same as the rest of the api project's `rootDir: src` convention) →
   **pass, clean**.
4. Spun up a **throwaway** MinIO container (`docker run --name pdf-migration-test-minio -p 19000:9000
   -p 19001:9001 minio/minio:latest`, distinct name/ports from anything in the repo's compose files)
   and a throwaway `minio/mc` container to bootstrap a private test bucket (`test-pdf-bucket`).
5. Ran a scratch integration test (`apps/api/src/pdf-store-s3-roundtrip-test.ts`, deleted after the run)
   against the throwaway MinIO instance, driving `pdf-store.ts`'s public API directly with
   `PDF_STORE_DRIVER=s3`:
   - `pdfExists` on an unwritten ref → `false`
   - `putPdf` → returns a 64-char hex sha256 ref
   - `pdfExists(ref)` after put → `true`
   - `readPdf(ref)` → returns a bare `Buffer` whose bytes exactly match what was written
   - `putPdf` on **identical content in a fresh buffer** → returns the **same ref** (content-addressing
     dedup holds through the S3 driver)
   - `putPdf` on different content → different ref
   - non-PDF content (no `%PDF-` magic) → rejected with `PdfStoreError`
   - `readPdf` on a nonexistent ref → throws `PdfStoreError` (not a raw S3/AWS SDK error) — confirms
     the auth-caller-facing `try/catch → 404` pattern in `index.ts` still works unchanged
   - Result: **`ALL ASSERTIONS PASSED`**
6. Ran `apps/api/scripts/migrate-pdf-blobs-to-s3.ts` against a scratch local dir containing one fake
   `.pdf` blob (real sha256-named file, `%PDF-` magic) and the same throwaway MinIO/bucket:
   - First run: `copied=1 skipped=0 failed=0` — object confirmed to exist post-write.
   - Second run (same source dir, unchanged): `copied=0 skipped=1 failed=0` — confirms idempotent
     copy-not-move behavior (safe to re-run after a partial failure).
7. Removed the scratch test file (`apps/api/src/pdf-store-s3-roundtrip-test.ts`) and the throwaway
   MinIO container (`docker rm -f pdf-migration-test-minio`) — confirmed removed via
   `docker ps -a --filter name=pdf-migration-test-minio` (empty output).
8. Re-ran `pnpm --filter @cmc/api typecheck` after cleanup → still clean.

## Real MinIO test: yes, ran
A real MinIO instance (throwaway Docker container, not testcontainers — Docker was directly available
in this environment) was used for both the driver round-trip test and the migration-script test. Not
faked; no test was skipped or mocked.

## Confirmation: prod-mirror stack untouched
- Did NOT modify `cmcnew-prod-*` container config or any running compose stack.
- Did NOT run the migration script against `cmcnew-prod-*`'s Postgres/data.
- Did NOT flip `PDF_STORE_DRIVER` on any running container — the prod compose file's new `S3_*`/
  `PDF_STORE_DRIVER` env vars all default to empty/`disk`, so `docker compose up` against the existing
  `.env.production` (which doesn't define these new vars) leaves `api` behavior byte-identical to
  before this change.
- The throwaway MinIO container used distinct name (`pdf-migration-test-minio`) and ports
  (19000/19001, vs. the new dev-compose MinIO's 9000/9001) precisely to avoid any collision with
  running or future services, and was removed at the end.
- Verified via `docker ps -a` before/after that only the throwaway container's lifecycle was affected;
  `cmcnew-prod-lms-1`, `cmcnew-prod-nginx-1`, `cmcnew-prod-api-1`, `cmcnew-prod-admin-1`,
  `cmcnew-prod-postgres-1`, `cmcnew-prod-redis-1` were present before and after, untouched.

## Deviations from the phase spec
- Migration script path: `apps/api/scripts/migrate-pdf-blobs-to-s3.ts` instead of repo-root
  `scripts/migrate-pdf-blobs-to-s3.ts` — see file-changed note above for the pnpm-resolution reason.
  The phase file used "e.g." for this path, so this is within the granted scope, not a contract change.
- Dropped the `dotenv` package from the migration script (would have hit the same repo-root/pnpm
  resolution problem as `@aws-sdk/client-s3` did); documented to use Node's built-in `--env-file` flag
  instead. No functional loss — same env-loading outcome, one fewer dependency.

## Session-photo follow-up
Left `apps/api/src/services/photo-store.ts` untouched, as explicitly out of scope. It is structurally
similar (content-addressed, disk-only) and could reuse the same driver-toggle pattern in a future phase
if/when session-photo blobs also need to move off local disk — noting this as a follow-up, not doing it
here.

## Unresolved questions
None blocking. One open follow-up (non-blocking): should `photo-store.ts` get the same `disk|s3`
toggle in a later phase for storage-backend parity? Deferred to whoever owns that scope.

Status: DONE
Summary: pdf-store.ts now has a disk|s3 driver toggle (interface unchanged), MinIO added to dev/prod
compose (idle by default, private bucket, no public read), env vars documented in .env.example with no
committed secrets, and a copy-only migration script — all verified against a real throwaway MinIO
instance (put→exists→read round-trip + content-addressing dedup + idempotent migration), with a clean
`pnpm --filter @cmc/api typecheck`. The running cmcnew-prod-* stack was not touched.
Concerns/Blockers: none.
