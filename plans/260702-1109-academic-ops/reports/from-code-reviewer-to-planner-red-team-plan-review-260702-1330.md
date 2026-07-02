# Red-team review — 260702-1109-academic-ops

Verdict: **FIX-FIRST**

Plan is directionally sound (transfer-by-status-flip, additive schema, DRY reuse of `detectConflicts`/print-HTML) but has one CRITICAL correctness gap that will ship a real access-control bug, one CRITICAL parallel-execution gap (undeclared shared file between two phases marked "independent"), one CRITICAL contradiction with the operator's stated FINAL decision, and several MAJOR anchor/scope errors. None require a rewrite; all are fixable by editing the phase files before coding starts.

All findings verified against the current (uncommitted) working tree, not against plan prose.

---

## CRITICAL

### C1 — Makeup sessions can prematurely open exercises batch-wide (Phase 2 gap, attack vector 2)

`apps/api/src/lib/exercise-open.ts` — `openedUnitIdsFor` (:28-55) and `assertExerciseOpenForStudent` (:57-93) — is the ONLY gate that decides whether a curriculum unit's exercises are visible/submittable. Neither function filters `isMakeup`:

```
apps/api/src/lib/exercise-open.ts:34-49  openedUnitIdsFor: where { status: {not:'cancelled'}, curriculumUnitId: {not:null}, batch.enrollments.some{status:'active'} }
apps/api/src/lib/exercise-open.ts:71-86  assertExerciseOpenForStudent: same shape, no isMakeup exclusion
```

Callers: `apps/api/src/routers/exercise.ts:88` (drives what a student sees as "opened") and `apps/api/src/routers/submission.ts:131,177` (submission gate). Phase 2's only stated safeguard is `curriculum-recompute.ts:30`, which filters `isMakeup:false` for **grade recompute only** — a completely different code path. Phase 2's requirements/steps never mention `exercise-open.ts` and its own "grep guard" instruction ("assert every recompute/progress query includes isMakeup:false") won't catch this because `exercise-open.ts` is not a recompute/progress query in that grep's target set — it's an access gate.

Concrete break: a teacher creates a makeup session mapped to `curriculumUnitId` for a unit the regular class hasn't reached yet (e.g. makeup for one absent student, taught out of order). The instant that makeup session's `endTime` passes, `openedUnitIdsFor`/`assertExerciseOpenForStudent` open that unit's exercises for **every active student in the batch**, not just the makeup attendee — because the gate is keyed on `(curriculumUnitId, batch, ended)`, not on which student attended which session.

Fix: Phase 2 must add `isMakeup: false` (or an explicit inclusion policy, if makeup-opens-for-attendee-only is desired) to both queries in `exercise-open.ts`, and add a regression test asserting a makeup session does not open its unit for non-attendee batchmates.

### C2 — Phase 3 and Phase 4 both own `apps/lms/src/parent-view.tsx`, undeclared in dependency graph (attack vector 6)

`phase-03-attendance.md` frontmatter `owns: […, apps/lms/src/parent-view.tsx]` and `phase-04-pdf-visibility.md` frontmatter `owns: […, apps/lms/src/parent-view.tsx]` — same file, both modifying the same tab region (P3: `sessions` tab per-session status; P4: download buttons on `gradebook` tab, per its own text "Parent UI: download buttons on gradebook tab").

`plan.md`'s dependency graph and file-ownership section only calls out two conflicts (P3+P5 on `attendance.ts`, P1+P5 on lifecycle) and explicitly states:
- `plan.md:39-43`: "P4 pdf/visibility ── independent (new files + parent-view.tsx)"
- `phase-03-attendance.md:44`: "Independent of P1/P2/P4."
- `phase-04-pdf-visibility.md:46`: "Independent of P1/P2/P3/P5/P6 files. Can run parallel."

These three statements are mutually inconsistent with the `owns:` frontmatter and will produce a real merge conflict (or silent overwrite) if P3 and P4 are executed in parallel as the plan explicitly authorizes. Fix: add `parent-view.tsx` to the serialization rule (either P3-then-P4 or P4-then-P3, whichever lands the file scaffolding first), and remove the "independent"/"can run parallel" claims for this specific file.

### C3 — Phase 5's stated blocked-lifecycle set contradicts the operator's FINAL decision, and is internally contradictory

