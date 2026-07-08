# Teacher-Lite Prod Hardening — Deep Review Report

Scope: 8 requested areas, all verified against current file contents (not the summary given in the prompt). `pnpm -r typecheck` passes clean (no edits made — read-only review).

## TOP FLAG (High) — read this first

**`exercise.listForPrincipal` silently loses all past exercises once an enrollment is marked `completed`.** This is real, reproducible from the code, and is very likely an unintended production regression, not a deliberate design choice — see finding H1 below.

---

## High Priority

### H1. Completing an enrollment retroactively hides a student's entire homework/exercise history from the LMS (confirmed regression)

- `apps/api/src/lib/exercise-open.ts:99-171` (`openedLessonIdsFor`/`openedUnitIdsFor`) — both filter `batch.enrollments.some({ studentId, status: 'active', archivedAt: null })`. `EnrollmentStatus` has a distinct `completed` value (`packages/db/prisma/schema.prisma:70-72`), which is `!== 'active'`.
- `apps/api/src/routers/exercise.ts:137-156` (`listForPrincipal`) calls those two functions with no fallback for non-active enrollments — a lesson/unit tied only to a now-`completed` enrollment drops out of the opened-set entirely.
- `apps/lms/src/student-view.tsx:515-573`: the exercise list rendered to the student comes **only** from `exercise.listForPrincipal` (`exercises` state). `submission.mine` (`apps/api/src/routers/submission.ts:68-79`) is joined by `exerciseId` purely to attach grade/status — it carries no title/description/PDF metadata of its own. Once `exercises` returns `[]` for that class, `visibleExercises` (`student-view.tsx:572-573`) has nothing to render even though the underlying `Submission` rows (including published scores/feedback) still exist in the DB and are still returned by `submission.mine`.
- **Concrete failure scenario**: director marks a student's enrollment `completed` (course finished/graduated) → within the same request cycle, that student's LMS homework tab goes from "N exercises, some graded" to empty, for *all* exercises ever assigned in that class, including ones already graded with a score. Same effect propagates to `climb-view.tsx` and `parent-view.tsx` (both consume `exercise.listForPrincipal` the same way — `apps/lms/src/climb-view.tsx:19-57`, `apps/lms/src/parent-view.tsx:46,672`).
- Data is not deleted (submissions/grades remain in `submission` table), but the product-facing feature silently regresses — parents/students lose the ability to review past homework/scores for a completed course, with no error, no warning, no admin visibility into "this is why it disappeared."
- Distinguish from theoretical: this is not an edge case — it is the deterministic, guaranteed behavior of every enrollment-completion for any class where the student had exercises. Given the intake docs' hard gate on "existing behavior" changes, this deserves a decision doc if it's actually the intended product behavior; more likely it's a gap the enrollment-completion mutation author didn't consider (their probable target was "stop showing *future/new* exercises", not "hide history").
- **Recommendation**: `openedLessonIdsFor`/`openedUnitIdsFor` should also honor enrollments with `status: 'completed'` (not just `active`) when computing "already opened," i.e. drop `active`-only for the *opened* check (which is about "has this content already unlocked", a one-way ratchet) and instead gate only *future* unlocks on active status. Concretely: union in `status: { in: ['active', 'completed'] }` for the opened-set query, while `assertExerciseOpenForStudent` (submission creation gate) can keep requiring `active` if new submissions genuinely should stop once a course is done — that's a separate, more defensible call.

---

## Medium Priority

### M1. `sessionEvidence.detailForStaff` / `listByClass` are facility-scoped, not teacher-scoped (read-only IDOR-shaped gap, likely already-accepted pattern)

- `apps/api/src/routers/session-evidence.ts:44-107`: `listByClass` and `detailForStaff` run under `requirePermission('sessionEvidence', ...)` (roles `giao_vien`, `giam_doc_dao_tao` — `packages/auth/src/permissions.ts:100-106`) with RLS scoping (`session_evidence_isolation` policy, `packages/db/prisma/migrations/20260701010000_session_evidence/migration.sql:81-98`) that allows any staff member whose `facility_id = ANY(app_facility_ids())` — i.e. any teacher at the same facility, not just the teacher assigned to that specific class/session.
- Contrast with `upsertDraft`/`publish` in the same file (lines 135, 227), which correctly call `assertTeachingSessionMutationAllowed` to restrict *mutation* to the assigned teacher (or director).
- **Concrete scenario**: Teacher A (facility X) can read Teacher B's (also facility X) session evidence detail — full roster names, per-student comments (`strength`/`needsImprovement`/`teacherNote`), internal notes — for a class Teacher A has no assignment to, provided they can obtain/guess the `classSessionId`/`classBatchId` UUID (e.g. via the shared class list in the admin UI, which is itself facility-scoped and visible to co-located teachers).
- This matches a **prior accepted decision** recorded in project memory (`rbac-teacher-access-decisions.md`, 2026-06-28: "teacher sees facility-wide student PII/financials (accepted)"), so I am not raising this as a new blocker — flagging only so it's visible in this pass, per the review posture, and because `internalNote` (teacher-only remarks about students) reaching facility-wide teacher visibility wasn't explicitly enumerated in that prior decision. Worth a one-line confirmation that `internalNote` visibility is intended to be facility-wide too, not just roster/photos/public comments.

