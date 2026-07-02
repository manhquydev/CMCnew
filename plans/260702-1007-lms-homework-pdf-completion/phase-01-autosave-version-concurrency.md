# Phase 01 — Autosave + version optimistic concurrency

Status: completed 2026-07-02 for code + TS/API validation. Browser/tablet manual two-tab check not run in this slice.

Closes gaps #1 (no autosave) and #5 (Submission.version unused). Combined because both edit `submission.save` — one phase avoids a double-edit / merge conflict.

## Context links
- `apps/api/src/routers/submission.ts:119-146` (save mutation; calls `assertExerciseOpenForStudent` at :131)
- `apps/api/src/lib/exercise-open.ts:57-93` (`assertExerciseOpenForStudent` — open-gate, throws FORBIDDEN)
- `apps/lms/src/student-view.tsx:143` (saveDraft → trpc.submission.save); PdfAnnotator at :239, `editable={!isGraded}` at :243
- `packages/db/prisma/schema.prisma:634` (`version Int @default(1)`)

## Overview
Add debounced autosave in the student modal so drawing/answer is never lost, and implement optimistic concurrency using the existing `version` column so two open tabs / stale reloads cannot silently overwrite each other.

## Key Insights
- `submissionSelect` already includes `version: true` (submission.ts:22-32) — the select-list work is done. Only the update-path version-guard logic and exposing version through `myLayer` remain. Verify the const at implementation time.
- `save` now (post seam-fixes) calls `assertExerciseOpenForStudent` (submission.ts:131) on EVERY save, not just create. This can throw a real `FORBIDDEN` mid-edit — not just `CONFLICT` — if a staff member retroactively cancels the session or the student's enrollment is archived while the modal is open. Autosave error handling MUST branch on error code (see Requirements).
- `save` currently `upsert`s with no version check. Create path has version=1 by default; update path must compare + increment.
- Redaction invariant (`redactUnpublishedGrade`, submission.ts:39-45,147-149) must be preserved on all new return paths.
- Grade layer (teacher) is a separate `Grade` row upserted in `grade.ts`. Decision: teacher grade layer does NOT need version concurrency now — single grader per submission, publish flow is idempotent (grade.ts:86-206). Document as YAGNI; only submission (student) gets version. Revisit if concurrent grading appears.

## Requirements
- Debounced autosave (suggest 1.5-2s idle) on annotation change AND answer text change.
- Flush pending autosave on modal close and `window.beforeunload`.
- `submission.save` accepts optional `version`; on update, `WHERE version = input.version`, `data.version = { increment: 1 }`; zero rows updated → `TRPCError CONFLICT`.
- Autosave error handling MUST branch on error code:
  - `CONFLICT` (stale version) → friendly message + offer reload (re-fetch latest layer). Do not silently discard local strokes without warning.
  - `FORBIDDEN` (from the open-gate at submission.ts:131 — session cancelled / enrollment lapsed mid-edit, NOT the pre-existing "unpublished" case) → **stop the background autosave loop silently** (no more failed write ticks), **keep the in-memory unsaved strokes client-side (do NOT clear them on FORBIDDEN)**, and surface one clear, non-alarming message aimed at a 3-11yo child/parent, e.g. "bài này đã đóng, nội dung vẽ dở vẫn được giữ tạm — báo cô giáo". No silent data loss.
- Autosave must not fire for unpublished exercises (save already 403s on non-published — keep). Note the unpublished-403 and the open-gate-FORBIDDEN are distinct paths; only the latter arises mid-edit after a modal was legitimately opened.

## Architecture
Data flow: annotation/answer change → debounce timer → `submission.save({exerciseId, answerText, annotationLayer, version})` → server: if row exists, conditional update on version → returns new version → client stores new version for next save. Create path (first save) omits version guard.

Concurrency: use Prisma `updateMany` with `{ where: { ...key, version: input.version }, data: { ..., version: { increment: 1 } } }`; if `count === 0` → distinguish missing-row (do create) vs stale (CONFLICT) by a prior `findUnique`. Keep it inside the existing `withRls` tx.

## Related code files
- Modify: `apps/api/src/routers/submission.ts` (save + submissionSelect)
- Modify: `apps/lms/src/student-view.tsx` (autosave hook, version state, conflict UX)
- Read-only: `apps/api/src/annotation.ts` (schema unchanged), `apps/api/src/routers/grade.ts` (confirm no version need)