Task brief states operator FINAL decision: *"completed lifecycle does NOT block LMS (only on_hold/withdrawn/transferred block)."* This decision does not appear anywhere in `plan.md`'s "Operator FINAL" line (`plan.md:14`, which only lists final-grade/capacity/excused) — it is missing as a recorded decision.

`phase-05-lifecycle.md:15` asserts as if settled: *"Blocking set = `{ on_hold, withdrawn, transferred, completed }` for LMS access; confirm `completed` should still allow read-only view (likely yes) → see Open Qs."* Then `phase-05-lifecycle.md:41` (Risks) says: *"Risk (high): over-broad gate locks out legitimate `completed` students from viewing history → confirm blocked set with operator before coding."*

So the phase file (a) states a set that includes `completed`, (b) hedges that `completed` "likely" should still have read access despite being in the blocking set (self-contradictory — "blocked" but "likely allowed"), and (c) defers the real decision to "confirm with operator," which the task brief says is already resolved the other way. If an implementer codes directly from `phase-05-lifecycle.md`'s literal `BLOCKED_LMS_LIFECYCLE` set, they will ship `completed` as blocked — directly violating the stated FINAL decision, and locking out every graduated/completed student from ever viewing their own transcript/certificate (which is the entire point of Phase 4's parent-downloadable học bạ/certificate feature — those documents are typically fetched *after* a program completes).

Fix: `plan.md`'s Operator FINAL line must record the blocked set explicitly as `{on_hold, withdrawn, transferred}`, and `phase-05-lifecycle.md:15,41` must be corrected to match — this also unblocks Phase 4's "parent downloads own child's certificate" flow for `completed` students, which as currently drafted would be gated shut by Phase 5 if coded literally.

### C4 — Parent multi-child gating: Phase 5 only touches `studentSession`, never `parentSession`

Verified `packages/auth/src/lms.ts`: there are two resolver functions, `parentSession` (:34-54, used by `mintParentSession` and by `resolveLmsSession` when `claims.kind === 'parent'`) and `studentSession` (:56-73, used by `loginStudent` and by `resolveLmsSession` when `claims.kind === 'student'`). Both currently select the same three student fields (`id, fullName, facilityId`) but **only from a single joined student per account for `studentSession`**, whereas `parentSession` joins **all** of a parent's children via `guardians.map(g => g.student)`.

`phase-05-lifecycle.md` steps (:28-31) say: *"Add `lifecycle: true` to `studentSession` student select"* and *"gating in `studentSession` covers BOTH login + re-check (DRY) — preferred."* This is true only for the student-login path. It never mentions `parentSession` at all — no select addition, no filtering logic, no requirement text. The plan's own Requirements line (`phase-05-lifecycle.md:20`) says *"active session invalidated... active unaffected; parent access to non-blocked child unaffected"* — i.e. it explicitly requires per-child filtering behavior for the parent path — but supplies zero implementation guidance for it and doesn't even acknowledge `parentSession` exists as a second function needing symmetric treatment.

Concrete risk: an implementer following the phase file literally will either (a) miss gating the parent path entirely (withdrawn/on_hold child's grades/attendance/certificate stay visible and, worse, in Phase 3's attendance guard the parent could still be shown mark-able UI for that child), or (b) naively reuse "reject whole session if lifecycle blocked" logic from `studentSession` and apply it to `parentSession`, which would **lock the parent out of ALL children** the moment one child is withdrawn — the exact regression attack vector 3 asks about and the plan's own success criteria (P5 test list, `phase-05-lifecycle.md:37`) requires NOT to happen.

Fix: Phase 5 must explicitly add `lifecycle: true` to `parentSession`'s student select and specify per-child filtering (drop blocked children from `students`/`studentIds`, keep the parent session alive) — this is a materially different code shape from the student-login gate and needs its own steps/tests, not a "DRY, same as studentSession" hand-wave.

---

## MAJOR

### M1 — Phase 1 anchor claim about FinalGrade is factually wrong; masks how transfer actually affects grading

