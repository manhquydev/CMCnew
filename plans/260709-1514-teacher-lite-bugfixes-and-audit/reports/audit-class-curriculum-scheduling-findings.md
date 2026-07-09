# Audit — Class / Curriculum / Scheduling domain (latent-bug, report-only)

Date: 2026-07-09
Branch: develop
Scope: teacher-lite-class-workflows.ts, schedule.ts, curriculum-recompute.ts,
domain-academic (schedule.ts/time.ts/code.ts), class-batch.ts, batch-code.ts,
class-workspace.tsx, teacher-lite-class-control-panel.tsx.
Mandate: read + reason only. No source files changed.

Both known bugs are CONFIRMED (F1, F2). Nine additional real defects found.
Ordered most-severe first.

---

## F1 — HIGH — Auto-course selection is alphabetical, and there is NO course picker at all
Files:
- `apps/admin/src/class-workspace.tsx:162-165`
- `apps/admin/src/teacher-lite-class-control-panel.tsx:115-118`

Both class-creation surfaces pick the course like this:

```ts
const autoCourse = courses
  .filter((c) => c.unitCount > 0)
  .sort((a, b) => a.code.localeCompare(b.code))[0] ?? null;
const courseId = autoCourse?.id ?? null;
```

Two compounding problems:
1. **Alphabetical `code.localeCompare` ordering** — `BRIGHT_IG` codes (e.g. `BIG-…`,
   `BRIGHT_IG-C`) sort before `UCREA` codes (`UCR-…`, `UCREA-L1`), so the winner is
   whatever course code is lexicographically first, not a business-meaningful choice.
2. **There is no UI to override it.** `courseId` is derived, never bound to a Select.
   Whatever `autoCourse` resolves to is the *only* course any class can be created
   with. Every other course with `unitCount > 0` is unreachable from these two flows.

Failure scenario / repro: seed ≥2 curriculum courses (UCREA + BRIGHT_IG, both
`unitCount>0`). Open "Tạo lớp". The form shows a single fixed "Khung chương trình:
<alpha-first course>" line and creates the batch with that `courseId`
(`classBatch.create` / `teacherLite.createClass`). Staff who want a UCREA class get a
BRIGHT_IG class (or vice-versa) with the wrong curriculum framework, wrong
`totalSessions`, wrong end-date estimate, and wrong per-session unit mapping — all
silently. `classBatch.create` accepts any `courseId` server-side, so the defect is
purely the client's hardcoded pick.

Why it matters: curriculum mapping, end-date estimate, and the whole
`recomputeCurriculumMapping` chain key off `batch.courseId`. A wrong course
poisons every downstream artifact for the life of the class.

---

## F2 — HIGH — Session generation is range-based, decoupled from curriculum `totalSessions`
Files:
- `packages/domain-academic/src/schedule.ts:28-51` (`enumerateSessions`)
- `apps/api/src/routers/schedule.ts:146-254` (`generateSessions`)
- `apps/api/src/services/teacher-lite-class-workflows.ts:85-166` (`generateInitialSessions`)
- `apps/admin/src/class-workspace.tsx:198-202` (end-date auto-estimate)
- `apps/admin/src/teacher-lite-class-control-panel.tsx:125` (no estimate at all)

`enumerateSessions` emits one session for **every** weekday occurrence of every slot
between `startDate` and `endDate` inclusive. The number of sessions is therefore a
pure function of the date window, never of the curriculum's `totalSessions`.

The window's `endDate` is only loosely coupled to the curriculum, and differently in
each surface:
- `class-workspace.tsx` estimates `weeks = Math.ceil(totalSessions / slots.length)`
  then `endDate = start + weeks*7 - 1`. Rounding and multi-slot interleaving make the
  session count drift from `totalSessions` (see repro below). The estimate ignores
  holidays/reschedules entirely (acknowledged in the code comment) and **stops
  overwriting once staff edit the end date** (`endDateAuto=false`).
