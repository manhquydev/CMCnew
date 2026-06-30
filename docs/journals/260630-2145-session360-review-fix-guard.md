# Session 360 review fix — facility-scoping guard for schedule-slot refs

**Date**: 2026-06-30 21:45
**Severity**: Medium (authorization gap, closed)
**Component**: API (class-batch / schedule routers)
**Status**: Resolved — guard shipped, DB FK deferred

## Context

3-agent code review (ERP-quality / LMS-completeness / cross-cutting) of commits `b28af8c` + `93f2e3e` ("session 360 class setup flow", branch `develop`) found a **Medium authorization gap**: `classBatch.create.initialSlot` and `schedule.addSlot` write `roomId`/`teacherId` to `schedule_slot` with **no backend facility-membership check** and **no DB FK**. `design.md:15` claimed "Room choices scoped to facility" but that was UI-only (`class-workspace.tsx:185` dropdown). A crafted request could persist a cross-facility or fabricated room/teacher id.

Also found (NOT a defect — planned future phase): the namesake "nhận xét học sinh + upload ảnh buổi học" feature is **not started** — post-class cards in `schedule-detail.tsx:144-176` are mock (Textarea `defaultValue` uncontrolled, buttons no `onClick`). No `SessionEvidence*` models, no `sessionEvidence` router, no LMS read path.

## Changes Made (intake #44, high-risk lane)

- **NEW** `apps/api/src/lib/slot-refs-guard.ts` — `assertSlotRefsInFacility(tx, facilityId, {roomId?, teacherId?})`: rejects (`BAD_REQUEST`) cross-facility / inactive / fabricated room+teacher refs **inside the caller's transaction**, so a rejection rolls back the whole class/slot write. Checks: room in facility + non-archived; teacher active + `giao_vien` role + facility membership via `UserFacility`.
- **MODIFIED** `apps/api/src/routers/class-batch.ts` — guard call before `scheduleSlot.create` in the `initialSlot` block.
- **MODIFIED** `apps/api/src/routers/schedule.ts` — guard call in `addSlot` after batch lookup (uses server-derived `batch.facilityId`, **ignores** client `input.facilityId`).
- **MODIFIED** `apps/api/test/class-create-initial-slot.int.test.ts` — replaced random-user fixture with dedicated `giao_vien` teachers (FAC1 + FAC2); added 3 tests: backward-compat (no `initialSlot`), cross-facility room rejected, foreign teacher rejected.
- **NEW** `apps/api/test/schedule-add-slot.int.test.ts` — `addSlot` happy path + cross-facility room rejected.

## Decision — DB FK deferred (Part 3)

A DB FK on `schedule_slot.room_id`/`teacher_id` was in the "full fix" scope but **deferred**: `schema.prisma` has 178 uncommitted shift-registration lines (Phase 6, not yet migrated). Running `prisma migrate dev` would bundle shift-registration + the FK into **one** migration → mixes two unrelated features. The app-layer guard already prevents bad data going forward; the FK is defense-in-depth, tracked as a backlog item for when shift-registration schema is committed.

## Verification

- `pnpm --filter @cmc/api typecheck` → `tsc --noEmit` clean (green).
- `pnpm --filter @cmc/api test:integration` → **67 files, 340 tests, ALL passed** (was 66/335; +1 file, +5 tests). 0 regressions.
- code-reviewer subagent → **APPROVED** (correctness, transaction safety, contract preserved, DRY, all acceptance criteria met). 2 non-blocking Low notes: inactive-teacher test + addSlot foreign-teacher test (optional hardening).
- `harness-cli trace` #86 recorded.

## Harness Friction

- GitNexus impact-analysis MCP tools unavailable this session (`npx` ENOENT, MCP not exposed in toolset) — manual blast-radius done by the 3 review agents instead.
- Editor substring-matching could not reduce indentation (preserves prefix) — fixed via PowerShell `[IO.File]` regex.
- Integration tests exceed the 30s `run_commands` timeout — ran via `start /b` background + log file.

## Next Steps

- [ ] DB FK on `schedule_slot.room_id`/`teacher_id` — re-scope once shift-registration schema (`schema.prisma` 178 lines) is committed and migrated cleanly on its own.
- [ ] (Low, optional) add inactive-teacher + addSlot foreign-teacher tests to close code-reviewer's non-blocking notes.
- [ ] Start the "nhận xét học sinh + upload ảnh buổi học" feature (separate intake): `SessionEvidence*` models, `sessionEvidence` router, LMS read path, wire `schedule-detail.tsx` cards off mock.
