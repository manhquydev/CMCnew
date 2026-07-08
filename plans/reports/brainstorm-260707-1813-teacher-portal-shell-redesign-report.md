# Brainstorm: Teacher Portal Shell Redesign

**Date:** 2026-07-07 18:13  
**Branch:** develop  
**Type:** UI/UX Rebuild + Architecture Decision

---

## Problem Statement

Teacher + Director (GĐ Đào tạo) hiện dùng `apps/admin` — một ERP app lớn chia sẻ với HR, Finance, Sales. UI là form-heavy ERP chuẩn (Stack/Group/Select), không thân thiện. Giáo viên hàng ngày cần: điểm danh → ảnh lớp → nhận xét → chấm bài. Director cần: tạo lớp → add HS → gửi email PH → upload tài liệu. Workflow thực tế đơn giản nhưng UI hiện tại "rộng quá" và không phù hợp.

**Thực tế:** Backend 100% đã build. Không cần thêm tính năng. Chỉ cần UX mới.

---

## Scout Findings

| Layer | Trạng thái |
|-------|-----------|
| Attendance API | ✅ `attendance.ts` — bulk mark, monthly report |
| Session evidence (ảnh + nhật ký) | ✅ `session-evidence.ts` — draft/publish, photos |
| Homework + Grading | ✅ `exercise.ts`, `grade.ts`, `submission.ts` |
| Teacher Lite (tạo lớp, cancel) | ✅ `teacher-lite.ts` — 4 procedures đủ dùng |
| Student enrollment + email PH | ✅ `createFamilyStudentAndEnroll` |
| LMS (student/parent portal) | ✅ `apps/lms` — StudentShell + ParentShell |
| Teacher Surface (hiện tại) | ⚠️ `apps/admin` với `isTeacherOnly` flag — UI thô |

**Design Reference** (`D:\Downloads\Thiết kế UIUX LMS và ERP`):
- 4-section sidebar: Tổng quan / Giảng dạy / Lớp & Học sinh / Tài chính & Điều hành
- Dashboard với stat cards + to-do list
- Master-detail layout (list trái, detail phải)
- Clean, professional — blueprint cho TeacherPortalShell

---

## Architecture Decision

**Chọn: TeacherPortalShell trong `apps/admin` tại `/portal/*`**

Lý do không dùng `apps/lms`:
- `apps/lms` dùng phone-auth (`LmsLoginGate`), teacher = staff auth (SSO/password)
- Thêm TeacherShell vào `apps/lms` tạo auth debt mới
- `apps/admin` đã có staff auth + tRPC client + all RBAC — zero setup

Lý do không tạo `apps/teacher`:
- Duplicate: auth, session, tRPC client setup
- 3-5 tuần vs 3-5 ngày
- Backend không thay đổi → không justify separate app

**Pattern:** Tạo `TeacherPortalShell` component trong `apps/admin`, route tại `/portal`. Khi user với role `giao_vien` hoặc `giam_doc_dao_tao` login, auto-redirect `/portal`. Admin roles giữ nguyên `/` path.

---

## Scope: Full Rebuild 2 Luồng

### Teacher Flow (giao_vien)
1. **Today's Classes** — list lớp hôm nay với giờ học, trạng thái
2. **Session Workspace** — click vào lớp → điểm danh (bulk/individual) + upload ảnh + nhận xét
3. **Homework Feed** — danh sách bài nộp → xem bài → chấm điểm/sao
4. **Schedule View** — lịch tuần/tháng

### Director Flow (giam_doc_dao_tao)  
1. **Quick Actions Dashboard** — stats + todo list (tham khảo design reference)
2. **Create Class** — form nhanh: cơ sở + khóa học + ngày + giờ → tạo ngay
3. **Student Management** — add HS mới + enroll vào lớp + gửi email PH
4. **LMS Materials** — upload tài liệu theo curriculum lesson
5. **Cancel Management** — cancel buổi/lớp với UI đơn giản

---

## Implementation Plan

### Phase 1 — Shell & Routing (0.5 ngày)
- Tạo `TeacherPortalShell` trong `apps/admin/src/teacher-portal/`
- Route `/portal/*` với auto-redirect logic
- Sidebar nav theo design reference (4 mục)

### Phase 2 — /stitch Teacher UI (1-2 ngày)
- Dùng `/stitch` design + implement Teacher screens
- Today's Classes card list → Session Workspace (attendance + photos + notes)
- Homework grading UI với score/star rating

### Phase 3 — /stitch Director UI (1-2 ngày)  
- Dashboard với stat cards (design reference layout)
- Quick Class Creation form
- Student enrollment + email trigger
- Cancel UI

### Phase 4 — Integration & Polish (0.5 ngày)
- Wire tất cả vào existing tRPC endpoints
- Test flows end-to-end
- Redirect logic + auth gate

**Total estimate: 3-5 ngày**

---

## Trade-offs Accepted

| Decision | Lý do |
|---------|-------|
| Không tách `apps/teacher` | Save 2-3 tuần, backend không thay đổi |
| Giữ nguyên tất cả rules/validation | User confirm không cần bỏ rule nào |
| `/portal` route trong apps/admin | Tránh auth debt từ việc mix vào apps/lms |
| Full rebuild cả 2 luồng song song | User request — parallel build |

---

## Success Criteria

- [ ] Teacher login → thấy Today's Classes ngay, không cần navigate
- [ ] Điểm danh cả lớp ≤ 3 tap
- [ ] Upload ảnh + nhận xét trong cùng 1 màn hình
- [ ] Director tạo lớp mới ≤ 60 giây
- [ ] Director add HS + gửi email PH trong 1 form
- [ ] UI reference design được — sidebar 4 mục, stat cards, clean layout

---

## Unresolved Questions

1. Teacher có cần xem lịch nhiều tuần (schedule view) hay chỉ cần "hôm nay"?
2. "Trả sao" trong grading — dùng 5-star system hay score number (0-10)?
3. Director có cần approve makeups/session requests từ teacher portal không?
