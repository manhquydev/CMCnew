# DEBT — deliberate gate-skips (a loan, written down)

Date: 2026-07-02

This file records backend-ready or identified gaps intentionally left out of shipped work.
Each open item is a loan: it names what was skipped, the residual exposure, and when it must be
repaid. Do not delete an open item to "clean up" — close it (mark paid) with evidence, or it is
still owed.

## Storage / durability

- [ ] DEBT: MinIO content-addressed object store (spec §3) deferred; S1.7 uses local-disk content-addressed PDF store behind the storage driver -- Dev-only: exercise PDFs live on the API host's local data dir, not a durable/replicated object store -- close before: Before production go-live: swap driver to MinIO/S3, move bucket creds to secrets -- opened 2026-06-23
  - PARTIALLY PAID 2026-06-23: per-principal access check on the file serve endpoint is DONE — `/files/exercise/:ref` authorizes before serving. NOTE (2026-07-02): with the global-asset decision 0022, exercise RLS is disabled so that endpoint now serves any non-archived exercise PDF to any authenticated principal (no PII in worksheets — accepted). Remaining: durable object store + secrets.

- [ ] DEBT: PDF/photo blob store is local-disk only, not captured by any backup -- `.data/pdf` (exercise PDFs) and `.data/session-photos` (check-in photos) live on the API host's local data dir; no backup/replication covers them, so a host-disk loss loses all uploaded worksheets and check-in evidence -- close before: production go-live: back these into the durable object store (folds into the MinIO/S3 migration above) or add a scheduled off-host backup of `.data/*` -- opened 2026-07-02

- [ ] DEBT: Receipt render is print-to-PDF HTML, not a server-generated PDF -- `/files/receipt/:id` returns styled Vietnamese HTML (browser Ctrl+P → Save as PDF); a true server PDF (pdf-lib) needs an embedded Unicode font for Vietnamese diacritics -- close before: if a non-interactive/archival PDF artifact is required, embed a TTF via @pdf-lib/fontkit -- opened 2026-06-24

## CI/CD

- [ ] DEBT: CI/CD chưa chạy tự động — GitHub Actions bị chặn do billing tài khoản (repo private). Quyết định chủ dự án (2026-06-24): **dựng CI/CD bằng Jenkins (sau)**. `.github/workflows/ci.yml` giữ làm tham chiếu pipeline (self-contained: Postgres service + env ci-only). Tới khi có Jenkins: verify = chạy local pipeline (`pnpm db:up` → migrate → seed → verify-rls → `pnpm -r typecheck` → `pnpm -r test` → `pnpm --filter @cmc/api test:int` → `pnpm -r build`). -- close before: stand up Jenkins pipeline chạy chuỗi này trên mỗi PR -- opened 2026-06-24
  - PARTIALLY PAID 2026-07-02 (ops-hardening Plan 7 P3): Jenkins integration-test gate now runs on PRs too (`changeRequest()`), not just `main` — a red int-test blocks merge. Remaining: e2e-on-PR (see below), broader unit coverage.

- [ ] DEBT: e2e tests run only post-deploy smoke on `main`, not per-PR — real e2e (`apps/e2e`) needs a running full stack; wiring that per-PR is a bigger lift than the int-test gate and coverage is currently ~1 e2e file. Deferred (YAGNI) per ops-hardening Plan 7 P3 assessment. -- close before: when e2e coverage grows enough to justify the per-PR stack cost, or a lighter-weight e2e harness is adopted -- opened 2026-07-02

- [ ] DEBT: unit-test coverage gap — the repo leans on integration tests (RLS/tenancy/business-flow) with comparatively thin unit coverage of pure logic (domain-* calc functions, small helpers). Not blocking (integration tests catch regressions in the paths that matter most), but slows isolating a failure to one function. -- close before: no hard gate; grow unit coverage opportunistically alongside touched modules -- opened 2026-07-02 (ops-hardening Plan 7 P5)

- [ ] DEBT: backups (`scripts/backup-db.sh`) write to local disk on the VPS only — no off-box copy (rsync/S3/object-store replication). A VPS-level disk loss loses both the live data and every local backup simultaneously. -- close before: production go-live hardening pass: add a cron step (or object-store sync) that copies `./backups/*` off the VPS after each run -- opened 2026-07-02 (ops-hardening Plan 7 P2)