- `teacher-lite-class-control-panel.tsx` has **no curriculum-based estimate** — the
  teacher picks an arbitrary `endDate` (`estimateSessionCount` is display-only), so
  the generated session count is completely arbitrary vs `totalSessions`.

Failure scenario / repro (rounding): `totalSessions = 25`, 2 slots/week →
`weeks = ceil(25/2) = 13` → 26 weekday occurrences → 26 sessions.
`recomputeCurriculumMapping` maps the first 25 to units and leaves session #26 as
`overflowCount` (unit null). Inverse case (`totalSessions=23`, 2 slots, weeks=12 → 24
occurrences → still 1 overflow). With a manual end date (teacher-lite panel) the gap
can be arbitrarily large: too few sessions → trailing units `uncoveredUnits` (never
taught); too many → tail of null-unit sessions.

Why it matters: the product intent is "one class == the curriculum's fixed N buổi".
The implementation instead materializes "however many weekdays fall in a guessed
window", so class length and curriculum length routinely disagree.

---

## F3 — MEDIUM — `Math.max(unit.sessions, 1)` in recompute vs `Σ sessions` in `totalSessions`: unit-count drift; plus a dead divergent second implementation
Files:
- `apps/api/src/services/curriculum-recompute.ts:41-46`
- `apps/api/src/routers/course.ts:18-24` (`totalSessions = Σ unit.sessions`)
- `packages/domain-academic/src/schedule.ts:75-97` (`assignUnitsToSessions`)

`recomputeCurriculumMapping` reserves slots as `count = Math.max(unit.sessions, 1)`
— a unit with `sessions = 0` still consumes one session slot. But
`course.list.totalSessions` is `_sum.sessions` (raw Σ), which counts a
`sessions=0` unit as 0. These two numbers disagree whenever any unit has
`sessions = 0`.

Consequence: the end-date estimate (F2) sizes the window from `totalSessions`
(the smaller number), so the generated session count is smaller than the number of
slots `recompute` reserves. The zero-session unit(s) at the front still eat a slot,
pushing the *last* real units past the end of the session list → they land in
`uncoveredUnits` and are silently never mapped/taught.

Second, orthogonal problem: `assignUnitsToSessions` in `domain-academic` is a
*separate* implementation of the exact same zip-logic, and it uses raw `u.sessions`
(no `Math.max(...,1)`). Per GitNexus it is called **only by its own unit test** —
production uses `recomputeCurriculumMapping`. So the tested function and the
shipped function differ on the `sessions=0` case, and the test suite validates the
one that isn't used. Two sources of truth; the green test proves nothing about prod.

Repro: seed a course with a leading `sessions=0` unit (e.g. an intro/placeholder).
`totalSessions` under-counts by 1; end-date estimate generates 1 too few sessions;
the final curriculum unit ends up uncovered after `recomputeForBatch`.

---

## F4 — MEDIUM — `editSlot(applyToFuture)` relocates makeup sessions (`isMakeup`) that don't belong to the slot
File: `apps/api/src/routers/schedule.ts:429-514`

Future sessions "belonging to" the edited slot are identified purely by
`startTime === before.startTime` AND `sessionDate.getUTCDay() === before.dayOfWeek`
(lines 429-437). There is **no `isMakeup: false` filter**. A makeup session
(`createMakeupSession`, `isMakeup=true`) that happens to fall on the same weekday and
start at the same time is matched and then moved (date shifted by `dayDelta`, times /
room / teacher overwritten, lines 501-512).

Failure scenario: class has a Mon-18:00 slot. Teacher creates a makeup buổi bù on a
future Monday at 18:00 (a natural choice). Staff later edit the Mon slot to Wed-19:00
with "áp dụng buổi tương lai". The makeup session — unrelated to the slot — is
silently dragged to Wednesday 19:00, corrupting the makeup's intended date/time and
its manually-assigned `curriculumUnitId` context (the subsequent recompute at
line 550 excludes makeup, so the moved makeup keeps a now-wrong unit).

