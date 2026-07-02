# Phase 04 — MinIO/S3 blob store driver + migration

Status: completed 2026-07-02 for code. VPS/prod cutover deferred to a deploy window (kept on disk driver by default).

Closes gap #4 (PDF store local disk → MinIO/S3, documented DEBT).

## Context links
- `apps/api/src/services/pdf-store.ts` (content-addressed sha256; `PDF_STORE_DIR` default `.data/pdf`; `putPdf`, `pdfExists`, `readPdf`, `PdfStoreError`)
- `apps/api/src/index.ts:59-72,134-149` (upload + serve; GET auth flow via exercise RLS)
- session-photo store (`putSessionPhoto`/`readSessionPhoto`) — parallel store; consider same driver but OUT OF SCOPE unless trivial.
- docker compose stack (prod live hoc.cmcvn.edu.vn)

## Overview
Swap the pdf-store persistence driver from local disk to MinIO/S3, preserving content-addressing (sha256 ref) and the ref format so callers, DB `basePdfRef` values, and the `GET /files/exercise/:ref` auth flow are unchanged. Add a MinIO compose service + env, and migrate existing blobs.

## Key Insights
- Only the DRIVER changes. Actual signatures (pdf-store.ts) MUST stay identical: `putPdf(buffer) → ref`, `readPdf(ref): Promise<Buffer>` (returns a **bare Buffer** — verified at pdf-store.ts:48-54), `pdfExists(ref)`. The S3 driver's `readPdf` must also return a bare `Buffer`. Do NOT add a `contentType` field — it does not exist in this store's return shape. Content-Type is hardcoded `application/pdf` at the call site (index.ts:151) and is out of scope for the driver swap. (The `{buffer, contentType}` shape belongs to the separate `readSessionPhoto` store — do not conflate.)
- Content-addressing preserved: ref = sha256 of content → object key in bucket. Idempotent put (same content = same key = dedup) must survive.
- Auth flow (index.ts:143-146) checks exercise RLS BEFORE existence; keep `pdfExists`→`readPdf` order so a non-entitled principal still cannot probe existence.
- Existing `basePdfRef` values in DB are content hashes — they remain valid keys after migration; no DB change.
- Env-driven driver selection lets dev keep disk, prod use MinIO (or MinIO everywhere via compose). Prefer a single S3-compatible driver + a `PDF_STORE_DRIVER` toggle (disk|s3) to keep local dev friction low (KISS).

## Requirements
- S3-compatible client (MinIO SDK or aws-sdk v3 S3) behind the existing pdf-store interface.
- Env: `PDF_STORE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE` (MinIO needs path-style). Secrets via env only — never committed.
- docker compose: MinIO service + volume + bucket bootstrap (mc or init container).
- One-time migration script: copy existing `.data/pdf/*` blobs into the bucket keyed by their existing ref.
- Serve + upload behavior byte-identical from the client's perspective.

## Architecture
Data flow (serve): GET /files/exercise/:ref → RLS visibility check → `pdfExists(ref)` (S3 HeadObject) → `readPdf(ref)` (S3 GetObject) → stream body. Upload: POST → RBAC (P3) → sha256 → `putPdf` (S3 PutObject, key=hash) → return ref.

Driver abstraction: keep `pdf-store.ts` as the single module; add an internal driver switch. Do NOT create a parallel "pdf-store-v2" file (repo rule: no enhanced/v2 duplicates) — refactor in place.

## Related code files
- Modify: `apps/api/src/services/pdf-store.ts` (add S3 driver, keep interface)
- Modify: docker compose file(s) + env example
- New: migration script (e.g. `scripts/migrate-pdf-blobs-to-s3.ts`) — one-shot
- Read-only: `apps/api/src/index.ts` (must remain unchanged). NOTE: its `/files/exercise/:ref` comment (index.ts:129-133) still describes the old "enrolled-in-class" serving semantics and predates decision 0022 (Exercise now global no-RLS → any authenticated principal). Do not let the stale comment mislead the authz model while swapping the driver; the actual comment fix belongs to Plan 1 (seam-fixes), not this phase.

