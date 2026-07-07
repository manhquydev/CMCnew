---
title: "Teacher Lite — Unified Calendar + Session Detail UI"
description: "Replace fragmented teacher schedule/attendance/grading sections with one push-navigation calendar component: List/Month/Kanban views + drill-down session detail with 4 tabs."
status: completed
priority: P1
branch: "develop"
tags: ["teacher-lite", "ui", "calendar", "ux"]
blockedBy: []
blocks: []
created: "2026-07-07T16:35:29.240Z"
createdBy: "ck:plan"
source: skill
brainstormReport: "plans/reports/brainstorm-260707-2330-teacher-schedule-unified-ui-report.md"
---

# Teacher Lite — Unified Calendar + Session Detail UI

## Overview

Thay 4 section rời (schedule, attendance, grading, assessment) trên teacher surface bằng **1 component thống nhất**. Giáo viên có calendar 3 chế độ xem (List | Tháng | Kanban), click session → drill-down Session Detail với 4 tab: Điểm danh, Ảnh & Nhận xét, Chấm bài, Nhật ký. Không thay đổi backend.

## Architecture

**Push-navigation pattern** (Hướng A — brainstorm approved):
```
state: activeSession = null  →  Calendar view (3 modes)
state: activeSession = row   →  Session Detail (4 tabs), full content area
```
Nút ← giữ nguyên view mode + tháng đang xem khi quay lại.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Calendar Views](./phase-01-calendar-views.md) | Completed |
| 2 | [Session Detail Drill-down](./phase-02-session-detail-drill-down.md) | Completed |
| 3 | [Nav Cleanup + Wire-up](./phase-03-nav-cleanup-wire-up.md) | Completed |
| 4 | [Typecheck + Deploy](./phase-04-typecheck-deploy.md) | Completed |

## Files Touched

| File | Action |
|---|---|
| `apps/admin/src/teacher-schedule.tsx` | CREATE — container: calendar + state machine |
| `apps/admin/src/teacher-schedule-session-detail.tsx` | CREATE — session detail + 4 tabs |
| `apps/admin/src/App.tsx` | MODIFY — wire schedule section → TeacherSchedule |
| `apps/admin/src/app-surface.ts` | MODIFY — GIỮ nguyên TEACHER_SURFACE_SECTIONS (reachability cho director); chỉ chú thích |
| `apps/admin/src/shell.tsx` | MODIFY — ẩn attendance+grading khỏi nav teacher qua `teacherNavMergedIntoCalendar`; giữ báo cáo |

## API (no backend changes needed)

- `trpc.schedule.mySessions` — load sessions by facility + date range
- `trpc.enrollment.listByBatch` — roster
- `trpc.attendance.mark` / `markAll` — điểm danh
- `trpc.sessionEvidence.upsertDraft` + `uploadSessionPhoto` from `@cmc/ui`
- `trpc.submission.listByExercise` — bài nộp
- `trpc.grade.grade` — chấm điểm

## Acceptance Criteria

- [ ] Teacher login → Lịch dạy hiển thị calendar tháng mặc định
- [ ] Toggle List/Tháng/Kanban hoạt động, giữ state khi quay lại từ detail
- [ ] Click session card → URL thêm `?session=<id>`, Session Detail chiếm toàn content
- [ ] Browser back / nút ← → URL xóa `?session`, quay về calendar đúng view + tháng
- [ ] Refresh trang với `?session=<id>` → drill-down đúng session (URL-driven state)
- [ ] `facilityIds = []` → FacilityPicker "Tất cả cơ sở", không crash
- [ ] Điểm danh: mark + bulk + rollback; 0 students → "Lớp chưa có học sinh" + bulk disabled
- [ ] Ảnh & NX: upload ảnh (`uploadSessionPhoto(file)`), textarea auto-save unified → "Đã lưu"
- [ ] Tab 2 + Tab 4 concurrent save không race (unified evidenceDraft state)
- [ ] Chấm bài: exercises của lớp hiện tại (classBatchId), list submissions, `grade.mutate({ submissionId, score, feedback })`
- [ ] Nhật ký: save internalNote + publish (`sessionEvidence.publish`)
- [ ] ERP users click "Lịch dạy" → vẫn thấy SchedulePanel (no regression)
- [ ] Sidebar teacher: ≤5 items với `giao_vien` (Điểm danh/Chấm bài không xuất hiện là nav items)
- [ ] `pnpm --filter admin tsc --noEmit` zero error

## Dependencies

Không có cross-plan dependency. Dùng API sẵn có, không thêm migration hay package mới.