`phase-01-transfer.md:12,18` claims Attendance **and** FinalGrade are "both keyed by `enrollmentId`" and that P1 must "not touch existing Attendance/FinalGrade rows on the old enrollment." Verified `schema.prisma:905-925`: `model FinalGrade` is keyed `@@unique([studentId, program, periodKey])` — it has no `enrollmentId` at all. Verified `apps/api/src/routers/assessment.ts:229-238` (`computeFinalGrade`): the attendance-rate aggregation query is `where: { enrollment: { studentId: input.studentId }, ...(inTerm ? {session:{sessionDate: inTerm}} : {}) }` — it is scoped by **studentId across all of that student's enrollments** within the term window, not by a single enrollment/class.

This means after a mid-term transfer, `computeFinalGrade`'s attendance rate automatically blends attendance from BOTH the old and new class's sessions within the term (attack vector 1's exact question) — which may be the intended business behavior (single blended student record) but the plan never states this as a designed outcome, never tests it, and its stated mental model ("keyed by enrollmentId", "don't touch old rows") is not why continuity works — continuity works because FinalGrade was never per-enrollment to begin with. If left uncorrected, the implementer may add unnecessary enrollment-scoping code to `computeFinalGrade` "to fix" a problem that doesn't exist, or file a wrong migration. Phase 1 test/validation list (`:38`) should explicitly assert "final grade attendance rate blends both enrollments' sessions within the term," not just "rows intact."

### M2 — Transfer revokes access to not-yet-submitted exercises from the old class (Phase 1 gap, attack vector 1)

Verified `apps/api/src/lib/exercise-open.ts:34-46` scopes `openedUnitIdsFor`/`assertExerciseOpenForStudent` to enrollments with `status: 'active'`. After transfer, the old enrollment flips to `status: 'transferred'` (per `phase-01-transfer.md:31`), so any exercise from the old class the student had access to but had not yet submitted becomes permanently `FORBIDDEN` via `assertExerciseOpenForStudent` (`Bài tập chưa mở cho học sinh này`) — even though the session itself still displays in the parent's timeline (`schedule.ts:432-446 sessionsForStudent` filters only `archivedAt: null`, not `status: 'active'`, so old sessions keep showing). Net effect: parent/student sees the old class's session/curriculum content in their history, but any in-flight incomplete exercise from it silently 403s. Plan's success criterion 1 ("new enrollment liền mạch LMS") doesn't cover this — old-class continuity is what's actually at risk, not new-class continuity. Needs an explicit decision recorded (grace period / permanent lock / no special-case) rather than being discovered by a student mid-transfer.

### M3 — Phase 5 file-ownership frontmatter vs. narrative disagree on `attendance.ts` risk framing but omit `lms.ts` blast radius check

Minor compared to C1-C4 but worth flagging: `phase-05-lifecycle.md` frontmatter `owns: [packages/auth/src/lms.ts, apps/api/src/routers/attendance.ts]` is correct and matches code, but the phase file's own risk section never asks for an impact check on `lms.ts` despite the project's CLAUDE.md hard-requiring `gitnexus_impact` before editing any shared-package symbol, and `lms.ts` is explicitly called out mid-file as "process-lifetime module, no per-request state added" — true, but `resolveLmsSession`/`parentSession`/`studentSession` are called from `apps/api/src/index.ts` (multiple routes: `/files/certificate`, `/sse/notifications`, plus every `lmsProcedure` in the tRPC layer) and from `packages/auth/src/index.ts` re-exports. Phase 7's validation step 7 ("run full int suite + lmsCaller regression") is the only stated mitigation — reasonable, but Phase 5 itself should list "run `gitnexus_impact` on `resolveLmsSession`/`parentSession`/`studentSession` before editing" per project rules, not defer entirely to P7.

---

## MINOR

### N1 — Phase 3 "report" scope ambiguity flagged by the plan itself, but no default recorded in plan.md
`phase-03-attendance.md:29` leaves `isMakeup` inclusion in the report denominator as "confirm, default include" — reasonable placeholder, but since C1 already shows `isMakeup` handling is currently under-specified project-wide, this should be resolved in the same pass as C1 rather than left as a runtime TODO.

### N2 — Phase 6 "host panel for room UI" and "note-write mutation existence" are both open unknowns
`phase-06-ui-wiring.md:41` flags both as unresolved before build. Verified `class-workspace.tsx` currently references only `room.create`/`room.list` (grep confirmed, no `room.update`/`room.archive` calls) — consistent with the plan's claim of "0 UI." Low risk (normal, not high-risk phase) but should be resolved before coding starts, not mid-implementation, since it changes which file gets a net-new UI section.

### N3 — Phase 3 term-report join and TZ bucketing (attack vector 5) not addressed
Plan's `report` requirement (`phase-03-attendance.md:18`) doesn't specify month-bucket timezone handling. Existing `sessionEndUtc` in `exercise-open.ts:6-22` hardcodes `ICT_OFFSET_HOURS = 7` for session-end comparisons — if Phase 3's report groups by month using naive `sessionDate` (a `DateTime`, stored presumably UTC-midnight per Prisma convention) without the same ICT offset correction, month-boundary sessions (e.g. a session at 23:00 ICT on the last day of a month, stored as next-day UTC) could bucket into the wrong month. Not confirmed as an actual bug (report code doesn't exist yet) but worth a specific requirement line referencing the existing `ICT_OFFSET_HOURS` convention so the report implementation reuses it rather than reinventing month math.

