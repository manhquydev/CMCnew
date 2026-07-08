# Brainstorm Report — Teacher Lite Unified Calendar UI

**Date**: 2026-07-07  
**Branch**: develop  
**Status**: Approved by user

---

## Problem Statement

Teacher Lite hiện tại phân mảnh: giáo viên phải nhảy 4-5 section riêng biệt (Lịch dạy, Điểm danh, Chấm bài, Nhận xét) để hoàn thành 1 luồng nghiệp vụ buổi học. Không có sự tập trung — không có "cây đi xuống" từ tổng thể lịch → chi tiết buổi → chức năng.

## Requirements

1. Calendar view 3 chế độ: **List | Tháng | Kanban** — mặc định Tháng
2. Click session card → **push vào Session Detail** (chiếm toàn content, không modal/drawer)
3. Session Detail có 4 tab: **Điểm danh | Ảnh & Nhận xét | Chấm bài | Nhật ký**
4. Ảnh upload per-session (album buổi học), nhận xét per-session-level textarea
5. Sidebar teacher gom lại 4-5 item, bỏ các section rời (attendance, grading standalone)
6. Design: Apple-minimal tokens hiện tại, dùng prototype `D:\Downloads\Thiết kế UIUX LMS và ERP` làm ref visual

## Evaluated Approaches

| Hướng | Mô tả | Verdict |
|---|---|---|
| A — Push-navigation | Section schedule, state-driven drill-down | ✅ Chosen |
| B — Hash routing | URL thay đổi per session | ❌ Over-complex |
| C — Drawer overlay | Calendar luôn visible, drawer 70% | ❌ Cramped |

## Chosen Design: Hướng A — Push-navigation

### Component: `teacher-schedule.tsx`

**State machine:**
```ts
type ScheduleView = 'list' | 'calendar' | 'kanban'
activeSession: SessionRow | null  // null = show calendar, non-null = show detail
activeTab: 'attendance' | 'photos' | 'grading' | 'journal'
```

**Calendar views:**
- **List**: Timeline grouped by week/day, each session 1 row
- **Tháng**: 7-column month grid, session cards colored by status
- **Kanban**: 4 columns (Sắp dạy | Đang diễn ra | Đã xong | Đã hủy)

**Session Detail (push state):**
```
Header: ← Lịch dạy | class code + date + time | status badge | X/Y checked badge

Tab 1 — Điểm danh:
  - Roster from trpc.enrollment.listByBatch
  - present/late/absent chips, optimistic update
  - "Có mặt tất cả" bulk button
  - Counter badge

Tab 2 — Ảnh & Nhận xét:
  - Photo grid 3×N with delete button
  - "+ Thêm ảnh" upload → uploadSessionPhoto
  - Session textarea "Nhận xét buổi học" auto-save
  - "Đã lưu" indicator

Tab 3 — Chấm bài:
  - List exercises for this batch → click → student submissions
  - Grade panel: score 0-10 + star 1-5 + comment + Lưu điểm
  - Empty state if no submissions

Tab 4 — Nhật ký:
  - Ghi chú textarea
  - "Đăng nhật ký" button (draft → published)
  - Published badge
```

### Files

| File | Action |
|---|---|
| `apps/admin/src/teacher-schedule.tsx` | CREATE — unified component |
| `apps/admin/src/App.tsx` | MODIFY — wire schedule section |
| `apps/admin/src/app-surface.ts` | MODIFY — remove attendance/grading from TEACHER_SURFACE_SECTIONS |
| `apps/admin/src/shell.tsx` | MODIFY — simplify teacher nav to 4 items |

### API (backend unchanged)
- `trpc.schedule.mySessions` — session list
- `trpc.enrollment.listByBatch` — roster
- `trpc.attendance.mark` / `markAll` — điểm danh
- `trpc.sessionEvidence.upsertDraft` — nhận xét + nhật ký
- `uploadSessionPhoto` from @cmc/ui — ảnh
- `trpc.submission.listByExercise` — bài nộp
- `trpc.grade.grade` — chấm điểm

## Success Criteria

- [ ] Teacher login → thấy Lịch dạy với calendar tháng mặc định
- [ ] Toggle List/Tháng/Kanban hoạt động
- [ ] Click session card → Session Detail chiếm toàn content
- [ ] ← Quay lại về calendar, giữ nguyên view mode và vị trí tháng
- [ ] Tab Điểm danh: mark từng học sinh + bulk
- [ ] Tab Ảnh & NX: upload ảnh thành công, nhận xét auto-save
- [ ] Tab Chấm bài: list submissions, grade + save
- [ ] Tab Nhật ký: ghi chú + đăng
- [ ] Sidebar teacher: 4-5 item, gọn

## Risks

- `teacher-schedule.tsx` sẽ ~400-500 LOC → cần split sub-components (session-detail-tabs/)
- Photo upload cần test CORS trên prod
- Kanban view: không cần drag-and-drop (chỉ hiển thị, không đổi status qua drag) → YAGNI
