# Code Review: Phase 07 validation test files (LMS homework-PDF plan)

Scope: 3 new uncommitted test files, no application source touched by their author.
- `apps/api/test/submission-version-conflict.int.test.ts`
- `apps/api/test/submission-open-gate-forbidden-midedit.int.test.ts`
- `apps/e2e/tests/lms-autosave-and-parent-readonly.spec.ts`

## Integration tests: confirmed passing (I ran them)

```
cd apps/api && npx vitest run --config vitest.integration.config.ts \
  test/submission-version-conflict.int.test.ts test/submission-open-gate-forbidden-midedit.int.test.ts

Test Files  2 passed (2)
     Tests  6 passed (6)
```

## submission-version-conflict.int.test.ts — verified against real implementation

Proves the actual claim, not just tRPC error codes. Read `apps/api/src/routers/submission.ts:141-215` (`save` mutation): optimistic concurrency is a Prisma `updateMany({ where: { ..., version: input.version }, data: { ..., version: { increment: 1 } } })`; `count === 0` → `CONFLICT`. The test (`submission-version-conflict.int.test.ts:140-149`) does a **direct DB read via `withRls(SUPER, ...)`** after the CONFLICT to assert `row.answerText === 'draft from tab A'` and `row.version === 2` — this genuinely proves no silent overwrite, not merely that an error was thrown. Matches implementation exactly.

## submission-open-gate-forbidden-midedit.int.test.ts — verified against real implementation

Read `apps/api/src/lib/exercise-open.ts:57-93` (`assertExerciseOpenForStudent`):
- Session-cancelled scenario: query filters `status: { not: 'cancelled' }` (line 73) — a cancelled session is excluded from `openedSession` lookup → `FORBIDDEN` at line 89. Matches test.
- Enrollment-archived scenario: query requires `enrollments.some({ status: 'active', archivedAt: null })` (lines 79-80) — an archived enrollment fails this filter → `FORBIDDEN`. Matches test.
- Ordering: `save()` calls `assertExerciseOpenForStudent` (submission.ts:154) **before** the version-conflict check (submission.ts:184-205). So even when the client sends the correct current version, a closed gate produces `FORBIDDEN`, never `CONFLICT` — exactly what the test asserts at lines 180-182 and 198-200. Correctly distinguished from both the version-CONFLICT case and the pre-existing "not published" 403 (`exercise.status !== 'published'` at exercise-open.ts:67-69, covered separately in `lms-security-invariants.int.test.ts:320-419`).

Minor/informational: the file's docstring claims the two-fixture design "also proves the second scenario's gate-close is scoped to its own enrollment, not a coincidental global cutoff" — no assertion actually cross-checks that. Each scenario correctly proves FORBIDDEN-for-the-right-cause in isolation; the "scoping" claim in the comment is not tested and should be treated as narrative, not a proven property. Low priority, not blocking.

## Report claim #5 is overstated — real coverage gap

The completion report claims: *"submission.ts's save mutation shares the same redactUnpublishedGrade helper on its return path (submission.ts:213), so this invariant already exercises the code the save-response redaction depends on."*

Verified false as a coverage claim (the underlying code is currently correct, but no test proves it). Grepped `lms-security-invariants.int.test.ts` for every `submission.save`/`grade.grade` call: "Invariant 1: unpublished grade privacy" (lines 197-256) exclusively calls `lms.submission.mine()` (line 208) and `staff.submission.listByExercise()` (line 249) — it never calls `submission.save`. Sharing a helper function is not equivalent to testing the call site; a future refactor of `save()` that returns `saved` directly (skipping `redactUnpublishedGrade`) would ship undetected, since:
- `save()`'s only exercised paths are: first save (no grade yet), version-conflict save (no grade exists on those fixtures), open-gate save (no grade exists).
- No fixture anywhere grades-but-does-not-publish a submission and then calls `save()` again to check the returned `grade.score`/`grade.feedback` are null.

