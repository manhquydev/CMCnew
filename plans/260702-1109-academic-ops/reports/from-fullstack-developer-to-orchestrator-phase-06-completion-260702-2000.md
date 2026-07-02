## Phase Implementation Report

### Executed Phase
- Phase: phase-06-ui-wiring
- Plan: D:\project\CMCnew\plans\260702-1109-academic-ops
- Status: DONE_WITH_CONCERNS

### Gating prerequisites (verified fresh, per phase instructions)
1. Host panel for room UI: re-grepped `room.` across `apps/admin/src` — `class-workspace.tsx` is still the sole consumer. Confirmed as host.
2. Note-write mutation: read `apps/api/src/routers/parent-meeting.ts` in full. **No mutation persists `note`.** `setSchedule` only accepts `{ id, scheduledAt }`; `setStatus` only accepts `{ id, status }`; `note` appears solely in the `myMeetings` select (read-only). Per the plan's explicit instruction, the outcome/note UI was **not built** — adding a note-write mutation is new API scope, out of this phase's boundary.

### Files Modified
- `apps/admin/src/class-workspace.tsx` (+64/-8 approx): added `RoomEditModal` component and wired `room.update`; added archive button wired to `room.archive` (with `window.confirm`) inside `RoomsManager`. Both already permission-gated by the existing `canManageClass` check that wraps `RoomsManager` (super_admin or `giam_doc_dao_tao`), matching the `room.update`/`room.archive` permission registry entries.
- `apps/admin/src/meetings-panel.tsx` (+70/-3 approx): added `SetScheduleModal` component wired to `parentMeeting.setSchedule`; added a "Chốt giờ" action + "Chưa chốt" badge on scheduled-but-unconfirmed meetings in `MeetingsPanel`'s table.
- New: `apps/e2e/tests/admin-room-management.spec.ts` — E2E for room edit + archive.
- New: `apps/e2e/tests/admin-meeting-set-schedule.spec.ts` — E2E for setSchedule → parent LMS `myMeetings` confirmed-time readback.

### Tasks Completed
- [x] Room edit + archive UI wired to `room.update`/`room.archive`, hosted in `class-workspace.tsx` (confirmed sole `room.` consumer).
- [x] `parentMeeting.setSchedule` UI: date + HH:mm form, confirms meeting time, flips `timeConfirmed`.
- [ ] Meeting outcome/note UI — **not built**, no note-write mutation exists (see gating prerequisite #2 above). Escalating rather than inventing a mutation.

### Tests Status
- Type check: **pass** (`pnpm --filter @cmc/admin typecheck` clean, one pre-existing type error in `meetings-panel.tsx` — `time.split(':').map(Number)` inferred `number | undefined` — fixed by destructuring strings before `Number()`).
- Unit tests: n/a (no existing unit test harness for these components).
- E2E: **written but NOT executed** — blocked by a pre-existing environment issue, not caused by this phase's changes (see below).

### Issues Encountered
**E2E execution blocker (pre-existing, environment-level):** `pnpm --filter @cmc/e2e exec playwright test` fails to load ANY spec that imports `@cmc/db` or `@cmc/auth` (e.g. `withRls`, `mintParentSession`), with `SyntaxError: Cannot use 'import.meta' outside a module` originating from `packages/db/src/seed-curriculum.ts` via `packages/db/src/index.ts`. Root cause: `packages/db/package.json` declares `"type": "module"` but `apps/e2e/package.json` has no `"type"` field, so Playwright's TS transform emits CJS for e2e specs, and `require()`-ing the ESM `@cmc/db` package chokes on `import.meta`.

Confirmed this is **not** something introduced by this phase: reproduced the identical failure on the pre-existing `session-evidence-publish.spec.ts` (unmodified, already in the repo, also imports `withRls`/`mintParentSession`). Specs that don't import `@cmc/db`/`@cmc/auth` (e.g. `admin-crm-opportunity.spec.ts`) list/load fine. This affects every db-fixture-based E2E spec in the suite, not just the two new ones.

Given this is outside this phase's file ownership (`apps/admin/src/class-workspace.tsx`, `apps/admin/src/meetings-panel.tsx` only) and is a pre-existing harness defect, I did not attempt to fix `apps/e2e/package.json` or the `@cmc/db` module config — escalating instead.

The two new specs were written against verified real component structure (selectors matched to actual button labels/text/dialog titles in the modified files) and follow the `session-evidence-publish.spec.ts` fixture pattern (`withRls` seed/teardown, `mintParentSession` for parent-side assertions), but their correctness has NOT been confirmed by an actual run.

### Next Steps
- Orchestrator/operator decision needed on the E2E harness `import.meta`/module-type mismatch (affects the whole suite, worth a dedicated fix, e.g. add `"type": "module"` to `apps/e2e/package.json` or adjust Playwright's TS config) before any db-fixture E2E spec (old or new) can run.
- Once fixed, run `admin-room-management.spec.ts` and `admin-meeting-set-schedule.spec.ts` to confirm the two E2E flows pass.
- Outcome/note UI remains unimplemented — needs a product/API decision: either add a dedicated `parentMeeting` note-write mutation (new API scope, next phase) or confirm notes are intentionally staff-internal via a different surface (e.g. Chatter log already present on `MeetingsTab`'s "Nhật ký" via `entityType: 'class_batch'` — not meeting-scoped though).

Status: DONE_WITH_CONCERNS
Summary: Room edit/archive and meeting setSchedule UI wired to existing audited mutations, typecheck clean; outcome-note UI correctly skipped (no write mutation exists, escalating instead of inventing one); wrote 2 new E2E specs but could not execute them due to a pre-existing (not phase-caused) `import.meta`/CJS module-loading bug affecting every db-fixture-based Playwright spec in the repo.
Concerns/Blockers: (1) E2E harness bug blocks running these specs — needs a separate fix outside this phase's file ownership. (2) Outcome/note UI scope gap needs an operator decision (new mutation vs. different surface).
