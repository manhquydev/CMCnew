---
title: "Teacher-lite restructure — 2 roles (admin / teacher)"
description: "Nav cleanup to 2 experiences + 15-min attendance gate + present/late comment lock + add-existing-student enroll, no RBAC/DB change."
status: done
priority: P1
effort: ~14h
branch: develop
tags: [teacher-lite, attendance, nav, enrollment, rbac-stable, tdd]
created: 2026-07-09
---

# Teacher-lite restructure — 2 roles (admin / teacher)

Source of truth: `plans/reports/brainstorm-260709-1124-teacher-lite-restructure-2roles-report.md`
(4 user-decided points + 3 agent-delegated defaults, all approved).

Goal: collapse teacher-lite into **two clear surfaces** — `admin` (director: super_admin +
giam_doc_dao_tao + giam_doc_kinh_doanh) and `teacher` (giao_vien, schedule-only) — plus three
real behavior fixes (attendance 15-min gate, present/late comment lock, add-existing-student).
**No DB role change, no RLS migration.** RBAC stays as-is (decision 0040 governance).

## Governance (hard rules)

- **Decision 0039/0040**: teacherLite.* API bypass keeps RLS + audit + anti-escalation. Any new
  teacherLite mutation MUST use `requirePermission('teacherLite', …)`, `withRls(...)`, and `logEvent`.
- **Server is source of truth** for the 15-min gate. UI mirrors (disabled + tooltip); never UI-only.
- **Nav-hide ≠ Set-removal** (lesson from df2a153): sections hidden from nav MUST stay in
  `TEACHER_SURFACE_SECTIONS` (app-surface.ts:11) so directors keep direct-URL + bookmark reach.
- **GitNexus impact gate** (repo CLAUDE.md): before editing any API symbol, run
  `gitnexus_impact({target, direction:'upstream'})` and report blast radius; warn on HIGH/CRITICAL.
  Symbols in scope: `attendance.mark`, `attendance.markAll`, `sessionEvidence.upsertDraft`,
  new `teacherLite.enrollExistingStudent`.

## Phases

| # | Phase | Items | Type | Risk | Effort | Status | Depends |
|---|-------|-------|------|------|--------|--------|---------|
| 1 | [Nav restructure](phase-01-nav-restructure.md) | #4 teacher-only=schedule, #5 hide 5 sections | Nav cleanup | Low | ~3h | done (tsc✓) | — |
| 2 | [Attendance gate + comment lock](phase-02-attendance-gate-and-comment-lock.md) | #1 15-min gate (API+UI), #2 present/late comment lock (server+UI) | TDD API+UI | High | ~5h | done (7/7 int✓, +8 companion test fixes, tsc✓) | — |
| 3 | [Enroll existing student](phase-03-enroll-existing-student.md) | #3 teacherLite.enrollExistingStudent + UI | TDD API+UI | Med | ~4h | done (6/6 int✓, tsc✓) | — |
| 4 | [Verify CRUD + LMS](phase-04-verify-crud-and-lms.md) | #6 HS/PH/GV CRUD, #7 LMS receives data | Verify | Low | ~2h | done (CRUD routes✓; LMS via int tests✓; live browser = manual follow-up) | 1,2,3 |

Phases 1–3 have **disjoint file ownership** (see below) → parallelizable. Phase 4 runs last (verifies 1–3).

## File ownership (no cross-phase overlap)

- **Phase 1**: `apps/admin/src/shell.tsx` (teacher nav builder ~L680-883), `apps/admin/src/app-surface.ts` (comment only).
- **Phase 2**: `apps/api/src/routers/attendance.ts`, `apps/api/src/routers/session-evidence.ts`,
  new `apps/api/src/lib/attendance-window.ts`, `apps/admin/src/teacher-schedule-session-detail.tsx`,
  new tests `apps/api/test/attendance-window-gate.int.test.ts` + `apps/api/test/session-comment-present-gate.int.test.ts`.
