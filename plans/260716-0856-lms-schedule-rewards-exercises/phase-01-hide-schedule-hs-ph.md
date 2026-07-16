---
phase: 1
title: "Hide Schedule HS+PH"
status: done
priority: P3
dependencies: []
---

# Phase 1: Hide Schedule HS+PH

## Overview
Ẩn mục "Lịch học & Nội dung" (`schedule`) khỏi LMS cho cả Học sinh và Phụ huynh — bỏ khỏi nav và chặn truy cập trực tiếp qua hash. Giữ nguyên component `CurriculumSessionsTab` (không xóa).

## Requirements
- Functional: HS và PH không thấy item schedule trong sidebar; gõ `#schedule` rơi về mặc định (HS → `exercises`, PH → `overview`) không lỗi.
- Non-functional: churn tối thiểu, có regression test chặn tái xuất hiện.

## ⚠️ Quyết định sản phẩm (Session 2)
Trang `schedule` (`CurriculumSessionsTab`) đang cho HS/PH xem **chủ đề, nội dung, tư duy đạt được, hình thức đánh giá, ngày giờ** từng buổi (khác tab "Điểm danh & buổi học" chỉ có ảnh + nhận xét GV). **User chốt ẩn HẲN cho cả HS+PH** — chấp nhận mất view nội dung/chủ đề buổi trong LMS. KHÔNG bảo toàn/di dời nội dung đợt này.

## Architecture
Nav + route đều dựa hash. Ẩn = xóa item khỏi mảng nav + xóa `'schedule'` khỏi `ALL_*_TABS` (Set kiểm hash). Khi hash không thuộc Set → dùng default hiện có. Case `schedule` trong switch của view giữ nguyên (nay không thể tới) để đảo ngược dễ.

## Related Code Files
- Modify: `apps/lms/src/student-shell.tsx` — bỏ item `schedule` khỏi `STUDENT_NAV` (dòng ~34) và `'schedule'` khỏi `ALL_STUDENT_TABS` (dòng ~65-67).
- Modify: `apps/lms/src/parent-shell.tsx` — bỏ item `schedule` khỏi nav (dòng ~25) và `'schedule'` khỏi `ALL_PARENT_TABS` (dòng ~37).
- Create/Modify: `apps/e2e/tests/lms-schedule-hidden.spec.ts` — regression guard (Playwright).
- Keep (không đổi): `apps/lms/src/curriculum-sessions-tab.tsx`, case `schedule` trong `student-view.tsx`/`parent-view.tsx`.

## ⚠️ Red-team correction (F6)
`apps/lms` **KHÔNG có test runner** (không vitest, không `*.test.ts*` — `apps/lms/package.json` chỉ có dev/build/preview/lint/typecheck). KHÔNG viết unit test trong `apps/lms`; import `student-shell.tsx` ngoài DOM sẽ throw (JSX icon module-scope). Dùng **e2e guard** (Playwright, đã có `apps/e2e`) — mạnh hơn vì kiểm hành vi thật.

## Implementation Steps (TDD qua e2e)
0. **Grep trước khi xóa**: `grep -rn "schedule" apps/e2e/tests` — nếu có spec đang assert tab schedule tồn tại → cập nhật/loại; xác nhận không phá e2e hiện có.
1. **Test trước** (`apps/e2e/tests/lms-schedule-hidden.spec.ts`): login HS và PH; assert sidebar KHÔNG có "Lịch học & Nội dung"; điều hướng `#schedule` → URL/hash rơi về default (HS `exercises`, PH `overview`), không lỗi console. Chạy → **đỏ**.
2. Xóa item `schedule` khỏi `STUDENT_NAV` và `'schedule'` khỏi `ALL_STUDENT_TABS`.
3. Xóa item `schedule` khỏi nav PH và `'schedule'` khỏi `ALL_PARENT_TABS`.
4. Chạy e2e → **xanh**.

## Success Criteria
- [x] `grep schedule apps/e2e` xử lý xong; không spec e2e nào vỡ vì xóa tab.
- [x] e2e `lms-schedule-hidden` xanh (đỏ trước khi sửa).
- [x] HS & PH không còn thấy "Lịch học & Nội dung".
- [x] `#schedule` gõ tay → fallback mặc định, không lỗi console.

## Risk Assessment
- Rủi ro thấp. Không notification/deep-link nào trỏ `#schedule` (đã xác nhận grep). Đảo ngược = thêm lại item + entry Set.
- Nếu e2e cần persona HS/PH mà môi trường CI chưa dựng → tối thiểu verify thủ công + ghi rõ (không giả test).
