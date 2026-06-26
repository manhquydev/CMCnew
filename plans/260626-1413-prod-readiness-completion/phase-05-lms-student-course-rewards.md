# Phase 05 — LMS Student Course Tab + Reward/View Fixes

**Risk:** NORMAL | **Depends:** Phase 02

## Decision (Q4)

Học sinh thấy danh sách lớp/khóa đang học ngay trong LMS app (homework platform vẫn hiển thị enrollment của mình).

## Requirements

### 1. C10 — Student course tab (Q4)
- Backend: `apps/api/src/routers/enrollment.ts` thêm `mine` — student-scoped query (dùng `ctx.lms.studentIds`), trả lớp/khóa đang học + trạng thái. RLS-safe (không dùng SYSTEM bypass).
- `apps/lms/src/student-shell.tsx`: thêm nav `courses` (Khóa học) vào STUDENT_NAV + union type.
- `apps/lms/src/student-view.tsx`: `CoursesTab` gọi `trpc.enrollment.mine`, list lớp/khóa.

### 2. Student qualitative grades (MEDIUM)
- `student-view.tsx:729` StudentGradebookTab: render `gradebook.qualitative` (như parent-view đã làm).

### 3. Parent meeting history (HIGH)
- `parent-view.tsx:142-186` UpcomingMeetingsCard: tách upcoming/past hoặc thêm tab "Lịch họp" toàn bộ meetings sort desc.

### 4. Parent notifications tab stub (HIGH)
- `parent-view.tsx:445-451`: populate notification history thật (hoặc rename "Tiến trình" nếu chỉ level progress). Đối chiếu có endpoint notification history không.

### 5. Reward review wiring (từ §4 report)
- `rewards.ts` `giftCreate`/`review` chưa có UI → redemption kẹt `pending`. Wire vào teaching/admin (giao Phase 06) — phần student/parent xem lịch sử đổi quà: `parent-view.tsx:454` thêm read-only `rewards.myRedemptions`.

### 6. Multi-studentId selector (MEDIUM)
- `student-view.tsx:730-745` hard-code `studentIds[0]`. Nếu business cho phép nhiều studentId/login → thêm Select; nếu không → assert length===1 + surface error.

## Validation

- `enrollment.mine` int-test: student chỉ thấy lớp của mình, không cross-facility.
- LMS typecheck green; tab Khóa học render data thật.
- Live: login student → tab Khóa học hiện đúng lớp; parent xem được lịch họp quá khứ.

## Risks / Rollback

- `enrollment.mine` phải RLS-safe (không lặp lỗi leaderboard SYSTEM bypass) — review kỹ.
- Badge icon fix nằm Phase 01.
