# Phase 03 — Màn "Lương & chấm công" (tab Phiếu lương/Chấm công)

**Status: DONE** — `payroll-checkin-panel.tsx` tạo mới, `NAV_GATES`/`buildNavGroups()`/`App.tsx` sửa xong. Sau code review: thêm per-tab `can('checkInOut','punch')` gate cho tab Chấm công.

## Files
- Sửa: `apps/admin/src/nav-permissions.ts` — thêm `NAV_GATES['payroll-checkin']` placeholder (lý do completeness type, xem phase-02). Lưu ý 2 mục gốc dùng CƠ CHẾ KHÁC NHAU: `my-payslips` = `{kind:'open'}` (mọi staff đăng nhập), `checkin` = `{kind:'permission', module:'checkInOut', action:'punch'}` — không phải cùng 1 điều kiện, rẽ nhánh ẩn phải xử lý riêng từng gate.
- Sửa: `apps/admin/src/shell.tsx` — trong `buildNavGroups()` (như phase 02): ẩn `my-payslips`+`checkin` khỏi output CHỈ khi `roles` chỉ gồm `giao_vien`, thêm mục `payroll-checkin`. Vai trò khác (sale, cskh, head_teacher... cũng có `checkInOut.punch`) giữ nguyên 2 mục cũ.
- Tạo: `apps/admin/src/payroll-checkin-panel.tsx` — Mantine `Tabs`, 2 `Tabs.Panel`: `<MyPayslipsPanel>`, `<CheckInPanel>` không đổi nội dung (cả 2 named export, không nhận props, tự fetch qua tRPC + `useSession()` nội bộ — xác nhận nhúng thẳng được).
- Sửa: `apps/admin/src/App.tsx` — thêm `case 'payroll-checkin'`, thêm `SectionKey`.

## Lưu ý
`checkInOut.punch` được chia sẻ với `head_teacher`, `sale`, `cskh` — chỉ rẽ nhánh ẩn/gộp cho đúng `giao_vien`, các role khác giữ 2 mục `Phiếu lương`/`Chấm công` y hệt hiện tại.

## Test
- Giáo viên: 1 mục "Lương & chấm công", 2 tab đúng dữ liệu.
- Sale/cskh/head_teacher: vẫn 2 mục riêng như cũ.

## Rủi ro
Thấp-trung bình, giống phase 02 nhưng phạm vi nhỏ hơn (chỉ 2 trang nhỏ, không có logic phức tạp như class-workspace).
