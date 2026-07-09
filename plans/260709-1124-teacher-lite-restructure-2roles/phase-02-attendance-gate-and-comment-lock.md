# Phase 2 — Attendance 15-min gate + present/late comment lock (TDD-first)

- **Date:** 2026-07-09 · **Priority:** P1 · **Status:** pending · **Risk:** High · **Effort:** ~5h
- **Items:** #1 (server-truth 15-min gate + UI mirror), #2 (comment only for present/late, server-enforced)
- **Context:** brainstorm items 1, 2, 5; plan.md governance (server = source of truth).

## Key insights (verified)

- `attendance.mark` (**attendance.ts:33-121**) and `attendance.markAll` (**attendance.ts:125-207**)
  both load the session (`sessionDate`, `startTime`, `endTime` available via select — currently
  select at :54-55 and :145-146 pulls `classBatchId, facilityId, status, teacherId` only; **must add
  sessionDate/startTime/endTime** to the select).
- ICT helpers already exist: `sessionEndUtc(sessionDate, endTime)` + `sessionHasEnded(...)` in
  `apps/api/src/lib/exercise-open.ts:7-27`, `ICT_OFFSET_HOURS = 7`. attendance.ts already imports
  `sessionEndUtc` (attendance.ts:7) — so importing a sibling window helper is consistent.
- Comment server gate is a **real gap**: `sessionEvidence.upsertDraft` (**session-evidence.ts:137-141**)
  only checks the student is in `enrollments where status:'active'` — it does NOT require present/late.
  UI already filters render to present/late (session-detail.tsx:451-459) but server accepts any active
  student's comment. Item #2 = close the server gap + keep UI.
- UI attendance button: `markAll` at session-detail.tsx:236-249, single mark at :224-234, button at
  :418-421 (`disabled={!enabled ...}` where `enabled = session.status !== 'cancelled'`, :64). Per-row
  `StudentRow` disabled at :429. The window state must extend `enabled`.

## Requirements

**#1** Server rejects `mark`/`markAll` when `now < sessionStartUtc − 15min` OR `now > endOfSessionDayUtc`.
Inside window → allowed. UI disables the attendance button + StudentRow outside window, tooltip
`"Mở điểm danh từ HH:MM"` (HH:MM = local start−15min).

**#2** Server rejects a comment in `upsertDraft` for a student whose attendance for that session is not
`present`/`late` (absent, excused-absent, or unmarked → reject). UI unchanged (already correct).

## TDD-first — write these tests BEFORE implementation

### `apps/api/test/attendance-window-gate.int.test.ts` (new)

Mirror pattern from `attendance-report-markall.int.test.ts` (staffCaller, withRls(SUPER), uniq,
`dbReachable` guard, teardown). Fixtures: 1 batch, 1 active enrollment, teacher assigned.

- **(a) allowed inside window** — session dated "today", startTime set so `now` is between start−15min
  and end-of-day; `mark`/`markAll` succeed, row written. Use a session whose start is ≤15min ahead of
  now (or already started) today.
- **(b) rejected before open** — session dated today, startTime far later (e.g. now+2h so now < start−15min);
  `mark` and `markAll` reject with the gate message (BAD_REQUEST).
- **(c) rejected after day-end** — session dated yesterday (ICT); `now > endOfSessionDayUtc`; both reject.
- Assert existing guards still fire (cancelled session, transferred enrollment) — regression.

  NOTE on time: build fixtures relative to real `new Date()` (ICT), NOT fixed 2094 dates (those are
  used by the report suite to *avoid* today — here we specifically need today/yesterday). Compute
  startTime/endTime strings from `now` in ICT so the window math is deterministic. Keep facility
  isolated + far-future not applicable; use unique codes via `uniq()`.

### `apps/api/test/session-comment-present-gate.int.test.ts` (new)

- Fixtures: batch, 3 active enrollments (S1, S2, S3), a session, teacher assigned. Mark S1 present,
  S2 late, S3 absent (via `attendance.mark`).
- **(a)** `upsertDraft` with comments for S1 + S2 → succeeds, 2 comment rows.
- **(b)** `upsertDraft` with a comment for S3 (absent) → rejects (BAD_REQUEST).
- **(c)** `upsertDraft` with a comment for an unmarked student → rejects.
- Confirms the render-filter is now backed by server truth.

## Implementation steps

### #1 gate (server)

1. New file `apps/api/src/lib/attendance-window.ts` (~40 lines, kebab, KISS):
   - `export function attendanceWindowFor(sessionDate: Date, startTime: string): { opensAt: Date; closesAt: Date }`
     - `opensAt = sessionStartUtc(sessionDate, startTime) − 15min`, where `sessionStartUtc` mirrors
       `sessionEndUtc` (Date.UTC(y,m,d, startH−7, startM)). Reuse ICT offset = 7.
     - `closesAt = end of the session's ICT calendar day = Date.UTC(y,m,d, 17, 0, 0, 0)` (24:00 ICT = 17:00 UTC same UTC-date, since sessionDate is stored as UTC-midnight of the ICT date).
   - `export function assertAttendanceWindowOpen(now: Date, sessionDate: Date, startTime: string): void`
     — throws `TRPCError({code:'BAD_REQUEST', message:'Ngoài giờ điểm danh (mở từ 15 phút trước giờ học đến hết ngày)'})`
     when `now < opensAt || now > closesAt`.
   - Do NOT modify exercise-open.ts (owned by a shipped phase; attendance.ts already duplicates the
     offset for the same reason, attendance.ts:10-12). Keep the helper self-contained; may import
     `sessionEndUtc`? Not needed — closesAt uses day-end, compute directly.
