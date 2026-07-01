# Phase 02 — Màn "Quản lý học sinh" (tab Lớp học/Khóa học/Học bạ)

**Status: DONE** — `student-management-panel.tsx` tạo mới, `SectionKey`/`NAV_GATES`/`buildNavGroups()`/`ALL_SECTION_KEYS`/`goToClass` sửa xong. Bổ sung ngoài phạm vi gốc (đã hỏi user, được duyệt): cũng ẩn `attendance`/`grading`/`meetings` cho giao_vien-only (cần để đạt acceptance criteria "đúng 3 mục nav"). Sau code review: thêm per-tab `can('assessment','termList')` gate cho tab Học bạ.

## Vì sao
Gộp 3 mục nav rời (`classes`, `courses`, `assessment`) thành 1 màn có tab, CHỈ cho vai trò `giao_vien`. Chứng chỉ giữ ẩn (đã quyết định).

## Files
- Sửa: `apps/admin/src/nav-permissions.ts` — `NAV_GATES` có kiểu `Record<SectionKey, NavGate>` (bắt buộc đủ key theo TS completeness check). Thêm `NAV_GATES['student-mgmt']` dạng **placeholder** (`{kind: 'open'}` chỉ để thỏa type, KHÔNG dùng để quyết định hiển thị thật — logic hiển thị thật nằm ở `buildNavGroups()` bên dưới).
- Sửa: `apps/admin/src/shell.tsx` — rẽ nhánh nằm trong **thân hàm `buildNavGroups({roles, isSuperAdmin})`** (đã có sẵn `roles` ở đây, KHÔNG sửa `visible()` vì hàm đó không nhận role). Logic: nếu `roles` chỉ gồm đúng `giao_vien` (không kèm role khác như `head_teacher`/`quan_ly` — quan trọng vì `assessment.termList` cũng cấp cho 2 role này, không được vô tình áp cách gộp của giáo viên lên họ), ẩn 3 mục `classes`/`courses`/`assessment` khỏi output, thêm 1 mục `student-mgmt`. Vai trò khác giữ nguyên nhánh cũ, không đổi.
- Tạo: `apps/admin/src/student-management-panel.tsx` — Mantine `Tabs` (theo mẫu `class-workspace.tsx:776`), 3 `Tabs.Panel` render `<Workspace navAction={navAction} />`, `<CoursesPanel>` (từ phase 01), `<AssessmentPanel>` KHÔNG đổi nội dung bên trong.
- Sửa: `apps/admin/src/App.tsx` — thêm `case 'student-mgmt'` trong `renderContent()`; thêm `'student-mgmt'` vào `SectionKey` (`shell.tsx:38-69`) và `ALL_SECTION_KEYS` (`App.tsx:577-585`); sửa `goToClass()` (dòng 631-637, không phải 630) để khi role là `giao_vien`, `navigate('/student-mgmt')` + `setNavAction({batchId, tab, ts: Date.now()})` thay vì `navigate('/classes')`.

## Bước làm
1. Rẽ nhánh role thực hiện trong `buildNavGroups()` (shell.tsx) — hàm này đã nhận `roles` làm tham số, không cần sửa `visible()`.
2. Route `/classes`, `/courses`, `/assessment` VẪN tồn tại nguyên vẹn cho role khác — chỉ ẩn khỏi sidebar khi `roles` chỉ có `giao_vien`, không xoá route (để không phá GĐĐT/GĐKD/head_teacher/quan_ly).
3. Dùng `keepMounted={false}` cho `Tabs` (theo cảnh báo agent UI convention) để tránh cả 3 tab fetch dữ liệu cùng lúc khi mở màn.
4. Sửa `goToClass()`: nếu `giao_vien` → mở `/student-mgmt` + `navAction` trỏ tab "classes"; nếu role khác → giữ hành vi cũ `navigate('/classes')`.
5. `Workspace` nhận prop `navAction: NavAction | null` (`{batchId?, tab, ts}` — `class-workspace.tsx:62-66`), khớp với cách gọi hiện tại; đảm bảo `student-management-panel.tsx` truyền đúng shape này xuống.

## Test
- `nav-consistency.test.ts`: cập nhật `expectedOpen` nếu cần (làm ở phase 05, nhưng chạy thử ở đây để bắt sớm).
- Giáo viên: sidebar hiện "Quản lý học sinh" thay vì 3 mục cũ; 3 tab hoạt động đúng dữ liệu.
- GĐĐT/GĐKD: sidebar giữ nguyên 3 mục `Lớp học`/`Khóa học`/`Học bạ` như trước — KHÔNG có mục "Quản lý học sinh".
- goToClass từ Lịch 360: giáo viên vào đúng tab Lớp học trong màn gộp.

## Rủi ro
Trung bình — điểm nhạy cảm nhất là rẽ nhánh role trong `shell.tsx`/`App.tsx`; sai sót ở đây có thể vô tình ẩn/hiện sai cho role khác. Bắt buộc code review kỹ đoạn rẽ nhánh này.