- **Phase 3**: new `apps/api/src/services/teacher-lite-enroll-existing.ts`, `apps/api/src/routers/teacher-lite.ts`,
  `packages/auth/src/permissions.ts` (add one key), `apps/admin/src/teacher-lite-class-control-panel.tsx`,
  new test `apps/api/test/teacher-lite-enroll-existing.int.test.ts`.
- Phase 2 & 3 both touch nothing Phase 1 touches. Phase 2 touches session-detail.tsx; Phase 3 touches
  class-control-panel.tsx — different files. Safe to run in parallel.

## Data flow (what enters / transforms / exits)

- **#1 gate**: client calls `attendance.mark`/`markAll` → server derives session (sessionDate,
  startTime, endTime) → `assertAttendanceWindowOpen(now, session)` throws BAD_REQUEST outside
  window → else upsert Attendance + audit. UI reads window from same session data to disable button.
- **#2 comment lock**: client `sessionEvidence.upsertDraft({comments[]})` → server loads session
  enrollments + **attendance rows** → reject comment for a student not present/late. UI already
  filters the render (session-detail.tsx:451-455) — server becomes the real gate.
- **#3 enroll-existing**: client picks studentId + classBatchId → `teacherLite.enrollExistingStudent`
  → validate batch facility, block dup (unique `[classBatchId, studentId]`, incl. archived) → create
  Enrollment(active) + set lifecycle active + audit → returns enrollment. LMS then sees the student
  under that class via existing exercise-open flow.

## Acceptance criteria (measurable)

1. giao_vien-only login shows **only "Lịch dạy"** in nav; no overview/students/guardians/attendance-
   report/levelup/etc. Director nav unchanged (verify a super_admin still sees all sections).
2. Học bạ, Duyệt cấp độ, Họp PH, Báo cáo điểm danh, Cockpit **absent from teacher-lite nav** but
   still reachable by direct URL for a director (section still in `TEACHER_SURFACE_SECTIONS`).
3. `attendance.mark`/`markAll` **reject** before (start−15min) and after end-of-session-day (ICT),
   **allow** inside window — proven by new int test (green). UI button disabled outside window with
   tooltip "Mở điểm danh từ HH:MM".
4. `sessionEvidence.upsertDraft` **rejects** a comment for a student marked absent (or unmarked) —
   proven by new int test. UI shows only present/late students (already true).
5. `teacherLite.enrollExistingStudent` enrolls succeeds once, **rejects duplicate** (active + archived)
   — proven by new int test. UI action in class hub lists existing students and enrolls.
6. HS/PH/GV CRUD verified reachable+working for director; LMS student/PH sees teacher comments/
   grades/photos. Gaps (if any) logged as follow-up, not silently fixed.

## Rollback

- Phase 1: pure UI/nav; revert shell.tsx diff — no data touched.
- Phase 2: gate is additive guard; revert restores prior (ungated) behavior. No schema change.
- Phase 3: new mutation + new file; revert removes the mutation + permission key + UI button. No
  data migration; enrollments created stay valid (identical shape to enrollment.enroll rows).
- Phase 4: read-only verification; nothing to roll back.

## Test matrix

| Item | Unit | Integration | E2E/manual |
|------|------|-------------|-----------|
| #1 gate | window helper (pure fn) | attendance-window-gate.int (allow/before/after) | button disabled+tooltip |
| #2 comment | — | session-comment-present-gate.int | render shows present/late only |
| #3 enroll | — | teacher-lite-enroll-existing.int (ok/dup active/dup archived) | class hub enroll flow |
| #4/#5 nav | — | — | director vs giao_vien nav; direct-URL reach |
| #6/#7 verify | — | — | CRUD + LMS live check |

## Closeout (2026-07-09)

- All 4 phases DONE. Pipeline: brainstorm → plan → TDD → implement (2 phases parallel) → review →
  test → audit → fix. Changed-area tests all green: 13 new int (window/comment/enroll) + 5
  enrollment-transfer + 49 across 7 companion-fixed suites = 67 pass. Both typechecks clean.
