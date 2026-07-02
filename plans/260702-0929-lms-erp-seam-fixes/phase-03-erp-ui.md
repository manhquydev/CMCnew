# Phase 03 — ERP UI: per-unit exercise manager + schedule-detail indicator

## Context links
- Brainstorm §4 W1 (ERP UI), D2
- Depends on: P2 (upsert procedure + perms).

## Overview
- Date: 2026-07-02
- Description: Add a director-only exercise manager in the curriculum area (list units of a course → attach PDF/description/stars per unit via `exercise.upsert`, NO due field). Replace the 2 dead buttons in `schedule-detail.tsx` with a read-only per-session indicator. **REMOVE the live teacher exercise-write UI in `grading.tsx` (C4)** — create/publish/CreateExerciseModal — leaving only the read+grade flow.
- Priority: P1
- Implementation status: pending
- Review status: not started

## Key Insights
- Dead buttons live in `apps/admin/src/schedule-detail.tsx:151-160`: `WorkflowCard "Phát bài tập LMS"` with `<Button>Chọn bài tập mẫu</Button>` (:157) and `<Button>Phát lên LMS</Button>` (:158) — no `onClick`. Tàn dư mock Session-360; concept is wrong (no manual "publish"). The session object here has `curriculumUnitId` available (ClassSession) to drive the indicator.
- Directors' curriculum area is where the 60-units-per-course list already renders (curriculum framework shipped commit 64bce29 / decision 0021). The exercise manager attaches to that surface — reuse it, do not build a new nav entry (KISS/DRY).
- `can(me.roles, me.isSuperAdmin, 'exercise', 'upsert')` gates the manager UI (mirror existing `can(...,'grade','grade')` usage at `schedule-detail.tsx:125`).
- **`grading.tsx` has a LIVE teacher exercise-write flow (C4 — red-team, NOT dead)**: `trpc.exercise.create.mutate` (`:81`), `trpc.exercise.publish.mutate` (`:529`), `CreateExerciseModal` mounted in `ClassGrading` (`:546`). Deleting the `create`/`publish` procedures in P2 breaks admin typecheck unless this UI is removed here. Keep the `listByClass` read (`:24,:515`) + `submission.listByExercise` grading flow (teachers keep read+grade — D2).

## Requirements
1. Per-unit exercise manager (directors only): for a selected course, list its `CurriculumUnit`s; each row shows current exercise(s) + edit form calling `exercise.upsert({ curriculumUnitId, type, ... })`. Per-unit rows expose a **homework slot AND (for REVIEW units) a test slot** — composite `(curriculumUnitId, type)`. Fields: title, description, basePdfRef (upload/ref), maxScore, starReward, status(draft/published). **NO due field** (NO-dueAt decision).
2. Replace `schedule-detail.tsx:151-160` WorkflowCard body with a read-only indicator: reads whether the session's `curriculumUnitId` has a published exercise; copy: "Bài tập buổi này (unit X): đã có / chưa upload · tự mở sau khi buổi kết thúc". No action buttons.
3. **Remove teacher exercise-write UI in `grading.tsx` (C4)**: delete `CreateExerciseModal` mount (`:546`), the publish button + `publish.mutate` (`:529`), the `create.mutate` call (`:81`), and their component state/imports. Keep `listByClass` read (`:24,:515`) + `submission.listByExercise` grading. After this, grep for `exercise.create`/`exercise.publish` in admin returns 0.
4. Gate manager entry with `exercise.upsert` permission; hide for non-directors (teachers no longer see any exercise-write UI — D2).

## Architecture
- Manager data-flow: select course → `curriculum.listUnits(courseId)` (existing read) → per unit, current exercise via a staff read (`exercise.listByUnit` or reuse listByClass-successor from P2) → `exercise.upsert` on save → audit logged server-side.
- Indicator data-flow: `session.curriculumUnitId` → lightweight `exercise.existsForUnit`/reuse list → boolean + published state → static text. Read-only; no mutation.

## Related code files
- `apps/admin/src/schedule-detail.tsx:151-160` — replace WorkflowCard buttons with indicator; :125-126 shows the `can()` gate pattern.
- `apps/admin/src/grading.tsx:81,529,546` — REMOVE create/publish/CreateExerciseModal (C4); keep read+grade (`:24,:515`).
- Curriculum area component (find in `apps/admin/src/` — curriculum/course workspace from 64bce29) — host the per-unit manager.
- `apps/admin/src/` shared UI (`@cmc/ui` notify/validators per UI-hardening convention) for the form.

## Implementation Steps
1. Grep the curriculum/course workspace component; add a "Bài tập theo bài" section listing units with per-unit upsert form (homework + test slots, no due field).
2. Wire form → `trpc.exercise.upsert`; success/error via `@cmc/ui` notify.
3. In `schedule-detail.tsx`, delete the two `<Button>`s + the `<Group>`; render read-only indicator driven by a per-unit exercise read.
4. In `grading.tsx`, remove CreateExerciseModal mount + publish/create mutations + their state (C4); keep read+grade.
5. Gate both surfaces on `can(..., 'exercise', 'upsert')` for the manager; indicator is read-only for all staff who can view the session.
6. `pnpm --filter admin typecheck`.

## Todo list
- [ ] Per-unit exercise manager section (directors only, hw+test slots, no due)
- [ ] upsert form wired + notify
- [ ] schedule-detail dead buttons removed → read-only indicator
- [ ] grading.tsx create/publish/CreateExerciseModal removed (C4); read+grade kept
- [ ] permission gating verified (teacher sees no write UI)
- [ ] admin typecheck green (no exercise.create/publish callers remain)

## Success Criteria
- Director uploads exercise for a unit from curriculum area; row reflects saved state.
- schedule-detail shows per-session status text, no dead buttons; teacher account sees indicator only, no manager.
- No `exercise.create`/`exercise.publish` calls remain in admin (grep clean).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Indicator query per session row causes N+1 in schedule view | Med | Low | Batch/existence read keyed by unit; cache per open session detail (single session detail, low volume). |
| Teacher still sees stale write affordance | Low | Med | Gate on `exercise.upsert`; e2e teacher-nav check (P7). |

## Security Considerations
- UI gating is convenience only; server `requirePermission('exercise','upsert')` (P2) is the real gate. Do not rely on hiding buttons.

## Next steps
- Rollback: revert admin component + schedule-detail from git. P4 handles the LMS-side display in parallel (different files).
