# Plan: Session-360 Review Fix — Facility-Scoping Guard for Schedule Slot Refs
>
> **Status: COMPLETED** — Parts 1+2 done (backend guard + 5 tests). Part 3 (DB FK) deferred (schema.prisma mid-flight with uncommitted shift-registration). Typecheck green, 67 files/340 integration tests pass, code-reviewer APPROVED. Intake #44, Trace #86.

> Lane: **high-risk** · Intake recorded via `harness-cli intake` · Story: `LMS-SESSION-EVIDENCE`
> Origin: 3-agent code review (ERP-quality / LMS-completeness / cross-cutting) of commits
> `b28af8c` + `93f2e3e` ("session 360 class setup flow").

## Consensus review finding

`classBatch.create.initialSlot` and `schedule.addSlot` write `roomId` / `teacherId`
to `schedule_slot` with **no backend facility-membership check** and **no DB FK**
(`schema.prisma:275-276`). A crafted request can persist a cross-facility or
fabricated room/teacher id. `design.md:15` claims "Room choices scoped to the
selected facility" — that is **UI-only** (`class-workspace.tsx:185`). The API is
the trust boundary. Severity: **Medium** (data-integrity; cross-facility *leak*
is limited because `mySessions` room-name resolution is RLS-scoped, but a
dangling/fabricated `roomId` corrupts class setup).

Also found (not a defect — planned future phase): the namesake "nhận xét học sinh
+ upload ảnh buổi học" feature is **NOT started** — post-class cards in
`schedule-detail.tsx:144-176` are mock (`Textarea defaultValue` uncontrolled,
buttons no `onClick`). No `SessionEvidence*` models, no `sessionEvidence` router,
no LMS read path. **Out of scope this round** (story docs already defer it).

## Expected output

1. Shared helper `assertSlotRefsInFacility(tx, facilityId, roomId?, teacherId?)`
   that throws `BAD_REQUEST` when a provided `roomId` is not in the facility, or
   `teacherId` is not an active `giao_vien` belonging to the facility.
2. `class-batch.ts` `create` calls the helper before `scheduleSlot.create`.
3. `schedule.ts` `addSlot` calls the helper before `scheduleSlot.create` (parity).
4. Integration tests: cross-facility room rejected, foreign/inactive teacher
   rejected, `startDate>endDate` rejected, create-without-`initialSlot`
   backward-compat, `schedule.addSlot` cross-facility room rejected.
5. **Part 3 (fork — see below)**: DB FK on `schedule_slot`.

## Acceptance criteria

- Caller passes `roomId` from another facility → `BAD_REQUEST`, no
  `schedule_slot` row, no `classBatch` leak (via `create`).
- Caller passes `teacherId` inactive or not in facility → `BAD_REQUEST`.
- Valid same-facility room + active teacher → succeeds (happy path unchanged).
- `create` WITHOUT `initialSlot` → still works (backward compat).
- `create` with `startDate > endDate` → rejected (existing refine).
- `schedule.addSlot` with cross-facility room → `BAD_REQUEST`.
- `pnpm --filter @cmc/api typecheck` green; existing integration suite green;
  new tests pass.

## Scope boundary

- **IN**: app-layer guard + tests for `classBatch.create` + `schedule.addSlot`.
- **OUT**: full LMS session-evidence feature (models, router, photo upload, LMS
  view) — planned future phase, not a review defect.
- **OUT**: post-class mock cards in `schedule-detail.tsx` (intentional mock).
- **Part 3 (DB FK)** — fork, decided at review gate.

## Non-negotiable constraints

- Branch `develop` (not `main`). ✓ confirmed.
- No breaking public contract: `classBatch.create` input stays backward
  compatible (`initialSlot` optional); `schedule.addSlot` input unchanged.
- **No mixing with the uncommitted shift-registration feature.**
- Follow existing patterns (mirror `schedule.addSlot` RLS-comment style).
- GitNexus impact tool unavailable this env (npx ENOENT; MCP not exposed) —
  manual blast-radius done by 3 review agents; noted in trace.

## Touchpoints

- MODIFY `apps/api/src/routers/class-batch.ts` (create mutation, ~99-114)
- MODIFY `apps/api/src/routers/schedule.ts` (addSlot mutation, ~48-58)
- EXTEND `apps/api/test/class-create-initial-slot.int.test.ts` + new
  `apps/api/test/schedule-add-slot.int.test.ts`
- (Part 3 fork) MODIFY `packages/db/prisma/schema.prisma` ScheduleSlot/Room/AppUser
  + new migration

## Part 3 fork (HIGH risk — decision at review gate)

`schema.prisma` has **178 uncommitted shift-registration lines** (Phase 6, not
yet migrated). `prisma migrate dev` diffs full schema vs migration history →
would bundle shift-registration + FK into ONE migration → mixes two unrelated
features.

- **(A) Defer DB FK** — do Parts 1+2 now; backlog FK for when shift-registration
  schema is committed. App guard already prevents bad data going forward.
  *[recommended — clean, no bundling]*
- **(B) Bundle DB FK** — add relations + migrate now (mixes features).
  *[not recommended]*
- **(C) Isolate now** — operator commits/stashes shift-registration first, then
  isolated FK migration.

## Risk classification

- Authorization: YES (the core fix)
- Data model: Part 3 only
- Public contract: NO (additive guard, backward compatible)
- Existing behavior: guard only rejects previously-invalid input
