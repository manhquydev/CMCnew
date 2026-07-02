# Phase 04 — LMS UI: adapt to reshaped listForPrincipal + "opens after session"

## Context links
- Brainstorm §4 W1 (Hiển thị LMS), §6.1
- Depends on: P2 (reshaped listForPrincipal return).

## Overview
- Date: 2026-07-02
- Description: Adapt LMS climb + student views to the reshaped `listForPrincipal` result (program/courseName/unitCode now flattened instead of nested `batch.course`), and surface the "opens after this session" semantics so students understand why some units have no exercise yet.
- Priority: P1
- Implementation status: pending
- Review status: not started

## Key Insights
- Consumers infer the row type from the query: `climb-view.tsx:19` (`type Exercise = Awaited<ReturnType<typeof trpc.exercise.listForPrincipal.query>>[number]`) and `student-view.tsx:39`. Calls at `climb-view.tsx:56`, `student-view.tsx:307,779`.
- climb groups exercises by program (BlackHole / BRIGHT I.G / UCREA) — today via `batch.course.program`. P2 removes `batch`; grouping key becomes flattened `program`/`courseName`. Any `ex.batch.course.program` access breaks → must migrate to `ex.program`.
- After P2, unopened units simply return NO exercise row (not a locked row) — matches brainstorm §4 ("chưa upload = chưa có row"). So the LMS shows fewer rows until sessions end; the display should explain absence rather than render a locked placeholder (YAGNI: no lock state needed).

## Requirements
1. Update `type Exercise` derivation sites to the reshaped result (inference auto-updates, but any `.batch.course.*` field access must be rewritten to the flattened fields from P2).
2. Fix program grouping in `climb-view.tsx` to use flattened `program`/`courseName`.
3. **Remove all `dueAt` renders (M3)**: `student-view.tsx:216` ("Hạn nộp: {fmtDate(exercise.dueAt)}") and `:384` — `dueAt` no longer exists on Exercise (dropped in P1, no due in P2 upsert). Remove the "Hạn nộp" column/field entirely; grep `dueAt` in `apps/lms/src` returns 0 on exercise rows.
4. Add copy/affordance conveying "bài tập tự mở sau khi buổi học dạy bài này kết thúc" where the exercise list is empty or partial (student-view exercises tab + climb). Informational only.
5. Verify `submission.mine` join still lines up with the new exercise rows (submissions key on exerciseId — unaffected, but confirm no reliance on exercise.classBatchId in the client).

## Architecture
- Data-flow unchanged at call level (still `trpc.exercise.listForPrincipal.query()`), only the row shape changed. Fix all field accesses; grouping key = `ex.program`.
- No new endpoint. Empty-state text is static, driven by presence/absence of rows.

## Related code files
- `apps/lms/src/climb-view.tsx:19` (type), `:56` (call), grouping logic below (grep `program`/`batch`).
- `apps/lms/src/student-view.tsx:39` (type), `:307`,`:779` (calls), `:216`,`:384` (dueAt renders — REMOVE, M3), exercises tab render.
- (Verify) any `climb/cloud-climb` helper consuming `batch.course`.

## Implementation Steps
1. Grep `climb-view.tsx` + `student-view.tsx` + `climb/` for `.batch` and `.course` accesses on exercise rows; rewrite to flattened fields.
2. Update grouping to `ex.program`.
3. Add empty/partial-state explanatory text.
4. `pnpm --filter lms typecheck` — this is the canary that the P2 reshape is fully absorbed.

## Todo list
- [ ] Rewrite `.batch.course.*` accesses → flattened fields
- [ ] Program grouping uses `ex.program`
- [ ] Remove dueAt renders `student-view.tsx:216,384` + "Hạn nộp" column (M3)
- [ ] "opens after session" empty-state copy (climb + student exercises tab)
- [ ] lms typecheck green (grep dueAt on exercise rows = 0)

## Success Criteria
- climb + student views compile and render grouped exercises using the new shape.
- Before a class's session for unit U ends, U's exercise is absent with explanatory copy; after, it appears (verified end-to-end in P7).
- No client reference to `exercise.batch`/`classBatchId`.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Silent type drift (inferred type changes, field access compiles against `any`) | Med | Med | Run lms typecheck; grep for now-removed field names; no `as any` on these rows. |
| Student confused by disappearing/late exercises | Med | Low | Explanatory empty-state copy; product-approved behavior (D1). |

## Security Considerations
- None new — read-only LMS surface; isolation enforced server-side (P2 join).

## Next steps
- Rollback: revert LMS view edits from git. Feeds P7 end-to-end auto-open verification.
