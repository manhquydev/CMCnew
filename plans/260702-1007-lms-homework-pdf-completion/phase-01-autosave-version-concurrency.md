# Phase 01 — Autosave + version optimistic concurrency

Closes gaps #1 (no autosave) and #5 (Submission.version unused). Combined because both edit `submission.save` — one phase avoids a double-edit / merge conflict.

## Context links
- `apps/api/src/routers/submission.ts:117-151` (save mutation)
- `apps/lms/src/student-view.tsx:145` (saveDraft → trpc.submission.save)
- `packages/db/prisma/schema.prisma:634` (`version Int @default(1)`)

## Overview
Add debounced autosave in the student modal so drawing/answer is never lost, and implement optimistic concurrency using the existing `version` column so two open tabs / stale reloads cannot silently overwrite each other.

## Key Insights
- `submissionSelect` does NOT currently include `version` — must add it so client can echo it back. Verify the const at implementation time.
- `save` currently `upsert`s with no version check. Create path has version=1 by default; update path must compare + increment.
- Redaction invariant (`redactUnpublishedGrade`, submission.ts:39-45,147-149) must be preserved on all new return paths.
- Grade layer (teacher) is a separate `Grade` row upserted in `grade.ts`. Decision: teacher grade layer does NOT need version concurrency now — single grader per submission, publish flow is idempotent (grade.ts:86-206). Document as YAGNI; only submission (student) gets version. Revisit if concurrent grading appears.

## Requirements
- Debounced autosave (suggest 1.5-2s idle) on annotation change AND answer text change.
- Flush pending autosave on modal close and `window.beforeunload`.
- `submission.save` accepts optional `version`; on update, `WHERE version = input.version`, `data.version = { increment: 1 }`; zero rows updated → `TRPCError CONFLICT`.
- Client on CONFLICT: friendly message + offer reload (re-fetch latest layer). Do not silently discard local strokes without warning.
- Autosave must not fire for unpublished exercises (save already 403s on non-published — keep).

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
6. CONFLICT handler: toast + reload-layer action.

## Todo list
- [ ] add version to submissionSelect
- [ ] version-guarded update in save
- [ ] expose version to client (myLayer or mine)
- [ ] debounced autosave + flush on close/beforeunload
- [ ] conflict UX
- [ ] manual: two-tab stale-write test

## Success Criteria
- Drawing survives modal close without manual save.
- Stale second-tab save → CONFLICT, user prompted to reload, no data corruption.
- Redaction still enforced (grade hidden pre-publish) on save response.

## Risk Assessment
- Autosave storm / server load (Med likelihood, Low impact): debounce + only-on-change guard. Mitigation: coalesce, skip if no diff since last save.
- Version added to select breaks tRPC output type consumers (Low/Med): grep consumers of `submissionSelect` before merge; additive field is generally safe.
- beforeunload flush unreliable on mobile Safari (Med/Med): treat as best-effort; primary guard is short debounce so at most ~2s lost. Document limitation.

## Security Considerations
- No new authz surface; save stays `studentProcedure` scoped to `ctx.lms.studentIds[0]`.
- version param is client-supplied but only used as an equality guard — cannot escalate; worst case forces a CONFLICT.

## Rollback
- Pure code revert; no schema change (version column pre-exists). Reverting save to unconditional upsert restores prior behavior with zero data migration.

## Next steps
Unblocks P2 (parent view relies on stable saved layers). P7 adds the conflict integration test.
