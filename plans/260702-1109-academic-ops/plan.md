---
title: "Academic ops: transfer + makeup + attendance + học bạ PDF + lifecycle"
description: "Close month-1 giáo vụ seams: student class transfer, makeup sessions, bulk attendance + reports, học bạ/certificate PDF with LMS parent visibility, and lifecycle access enforcement."
status: pending
priority: P1
effort: 3-4d
branch: develop
tags: [academic, enrollment, attendance, certificate, lifecycle]
created: 2026-07-02
---

# Academic Ops

Source: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md` §"PLAN 5". Operator FINAL (do not re-litigate): D-P5a final grade stays instant-publish (no gate on `computeFinalGrade`); capacity stays soft-warning; `excused` stays a checkbox modifier (not a 4th status).

## Lane & Intake (HIGH-RISK)

Hard gates: **Data model** (Enrollment transfer semantics, Attendance bulk write, ClassSession makeup rows), **Existing behavior** (attendance-roster, recompute, LMS login path), **Authorization** (lifecycle → LMS access gating). ≥4 flags → high-risk.

Durable artifacts (checkpoints, NOT code): high-risk story folder (`docs/templates/high-risk-story/`); **Decision** — student class transfer preserves history via status-flip (no re-enroll data loss) + lifecycle gates LMS login. Harness: `intake` → `story add/update` per phase → `decision add` → `trace` at each phase close.

## Phases

| # | Phase | Status | Link |
|---|-------|--------|------|
| P1 | Enrollment transfer (old→transferred + new enrollment, history preserved, chatter, LMS continuity) | pending | [phase-01-transfer.md](phase-01-transfer.md) |
| P2 | Makeup sessions (createMakeupSession, isMakeup=true, detectConflicts reuse, roster) | pending | [phase-02-makeup.md](phase-02-makeup.md) |
| P3 | Attendance bulk mark-all + per-student/class/term report + parent per-session visibility | pending | [phase-03-attendance.md](phase-03-attendance.md) |
| P4 | Học bạ + certificate PDF (shared print-render infra) + LMS parent visibility | pending | [phase-04-pdf-visibility.md](phase-04-pdf-visibility.md) |
| P5 | Lifecycle enforcement (withdrawn/paused → block LMS login + attendance + visible state) | pending | [phase-05-lifecycle.md](phase-05-lifecycle.md) |
| P6 | UI wiring: room.update/archive + parentMeeting.setSchedule + meeting outcome note | pending | [phase-06-ui-wiring.md](phase-06-ui-wiring.md) |
| P7 | Validation (int tests + e2e + migration 0-drift on prod-mirror) | pending | [phase-07-validation.md](phase-07-validation.md) |

## Dependency graph

```
Plan 1 260702-0929 (session/exercise shape) ──► THIS PLAN
P1 transfer ─┐
P2 makeup  ──┼─> (independent files) ─┐
P3 attend  ──┘                        │
P5 lifecycle ── shares attendance.ts guard w/ P3 → serialize P3 then P5
P4 pdf/visibility ── independent (new files + parent-view.tsx)
P6 ui-wiring ── independent (room/parent-meeting)
P7 depends on ALL (P1–P6)
```

MAY run parallel to Plan 4 finance (disjoint files: finance.ts/dashboard.ts/email vs academic routers). Verify no shared edit before parallelizing.

File-ownership: P3 and P5 BOTH edit `apps/api/src/routers/attendance.ts` → **serialize** (P3 bulk endpoint first, then P5 lifecycle guard). P1 and P5 both edit enrollment/student lifecycle logic → P1 first.

## Success criteria

1. Transfer: chuyển lớp giữ nguyên attendance + grade history; new enrollment liền mạch LMS; both visible to parent.
2. Makeup: buổi bù tạo được (conflict-checked), điểm danh được, KHÔNG lệch recompute/final grade.
3. Attendance: cô điểm danh 1 chạm (mark-all); báo cáo theo HS/lớp/kỳ; PH thấy per-session.
4. PDF: PH tải được học bạ + chứng chỉ PDF; staff vẫn tải được.
5. Lifecycle: HS withdrawn/paused KHÔNG đăng nhập LMS được + không điểm danh được + trạng thái hiển thị.
6. UI: room sửa/lưu-trữ; PH thấy giờ họp đã chốt; staff ghi outcome note.

## Rollback

Per-phase DB rollback in each phase file. All schema deltas additive (nullable columns / new rows) → down-migration drops added columns only; no destructive change to existing attendance/enrollment rows.