- **Audit (code-reviewer) verdict:** PASS-WITH-CONCERNS. Companion fixes to 8 test files verified
  seed-only (0 assertions weakened). Fixed: (Finding #1) `enrollment-transfer` test (c) re-dated to
  today so it independently exercises the transferred-enrollment guard (asserts the specific message,
  not bare BAD_REQUEST); (Finding #3) dropped unused `endTime` from attendance selects.
- **Contract change (call out in PR):** `sessionEvidence.upsertDraft` now rejects comments for a
  student not marked present/late (was enrolled-only) — teacher must mark attendance before drafting a
  comment; error message changed accordingly.
- **Decisions taken (agent-delegated):** #3 built new `teacherLite.enrollExistingStudent` (not reuse
  `enrollment.enroll`) for clean decision-0040 governance; #1 window close = end of session's ICT day.
- **Blast-radius lesson:** gating `attendance.mark`/`markAll` broke 8 existing suites that seeded via
  the router with out-of-window dates (spec anticipated only 1). Pattern: seed via SUPER tx when the
  test asserts something other than mark's own authz; move fixture date into window otherwise.
- **Manual follow-up (not blocking):** live-browser verify teacher-only nav = Lịch dạy only + director
  nav on dev; other admin surfaces (`session-workspace.tsx`, `attendance-roster.tsx`) call mark/markAll
  and now get server BAD_REQUEST outside window with no client tooltip (server-truth OK; add mirror if
  those surfaces stay in active use).

## Deploy + live-verify (2026-07-09)

- **Deployed both envs via Jenkins:** dev (build #91, develop 5f9c667) + prod (build #45, main 42bed12
  = tree-identical to develop) green + health-verified + prod smoke passed. No DB migration.
- **Live browser-verify on devteacher.cmcvn.edu.vn** (staff password login via DB test accounts —
  STAFF_PASSWORD_LOGIN=true, no SSO needed; created teacher-verify@dev.local + director-verify@dev.local
  as giao_vien / giam_doc_dao_tao with pgcrypto bcrypt):
  - **giao_vien**: nav shows ONLY "Lịch & buổi học" (→ schedule). No other sections. ✓ (acceptance #1)
  - **director**: 5 teacher-lite groups only (Lịch & buổi học / Lớp & bài tập / Học viên / Tiếp nhận
    học viên / Điều phối đào tạo); NO ERP groups (Tài chính/Nhân sự/CRM/Công ca); calendar renders. ✓
- **Landing fix (follow-up commit a75e098):** giao_vien default landing was still `overview`; changed to
  `schedule` so a teacher goes straight to the calendar (matches "vào thẳng lịch" + ERP-surface behavior).
  Redeployed dev+prod.
- **Dev test accounts left in place** (teacher-verify@ / director-verify@dev.local, pw VerifyDev@2026) for
  future verification — dev only, not prod.

## Unresolved questions

1. **#3 build-new vs reuse**: `enrollment.enroll` (enrollment.ts:51, gated `['sale','giam_doc_kinh_doanh']`)
   already enrolls existing students + blocks dup. Brainstorm chose a NEW `teacherLite.enrollExistingStudent`
   (decision-0040 namespace, adds giam_doc_dao_tao, no CRM opportunity/notify coupling). Plan follows the
   brainstorm. Cheaper alternative = add `giam_doc_dao_tao` to `enrollment.enroll` perm + reuse. Confirm
   before Phase 3 if cost matters. (Recommendation: build new — cleaner governance, mirrors direct-provisioning.)
2. **#1 window end** — "hết ngày buổi học" interpreted as end of the session's ICT calendar day
   (sessionDate 24:00 ICT = 17:00 UTC same day). Confirm this is the intended late-edit cutoff (vs.
   session end time, vs. +N hours). Default chosen per brainstorm item 5.
