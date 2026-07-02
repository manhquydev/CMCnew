# Red-team plan review — LMS engagement + rewards admin

Verdict: **FIX-FIRST**

Phases 2/3 and most of 4 are solid and verified against the current tree. Phase 1's
core mechanism is broken for the stated common case (exercise published after
session end), and Phase 4 has a real RLS/model design gap plus an unresolved
spam/DoS surface. Neither requires abandoning the plan; both need the design
section rewritten before implementation starts.

## CRITICAL

### C1 — P1 cron design cannot fire for the documented common case (exercise published after session end)

`apps/api/src/lib/exercise-open.ts:28-55` (`openedUnitIdsFor`) and the
`Exercise` model (`packages/db/prisma/schema.prisma:600-619`) confirm: there is
**no `publishedAt` timestamp on `Exercise`** and **no `updatedAt` on
`ClassSession`** (`schema.prisma:324-349`, grep for `updatedAt` shows it absent
from `class_session`). `Exercise.status` can flip `draft → published` at any
time via `exercise.upsert` (`apps/api/src/routers/exercise.ts:99-`) with zero
trace of *when* that happened.

Phase 1's own requirements (phase-01:14) state the trigger data flow as:

> cron tick → find recently-ended sessions with `curriculumUnitId` → resolve
> published exercises on those units → resolve active-enrolled students...

and bounds the scan to `sessionEndUtc ∈ [now-40min, now]`
(phase-01:24), with the query additionally bounded by `sessionDate >=
today-1` (phase-01:24, reinforced in the risk table phase-01:48).

This is inverted from the business reality the brainstorm itself flags as the
common case: teachers upload homework **days after** the session already
happened (LMS is a "làm bài tập sau buổi học" platform per
`lms-positioning-homework-platform` memory / `docs/decisions/0008-*`). When
that happens:

1. The session ended > 40 minutes (often days) ago → outside the scan window on
   every subsequent tick, permanently.
2. The session's `sessionDate` may also be older than `today-1` → excluded by
   the query bound entirely.
3. Nothing in the design re-scans "recently published exercises" against
   already-ended sessions — the trigger is keyed exclusively on session-end
   time, not on publish time.

