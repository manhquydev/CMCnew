# Phase 03 — Hoàn thiện nghiệp vụ còn thiếu (P1)

> Hai khoảng hở nghiệp vụ thật so với spec. Làm sau khi Phase 01 xong; độc lập với CI.

## Hạng mục 1 — Audit/Chatter UI timeline
**Vấn đề:** Spec Phase 1 §2.8 đặt chatter kiểu Odoo là cross-cutting **bắt buộc**. Backend `record_event` (packages/audit) đã đủ và được gọi khắp router (logEvent ở finance/crm/payroll/grade...). Nhưng **UI** hiển thị timeline / followers / ghi chú tay trên màn chi tiết record gần như chưa có (chỉ 1 tham chiếu trong `apps/teaching/src/App.tsx`).

**Files (dự kiến):**
- TẠO `packages/ui/src/record-timeline.tsx` (component dùng chung: đọc record_event theo entityType+entityId, render timeline).
- TẠO router đọc: `apps/api/src/routers/audit.ts` (kiểm tra đã có `audit.ts` — mở rộng query timeline + add note + follow).
- SỬA màn chi tiết các thực thể chính (ClassBatch, Student, Receipt, Payslip, Opportunity) để nhúng timeline.

**Acceptance:**
- [ ] Mở chi tiết 1 lớp/phiếu thu → thấy timeline "ai · khi · trường cũ→mới + lý do".
- [ ] Thêm ghi chú tay + theo dõi record hoạt động.

## Hạng mục 2 — Chốt & (tùy quyết định) khép vòng hoa hồng vào payslip
**Vấn đề:** `commissionForSale` (payroll.ts:110) auto-compute từ CompensationPolicy effective + receipt attributed, nhưng **mới là preview** — chưa tự ghép vào dòng `variablePay` của payslip; HR vẫn nhập tay. Spec Phase 4 **cho phép** v1 nhập tay (variablePay manual), nên đây là **quyết định mở**, không phải bug.

**Cần chủ dự án chốt:**
- Phương án A (giữ spec): v1 HR xem preview rồi nhập tay vào variablePay → chỉ cần nút "áp preview vào dòng" cho tiện.
- Phương án B (tự động): payslipCompute tự kéo commission của kỳ vào variablePay (có thể override tay).

**Files (nếu chọn B):**
- SỬA `apps/api/src/routers/payroll.ts` (payslipCompute đọc commission kỳ, ghi vào variablePay với nguồn truy vết).
- THÊM test integration: commission kỳ → phản ánh đúng trong grossIncome/PIT.

**Acceptance:**
- [ ] Quyết định A/B được ghi vào `DEBT.md` hoặc spec (kèm lý do).
- [ ] Nếu B: payslip kỳ có commission tự động khớp `domain-payroll` (live + test).

## Ghi chú
Đây là phần "đi tiếp" — chỉ mở sau khi lưới an toàn Phase 01/02 xanh, đúng nguyên tắc "nghiệp vụ chắc trước".
