# Phase 07 — Validation: completion report

Scope: close the remaining test-matrix gaps for the LMS homework-PDF plan (`plans/260702-1007-lms-homework-pdf-completion/phase-07-validation.md`). P1–P6 already implemented and committed. No application source files were touched — only new test files under `apps/api/test/` and `apps/e2e/tests/`.

## 1. Version-conflict integration test — DONE

New file: `apps/api/test/submission-version-conflict.int.test.ts` (4 tests).

Covers: first save creates at `version=1`; two saves both holding stale `version=1` — first succeeds and bumps to `2`, second rejects with `CONFLICT`; DB cross-check confirms no silent overwrite (row holds the winner's `answerText`); a save carrying the now-current version succeeds and increments again; staff `listByExercise` still sees the final state.

Ran against real dev DB (Postgres, RLS enforced, no mocks):
```
cd apps/api && npx vitest run --config vitest.integration.config.ts test/submission-version-conflict.int.test.ts
✓ 4 tests passed
```

## 2. Open-gate FORBIDDEN mid-edit integration test — DONE

New file: `apps/api/test/submission-open-gate-forbidden-midedit.int.test.ts` (2 tests).

Two scenarios, each on its own classBatch/enrollment (Enrollment has a unique `(classBatchId, studentId)` constraint, so one batch can't hold two independent enrollment rows for the same student — this also proves each gate-close is scoped to its own fixture, not a coincidental global cutoff):
- Session cancelled after an initial successful save → next `submission.save` (even carrying the correct current `version`) → `FORBIDDEN`.
- Enrollment archived after an initial successful save → next `submission.save` → `FORBIDDEN`.

Both assert the error code is `FORBIDDEN`, not `CONFLICT`, confirming `assertExerciseOpenForStudent` (apps/api/src/lib/exercise-open.ts) is the rejection source, distinct from the version guard and from the "exercise never published" 403 already covered in `lms-security-invariants.int.test.ts`.

```
✓ 2 tests passed
```

## 3. Full regression run (acceptance criterion) — DONE, all green

```
cd apps/api && npx vitest run --config vitest.integration.config.ts \
  test/lms-security-invariants.int.test.ts \
  test/lms-full-lifecycle-e2e.int.test.ts \
  test/submission-guardian-layer.int.test.ts \
  test/upload-exercise-pdf-rbac.int.test.ts \
  test/submission-version-conflict.int.test.ts \
  test/submission-open-gate-forbidden-midedit.int.test.ts

Test Files  6 passed (6)
     Tests  27 passed (27)
```

`pnpm --filter @cmc/api typecheck` → clean, no errors.

## 4. Parent redaction / cross-guardian / upload RBAC — CONFIRMED already covered, not duplicated

Verified via `submission-guardian-layer.int.test.ts` (4/4) and `upload-exercise-pdf-rbac.int.test.ts` (3/3) — both included in the regression run above, both pass. No new tests added for these.

## 5. Save-response redaction — CONFIRMED already covered

`lms-security-invariants.int.test.ts` → "Invariant 1: unpublished grade privacy" asserts `submission.mine()` never returns unpublished score/feedback; `submission.ts`'s `save` mutation shares the same `redactUnpublishedGrade` helper on its return path (submission.ts:213), so this invariant already exercises the code the save-response redaction depends on. No gap found.

## 6. E2E — student autosave + parent read-only — SPECS WRITTEN, BLOCKED by a pre-existing environment issue (not caused by this change)

New file: `apps/e2e/tests/lms-autosave-and-parent-readonly.spec.ts`, two tests:
- **Student autosave**: fixture setup uploads a real minimal-but-structurally-valid PDF (correct xref byte offsets, so pdf.js can actually parse/render it) via the real `/upload/exercise-pdf` HTTP endpoint as a director principal; creates course/batch/student/enrollment/ended-session/published-exercise via direct Prisma writes (same pattern as the existing `session-evidence-publish.spec.ts`). The test logs in as the student, opens the exercise node, draws an ink stroke on the PDF overlay via real pointer events, waits past the 1.8s autosave debounce, cross-checks the DB directly that the stroke actually persisted (not just optimistic client state), closes via Escape without touching "Lưu nháp", reopens, and asserts the stroke round-tripped.
- **Parent read-only**: grades+publishes the submission, mints a parent session (`mintParentSession`), directly verifies `GET /files/exercise/:ref` returns 200 for the guardian principal (decision 0022 — global no-RLS exercise asset), then drives the LMS parent UI to open "Xem bài làm" and asserts none of the editing controls (Bút/Tẩy/Hoàn tác/Lưu nháp/Nộp bài) render.

**Blocker (confirmed genuine, pre-existing, NOT introduced by this change):** Playwright's test loader cannot import `@cmc/db` (or `@cmc/auth`, which re-exports it) in this environment — `packages/db/src/seed-curriculum.ts` uses `import.meta.url` and the Playwright TS loader here evaluates it in a non-ESM context, throwing `SyntaxError: Cannot use 'import.meta' outside a module` before any test can even be *listed*. Reproduced identically against the **pre-existing, already-committed** `apps/e2e/tests/session-evidence-publish.spec.ts` (which also imports `@cmc/db`/`@cmc/auth`), using both `npx playwright test --list` from `apps/e2e` and the documented `pnpm --filter @cmc/e2e exec playwright test --list` — same failure, same stack trace, on a file I did not touch. Specs that avoid those imports (e.g. `admin-crm-opportunity.spec.ts`) list and would run fine. This is an environment/toolchain issue orthogonal to Phase 7 — flagging for the orchestrator's decision rather than patching `packages/db` (out of my file-ownership scope for this phase, and it's application source).

Both new tests are syntactically correct TypeScript, follow the codebase's existing e2e fixture idioms exactly, and would run once the loader issue is resolved (or once run through whatever mechanism successfully executes `session-evidence-publish.spec.ts` in CI — this suggests CI's Node/Playwright invocation differs from what's available in this sandboxed shell, e.g. a different Node major version or `ts-node`/`tsx` register flag not present here).

## 7. grading.tsx regression after P5/P6 — DONE via code review (Playwright execution blocked by the same #6 issue; no admin e2e harness exists for annotator drawing regardless)

Method: compared `apps/admin/src/grading.tsx`'s `GradePdfModal` (grading.tsx:166–171) call site against `PdfAnnotator`'s current public signature (`packages/ui/src/pdf-annotator.tsx:134–146`):

```tsx
<PdfAnnotator
  pdfRef={basePdfRef}
  value={teacherLayer}
  onChange={setTeacherLayer}
  editable
  readOnlyLayers={studentLayer ? [{ items: studentLayer.items, opacity: 0.6 }] : []}
/>
```
vs. signature: `{ pdfRef: string; value: AnnotationData | null; onChange?; editable?: boolean; readOnlyLayers?: { items; opacity? }[] }`.

`git log` on `pdf-annotator.tsx` confirms P5 (`d0df0c9` — eraser/pen-width/pinch-zoom) and P6 (`dde5992` — lazy/windowed rasterization) only added **internal** state (tool/color/width refs, IntersectionObserver-driven LRU render cache) — neither commit touched the exported prop list or the `readOnlyLayers`/`value`/`onChange`/`editable` contract. All 5 props grading.tsx passes are still honored unchanged. Undo (`items.length === 0` disables it), the editable overlay (`onDown`/`onMove`/`onUp`, gated on `editable`), and save (`onChange` → `setTeacherLayer` → `grade.grade.mutate`) are all unconditional on the P5/P6 additions.

Explicitly not an executed test — a code-review-based verification, distinguished from the executed integration/e2e results above.

## 8. Manual tablet checklist — DEFERRED (no physical device in this environment)

Cannot execute: eraser/pen-width/pinch-zoom-by-touch, 20-page/~20MB PDF lazy-load-under-touch-scroll, and MinIO-served-PDF-parity all require a real touch device or, at minimum, a running MinIO instance + browser touch emulation session neither of which this sandboxed environment provides. Flagging as DEFERRED per the phase file's own risk-mitigation note ("flag physical-device check as deferred if needed") rather than fabricating results.

## Bugs found

None. No behavioral defect surfaced in any of the executed tests (int or code review).

## Files added

- `apps/api/test/submission-version-conflict.int.test.ts`
- `apps/api/test/submission-open-gate-forbidden-midedit.int.test.ts`
- `apps/e2e/tests/lms-autosave-and-parent-readonly.spec.ts`

No application source files modified.

Status: DONE_WITH_CONCERNS
Summary: Both integration test gaps (version-conflict, open-gate-FORBIDDEN-mid-edit) are implemented and passing against the real dev DB with zero regressions across the full LMS/submission suite (27/27) and a clean typecheck. The two e2e specs (student autosave, parent read-only) are written and match existing fixture patterns but cannot execute here — Playwright's TS loader in this sandbox fails on `import.meta` inside `packages/db/src/seed-curriculum.ts`, reproduced identically on the pre-existing `session-evidence-publish.spec.ts`, so this is an environment/toolchain gap, not a new regression. grading.tsx's P5/P6 regression check is done via prop-contract code review (no admin e2e harness exists for annotator drawing either way). The manual tablet checklist is deferred — no physical device available.
Concerns/Blockers: (1) Playwright + `@cmc/db`/`@cmc/auth` import.meta loader incompatibility blocks running ANY e2e spec that touches those packages in this sandbox — needs an orchestrator/infra decision (different Node version? a `tsx`/loader flag Playwright's config should set?) since it also silently blocks the pre-existing `session-evidence-publish.spec.ts`, not just my new file. (2) Manual tablet checklist needs a real device — recommend scheduling that separately as an operator task, not blocking phase sign-off on it.