This is a real, reachable path: nothing in `save()` blocks a student from saving again after being graded-but-unpublished while the exercise gate is still open (status isn't checked, only version + gate). Recommend adding one assertion (e.g., in `submission-version-conflict.int.test.ts` or a new small test): grade an unpublished submission via staff, then call `lms.submission.save()` again and assert `saved.grade.score === null && saved.grade.feedback === null`.

## E2E spec (static review only — confirmed unexecuted, blocker not re-litigated)

Structurally consistent and would plausibly pass once the loader issue is fixed. Cross-checked against:
- `apps/api/src/index.ts:79-96` (`/upload/exercise-pdf`): accepts raw arraybuffer body, gates on `exercise.upsert` permission. `packages/auth/src/permissions.ts:70` confirms `giam_doc_dao_tao` (the fixture's director role) has `exercise.upsert`. Matches.
- `apps/api/src/index.ts:161-184` (`/files/exercise/:ref`): any authenticated staff-or-LMS principal gets any non-archived exercise PDF (decision 0022, global no-RLS asset) — matches the parent-fetch assertion (200, `application/pdf`).
- Prisma fixture writes match schema exactly: `StudentAccount{studentId,loginCode,passwordHash,isActive}`, `ParentAccount{email,displayName,passwordHash,isActive}`, `Guardian{facilityId,parentAccountId,studentId,relation}` (`schema.prisma:550-594`); `Submission` unique key is `@@unique([exerciseId, studentId])` (schema.prisma:638) → generates the `exerciseId_studentId` compound key the test's `findUnique`/`findUniqueOrThrow` calls use.
- `login`/`mintParentSession` both return `{ token, session }` (`packages/auth/src/index.ts:60-77`, `packages/auth/src/lms.ts:97-104`) — matches the test's `.token` usage.

**Autosave persistence assertion is real, not optimistic-state-only**: lines 233-240 query `tx.submission.findUnique(...).annotationLayer` directly via `withRls(SUPER, ...)` and assert `items.length > 0` **before** the modal is even closed (before the Escape keypress at line 242) — this proves the debounce fired and persisted server-side, not just that client state looks right.

**Parent read-only assertion is a genuine structural check, not vacuous**: `packages/ui/src/pdf-annotator.tsx:474` wraps the entire toolbar (including the "Bút"/"Tẩy"/"Hoàn tác" buttons at lines 476-493, 532-534) in `{editable && (...)}`. `apps/lms/src/parent-view.tsx:365-372` (`DrawnWorkModal`) passes `editable={false}` to `PdfAnnotator`. "Lưu nháp"/"Nộp bài" are student-view-only buttons (`apps/lms/src/student-view.tsx:480-491`) that don't exist anywhere in the parent component tree. So the 5-button absence check verifies a real prop-driven structural property, not a tautological "these labels don't exist in this unrelated component" check.

Residual caveat (inherent to any unexecuted spec, not a defect found): the reopen assertion (`renderedItemCount > 1`, line 253-256) depends on `PageLayer` rendering annotation items before the trailing editable-overlay div (`packages/ui/src/pdf-annotator.tsx:576-584`) — correct as currently written, but this ordering assumption isn't verified by an actual test run, so a future markup reorder in `PdfAnnotator` could silently break this test until someone finally executes it.

## Ranked findings

1. **Medium — real test-coverage gap, not a code defect**: report's claim that save-response grade redaction is "already covered" by Invariant 1 is false; `submission.mine()` and `submission.save()` are separate code paths and only `mine()` is exercised. `apps/api/test/lms-security-invariants.int.test.ts:197-256`, `apps/api/src/routers/submission.ts:207-213`. Recommend adding the grade-then-resave assertion described above before treating phase-07's redaction item as closed.
2. **Low — informational**: `submission-open-gate-forbidden-midedit.int.test.ts` docstring overclaims cross-scenario "scoping" proof that no assertion actually performs. Not blocking; consider softening the comment.
3. **Low — informational**: e2e spec is genuinely unexecuted; static review found no defects but the parent-view/PdfAnnotator DOM-structure assumptions it encodes (child ordering, button labels) are unverified by an actual run. Flag as residual risk until the Playwright `import.meta`/`@cmc/db` loader issue (already logged in DEBT.md) is resolved.

## Confirmed passing

Both integration test files (`submission-version-conflict.int.test.ts`, `submission-open-gate-forbidden-midedit.int.test.ts`) pass when run directly: 2 files, 6 tests, all green, matching the implementer's report.

## Unresolved questions

- Should the missing save()-redaction assertion (finding 1) block phase-07 sign-off, or be tracked as a fast-follow given the underlying code is currently correct?