## Implementation Steps
1. Add S3 client dep (aws-sdk v3 `@aws-sdk/client-s3` or minio). Confirm not already present (npm-live/list).
2. Refactor pdf-store.ts: extract disk impl behind interface; add S3 impl; select by `PDF_STORE_DRIVER`.
3. Add MinIO service + volume + bucket-init to compose; add env vars to example + prod env (secrets out-of-band).
4. Write one-shot migration script: enumerate `.data/pdf`, PutObject each under existing ref key, verify HeadObject, log counts.
5. Dry-run migration against a staging bucket; verify a known exercise PDF serves identically.
6. Confirm session-photo store left as-is (out of scope) OR note follow-up.

## Todo list
- [x] add S3 client dep
- [x] refactor pdf-store.ts with driver toggle (in place)
- [x] compose MinIO service + bucket bootstrap + volume
- [x] env vars + example (no secrets committed)
- [x] migration script + dry-run
- [x] verify serve/upload byte-identical
- [x] decide session-photo follow-up (deferred — flagged as a follow-up, not built)

## Evidence 2026-07-02
- `pnpm --filter @cmc/api typecheck` PASS. Driver interface (`putPdf`/`pdfExists`/`readPdf`/`PdfStoreError`) unchanged; default driver stays `disk`.
- Verified against a real throwaway MinIO container (not the running dev/prod stacks): put→exists→read round-trip, content-addressing dedup (same content → same ref), migration script idempotent on re-run (copy-only, HeadObject-verified).
- Code review fix: dev-compose `minio`/`minio-init` services now gated behind `profiles: ['minio']` (previously would start unconditionally on `docker compose up`, contradicting the "opt-in" comment) — matches the prod-compose pattern.
- Prod compose MinIO section stays behind its own `minio` profile with hard-fail `${VAR:?...}` creds (no default secret); not exposed via published ports.
- Migration script lives at `apps/api/scripts/migrate-pdf-blobs-to-s3.ts` (not repo-root `scripts/`) — pnpm's non-hoisted resolution requires it inside the `@cmc/api` workspace to resolve `@aws-sdk/client-s3`.

## Success Criteria
- Existing PDFs (pre-migration refs) serve correctly from MinIO.
- New uploads land in bucket, dedup by content hash.
- `GET /files/exercise/:ref` auth order unchanged; non-entitled principal still 403 (not 404-leak).
- Dev can still run with disk driver (no MinIO required locally).

## Risk Assessment
- Blob migration data loss / incomplete copy (Med likelihood, HIGH impact): migration is COPY not move; keep `.data/pdf` until verified. Verify object count + spot-check hashes before decommissioning disk.
- MinIO credentials leak (Low/HIGH): env/secret-manager only; never in compose literals committed to git; use compose env_file.
- Existence-probe leak if HeadObject errors differ from disk (Low/Med): normalize S3 NotFound → same `pdfExists=false`; keep auth-before-existence order.
- Prod downtime during cutover (Med/Med): deploy with dual-read (try S3, fall back to disk) OR migrate-then-flip driver env. Prefer migrate → verify → flip `PDF_STORE_DRIVER=s3` → redeploy.

## Security Considerations
- Bucket must be private (no public read); all access proxied through the RLS-checked GET endpoint. Never make the bucket or objects public.
- Rotate/scope MinIO keys; least-privilege bucket policy.

## Rollback
- Set `PDF_STORE_DRIVER=disk` and redeploy → instantly back to disk (blobs still present since migration was copy-only). MinIO service can stay running idle. No DB change to revert (refs unchanged). This is the key reason migration must be copy-not-move.

## Next steps
Independent track. No dependency on P1-P3. Coordinate cutover timing with prod deploy window.