Note the inconsistency: `recomputeCurriculumMapping` deliberately excludes
`isMakeup` sessions (curriculum-recompute.ts:35), but `editSlot`'s mover does not.

---

## F5 — MEDIUM — Cancelling a session never recomputes curriculum mapping (inconsistent with generate/editSlot)
Files:
- `apps/api/src/services/teacher-lite-class-workflows.ts:294-340` (`cancelTeacherLiteSession`)
- `apps/api/src/routers/class-batch.ts:279-335` (`classBatch.cancel`, batch-level)
- vs `apps/api/src/routers/schedule.ts:239, 550` (generate/editSlot DO recompute)

`generateSessions` and `editSlot` both re-run `recomputeCurriculumMapping` after
changing the non-cancelled session set, precisely because the mapping is defined over
"non-cancelled, non-makeup sessions ordered by date" (curriculum-recompute.ts:34-38).
But the two cancellation paths change that exact set and do **not** recompute.

Failure scenario: class S1..S24 mapped U1..U24. Cancel S5. The mapping is now stale —
S6..S24 still show U6..U24, and U5 lives only on the cancelled S5. Had recompute run,
S6 would slide up to U5 and the tail would re-pack, surfacing U24 as the new overflow.
Instead one unit is silently dropped from the live schedule with no re-pack. On
`classBatch.reopen`, future sessions are restored to `planned` (class-batch.ts:371)
but again without recompute, so any interim `editSlot`/generate can leave the mapping
in a state that depends on operation order.

This may be a partly-intentional "cancel loses the unit, re-teach via makeup" model,
but the behavior is undocumented and inconsistent with the other two mutation paths
that treat the mapping as always-recomputed. At minimum it is a latent inconsistency;
in practice it produces wrong per-session curriculum labels in
`schedule.listSessions` / `sessionsForStudent`.

---

## F6 — LOW — UTC/ICT date-boundary skew in "future" filters and weekday estimate
Files:
- `apps/api/src/services/teacher-lite-class-workflows.ts:268` and
  `apps/api/src/routers/class-batch.ts:261,292,368` (`today = new Date(new Date().toISOString().slice(0,10))`)
- `apps/admin/src/teacher-lite-class-control-panel.tsx:45-58` (`estimateSessionCount` uses `getDay()`)

All session dates are stored/compared at UTC-midnight and weekdays computed with
`getUTCDay()` (internally consistent — good). But `today` for the cancel/reopen/
editSlot "future session" filters is derived from `new Date().toISOString()`, i.e.
the UTC calendar date. The app operates in ICT (UTC+7). Between 00:00–07:00 ICT the
UTC date is still "yesterday", so `today` lags the local date by one day.

Failure scenario: at 06:00 ICT on day D, `today` = D-1. Cancelling a class then treats
a session dated D-1 (which in ICT already occurred yesterday morning) as `>= today`
and cancels it — cancelling an already-past session; symmetrically a genuinely-today
session can be missed at other boundary hours. Low impact (narrow window, server tz
dependent) but a real correctness edge in a destructive path.

Separately, `estimateSessionCount` (control panel) uses `getDay()` (local) and returns
`0` when `start >= end`, so a same-day single-session window shows "0 buổi". Display
only, but misleading.

---

## F7 — LOW — Two same-day, time-overlapping slots sharing a room/teacher hard-block the whole generation
Files:
- `apps/api/src/routers/class-batch.ts:31-45` (`assertNoDuplicateSlots` dedups only exact `dayOfWeek|startTime`)
- `packages/domain-academic/src/schedule.ts:101-118` (`detectConflicts` compares candidates against each other)