- [ ] DEBT: `apps/e2e` cannot statically import `@cmc/auth`/`@cmc/db` for direct-session-injection specs — `apps/e2e/package.json` has no `"type": "module"`, so Playwright's default CJS transform breaks on `import.meta` inside `packages/db/src/seed-curriculum.ts` (both packages are ESM-only). Blocks `apps/e2e/tests/work-shift-manual-punch-approval.spec.ts` (pre-existing) and `admin-monthly-report-drilldown.spec.ts` (Plan 3 E2E gap-fill, 2026-07-02) from running live; both are syntactically correct and logic-reviewed, just unexecuted. Attempted fix (adding `"type": "module"` to `apps/e2e/package.json`) surfaced a deeper Node-ESM workspace-resolution break (`Cannot find package '@cmc/auth'`) — reverted rather than chase it under time pressure. -- close before: someone with `apps/e2e` + `packages/db` in scope investigates the ESM/CJS boundary properly (likely needs a Playwright-specific module resolver config, not just a package.json flag) -- opened 2026-07-02

- [ ] DEBT: Plan 3's onboarding→SSO-login E2E flow has no feasible Playwright coverage — SSO login is an external IdP redirect with no mock IdP in this repo. `admin-create-staff.spec.ts` covers the onboarding-form half only. Accepted as a permanent gap, not deferred work, unless a mock IdP gets built for other reasons. -- close before: n/a (accepted gap) -- opened 2026-07-02

## Backend-Ready UI Gaps

- Web-lead inbox: public/integrated lead intake queue remains unbuilt; CRM still relies on
  direct contact/opportunity creation and current public ingest path. Close when website/ad
  leads need an operator-reviewed inbox before entering the pipeline.
- Callio sync: phone/call-center integration remains unbuilt; CRM contact/opportunity phones
  are local records only. Close before relying on call logs for sales ops attribution.
- Badge administration: backend exists for badge/star mechanics; admin CRUD/review UI remains deferred.
- Shift registration withdraw/cancel: shift registration flow supports submit/approve paths; employee withdraw UX remains deferred.
- Room update/archive: room creation/listing is wired; edit/archive UI remains deferred.
- Facility network update/archive: network list/create exists; full management UX remains deferred.

## Security / Identity

- [ ] DEBT: Column-level encryption for HR sensitive fields (`nationalId`, `bankAccount`) deferred by decision 0026 -- values are currently stored plaintext and masked server-side for non-privileged readers; audit logs record field names only, not raw values -- close before: real production rebuild or when these fields become required operational data -- opened 2026-07-02 (Plan 3 P6)
- [ ] DEBT: Microsoft Graph provisioning ADR 0015 remains Proposed-only -- staff onboarding is SSO-only by email, but automatic M365 provisioning/sync is not implemented -- close before: production identity cutover where account creation must be automated -- opened 2026-07-02 (Plan 3 P6)

## Cleanup Follow-Up

- Replace the centralized shallow tRPC boundary in `apps/admin/src/shallow-trpc.ts` with direct typed calls after router output types are simplified enough to avoid TS2589.
- Add focused integration coverage for payroll director domain write guards beyond permission snapshots.
- Add the two missing C2 negative int tests (session-not-yet-ended denial + cross-class not-enrolled denial) to `lms-security-invariants.int.test.ts`.
- Verify production LMS bundle behavior around `/showcase` during the next build/deploy review.

## Accepted (recorded, not owed)

- [x] ACCEPTED (security-class, approved by operator 2026-06-24): identity tables `parent_account` / `student_account` opened from super_admin-only to any-staff read/write at the RLS layer (parents/students still excluded). Facilities are linked branches, not silos — these are system-wide identities (docs/specs/facility-model-decision.md). Residual exposure: any staff DB query can read parent/student contact rows; mitigated by (a) router role-gate (guardian mgmt = bgd/quan_ly/super only) and (b) every select excludes passwordHash/login secrets. Verified live: quan_ly (non-super) reads cross-facility parents; giao_vien → FORBIDDEN.

- [x] ACCEPTED (2026-07-02, decision 0022): exercise PDFs served to any authenticated principal via `/files/exercise/:ref` (exercise RLS disabled, global curriculum asset). Residual exposure: a logged-in principal can fetch any non-archived exercise PDF including drafts/closed by ref. Accepted: worksheets carry no PII; only gate is authentication.

- [x] DROPPED 2026-06-24 (operator decision): Chat CSKH (AI chatbot via Gemini) removed from roadmap — never built; the `cskh` role + Odoo-style `chatter` activity log stay (unrelated). No code to remove.

- [x] CLOSED (Plan 3 role-flows Decision B — RBAC role consolidation): payroll domain read/list surfaces stay facility-wide for the 2 directors; only writes (approve/confirm) are domain-scoped. This is intentional executive visibility, not a gap — see `[[rbac-role-consolidation-decision]]` memory / Plan 3 permission tests.

## Unresolved Questions

- (none open — payroll director-read visibility resolved above, closed)