## Implementation Steps
1. Add `version: true` to `submissionSelect`; confirm all consumers tolerate the extra field.
2. Rework `save`: fetch current row; if none → create (version defaults 1); if exists → `updateMany` guarded by `input.version`; count 0 → CONFLICT. Return redacted row incl. new version.
3. Add `version` to save input zod (optional; required only when a submission already loaded client-side).
4. Client: track `version` from initial load (`myLayer` returns no version today — either add version to `myLayer` return or fetch from `mine`/`forStudent`; simplest: extend `myLayer` to also return `version`). Store in state.
5. Add debounced autosave effect (annotation + answer deps); flush on unmount + `beforeunload`.
6. Error handler branches on tRPC error code: `CONFLICT` → toast + reload-layer action; `FORBIDDEN` (open-gate) → set an `autosaveFrozen` flag that halts the debounce loop, retains local strokes in state, and shows the "bài đã đóng" message.

## Todo list
- [x] add version to submissionSelect
- [x] version-guarded update in save
- [x] expose version to client (myLayer or mine)
- [x] debounced autosave + flush on close/beforeunload
- [x] conflict UX (CONFLICT → reload)
- [x] FORBIDDEN-mid-edit UX: freeze autosave loop, keep local strokes, "bài đã đóng" message
- [ ] manual: two-tab stale-write test (browser/tablet only — code-level race covered by code review fix below)

## Code review fixes 2026-07-02

- Two-tab first-save race: concurrent `create` on the unique(exerciseId,studentId) constraint now catches Prisma P2002 and maps to the same CONFLICT response as a stale version, instead of leaking a raw 500-shaped error (submission.ts).
- Double-flush on normal modal close: the `beforeunload` effect's cleanup no longer force-flushes unconditionally on every `opened` transition (which fired a redundant save + exercise-open DB check on every close, since `handleClose` already flushes explicitly) — cleanup now only flushes when there's actually unsaved work (student-view.tsx).

## Evidence 2026-07-02

- `pnpm --filter @cmc/api typecheck` PASS.
- `pnpm --filter @cmc/lms typecheck` PASS.
- `pnpm --filter @cmc/api exec vitest run test/lms-security-invariants.int.test.ts test/lms-full-lifecycle-e2e.int.test.ts` PASS: 2 files, 14 tests.
- Inline TS proof: draft create version=1, guarded update version=2, stale version=1 save returns `CONFLICT`.
- GitNexus: `ExerciseModal` upstream impact LOW / 0 direct graph callers. `submissionRouter` property not indexed as symbol; `submission.save`/`myLayer` caller scan used instead.

## Success Criteria
- Drawing survives modal close without manual save.
- Stale second-tab save → CONFLICT, user prompted to reload, no data corruption.
- Session cancelled / enrollment lapsed mid-edit → save returns FORBIDDEN → autosave loop stops silently, local strokes retained (not cleared), one non-alarming "bài đã đóng" message shown. No looped error toasts, no lost strokes.
- Redaction still enforced (grade hidden pre-publish) on save response.

## Risk Assessment
- **Silent data loss on FORBIDDEN mid-edit (Low likelihood, HIGH impact for 3-11yo audience)**: session cancel / enrollment lapse flips the open-gate while a child is drawing; a naive autosave would loop failed writes or clear strokes. Mitigation: FORBIDDEN branch freezes the loop and retains strokes client-side (see Requirements/Steps). P7 must cover save-after-session-cancelled → FORBIDDEN.
- **Per-autosave DB query cost from the new open-gate (Med likelihood, Low-Med impact)**: `assertExerciseOpenForStudent` (exercise-open.ts:57-93) runs `exercise.findUniqueOrThrow` + a `classSession.findMany` (joined through `batch.enrollments`) on EVERY debounced save tick (~every 1.5-2s while drawing) — a cost that did not exist before seam-fixes, on top of the upsert. Not N+1 (no loop), but real added per-save load on a tablet-heavy, spotty-network classroom. Mitigation (YAGNI — flag now, act only if measured slow): the open state cannot regress within one browsing session in the common case, so consider caching "is this exercise open for this student" for the lifetime of the modal and only re-checking on submit / on a CONFLICT. Do not build the cache pre-emptively.
- Autosave storm / server load (Med likelihood, Low impact): debounce + only-on-change guard. Mitigation: coalesce, skip if no diff since last save.
- Version already in `submissionSelect` — no new type-consumer risk from adding it (it exists); still grep consumers before touching the const.
- beforeunload flush unreliable on mobile Safari (Med/Med): treat as best-effort; primary guard is short debounce so at most ~2s lost. Document limitation.

## Security Considerations
- No new authz surface; save stays `studentProcedure` scoped to `ctx.lms.studentIds[0]`.
- version param is client-supplied but only used as an equality guard — cannot escalate; worst case forces a CONFLICT.

## Rollback
- Pure code revert; no schema change (version column pre-exists). Reverting save to unconditional upsert restores prior behavior with zero data migration.

## Next steps
Unblocks P2 (parent view relies on stable saved layers). P7 adds the conflict integration test.
