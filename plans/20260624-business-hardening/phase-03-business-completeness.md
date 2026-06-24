# Phase 03 — Hoàn thiện nghiệp vụ còn thiếu (P1)

> Hai khoảng hở nghiệp vụ thật so với spec. Làm sau khi Phase 01 xong; độc lập với CI.

## Hạng mục 1 — Audit/Chatter UI timeline
**CẬP NHẬT 2026-06-24 (scout lại):** Phần lớn ĐÃ XONG. `packages/ui/src/chatter.tsx` là component đầy đủ (Timeline đổi-trạng-thái old→new + ghi chú tay + auto-follow + nhãn tiếng Việt); router `audit` có `timeline/followers/postNote/follow`; đã mount `<Chatter entityType="class_batch" .../>` trên màn lớp. **Khoảng hở duy nhất:** mới gắn trên ClassBatch — chưa gắn lên màn chi tiết các entity khác (Receipt, Opportunity, Student, Payslip). Nhiều panel hiện là dạng bảng/list, chưa có "màn chi tiết" để mount → cần tạo drawer/expand-row trước khi gắn.

**Việc còn lại (nếu làm):** với mỗi entity ưu tiên, thêm chi tiết (drawer) + `<Chatter entityType=... entityId=... facilityId=... />`. Không đụng backend (đã đủ).

**Files (dự kiến):**
- TẠO `packages/ui/src/record-timeline.tsx` (component dùng chung: đọc record_event theo entityType+entityId, render timeline).
- TẠO router đọc: `apps/api/src/routers/audit.ts` (kiểm tra đã có `audit.ts` — mở rộng query timeline + add note + follow).
- SỬA màn chi tiết các thực thể chính (ClassBatch, Student, Receipt, Payslip, Opportunity) để nhúng timeline.

**Acceptance:**
- [ ] Mở chi tiết 1 lớp/phiếu thu → thấy timeline "ai · khi · trường cũ→mới + lý do".
- [ ] Thêm ghi chú tay + theo dõi record hoạt động.

## Hạng mục 2 — Hoa hồng vào payslip → CHỐT: Phương án A+ (đã có sẵn)
**CẬP NHẬT 2026-06-24:** Chủ dự án chọn **A+**. Scout lại phát hiện nút A+ **đã tồn tại** — `payroll-panel.tsx:162` `<Button onClick={() => setVariablePay(commission.total)}>Đưa vào ô biến đổi ↓</Button>`: HR bấm "Tính hoa hồng" → preview → bấm đưa vào ô `variablePay` (vẫn sửa được) → tính lương. Đúng spec v1 nhập tay, rủi ro ~0. **Không cần làm thêm.** Phương án B (auto-ghép payslipCompute) để sau khi attribution chạy thật vài kỳ.

(Lịch sử) `commissionForSale` (payroll.ts:110) auto-compute từ CompensationPolicy effective + receipt attributed.

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