Net effect: for the majority real-world case, `new_exercise_open` **never
fires**. This isn't a corner case — it directly contradicts the plan's own
acceptance criterion ("Cron emits ONE `new_exercise_open` notification... Only
fires for published exercises whose unit's session... has ended", plan.md:39)
because the design as written structurally cannot catch late-published
exercises for already-ended sessions.

**Fix direction (for the phase author to decide, not prescribing the fix):**
the scan needs a second leg keyed on *exercise publish event*, not just
session-end event — e.g. scan `Exercise` rows with `status='published'` and no
existing `new_exercise_open` notification for any actively-enrolled,
already-ended-session student of that unit, each tick (bounded by
`Exercise.createdAt`/an added `publishedAt`, or by re-running the full
dedup-by-notification-table check across all published exercises each tick
since volume is stated to be small). This also subsumes the original "unit
just opened" case, so it can likely replace the session-scan leg rather than
add a second one — worth re-designing, not patching.

### C2 — Cron downtime blind spot (compounds C1, independently real)

Even for the intended "session just ended, exercise already published"
case: the scan window is `[now-40min, now]` on 30-min ticks (phase-01:24). If
the API process is down (deploy, crash, restart) for more than ~40 minutes,
any session whose end time fell inside that downtime window will never be
inside `[now-40min, now]` once the process resumes — it's permanently missed,
with **no backfill mechanism**. The plan explicitly calls this out as a
mitigated risk ("bound scan... never scan all history", phase-01:48) but the
mitigation only addresses *flood* risk, not the *missed-window* risk it
creates. Given C1 already breaks the late-publish case, this makes the
"session ends → exercise already published" narrow path also lossy on
ordinary ops downtime (documented as normal in this repo — Jenkins deploys,
etc.).

## MAJOR

### M1 — P4: `GuardianLinkRequest.facilityId` is populated only at review time, but `linkRequestList` is specified as "facility-scoped"

Phase-04 model spec (phase-04:17): `facilityId?(from matched student)` —
i.e. null until a staff reviewer resolves the match. But the staff endpoint is
specified as (phase-04:22): `linkRequestList` — "pending queue
(**facility-scoped**) with matched-student candidate lookup (by phone/code)."

These two statements are inconsistent: you cannot RLS-scope-by-facility a row
whose `facilityId` doesn't exist yet. Two real options, neither currently
chosen by the plan:

- (a) `linkRequestList` resolves match candidates query-time and filters the
  *result set* to rows whose candidate student falls in
  `ctx.session.facilityIds` — meaning unmatched/ambiguous rows are invisible
  to every director until enough info exists to place them, and a director
  whose facility a phone/code doesn't belong to never sees that row. This is
  workable but is not what "resolved at review" implies, and needs the RLS
  policy on `GuardianLinkRequest` to be non-trivial (candidate-join-based, not
  a plain `facility_id` column check like every other RLS-scoped table in this
  codebase per `[[project_identity-tables-global-rls]]`).
- (b) `linkRequestList` is actually global (any director sees all pending
  requests, matched or not) — this leaks raw `studentPhone`/`studentCode` PII
  for parents/students outside a director's assigned facilities to that
  director, which the intake's own risk table explicitly calls a hard-gate
  concern ("Missing RLS policy on new table → cross-parent read", phase-04:48)
  it claims to mitigate — but the *model shape itself* makes proper mitigation
  non-obvious.

This is exactly the class of gap flagged by prior review memory
`[[project_identity-tables-global-rls]]`: `ParentAccount`/`StudentAccount` are
global no-facility-scope identity tables, and this new table inherits the same
problem one level further (its own `facilityId` is optional/deferred). The
phase file needs to pick (a) or (b) explicitly and write the RLS policy
against that decision before implementation — right now "add RLS policy in
migration (mirror existing LMS-owned tables)" (phase-04:17) assumes a shape
("mirror existing... tables") that doesn't fit because existing tables have a
non-null `facilityId` at creation.

### M2 — P4: no rate limiting on `requestLink` despite a reusable primitive existing for this exact pattern

`apps/api/src/rate-limit.ts:87-104` ships a generic `throttle(bucketKey,
limit)` explicitly documented for "non-login endpoints (e.g. password-reset
requests)" — the same shape as `requestLink` (repeatable, low-cost, staff-queue
side effect). Phase-04 requirements (phase-04:20) don't mention throttling
`requestLink` at all. Because `requestLink` always returns a generic "request
submitted" response regardless of whether the phone/code matches a real
student (good — this closes the enumeration-oracle concern raised in the
attack brief), there is no information-leak risk from unlimited calls, **but**
there is an unbounded-spam risk: an authenticated parent account can flood the
staff review queue with arbitrary pending rows (cheap insert, no distinct-pair
uniqueness constraint specified in the model). Low severity given `parentProcedure`
requires an authenticated LMS session (not anonymous), but worth a `throttle()`
call per accountId given the primitive already exists and the pattern doc
explicitly invites reuse ("Use the repo's existing patterns... before inventing
new ones" — CLAUDE.md). Not a blocker; note as required scope for phase-04
implementation.

## MINOR

### N1 — Star-adjust race with redeem's advisory lock (P2)

`redeem` (`apps/api/src/routers/rewards.ts:71`) takes
`pg_advisory_xact_lock(hashtext(studentId))` before checking balance, to
guarantee no double-spend across concurrent redeems. The planned `starAdjust`
(phase-02:13) does not take the same lock. A concurrent director `starAdjust
-N` can commit between `redeem`'s balance read and its `starTransaction.create`,
producing a balance that dips below what `checkRedeem` validated — i.e. the
advisory-lock guarantee `redeem` exists specifically to provide is bypassable
via the new admin path. The plan already accepts negative balances as
intentional ("Allow (correction use-case)", phase-02 risk table) so this
doesn't create an invalid state, but it does mean the "atomic redeem" comment
(`rewards.ts:63`, "charter: advisory lock... no double-spend / over-consume")
is no longer a true invariant once `starAdjust` ships un-locked. Recommend the
phase file at least note this explicitly (it currently doesn't mention
`starAdjust` interacting with the advisory lock at all) so it's a documented
trade-off, not a missed one.

### N2 — `editSlot.applyToFuture` can move an already-past-notified session further in a direction that desyncs cron scan bounds (P1, compounding)

`schedule.ts:294-306`: candidates are matched on `sessionDate: { gte: today }`,
i.e. sessions ending *today* (already ended, if earlier today) are eligible
for `applyToFuture` moves. A negative `dayDelta` (e.g. Monday→Sunday, delta
-1) can push a session that starts within the next few days to a date in the
past relative to `now`, which then falls outside P1's `sessionDate >=
today-1` scan bound (phase-01:24) — the moved session can never trigger the
open-notification path. Low probability (requires a specific
`applyToFuture` edit shape), not independently critical, but it's another
instance of the same root issue as C1 (the scan design has no re-entry path
once a session/exercise falls outside the narrow time window). Not a new
finding worth its own fix — folds into the C1 redesign.

### N3 — Line-number drift in phase files (non-blocking, expected)

Phase-01 cites `apps/lms/src/parent-view.tsx:225` for the label switch; current
tree has the `switch (n.type)` at line 225 but the `default` fallback (the
actual edit target) is at line 236 (`describeNotif`,
`apps/lms/src/parent-view.tsx:220-238`). Phase-01 itself already warns "re-grep
at implementation; scout summaries go stale" (phase-01, plan.md:18) — flagging
only so the implementer doesn't anchor on the stale line number.

## Verified as sound (no finding)

- **P2 delivered-state FSM**: stock is decremented at `redeem` time
  (`rewards.ts:79-85`), not at `review`/approve time, so `markDelivered`
  (`approved→delivered`) cannot double-decrement stock, and reject is
  correctly restricted to `pending` only (`rewards.ts:144`) — "reject after
  approve" is already structurally impossible, matching the plan's claim.
- **P2 partial-unique reference**: `(type, reference) WHERE reference NOT
  NULL` is real (raw-SQL migration per `schema.prisma:685-689` comment,
  confirmed not expressible via Prisma `@@unique`); plan's `randomUUID()` per
  manual row is a correct way to satisfy it without colliding.
- **P3 badge archive**: archiving a badge only sets
  `isActive=false/archivedAt` (`badge.ts:92-102`) — no cascade to existing
  `StudentBadge` rows, so already-granted badges are correctly retained by
  the student. Phase-03 doesn't claim otherwise; no gap.
- **P4 anti-takeover core claim**: `guardian.link` (staff-only,
  director-gated, `guardian.ts:66-97`) is the only path that writes a
  `Guardian` row today; phase-04's design (parent writes only
  `GuardianLinkRequest`, staff `linkRequestReview` calls the existing `link`
  upsert logic) is consistent with that and with the RLS-approval-required
  pattern already used elsewhere.
- **Cross-facility approve guard**: `guardian.link`'s `tx.student.findUniqueOrThrow`
  runs under `withRls(rlsContextOf(ctx.session))` — assuming `student` (unlike
  `parent_account`) carries normal facility-scoped RLS, a director cannot
  approve a link to a student outside their assigned facilities even before
  M1 is resolved. (This mitigates the *write* path; M1 is about the *list/read*
  path exposing raw phone/code across facilities before that guard applies.)
- **`parent_meeting_reminder` fallback claim**: confirmed — `describeNotif`
  (`parent-view.tsx:223-238`) has no `case 'parent_meeting_reminder'`, falls to
  the generic "Thông báo mới" default exactly as phase-01 states.

## Unresolved questions

1. C1: does the team want the P1 redesign to replace the session-scan leg
   entirely with an exercise-publish-scan leg, or run both? (Affects whether
   `openedUnitIdsFor`/`sessionHasEnded` stay reused as-is or need a companion
   "exercises with no pending open-notif for their opened units" query.)
2. M1: pick (a) query-time facility-filter on `linkRequestList` or (b) a
   different data model where `facilityId` is best-effort-resolved at request
   creation (e.g. resolve student candidates synchronously in `requestLink`
   and store facilityId immediately, still without creating `Guardian`) —
   this also changes the RLS policy shape for the new table.
3. Is `GuardianLinkRequest` rate-limited by anything else upstream (e.g. a
   global per-session mutation cap) that would make M2 moot? Not found in a
   scoped grep of `apps/api/src` beyond the login/lms-auth/crm/graph-client
   usages of `rate-limit.ts`.

## Status / Summary

Status: DONE
Summary: Reviewed plan.md + all 5 phase files against current tree (exercise-open.ts, exercise.ts, schedule.ts editSlot, rewards.ts, badge.ts, guardian.ts, parent-view.tsx, schema.prisma). Found 1 critical (P1 cron design structurally misses the plan's own stated common case: exercise published after session end — no publishedAt/updatedAt fields exist to catch it), 1 compounding critical (cron downtime blind spot with no backfill), 2 major (P4 facilityId-at-review vs "facility-scoped" list is self-contradictory; P4 has no rate limit on requestLink despite an existing throttle() primitive built for this exact pattern), and 3 minor findings. P2/P3 and P4's anti-takeover core design verified sound. Verdict FIX-FIRST — phase-01 and phase-04 design sections need rework before implementation; phase-02/03 can proceed as written.