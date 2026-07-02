---
title: "Academic ops: transfer + makeup + attendance + học bạ PDF + lifecycle"
description: "Close month-1 giáo vụ seams: student class transfer, makeup sessions, bulk attendance + reports, học bạ/certificate PDF with LMS parent visibility, and lifecycle access enforcement."
status: completed
priority: P1
effort: 3-4d
branch: develop
tags: [academic, enrollment, attendance, certificate, lifecycle]
created: 2026-07-02
---

# Academic Ops

Source: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md` §"PLAN 5".

Operator FINAL (do not re-litigate):
- D-P5a: final grade stays instant-publish (no gate on `computeFinalGrade`); capacity stays soft-warning; `excused` stays a checkbox modifier (not a 4th status).
- **Blocked-LMS-lifecycle set = EXACTLY `{on_hold, withdrawn, transferred}`.** `completed`, `active`, `admitted` do NOT block LMS access (completed must read transcript/certificate — P4's whole point). (P5)
- **Transfer blend is intentional design, not accident.** `FinalGrade` is keyed `@@unique([studentId, program, periodKey])` — NOT `enrollmentId`. `computeFinalGrade` attendance rate (`assessment.ts:229-238`) already aggregates by `studentId` across ALL of a student's enrollments in the term. Keep it. Do NOT add enrollment-scoping. (P1)
- **Makeup opens exercises PER-STUDENT, not class-wide.** A makeup session (`isMakeup=true`) never counts toward "unit opened" for the whole class; only a student with an Attendance (present/late) row on that makeup session gets individual early access to its unit's exercise. Rest of class still waits for their own regular session. (P2)
- **Transfer immediately cuts old-class exercise access (accepted, KISS).** Old enrollment flips to `transferred`; `exercise-open.ts` scopes `status:'active'`, so in-flight unsubmitted old-class exercises stop being submittable at transfer. Old sessions still show in parent timeline = historical record, not an access grant. (P1/M2)

## Lane & Intake (HIGH-RISK)

Hard gates: **Data model** (Enrollment transfer semantics, Attendance bulk write, ClassSession makeup rows), **Existing behavior** (attendance-roster, recompute, LMS login path), **Authorization** (lifecycle → LMS access gating). ≥4 flags → high-risk.

Durable artifacts (checkpoints, NOT code): high-risk story folder (`docs/templates/high-risk-story/`); **Decision** — student class transfer preserves history via status-flip (no re-enroll data loss) + lifecycle gates LMS login. Harness: `intake` → `story add/update` per phase → `decision add` → `trace` at each phase close.

## Phases

| # | Phase | Status | Link |
|---|-------|--------|------|
| P1 | Enrollment transfer (old→transferred + new enrollment, history preserved, chatter, LMS continuity) | completed | [phase-01-transfer.md](phase-01-transfer.md) |
| P2 | Makeup sessions (createMakeupSession, isMakeup=true, detectConflicts reuse, roster) | completed | [phase-02-makeup.md](phase-02-makeup.md) |
| P3 | Attendance bulk mark-all + per-student/class/term report + parent per-session visibility | completed | [phase-03-attendance.md](phase-03-attendance.md) |
| P4 | Học bạ + certificate PDF (shared print-render infra) + LMS parent visibility | completed | [phase-04-pdf-visibility.md](phase-04-pdf-visibility.md) |
| P5 | Lifecycle enforcement (withdrawn/paused → block LMS login + attendance + visible state) | completed | [phase-05-lifecycle.md](phase-05-lifecycle.md) |
| P6 | UI wiring: room.update/archive + parentMeeting.setSchedule + meeting outcome note | completed | [phase-06-ui-wiring.md](phase-06-ui-wiring.md) |
| P7 | Validation (int tests + e2e + migration 0-drift on prod-mirror) | completed (except P6 e2e/browser-PDF flows, blocked on pre-existing DEBT.md ESM/CJS issue) | [phase-07-validation.md](phase-07-validation.md) |

## Dependency graph

```
Plan 1 260702-0929 (session/exercise shape) ──► THIS PLAN
P1 transfer ─┐
P2 makeup  ──┴─> (disjoint routers) 
P3 attend ──► P4 pdf ── serialize: BOTH edit parent-view.tsx (P3 sessions tab, then P4 gradebook download btns)
P3 attend ──► P5 lifecycle ── serialize: BOTH edit attendance.ts (P3 endpoints first, then P5 guard)
P1 transfer ──► P5 lifecycle (same student lifecycle path) → P1 first
P6 ui-wiring ── independent (room/parent-meeting)
P7 depends on ALL (P1–P6)
```

MAY run parallel to Plan 4 finance (disjoint files: finance.ts/dashboard.ts/email vs academic routers). Verify no shared edit before parallelizing.

File-ownership (serialization is mandatory — these are NOT parallel-safe):
- `apps/api/src/routers/attendance.ts`: P3 (markAll/report) FIRST, then P5 (lifecycle guard) rebases.
- `apps/lms/src/parent-view.tsx`: P3 (per-session status on `sessions` tab) FIRST, then P4 (download buttons on `gradebook` tab) rebases on top. Small, disjoint tab regions — kept as two phases, not merged.
- Enrollment/student lifecycle: P1 FIRST, then P5.
- `apps/api/src/lib/exercise-open.ts`: P2 only (C1 two-tier makeup gate). P1 does NOT edit it (accepts existing `status:'active'` cut).

## Success criteria

1. Transfer: chuyển lớp giữ nguyên attendance + grade history; new enrollment liền mạch LMS; both visible to parent.
2. Makeup: buổi bù tạo được (conflict-checked), điểm danh được, KHÔNG lệch recompute/final grade.
3. Attendance: cô điểm danh 1 chạm (mark-all); báo cáo theo HS/lớp/kỳ; PH thấy per-session.
4. PDF: PH tải được học bạ + chứng chỉ PDF; staff vẫn tải được.
5. Lifecycle: HS withdrawn/paused KHÔNG đăng nhập LMS được + không điểm danh được + trạng thái hiển thị.
6. UI: room sửa/lưu-trữ; PH thấy giờ họp đã chốt; staff ghi outcome note.

## Rollback

Per-phase DB rollback in each phase file. All schema deltas additive (nullable columns / new rows) → down-migration drops added columns only; no destructive change to existing attendance/enrollment rows.
