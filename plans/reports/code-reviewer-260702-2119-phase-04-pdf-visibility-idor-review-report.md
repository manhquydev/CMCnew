# Phase 04 PDF visibility — IDOR-focused review

**Verdict: PASS.** No blocking findings. Ownership checks genuinely gate data access in every path reviewed; tests and typechecks pass.

## Scope
- `apps/api/src/services/transcript-html.ts` (new)
- `apps/api/src/index.ts` — `/files/transcript/:studentId` (new), `/files/certificate/:id` (generalized)
- `apps/api/src/routers/certificate.ts` — `forStudent` (new)
- `apps/lms/src/parent-view.tsx` — gradebook tab additions
- `apps/api/test/transcript-certificate-lms-access.int.test.ts` (new)

## Verified against spec (`plans/260702-1109-academic-ops/phase-04-pdf-visibility.md`)

**(a) `/files/transcript/:studentId` ownership order** — `index.ts:281-284`: `resolveLmsSession` → `if (!lms.studentIds.includes(studentId)) return c.text('forbidden', 403)` executes **before** `withRls(lmsRlsContextOf(lms), ...)` is even called. No query runs before the check. Confirmed real gate, not cosmetic.

**(b) `/files/certificate/:id` generalization**
- (i) Staff branch byte-diffed against `git show HEAD:apps/api/src/index.ts` — logic identical (`withRls(rlsContextOf(staff), ...)`, same select shape), only wrapped in a ternary. Confirmed unchanged.
- (ii) LMS branch (`index.ts:250-256`): ownership check `!lms!.studentIds.includes(cert.studentId)` happens inside the `SYSTEM_RLS` (bypass) callback but **before** any further reads (student/facility lookups) and before the result is returned/used — `cert` is fetched, checked, and only on pass do the student/facility queries run. Confirmed check precedes use.
- (iii) Branch selection is `staff ? withRls(rlsContextOf(staff), ...) : withRls(SYSTEM_RLS, ...)` — mutually exclusive by construction (`staff` is only non-null via staff cookie/session; LMS branch only reachable when `!staff`). No path lets an LMS caller hit the staff branch's RLS-only assumption or vice versa.

**(c) `certificate.forStudent`** — `certificate.ts:14-18`: `if (!ctx.lms.studentIds.includes(input.studentId)) throw FORBIDDEN` runs before `withRls(SYSTEM_RLS, ...)`. Same pattern, correct order.

**(d) Data scoping inside the payload** — `transcript-html.ts` `renderTranscriptHtml` only receives `finalGrades`/`qualitative` fetched via `where: { studentId }` (index.ts:293, 302) — no sibling/other-student data enters the render. HTML-escapes all interpolated strings via `esc()`. Additionally, `final_grade`/`qualitative_assessment` tables carry RLS (`migration.sql:130-146`: non-staff principal restricted to `student_id = ANY(app_student_ids())`), so even a hypothetical bug in the app-level check would be caught by DB-level RLS — genuine defense in depth, not just a single point of failure.

**(e) No lifecycle gating added or missing** — grepped `index.ts` for `lifecycle|withdrawn|on_hold|transferred`: zero matches in the diff. Correct — this phase is ownership-only per spec; lifecycle gating is P5's scope on different files.

**(f) parent-view.tsx scope** — `git diff --stat` shows `+83/-0`, purely additive. `AttendanceHistoryCard` (line 394) and its usage under `tab === 'sessions'` (line 635-638) are untouched; `DrawnWorkModal` (line 334, usage at 842) untouched. New code is a `Group` with a download button injected into the `tab === 'gradebook'` branch, plus a new standalone `CertificatesCard` component rendered after the existing conditional blocks — no edits to existing JSX inside those blocks.

## Test / build verification
- `npx vitest run --config vitest.integration.config.ts test/transcript-certificate-lms-access.int.test.ts test/submission-guardian-layer.int.test.ts test/level-progress-authz.int.test.ts test/upload-exercise-pdf-rbac.int.test.ts` → **4 files, 18 tests, all passed.**
- `pnpm --filter @cmc/api typecheck` → clean.
- `pnpm --filter @cmc/lms typecheck` → clean.

## Minor observations (non-blocking)
- The new int test only exercises the `parent` LMS-session kind; no case for `student`-kind session hitting these routes. Given `lmsRlsContextOf`/`resolveLmsSession` treat both kinds uniformly via `studentIds`, this is low risk, but a `student` fixture would close the coverage gap if this route is expected to be reachable by student logins too.
- `window.open(...)` navigations to `/files/certificate/:id` and `/files/transcript/:studentId` rely on the browser sending the LMS cookie on cross-tab navigation — consistent with the existing receipt/exercise-PDF pattern already in the codebase, not a new risk introduced by this diff.

## Unresolved questions
None — all six adversarial checks (a)-(f) verified against actual code, not just spec claims.
