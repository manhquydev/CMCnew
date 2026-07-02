# Phase 4 completion report — transcript/certificate PDF + LMS parent visibility

## Files changed

- **New** `apps/api/src/services/transcript-html.ts` — `renderTranscriptHtml(view)`. Self-contained print-to-PDF HTML (Georgia serif, print CSS), visually matching `certificate-html.ts`'s style. Not literally sharing code with `certificate-html.ts` (that file is outside this phase's file-ownership list, so it was read-only), but same KISS approach: no PDF library, browser print.
- `apps/api/src/index.ts`:
  - New route `GET /files/transcript/:studentId` — LMS-only (parent/student). Ownership check: `lms.studentIds.includes(studentId)` before any query. Data read under `lmsRlsContextOf(lms)` — `final_grade`/`qualitative_assessment`/`student`/`facility` RLS already support parent/student ownership (`student_id ∈ app.student_ids`), verified from migration `20260623100000_principal_aware_rls` and `20260623045316_rls_tenancy`, so no bypass context needed here.
  - `GET /files/certificate/:id` — generalized with an authz branch, staff path byte-for-byte unchanged. New LMS branch: `certificate` table's RLS is staff-only (`principal_kind='staff'`, migration `20260623182722_phase5_certificate`), so the LMS branch reads under a local `SYSTEM_RLS` bypass context and enforces ownership explicitly in code (`cert.studentId` must be in `lms.studentIds`) — mirrors the existing `submission.layerForGuardian` / `leaderboard.forStudent` pattern already in the codebase.
- `apps/api/src/routers/certificate.ts` — added `forStudent` (lmsProcedure): lists an owned student's certificates for the LMS UI to link download buttons. Ownership checked against `ctx.lms.studentIds` before a `SYSTEM_RLS`-bypassed read (same reasoning as the HTTP route above).
- `apps/lms/src/parent-view.tsx` — gradebook tab only (did not touch `sessions` tab / `DrawnWorkModal`): added a "Tải học bạ (PDF)" button opening `${API_URL}/files/transcript/${childId}`, and a new `CertificatesCard` component listing certificates with per-row "Tải PDF" buttons opening `${API_URL}/files/certificate/${cert.id}`.
- **New** `apps/api/test/transcript-certificate-lms-access.int.test.ts` — 7 integration tests against the real dev DB (no mocks), via `app.request()`.

## Scope decisions

- No schema change, no migration.
- Did not gate on lifecycle status (`completed` students keep access) — out of scope per the plan; that's P5's job on different files.
- Certificate route generalization kept the staff branch's query/response shape identical; only added the `else` branch and widened the `!staff && !lms` guard.

## Tests

- `pnpm --filter @cmc/api typecheck` — clean.
- `pnpm --filter @cmc/lms typecheck` — clean.
- New int test file, 7/7 passing:
  - transcript: parent fetches own child (200, HTML contains student name) / other family child (403 IDOR) / unauthenticated (401).
  - certificate: parent fetches own child's cert (200) / other family parent (403 IDOR) / staff path unchanged (200) / unauthenticated (401).
- Spot-checked no regression: `submission-guardian-layer.int.test.ts`, `level-progress-authz.int.test.ts`, `upload-exercise-pdf-rbac.int.test.ts` — all still passing.
- Manual print-to-PDF Vietnamese rendering not verified in a browser this session (no UI harness run) — same font/CSS approach as the already-shipped certificate route, low risk per the plan's own risk assessment.

Status: DONE
Summary: Added `renderTranscriptHtml`, LMS-authorized `/files/transcript/:studentId` + generalized `/files/certificate/:id` (staff unchanged, new LMS ownership-checked branch), a `certificate.forStudent` lmsProcedure, and parent-view gradebook-tab download buttons; IDOR ownership checks verified by 7 passing integration tests, both apps typecheck clean.
Concerns/Blockers: None. One unresolved note — manual Vietnamese print-to-PDF rendering in an actual browser was not performed (no dev UI session run); recommend a quick manual check before considering this fully validated end-to-end.
