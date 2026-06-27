# Verify — LMS / Academic-Scheduling Findings (reports 05 & 06)

Date: 2026-06-27 | Mode: READ-ONLY adversarial re-verification against current `develop` code.
Source reports generated ~10:33 (before fix wave). Each finding re-opened against live code.

## Verdict Table

| # | Finding (report) | Verdict | Evidence (file:line) | Re-rated severity | Fix |
|---|------------------|---------|----------------------|-------------------|-----|
| 05-1 | Submission APIs leak unpublished grade data | **REAL** | `apps/api/src/routers/submission.ts:13-19,30` (`gradeSelect` incl. score/feedback, no `isPublished` filter), returned by `mine` :51-61 and `forStudent` :65-78; UI-only hide `apps/lms/src/student-view.tsx:366`, `parent-view.tsx:412` | High | In `submissionSelect`, conditionally null score/feedback when `grade.isPublished===false` (map after query), or filter `grade` to published; never return raw unpublished score/feedback to LMS principals. |
| 05-2 | Students can submit to unpublished/closed exercises by ID | **REAL** | `submission.save` :107-122 + `submit` :146-176 load exercise via `findUniqueOrThrow` with no `status==='published'` / `dueAt` guard; list filters published only `exercise.ts:24-31`; RLS scopes by enrolment not status | Medium (needs known ID) | In `save`/`submit` assert `ex.status==='published'` and (optionally) `dueAt==null || now<=dueAt` → else `FORBIDDEN`/`CONFLICT`. |
| 05-3 | Grade score can exceed maxScore | **REAL** | `grade.ts:29` zod `score: z.number().min(0)` (no max); `maxScore` read :39 only used for create field :55, never compared to `input.score` | Medium | Fetch `sub.exercise.maxScore`, reject `input.score > maxScore` with `BAD_REQUEST` before upsert (zod can't see maxScore, do it in handler). |
| 05-4 / 06-5 | Term lock doesn't block source grade/qualitative mutations | **PARTIALLY FALSE / INTENTIONAL** | Lock enforced only in `assessment.ts:191` (`computeFinalGrade`); `grade.grade` :35, `grade.publish` :79, `upsertQualitative` :131 have no lock check. **But** stored `FinalGrade` cannot change without `computeFinalGrade`, which IS blocked — so the report's "locked final output can be bypassed" impact is FALSE. | Low (policy gap, not bypass) | No code bug. If product wants source freeze, add term-window lock check to grade/qualitative writes. Needs product decision (see open Qs). |
| 05-5 | Gift program/minLevel gates stored but not enforced | **REAL** | `schema.prisma:569-570` has `program`/`minLevel`; `giftCreate` :17-27 doesn't even accept `minLevel`; `gifts` query :11-15 returns all active facility gifts; `checkRedeem` `packages/domain-rewards/src/stars.ts:34-39` only checks active/stock/balance | Low (feature unwired; minLevel unsettable) | If gating wanted: add `minLevel` to `giftCreate`, filter `gifts` by student program/level, enforce in `redeem`. Else drop columns. Product decision. |
| 05-6 | Manual certificates have no LMS read path | **INTENTIONAL** | decision `docs/decisions/0008-...certificate-manual-only.md`; RLS + router staff-only `certificate.ts:8` | N/A (product gap) | Open product Q — no code defect. |
| 06-1 | Attendance can attach enrollment to wrong session | **REAL** | `attendance.ts:17-66` `mark` takes client `facilityId`+`classSessionId`+`enrollmentId`, upserts on `(classSessionId,enrollmentId)` with **no check** that `enrollment.classBatchId === session.classBatchId`; schema has independent FKs only `schema.prisma:332-335` | Medium | In `mark`, load session+enrollment, assert `enrollment.classBatchId===session.classBatchId` (and derive `facilityId` server-side instead of trusting input) → `BAD_REQUEST` on mismatch. |
| 06-2 | Class reopen restores manually-cancelled future rows | **REAL** | `class-batch.ts` reopen restores blindly: sessions :231-234 (`status:'cancelled' & date>=now → planned`), meetings via `restoreFutureParentMeetings` :33-37; cancel sets plain `'cancelled'` with no provenance marker :149-156; existing test `class-reopen-restores-meetings.int.test.ts` only covers class-cancelled rows, NOT staff-manual ones | Medium | Add provenance (e.g. `cancelledByClassCancel`/`cancelReason` marker set only by `cancel`) and restore only those rows on `reopen`. |
| 06-3 | UTC `today` boundary vs ICT business day | **REAL (minor)** | `class-batch.ts:121,152,228` use `new Date(new Date().toISOString().slice(0,10))` = UTC-midnight; during ICT 00:00–06:59 UTC date = ICT-yesterday, so cutoff wrongly includes yesterday-ICT rows | Low | Compute "today" in `Asia/Ho_Chi_Minh` (e.g. shift +7h before slicing) for the `>= today` cutoffs. |
| 06-4 | Schedule slot/session facility integrity under-validated | **REAL** | `schedule.addSlot` :38-40 writes client `roomId`/`teacherId` unchecked; `ScheduleSlot` room/teacher are bare `String?` no relation `schema.prisma:270-271`; `generateSessions` copies slot room/teacher into session :191-202 (`ClassSession.roomId` FK by id only :289-292, no facility match) | Medium | Validate `room.facilityId===input.facilityId` and teacher belongs to facility in `addSlot`; consider FK on `ScheduleSlot.roomId`. |

## Counts

- Findings reviewed: 11 (10 unique; 05-4 == 06-5).
- REAL: 7 (05-1, 05-2, 05-3, 05-5, 06-1, 06-2, 06-3, 06-4 → 8 rows but 05-5/06-3 low).
- PARTIALLY FALSE / INTENTIONAL: 05-4 (impact false), 05-6 (intentional), 06-5 (dup of 05-4).
- ALREADY-FIXED: 0.
- FALSE (outright): 0 — though 05-4's stated *impact* ("bypass locked output") is false.

## Top 3 Confirmed-REAL (priority)

1. **05-1 Unpublished grade leak (High)** — LMS `submission.mine`/`forStudent` return `score`+`feedback` for grades with `isPublished=false`; only the UI hides them. Direct API callers see un-published scores. Server-side suppression required.
2. **06-1 Attendance session/enrollment mismatch (Medium→High data integrity)** — `attendance.mark` never checks the enrollment and session share a `classBatchId`; a wrong tuple corrupts attendance rate feeding `computeFinalGrade`. Add a same-batch assertion + server-derived facilityId.
3. **05-3 Grade > maxScore (Medium)** — `grade.grade` validates only `score>=0`; an over-max score persists and inflates `norm10()` in final-grade aggregation. Add `score<=maxScore` handler guard.

## Notes / Corrections to source reports

- **05-4 / 06-5 overstated**: the locked `FinalGrade` cannot be "bypassed" by editing source grades — recompute is the only write path and it is blocked. Real residual is source-data drift while locked, a policy choice, not a bypass. Downgrade High→Low.
- Positive controls in both reports confirmed accurate (idempotent star earn, advisory-lock redeem, reject refund/restock, parent-meeting reminder dedup, conflict detection in `generateSessions`).

## Unresolved (product decisions, not bugs)

- Should term lock freeze source grade/qualitative inputs, or only final-grade recompute (current)?
- Should `Gift.program`/`minLevel` gates be enforced, or removed?
- Should certificates be visible to parent/student in LMS?
- Should staff-manually-cancelled future sessions/meetings survive a class reopen?

Status: DONE
