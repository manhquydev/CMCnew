# Phase 4 — Verify HS/PH/GV CRUD + LMS data reception (verification only)

- **Date:** 2026-07-09 · **Priority:** P1 · **Status:** pending · **Risk:** Low · **Effort:** ~2h
- **Items:** #6 (HS/PH/GV CRUD complete), #7 (LMS student/PH receive teacher's data)
- **Depends on:** Phases 1, 2, 3 merged. **No code unless a gap is found** (then log follow-up, don't silently fix).

## Scope / method

Live verification on the running dev stack (per memory `lms-live-verification-harness`: seed accounts +
tRPC-over-curl or browser). Director persona = super_admin or giam_doc_dao_tao; teacher = giao_vien;
LMS = a parent/student account. Record pass/fail per checklist; do not change scope decisions.

## #6 — HS / PH / GV CRUD checklist

Verify each is reachable (nav for director after Phase 1) AND functional:

- **Học sinh (students)** — panel `apps/admin/src/*students*` (nav key `students`, shell.tsx:737).
  Check: list, create, edit (student.ts:11 list, :109 create, :207 update), archive path. Direct-URL
  `/students` loads for director.
- **Phụ huynh (guardians)** — hub (nav key `guardians`, shell.tsx:738). Check: list, link/create,
  edit; guardian↔student link. Router `guardian.ts`.
- **Giáo viên (staff-lite)** — `teacher-staff-lite-panel` (nav key `staff-lite`, shell.tsx:816,
  visible to super_admin/giam_doc_dao_tao per teacher flatMap shell.tsx:876-877). Check: list teachers,
  create/edit lean roster.
- Confirm the 4 admin nav items from brainstorm acceptance render for director: Lớp học, Học sinh,
  Phụ huynh, Giáo viên (post-Phase-1).

## #7 — LMS reception checklist

Confirm student/PH LMS sees data the teacher produced (all already-shipped paths — verify, don't build):

- **Comments/evidence** — published SessionEvidence + per-student comments appear in LMS after teacher
  `publish` (session-evidence.ts publish path; forStudent/LMS read). Verify a *present* student sees
  their comment (ties to Phase 2 #2 lock — absent students correctly get none).
- **Grades** — `grade.grade` results visible to student/PH (submission/grade LMS read).
- **Photos** — session photos visible via `/files/session-photo/:ref` RLS gate for enrolled student.
- **Attendance** — `attendance.forStudent` (attendance.ts:334-364) returns per-session history to LMS
  principal; verify marks from Phase 2 gate window show up.
- **New enrollment (Phase 3)** — a student added via `enrollExistingStudent` appears in LMS class list
  and exercise-open unlocks published exercises for them (exercise-open.ts openedLessonIdsFor scopes
  status:'active' — the new enrollment is active).

## Todo

- [ ] Director nav shows exactly the 4 admin sections (Phase 1 result)
- [ ] HS CRUD works (list/create/edit/archive)
- [ ] PH CRUD works (list/link/edit)
- [ ] GV staff-lite CRUD works
- [ ] LMS: present student sees comment; absent student sees none
- [ ] LMS: grades + photos + attendance history visible
- [ ] LMS: Phase-3 enrolled student sees class + opened exercises
- [ ] Log any gap as a follow-up item (do NOT silently fix scope)

## Success criteria

- All checklist items pass, OR gaps are documented with file:line + proposed follow-up (separate task).
- No scope decision reversed without user confirmation (review-audit-self-decision rules).

## Risk / security

- Low: read-only verification. Any fix discovered = new scoped task, not folded in here.
- If a CRUD gap is found in an authz path, treat as high-risk (intake gate) before fixing.
