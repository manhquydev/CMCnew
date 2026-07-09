# Brainstorm — Teacher Lite tái cấu trúc 2 vai trò (admin / teacher)

- **Date:** 2026-07-09
- **Surface:** teacher-lite (apps/admin, surface='teacher')
- **Bối cảnh nền:** clear ERP, chỉ teacher-lite + LMS vận hành (xem memory `clear-erp-teacher-lite-only`)
- **Nguồn ảnh tham khảo:** `teacher-schedule-session-detail.tsx` đang chạy (session hub) = target interaction

## Problem statement

Teacher-lite chức năng đã ~80% (calendar, session-detail, attendance, grading PDF, student/teacher CRUD,
class control). Vấn đề THẬT: **nav rối + workflow tương tác thừa/chưa thông minh**, chưa phải build mới.
Yêu cầu: gom về 2 trải nghiệm rõ ràng — admin (quản lý) và teacher (chỉ lịch) — bỏ hết mục thừa.

## Quyết định đã chốt (user)

1. **Role model:** GIỮ RBAC hiện tại, chỉ gom UI. `admin` = super_admin + giam_doc_dao_tao +
   giam_doc_kinh_doanh; `teacher` = giao_vien. KHÔNG đổi DB role (khớp decision 0040, tránh migration RLS).
2. **Teacher nav:** giao_vien chỉ thấy **Lịch dạy** (vào thẳng). Bỏ mọi nav phụ.
3. **Add HS vào lớp:** cả 2 luồng — tạo-mới-PH+HS (đã có) + **add HS đã tồn tại vào lớp** (build mới).
4. **Học liệu:** quản lý trong **chi tiết Lớp → tab Học liệu theo buổi** (CourseExerciseManager đã có).

## Quyết định mặc định (agent tự chọn theo codebase, user ủy quyền "quan tâm kết quả cuối")

5. **Gate 15p:** mở từ 15p trước giờ bắt đầu → sửa được đến hết ngày buổi học. Server là nguồn sự thật,
   UI mirror (nút mờ + tooltip "Mở điểm danh từ HH:MM").
6. **Dọn nav (ẩn, giữ router/panel):** bỏ khỏi teacher-lite: Học bạ (assessment), Duyệt cấp độ (levelup),
   Họp PH (meetings), Báo cáo điểm danh (attendance-report), Cockpit điều phối. Bật lại sau nếu cần.
7. **HS/PH:** admin dùng 2 hub `/students` + `/guardians` đã có (record-detail hub, click xuyên) — không gộp.

## Kết quả cuối cùng (acceptance tổng)

### Giáo viên (giao_vien)
- Login → vào thẳng Lịch dạy, không nav phụ.
- Bấm buổi → session hub (đúng ảnh mẫu):
  - **Điểm danh**: chỉ bật trong cửa sổ 15p-trước → hết ngày; ngoài cửa sổ nút mờ + tooltip.
  - **Nhận xét HS**: chỉ HS đã điểm danh có mặt/muộn.
  - **Upload ảnh buổi học**: nút mở trang upload.
  - **Chấm bài**: xem PDF HS làm, chấm, lưu (đã có).

### Admin (super_admin + 2 giám đốc)
- Nav gọn: **Lớp học** (CRUD + enroll tạo-mới/có-sẵn + tab Học liệu theo buổi) · **Học sinh** (CRUD) ·
  **Phụ huynh** (CRUD) · **Giáo viên** (CRUD).
- Bỏ: Học bạ, Duyệt cấp độ, Họp PH, Báo cáo điểm danh, Cockpit khỏi nav.

### Học sinh / PH (LMS)
- Nhận data GV đã làm (nhận xét, điểm, ảnh) — đã có, verify.

## Việc thật cần làm

| # | Việc | Loại | File chính |
|---|------|------|-----------|
| 1 | Gate 15p điểm danh (API server-truth + UI nút mờ/tooltip) | BUILD | `attendance` router, `teacher-schedule-session-detail.tsx` |
| 2 | Siết nhận xét chỉ HS có mặt/muộn | Hoàn thiện | `teacher-schedule-session-detail.tsx` (đã có 1 phần L454-458) |
| 3 | Add HS đã tồn tại vào lớp | BUILD | `teacherLite` router + class hub UI |
| 4 | Teacher-only chỉ thấy Lịch dạy | Dọn nav | `shell.tsx`, `app-surface.ts` |
| 5 | Ẩn Học bạ/Duyệt cấp độ/Họp PH/Báo cáo/Cockpit | Dọn nav | `shell.tsx` |
| 6 | Verify HS/PH/GV CRUD đầy đủ | Verify | students/guardians/staff-lite panel |
| 7 | Verify LMS student/PH nhận data | Verify | LMS app |

## Ngoài phạm vi
- Không đổi DB role, không migration RBAC.
- Không xóa code ERP/router — chỉ ẩn nav.
- Không đụng luồng LMS làm bài (đã chạy).

## Rủi ro
- Gate 15p đụng `attendance.markAll` — impact-check trước, gate server-side, mirror UI.
- Dọn nav: GIỮ direct-URL reachability cho giám đốc (bài học df2a153 — không xóa khỏi Set, chỉ ẩn nav).
- Add-existing-student: tránh trùng enrollment (unique constraint), block khi HS đã trong lớp.

## Governance
- Decision 0039 (chung DB/auth/LMS) + 0040 (API bypass teacherLite.*, giữ RLS+audit+anti-escalation).
- Server-truth cho gate 15p (không tin UI-only).

## Unresolved
- (none) — 4 quyết định nền chốt, 3 mặc định ủy quyền agent.
