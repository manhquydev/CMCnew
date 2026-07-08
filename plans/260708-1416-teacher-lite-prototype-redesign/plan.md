---
title: "Teacher Lite — Prototype-faithful redesign (linked record-detail hub + automation)"
description: "Redesign toàn bộ teacher-lite theo prototype D:\\Downloads\\Thiết kế UIUX LMS và ERP: UI có tính LIÊN KẾT (record-detail hub, click xuyên bản ghi), tự động hóa (sinh buổi tự động), CRUD đầy đủ, LMS responsive."
status: in-progress
priority: P1
branch: develop
tags: [teacher-lite, ui-redesign, prototype, record-detail-hub, lms, responsive]
created: "2026-07-08"
source: cook
prototype: "D:\\Downloads\\Thiết kế UIUX LMS và ERP (wireframe = nguồn sự thật)"
---

# Teacher Lite — Prototype-faithful redesign

## Teacher Lite giải quyết vấn đề gì (nguyên tắc nền)
Hệ thống nội bộ GỌN, **đơn giản hóa quy trình**: tự động hóa tối đa, **con người chỉ can thiệp chỗ máy
không tự làm được**. KHÔNG ràng buộc duyệt phiếu thu/finance/CRM cho thao tác teacher-lite (bypass ERP —
Decision 0039/0040). Liên kết LMS trên backend chung (không app/DB riêng).

## Nguyên tắc UI (từ prototype)
- **LIÊN KẾT (record-detail hub):** list/calendar → click bản ghi → chi tiết hub; **trong hub click sang
  bản ghi liên quan** (vd click HS trong chi tiết buổi → mở chi tiết HS) thay vì phải mở trang khác.
- Record-detail hub = header (kind/tên/phụ đề) + **chevron statusbar** (đã có) + "Thao tác" (hành động
  inline) + smart-stat tiles bấm được + Thông tin + **Chatter sidebar 344px**. Dùng primitive `packages/ui`.
- Apple-minimal tokens; **responsive mobile + desktop** (LMS học viên bắt buộc).

## Vai trò + luồng (mục tiêu)
### Giáo viên
- Lịch → bấm buổi → **chi tiết buổi**: điểm danh HS, **nhận xét từng HS**, upload ảnh lớp, **chấm bài
  từng HS** (giao diện xem bài HS làm — ✅ đã ship c15ca80).
- **Liên kết:** trong chi tiết buổi, bấm 1 HS → mở chi tiết HS (contextual).
### Giám đốc / super_admin
- **Thêm nhân sự GV nhanh** ngay teacher-lite; quản lý nhân sự/PH/HS **đầy đủ CRUD** (thêm/sửa/xóa).
- **Thêm học sinh mới nhanh** — KHÔNG ràng buộc duyệt phiếu thu.
- **Quản lý học liệu LMS**: upload/sửa tài liệu **từng buổi tương ứng** (CourseExerciseManager — đã có).
- **Sinh buổi học TỰ ĐỘNG** (bỏ nút "Sinh buổi" thủ công) — tạo lớp → sinh buổi tự động hết.
### Học viên (LMS)
- Thấy **bài học tương ứng buổi đã diễn ra**, **làm bài tương tác** (draw-on-PDF), **responsive** mobile+desktop.
### PH
- Nghiệp vụ tương ứng (xem bài con, thông báo).

## Đã ship phiên này (nền)
- `c15ca80` chấm bài xem bài HS làm trên PDF.
- `74dea49` hủy lớp/buổi inline (Thao tác) từ lịch.
- `0f162aa` chevron statusbar Odoo + fix bug "Sắp dạy" (time-derived status).

## Thứ tự thực thi (mỗi module = 1 workflow design→implement→verify, tôi review/fix + tsc + commit + live-verify)
1. ✅ **/students** record-detail hub — pattern chuẩn (student-detail.tsx).
2. **Session-detail LINKED**: click HS trong chi tiết buổi → mở chi tiết HS (contextual). Chatter sidebar + smart-stats.
3. ✅ **/classes** hub (record-detail + chevron + Chatter + tab Học liệu) + **sinh buổi TỰ ĐỘNG** khi tạo lớp — chưa commit, chờ tsc/live-verify.
4. **/guardians** hub (CRUD đầy đủ đã có: create/edit/archive).
5. **Thêm nhân sự GV nhanh** (form gọn thay vì link ERP) + **Thêm HS nhanh** (đã có teacherLite provisioning).
6. **LMS học viên responsive** (mobile+desktop) + làm bài tương tác — verify + hoàn thiện.

## Acceptance (toàn plan)
- [ ] Mọi màn teacher-lite theo record-detail hub + chevron + Chatter sidebar (prototype).
- [ ] Trong chi tiết buổi, click HS → chi tiết HS (liên kết, không mở trang rời).
- [x] Sinh buổi tự động khi tạo lớp; không còn thao tác sinh buổi thủ công ban đầu (bấm "Tạo lớp" là xong). Nếu tự sinh fail/skip: toast báo rõ + nút 1-click "Sinh buổi ngay" ngay tại tab "Buổi học" (không phải đào menu); menu "Sinh lại buổi theo lịch" giữ làm recompute khi buổi bị hủy/dời (xem báo cáo `plans/reports/brainstorm-260708-1814-classhub-generate-sessions-fallback-button-report.md`).
- [ ] Director thêm GV nhanh + CRUD nhân sự/PH/HS đầy đủ; thêm HS nhanh không cần phiếu thu.
- [ ] Chấm bài xem được bài HS làm (✅). Học liệu upload theo buổi (✅ CourseExerciseManager).
- [ ] LMS học viên responsive mobile+desktop, làm bài tương tác.
- [ ] tsc 0 lỗi mọi package; Jenkins develop green; live-verify dev.

## Governance
- Decision 0039 (chung DB/auth/LMS) + 0040 (API bypass teacherLite.*, giữ RLS+audit+anti-escalation).
- Không đổi backend contract trừ khi cần (vd form thêm GV gọn dùng user.create sẵn có).

## Unresolved (chốt khi tới)
1. "Thêm nhân sự GV nhanh" — user.create yêu cầu CCCD/ngày vào làm/vị trí/email cá nhân (full HR). Làm form
   gọn cần backend cho phép tối thiểu, hoặc giữ full form nhưng UI gọn? (quyết ở phase 5).
2. Chevron cho student lifecycle — StudentLifecycle enum map chevron thế nào (quyết ở phase /students).
