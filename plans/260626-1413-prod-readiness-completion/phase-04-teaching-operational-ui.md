# Phase 04 — Teaching Operational UI (6 nav items)

**Risk:** NORMAL | **Depends:** Phase 02

## Decision (Q3 — agent UX)

Tách "Hôm nay / vận hành đa lớp" khỏi "quản lý từng lớp":

| Key | Verdict |
|-----|---------|
| `schedule` Lịch dạy | **Cross-class agenda** (mới `schedule.mySessions`), default landing |
| `sessions` Buổi học | **Remove** khỏi nav (trùng schedule + đã có tab trong ClassDetail) |
| `attendance` Điểm danh | **Cross-class "hôm nay"** → chọn buổi → điểm danh roster |
| `enrollment` Ghi danh | **Class-scoped shortcut** → ClassDetail tab (quan_ly/sale only) |
| `meetings` Họp PH | **Cross-class** (backend đã facility-scoped, 0 endpoint mới) |
| `classlog` Sổ đầu bài | **Class-scoped shortcut** → ClassDetail "Nhật ký" tab |

Sub-decisions (theo recommend của agent, đã chốt):
- `schedule.mySessions` default lọc theo caller cho giao_vien; quan_ly/head_teacher xem cả facility.
- "Sổ đầu bài" giữ Chatter per-class hiện tại — SessionLog model riêng (P4) DEFER.
- Default landing đổi `classes` → `schedule` sau khi agenda có.

## Nav IA mới (`shell.tsx` buildGroups)

```
HÔM NAY:        schedule, attendance, meetings
QUẢN LÝ LỚP:    classes, enrollment(qly/sale), classlog, levelup, certificate
GIẢNG DẠY:      grading, assessment
(KINH DOANH/NHÂN SỰ giữ nguyên, role-gated)
```
Bỏ nav item `sessions`.

## Backend (`apps/api/src/routers/schedule.ts`)

- `schedule.mySessions` input `{ facilityId, from, to, teacherId? }` → sessions đa lớp, join `classBatch.code/name`, room, status, order `sessionDate,startTime`. giao_vien default teacherId=caller; quan_ly/head_teacher cho phép all-facility. RLS facility-scoped.
- Int-test: giao_vien chỉ thấy buổi mình dạy; quan_ly thấy cả facility; không cross-facility.

## Frontend (`apps/teaching/src/`)

1. **Refactor `Workbench`** (`App.tsx:986`): lift state `{activeSection, selectedBatchId, detailTab}` + callback `goToClass(batchId, tab)`. `enrollment`/`classlog` keys set `activeSection='classes'` + selected batch + target tab. Remove `sessions` case.
2. **`schedule-panel.tsx`** (mới): agenda đa lớp, đổi ngày/tuần, group theo lớp, badge status, empty state, row → `goToClass(id,'sessions')`. Dùng `schedule.mySessions`.
3. **`attendance-panel.tsx`** (mới): buổi hôm nay (mySessions to=from=today) → chọn buổi → roster. Extract bảng marking từ `AttendanceTab` (App.tsx:523-606) thành `<AttendanceRoster>` shared (DRY) dùng chung panel + ClassDetail tab. Bulk "present-all".
4. **`meetings-panel.tsx`** (mới): bảng meetings đa lớp từ `parentMeeting.list({facilityId})`. Filter scheduled/done/cancelled, upcoming-first, confirm time (`setSchedule`) + done/cancel (`setStatus`). Reuse logic `MeetingsTab` bỏ batch filter.
5. Default landing → `schedule`.

## Also fix (review high/medium teaching)
- AttendanceTab/SessionsTab/ScheduleTab: bỏ `.catch(()=>{})` câm → loading/error states.
- Student selects (assessment/cskh/certificate/finance/enroll): filter `facilityId`.
- MeetingsTab: form thêm cuộc họp (`parentMeeting.create`/`setSchedule`).
- Time inputs (slot, schedule): TimeInput hoặc HH:MM regex.
- effectiveFrom payroll: DateInput.

## Validation

- `schedule.mySessions` int-test pass.
- Teaching typecheck green; 6 key không còn blank; cross-class → click row mở ClassDetail đúng tab.
- Live: giáo viên thấy lịch hôm nay đa lớp, điểm danh từ panel, quản lý họp PH đa lớp.

## Risks / Rollback

- Lift state Workbench đụng nhiều chỗ → refactor cẩn thận, giữ ClassDetail tabs hoạt động.
- Extract AttendanceRoster phải giữ behavior cũ (regression check ClassDetail attendance).