2. attendance.ts `mark`: add `sessionDate, startTime, endTime` to the session select (:54-55); after
   the cancelled + teaching-authz checks (after :73), call `assertAttendanceWindowOpen(now, session.sessionDate, session.startTime)`.
3. attendance.ts `markAll`: same — add fields to select (:145-146) and call the guard after :151.
4. **GitNexus impact gate**: run `gitnexus_impact({target:'mark', direction:'upstream'})` and
   `{target:'markAll', ...}` before editing; report callers (session-detail.tsx markSingle/markAll,
   plus any bulk-attendance panel). Warn if HIGH/CRITICAL. Known caller: `attendance-report-markall.int.test.ts`
   `mark`/`markAll` calls use far-future 2094 dates → **those will now hit the "after day-end" gate and FAIL.**
   → Mitigation: that suite must pass a `now` override OR the gate must not apply retroactively to its
   fixtures. Decide: (i) add an optional injectable clock is over-engineering; (ii) simplest — update
   the report suite's fixtures/marks are asserting report aggregation, not the gate; since 2094 is future,
   `now < opensAt` → they'd fail the "before open" branch too. **Action: update attendance-report-markall
   fixtures to dates within the window is wrong (they test month-bucketing across 2094).** Better: the
   gate should be enforced in the router, and the report suite calls `mark`/`markAll` to *seed* data.
   RESOLUTION (choose in impl): seed the report suite's attendance rows via direct `tx.attendance.create`
   under `withRls(SUPER, ...)` instead of through the gated router, OR export the window guard so tests
   can pre-check. Recommended: seed via SUPER tx in that suite's setup (removes router coupling). This is
   a required companion edit — list it in the impact report.

### #2 comment lock (server)

5. session-evidence.ts `upsertDraft`: after loading the session (:121-133), also load attendance for
   the session keyed by studentId (join Attendance→Enrollment.studentId where classSessionId = input).
   Build `Set<studentId>` of present/late. Replace the enrolled-only check (:137-141) with: student
   must be present/late (implies enrolled). Keep the existing NOT_FOUND + teaching-authz.
   - Query: `tx.attendance.findMany({ where: { classSessionId, status: { in: ['present','late'] } }, select: { enrollment: { select: { studentId } } } })`.
6. **GitNexus impact**: `gitnexus_impact({target:'upsertDraft', direction:'upstream'})` — caller is
   session-detail.tsx (publishEvidence/handlePhotoUpload/debounced save all send `comments`). Verify no
   other caller sends comments for absent students programmatically.

### #1 gate (UI mirror)

7. session-detail.tsx: compute window from `session` (already has sessionDate/startTime/endTime).
   Add `const attendanceOpen = isAttendanceWindowOpen(session)` (client mirror of the same math; small
   local helper or import a shared pure fn). Combine into button/row disabled:
   - :418 markAll button `disabled={!enabled || !attendanceOpen || enrollments.length===0}`.
   - :429 StudentRow `disabled={!enabled || !attendanceOpen}`.
   - Add tooltip on the button (Mantine `Tooltip`) `"Mở điểm danh từ HH:MM"` where HH:MM = local
     `start−15min` (only shown when `!attendanceOpen`).
   - Client math must match server (ICT). Keep a single source: consider a tiny shared pure helper in
     a client util, since the server helper is server-only (TRPCError import). Duplicate the pure
     boolean (opensAt/closesAt) client-side — acceptable (KISS), server remains the enforcing truth.

## Success criteria

- New int tests green: window allow/before/after + comment present/late.
- `attendance-report-markall.int.test.ts` still green (seed path fixed).
- UI: outside window the attendance button + rows are disabled with tooltip; inside window enabled.
- upsertDraft rejects absent/unmarked student comments (server), UI still shows present/late only.

## Risk / security

- **HIGH**: gate on markAll breaks the report seed suite (2094 dates) — companion fix required (step 4).
- Timezone correctness: sessionDate is UTC-midnight of the ICT date; closesAt = 17:00 UTC same date.
  Cover with test (c) yesterday-ICT and a late-evening session (endTime 22:30) sanity.
- Security: gate is additive server-side; UI mirror is convenience only. No RLS/authz change. No schema
  change. Audit logging paths untouched.
- Comment lock tightens (never loosens) an existing check → no data-leak risk; worst case a legit
  present-student comment blocked if attendance not yet marked (acceptable UX — mark first, brainstorm).

## Next steps

Phase 4 manual: verify tooltip + LMS still receives published comments for present students.
