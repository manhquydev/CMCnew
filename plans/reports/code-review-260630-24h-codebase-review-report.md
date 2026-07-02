# 24h Codebase Review — 2026-06-30

Scope: commits from `95d69d9..HEAD` plus current worktree. 161 files, 11262 insertions, 589 deletions. Harness intake #40. Branch `develop`.

## Findings

### Fixed — CI integration stage did not run tests

- Severity: Critical
- Evidence: `scripts/ci-integration-tests.sh:32` called `pnpm --filter @cmc/api test:integration`, but `apps/api/package.json` only had `test:int`.
- Repro: `pnpm --filter @cmc/api test:integration` printed `None of the selected packages has a "test:integration" script` and exited 0.
- Impact: Jenkins main integration stage could pass while running zero API integration tests.
- Fix: added `test:integration` alias in `apps/api/package.json`.
- Proof: `pnpm --filter @cmc/api test:integration -- --help` now invokes Vitest with `vitest.integration.config.ts`.

### Fixed — user guide verifier crashed on scalar orphan list

- Severity: Important
- Evidence: `scripts/verify-user-guides.ps1` failed at line 79: `.Count` missing when `$orphanFiles` collapsed to scalar.
- Impact: guide validation proof was unavailable even when assets were valid.
- Fix: wrapped `$assetRefs`, `$assetFileNames`, and `$orphanFiles` in array expressions.
- Proof: `.\scripts\verify-user-guides.ps1` now returns `user-guides-ok`.

### Improved — CRM permission invariants did not name new endpoints

- Severity: Medium
- Evidence: `permission-snapshot.json` covered `crm.opportunityGet` and `crm.assignableOwners`, but named tests still described ctv_mkt as only `opportunityList/opportunityCreate`, and KD "full CRM access" omitted new CRM read/reassign/history endpoints.
- Impact: future permission drift could still pass parity but leave product-intent tests stale.
- Fix: expanded `apps/api/test/permission-parity.test.ts` named invariants.
- Proof: `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` => 25/25 pass.

### Open — `ci.cmcvn.edu.vn` cert mode depends on Cloudflare config

- Severity: Medium
- Evidence: `docker/nginx-prod.conf:127-136` adds a CI vhost using `/etc/letsencrypt/live/erp.cmcvn.edu.vn/*`; bootstrap comments at `docker/nginx-prod.conf:9-13` only request `erp.cmcvn.edu.vn` and `hoc.cmcvn.edu.vn`.
- Impact: OK if Cloudflare is intentionally `Full`; fails if `Full (strict)` or origin is accessed directly because origin cert SAN does not include `ci.cmcvn.edu.vn`.
- Recommendation: either document required Cloudflare mode or include `-d ci.cmcvn.edu.vn` in the origin cert lifecycle.

### Open — API lint has one warning

- Severity: Low
- Evidence: `pnpm --filter @cmc/api lint` exits 0 but warns `apps/api/src/lib/emit-staff-notif.ts:32:55 no-empty-function`.
- Impact: not blocking, but keeps lint output noisy and weakens signal.

### Open — admin bundle size warning

- Severity: Low
- Evidence: `pnpm --filter @cmc/admin build` passes but main JS chunk is about 1.4 MB minified.
- Impact: not a correctness failure; should be tracked before ERP app grows much more.

## Areas Reviewed

- CI/CD: `Jenkinsfile`, `scripts/ci-integration-tests.sh`, Jenkins compose/CASC, prod nginx, API health marker.
- API/authz: CRM endpoints, permission registry + snapshot, audit timeline gates, user profile update, rewards pending/review.
- Admin frontend: BrowserRouter migration, CRM record page, link-preview metadata, DataTable row-click, staff profile/activity log, reusable UI primitives.
- Harness/docs: CK workflow docs, Harness smoke, guide verifier, recent story matrix.

## Verification

- `npx gitnexus analyze` — pass, index refreshed to 3596 nodes / 5752 edges / 160 flows.
- `mcp gitnexus detect_changes --scope all` — low risk for initial worktree; after fixes, expected files changed.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` — pass, 25 tests.
- `pnpm --filter @cmc/api test:integration -- --help` — pass, alias now resolves to Vitest integration config.
- `pnpm --filter @cmc/api typecheck` — pass.
- `pnpm --filter @cmc/admin typecheck` — pass.
- `pnpm --filter @cmc/admin build` — pass, chunk-size warning.
- `pnpm --filter @cmc/admin lint` — pass.
- `pnpm --filter @cmc/api lint` — pass with 1 warning.
- `pnpm --filter @cmc/auth typecheck` — pass.
- `pnpm --filter @cmc/ui typecheck` — pass.
- `pnpm --filter @cmc/ui lint` — pass.
- `.\scripts\verify-harness.ps1` — pass, 15/15.
- `.\scripts\verify-ck-docs.ps1` — pass, 67 skill refs.
- `.\scripts\verify-user-guides.ps1` — pass.
- `.\scripts\bin\harness-cli.exe audit` — entropy 20/100; orphaned planned stories: `CRM-SALESOPS`, `REWARD-PANEL-UI`.
- `git diff --check` — pass; CRLF warnings only.

## Not Run

- Full `scripts/ci-integration-tests.sh` locally. It is Jenkins/Linux/Docker-oriented and depends on `$WORKSPACE` path semantics. The broken script-name gate was reproduced directly and fixed; full DB integration should run in Jenkins after merge.
- Browser QC. Existing reports cover CRM path routing; this pass focused code + build + verifier evidence.

## Unresolved Questions

1. Is Cloudflare for `ci.cmcvn.edu.vn` intentionally set to Full, not Full Strict?
2. Should `scripts/ci-integration-tests.sh` be made locally runnable on Windows, or remain Jenkins-only?
3. Should the existing API lint warning be fixed now or tracked as backlog?