---

## Low Priority / Verified Clean

- **Photo-ref auto-drop in `upsertDraft`** (`session-evidence.ts:142-178`): correctly non-destructive — dead refs are dropped from the photo list only, comments/summary saved regardless, `droppedPhotoCount` returned to the caller. No silent data loss found; the previous evidence's other data isn't touched.
- **Cancelled-batch publish guard** (`session-evidence.ts:228-230`): only blocks `publish`, not `upsertDraft` — correct, since drafts never reach parents/LMS.
- **IDOR on mutations** (`upsertDraft`, `publish`): both correctly call `assertTeachingSessionMutationAllowed` (`teaching-authz.ts:8-18`), which checks facility membership AND (unless director/super-admin) `session.teacherId === actor.userId`. No bypass found.
- **`class-workspace.tsx` auto-generate-on-create** (lines 222-278): both failure branches (missing `endDate`, `generateSessions` throwing) are surfaced via `notifyError`/`notifyInfo`, never swallowed; class creation itself still succeeds and reports success separately. The fallback "Sinh buổi ngay" button (lines 664-708, 1329-1345) is reachable whenever `sessions.length === 0` and gated by the same `schedule.addSlot` permission as the original manual flow — no permission widening. A `sessionsReloadKey` remount pattern (line 1298) was added to fix a real stale-cache bug (SessionsTab has no react-query) — verified the fix is correctly wired (`setSessionsReloadKey` called after successful generate, line 1341).
- **Photo/PDF disk stores**: `putSessionPhoto`/`putPdf` are the only writers found repo-wide (`writeFile` grep) for `.data/session-photos` and `.data/pdf`; both validate magic bytes + size before persisting. `docker/docker-compose.prod.tls.yml:113-114` bind-mounts both directories at paths matching the Dockerfile's `WORKDIR /app/apps/api` (so `process.cwd()`-relative defaults `.data/pdf` / `.data/session-photos` land on the mount) — confirmed persistent across container recreation. No bypass path found.
- **`pdf-annotator.tsx` caps**: `MAX_ITEMS=500` enforced both client-side (`pdf-annotator.tsx:399,407`) and independently server-side (`apps/api/src/annotation.ts:11,46` — same constant, separately defined, not shared/imported, so a future edit to one without the other would silently desync the cap; minor DRY note, not a bug today). `outerRef`/`containerRef` fit-scale effect (`pdf-annotator.tsx:260-268`) resets `fitAppliedRef` on `pdfRef` change (line 219) and re-fires on `dims` populating for the new doc — traced through the 1-page vs 50-page transition and found no dims-desync bug; React 18 batches `setDims`+`setLoading` in the same tick so `outerRef.current` is committed before the fit effect runs.
- **`App.tsx` `ALL_SECTION_KEYS`**: cross-checked every `key:` literal used in `shell.tsx`'s `buildNavGroups` (schedule, attendance, attendance-report, grading, assessment, classes, courses, student-mgmt, meetings, levelup, certificate, students, guardians, family-intake, crm, cskh, rewards, badges, finance, email-outbox, revenue-report, reconcile-worklist, hr, kpi, compensation, my-payslips, payroll-checkin, checkin, shift-registration, overview, biz-director-cockpit, edu-director-cockpit, org, facility-network, shift-config, staff-lite) against the `ALL_SECTION_KEYS` set (`App.tsx:589-600`). All present; `certificate` is deliberately excluded with an explanatory comment (feature hidden, `visible:false`). No other unreachable section keys found.
- **`email-outbox.ts`**: full retry/backoff (`MAX_ATTEMPTS=5`, exponential backoff capped at 30min), audit log on both success and terminal failure, stale-lease reclaim, per-transport rate-limit isolation, single-instance overlap guard (documented as a known limitation for multi-replica, not applicable to current topology). No silent-drop path found — every terminal failure is logged via `logEvent` with the error message and recipient. `submission.submit`/`save` similarly always throw (CONFLICT/NOT_FOUND) rather than silently no-op on race/missing-row conditions.

---

## Unresolved Questions

1. **H1** — is hiding past exercises for `completed` enrollments intentional product behavior (e.g. "course closed = archive access removed") or an oversight? If intentional, it should be a recorded decision per `docs/decisions/`, since it's a behavior change with real user impact (hard-gate item "Existing behavior" per `docs/FEATURE_INTAKE.md`).
2. **M1** — confirm whether `internalNote` (teacher-private notes) facility-wide visibility to co-teachers was covered by the 2026-06-28 RBAC decision, or should be tightened to assigned-teacher-only even though roster/comments/photos stay facility-wide.

Status: DONE_WITH_CONCERNS
Summary: One confirmed High-severity regression (H1: completed enrollments hide all past LMS exercises/grades) and one Medium note re-flagging an already-accepted facility-wide read visibility pattern (M1). All other requested areas (photo/pdf storage bypass, nav-key reachability, auto-generate-sessions error handling, email outbox drop risk, annotator caps) checked clean.