`assertNoDuplicateSlots` rejects only *identical* `(dayOfWeek, startTime)` pairs. Two
slots on the same weekday with *overlapping but non-identical* times (e.g. 18:00–19:30
and 19:00–20:30) and the same room/teacher pass that guard, but `enumerateSessions`
then emits two overlapping same-date candidates, and `detectConflicts` (which also
checks candidates against each other) flags a room/teacher conflict → the entire
`generateSessions` / `generateInitialSessions` throws `CONFLICT` and creates nothing.

Failure scenario: staff add two overlapping weekly slots with the same room by
mistake → instead of a targeted validation message at slot-entry, session generation
fails wholesale with a generic "Trùng lịch" and zero sessions materialize. Low
severity (user error) but the failure mode is opaque and all-or-nothing.

---

## F8 — LOW — Redundant double session-generation in `CreateClassModal`; in-transaction CONFLICT aborts the whole class create
File: `apps/admin/src/class-workspace.tsx:240-267`

`classBatch.create` already auto-generates sessions via `generateInitialSessions`
(class-batch.ts:176-184) inside its transaction. The modal then, on success, calls
`schedule.generateSessions` again with the same dates (lines 258-264). The second call
is idempotent (dedup by date+startTime → creates 0) so it is merely wasteful (an extra
`recomputeCurriculumMapping` full-batch pass), but:

Because `generateInitialSessions` runs *inside* the create transaction and can throw
`CONFLICT` (room/teacher clash with another class, teacher-lite-class-workflows.ts:
133-141), a scheduling clash makes the **entire class creation roll back** — the batch
is never created at all. The user sees "create failed" when the real cause is a slot
double-booking; there is no partial "class created, fix the schedule" state. The
manual "Sinh buổi ngay" escape hatch is unreachable because no batch exists.

---

## F9 — LOW — `overCapacity` off-by-one differs between enroll and transfer
File: `apps/api/src/routers/enrollment.ts:126` vs `:212`

`enroll` computes `overCapacity = activeCount + 1 > capacity` (pre-insert count + the
new one). `transfer` computes `overCapacity = activeCount > capacity` (count taken at a
different point). The two paths report the "vượt sĩ số" warning at counts that differ
by one for the same real occupancy. Warning-only (capacity is a soft cap by decision),
so impact is cosmetic, but the threshold is inconsistent across the two entry points.
(Outside the core scheduling scope; noted for completeness.)

---

## Confirmed-correct (checked, not defects)
- `nextBatchCode` advisory lock: `key2 = year*10 + PROGRAM_ORDER_INDEX (0..2)` is
  collision-free per (facility, program, year); the `batchCodeCounter` unique
  constraint independently serializes concurrent upserts, and the increment is inside
  the tx so a rolled-back create does not leak a sequence gap. (batch-code.ts, code.ts)
- `formatBatchCode` overflow guard (>9999) and 2-digit year formatting are sound.
- `enumerateSessions` / `dateKey` / `getUTCDay` use a single UTC convention end to end
  (no ICT drift *within* generation); F6 is only about the separately-derived `today`.
- `detectConflicts` window queries correctly exclude the sessions being moved
  (`editSlot`) and cancelled sessions.

---

## Unresolved questions
1. F5: Is "cancel drops the unit, re-teach via makeup" the intended curriculum model,
   or should cancellation recompute+re-pack like generate/editSlot? Product decision.
2. F1: Should the two create surfaces expose a real course Select, or is single-course
   auto-pick intended (in which case the alpha `localeCompare` tiebreak is still wrong)?
3. F3: Are `sessions = 0` curriculum units a legitimate seed state? If never, F3's
   drift is dormant; if possible, `totalSessions` and `recompute` must agree on the
   rule.

Status: DONE
Counts by severity — HIGH: 2 (F1, F2) · MEDIUM: 3 (F3, F4, F5) · LOW: 4 (F6, F7, F8, F9). Total 9 defects (2 known confirmed + 7 new).