### N4 — Report/teacher-scope authorization for `attendance.report` unspecified
`phase-03-attendance.md:18` defines the report shape but not its permission scope (teacher sees own classes only vs. director sees all facility). `attendance.ts` currently has no role-scoping beyond `requirePermission('attendance','mark')`; a `report` procedure needs its own explicit authz statement, not an implicit inherit.

---

## Cross-plan / anchor spot-checks (attack vector 6)

- `apps/api/src/routers/attendance.ts` and `apps/api/src/routers/enrollment.ts` are **not** in the current uncommitted diff (`git status` — absent from modified list), so their anchors (`attendance.ts:60`, `enrollment.ts` structure) are stable against the current tree; verified directly, matches plan citations exactly (`:60` left-class guard confirmed at that line).
- `apps/api/src/routers/schedule.ts` IS in the uncommitted diff; re-verified live against current tree (not just plan prose) — `detectConflicts` call sites at `:201` and `:348`, `scheduleRouter`/`SessionLike` import at `:6`, `sessionsForStudent` at `:432` all confirmed present at cited/nearby lines.
- `apps/admin/src/class-workspace.tsx` IS in the uncommitted diff; confirmed it is still the sole `room.` consumer in `apps/admin/src` (only `room.create`/`room.list` calls found) — Phase 6's premise holds.
- `packages/auth/src/permissions.ts`: `enrollment` registry currently has only `enroll`/`complete` (`:111-114`) — no `transfer` key exists yet, confirming Phase 1's "verify key naming before adding" is a real open task, not decorative.
- `curriculum-recompute.ts:30` filter confirmed exact (`isMakeup: false`) — Phase 2's one cited safeguard is real, just insufficient (see C1).

---

## Unresolved Questions

1. Should the operator-FINAL blocked-lifecycle set (`{on_hold, withdrawn, transferred}` per task brief) be written into `plan.md`'s "Operator FINAL" line now, given `phase-05-lifecycle.md` currently contradicts it? (C3)
2. For C4 (parent multi-child gating): confirm the intended UX — does a parent with one blocked child see that child at all (e.g. read-only "withdrawn" badge) or is the child silently dropped from `students`/`studentIds`? This changes both `parentSession` and any UI that renders the child list.
3. For M2 (old-class exercise access after transfer): is losing access to in-flight old-class exercises intentional, or should there be a grace window / explicit "archived, still submittable" state?
4. For C1: is the desired behavior "makeup session opens the unit only for its own attendee(s)" or "makeup sessions never auto-open new units (unit must already be open via a regular session)"? Both are defensible; the plan needs to pick one before Phase 2 is coded.

## Status / Summary

Status: DONE
Summary: FIX-FIRST verdict — 4 CRITICAL findings (makeup-session exercise-gate leak with no isMakeup filter in exercise-open.ts; undeclared parent-view.tsx ownership conflict between "independent" P3/P4; phase-05's blocked-lifecycle set contradicts the operator's stated FINAL decision and is self-contradictory; parent multi-child lifecycle gating only specified for the student-login path, not parentSession) plus 3 MAJOR anchor/scope gaps (wrong FinalGrade keying claim, undocumented old-class exercise access loss after transfer, missing gitnexus_impact call-out for shared auth package) and 4 MINOR open items. All verified against current working tree, not plan prose. Report at plans/260702-1109-academic-ops/reports/from-code-reviewer-to-planner-red-team-plan-review-260702-1330.md.
