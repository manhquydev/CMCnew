# Brainstorm — Hoàn thiện technical theo 4 vai trò xương sống (Plan 3)

Date: 2026-07-02 · Branch: develop · Input: 3 scout song song (công ca/chấm công, CRM/sale, nhân sự onboarding) + 2 vòng hỏi-đáp operator.

## 1. Problem statement

Xương sống đã có (pipeline CRM, Lịch 360, cockpit GĐ, công ca self-service, tạo tài khoản SSO). Đứt gãy nằm ở các MẠCH nối giữa module — tiền (hoa hồng, phạt-lương) và người (onboarding, chuỗi duyệt). Audit theo trải nghiệm từng vai trò: sale, giao_vien, giam_doc_kinh_doanh, giam_doc_dao_tao.

## 2. Phát hiện chính (verified file:line — chi tiết trong 3 scout transcript)

### Mạch tiền
- **Hoa hồng đứt hoàn toàn**: `finance-panel.tsx:714,727` không bao giờ gửi `opportunityId` → `soldById` + phân loại "new" (`finance.ts:612-657`) không thể kích hoạt từ UI. Sale không có quyền `finance.receiptCreate` (`permissions.ts:131` = ke_toan/gd_kd). `receiptApprove` không auto-advance opp→O5.
- **Phạt chấm công display-only**: `check-in-out.ts:175-182` tính 500đ/phút trễ + 1.000đ/phút sớm nhưng `payroll.ts` không tham chiếu punch/penalty nào — không trừ vào payslip.
- `checkInOut.monthlyReport`: quyền đã cấp (`permissions.ts:277`) nhưng procedure + UI **chưa tồn tại** (dead permission).

### Mạch người
- Onboarding đứt sau tạo tài khoản: `user.create` (App.tsx:267→user.ts:83) chỉ lưu email/tên/roles/facility — KHÔNG SĐT lúc tạo; EmploymentProfile/SalaryRate chỉ có API (`payroll.profileUpsert:327`, `rateCreate`) không UI (P5 seam-fixes sẽ nối form); **`managerId` không set được từ bất kỳ đâu** (profileUpsert input thiếu, `payroll.ts:328-339`) → chuỗi duyệt ca luôn fallback về GĐ (`shift-registration.ts:17-58`).
- Thiếu cột: địa chỉ/CCCD/tài khoản ngân hàng không tồn tại trong schema; `startedAt` có cột nhưng kẹt API.
- Trùng email → lỗi thô; super_admin tạo được tài khoản 0 cơ sở (guard `user.ts:116-121` chỉ nằm nhánh non-superadmin).
- Cấp trung gian nhận phiếu ca nhưng không có quyền duyệt (`permissions.ts:260` chỉ 2 GĐ; guard `assertAssignedApprover` đã có sẵn `shift-registration.ts:86-101`).
- Graph provisioning ADR 0015 = Proposed-only, chưa có code (tạo tay M365 + AppUser khớp email — chấp nhận).

### Đính chính audit cũ
- Đăng ký ca self-service **ĐÃ nối đầy đủ** (create/updateEntry/submit/get + approve/reject/supersede + notif). Gap thật chỉ còn: `withdraw` (không nút), `history` (không màn), `registeredInMonth` (không dùng), notif chỉ tới managerId (không tới nextManagerId; managerId null → không ai được báo).
- CSKH: role `cskh` không ai giữ, `sale` bị loại khỏi `afterSale.*` → mọi case dồn lên GĐ KD.
- Danh bạ liên hệ: `crm.contactList` (`crm.ts:160`) 0 caller; dedupe SĐT âm thầm server-side → dễ trùng cơ hội.

## 3. Quyết định operator (2 vòng, 2026-07-02 — FINAL)

| # | Quyết định | Chọn |
|---|---|---|
| D1 | Phạt trễ/sớm | **Trừ tự động vào payslip** khi compute (cộng dồn từ punch tháng), breakdown rõ; GĐ override (miễn/giảm) trước finalize — dùng cơ chế override sẵn có. |
| D2 | Sale → phiếu thu | **Sale tạo phiếu NHÁP từ trang cơ hội** (nút "Tạo phiếu thu", tự link opportunityId); duyệt vẫn GĐ/kế toán; `receiptApprove` **auto-advance opp → O5**. Cấp `finance.receiptCreate` thêm role sale (create=draft-only theo thiết kế hiện tại). |
| D3 | Sale & CSKH | **Cấp `afterSale.*` cho sale** (facility-scoped). Authorization change → decision record. |
| D4 | Hồ sơ HR | **ĐẦY ĐỦ**: SĐT nhập lúc tạo + startedAt + managerId + CỘT MỚI địa chỉ/CCCD/tài khoản ngân hàng. CCCD + bank là nhạy cảm: che (mask) khi hiển thị, chỉ 2 GĐ + super_admin xem/sửa; audit mọi truy cập sửa. Data-model hard gate → migration + decision record. |
| D5 | Quyền duyệt ca | **Mở cho người-được-chỉ-định**: managerId của phiếu duyệt được phiếu đó (guard assigned-approver + chống tự duyệt đã có; mở module perm cho các role staff, handler siết); 2 GĐ duyệt mọi phiếu như cũ. |
| D6 | Ranh giới | **LÀM**: danh bạ liên hệ + cảnh báo trùng SĐT khi tạo cơ hội; báo cáo công tháng (procedure + UI); lịch sử chấm công (self + manager); nút rút phiếu ca; vá notif (nextManagerId + cảnh báo managerId null); lỗi trùng email thân thiện; guard facility-less. **DEBT**: web-lead inbox, Callio sync, Graph 0015, badge admin. |

## 4. Workstreams đề xuất cho Plan 3

- **W1 Mạch hoa hồng** (D2): nút tạo-phiếu-từ-cơ-hội + finance-panel truyền opportunityId + perm sale + auto-O5 on approve + int tests (commission new/renewal attribution qua UI path).
- **W2 Mạch chấm công–lương** (D1, D5, D6): penalty aggregation vào `payslipCompute` (+override + breakdown), `monthlyReport` procedure + UI, history UI (self/manager), withdraw button, notif fix, delegated-approver perm mở rộng.
- **W3 Mạch onboarding HR** (D4): migration cột mới (address, nationalId, bankAccount, bankName…), user.create + phone, profileUpsert mở rộng (managerId, startedAt, cột mới), form staff-profile/onboarding (phối hợp P5 seam-fixes — Plan 3 MỞ RỘNG form P5 đã nối, không làm trùng), masking + quyền xem nhạy cảm, dup-email friendly, facility guard.
- **W4 CRM hygiene** (D3, D6): contact directory UI (contactList) + cảnh báo trùng SĐT trước khi tạo cơ hội, cấp afterSale cho sale.
- **W5 Validation + hồ sơ**: decision records (commission-sale-draft; attendance-payroll-deduction; hr-sensitive-record; delegated-shift-approver), parity snapshot, int/e2e, DEBT.md.

## 5. Ràng buộc & phụ thuộc
- **Chạy SAU Plan 1 (seam-fixes)** — đụng chung `permissions.ts`, payroll panels, snapshot. Có thể chạy SONG SONG Plan 2 (LMS PDF) — file disjoint (finance/crm/shift/user vs submission/annotator/parent-view); xác nhận lại lúc thi công.
- Lane: **HIGH-RISK** (authorization nhiều nhánh + data model nhạy cảm + tiền lương). Story folder + decision records + harness checkpoints bắt buộc.
- Migration mới phải replay-from-zero 0-drift (chuẩn đã đặt từ vụ work-shift).
- CCCD/bank: không log giá trị thô, mask UI, cân nhắc mã hóa cột (quyết ở plan — tối thiểu mask + quyền + audit).

## 6. Success criteria
1. Sale chốt O4 → bấm tạo phiếu nháp → GĐ duyệt → hoa hồng ghi đúng soldById + kind=new + opp tự sang O5 (int test đi qua đúng UI path — không gọi API tay).
2. Payslip tháng có dòng khấu trừ đi-trễ/về-sớm khớp tổng punch; GĐ override được; finalize khóa số.
3. GĐ mở "Báo cáo công tháng" thấy đủ nhân sự cơ sở: ngày công, trễ/sớm, phạt; drill-down lịch sử punch từng người.
4. Tạo nhân viên mới 1 màn: email+SĐT+tên+role+cơ sở+cấp trên+ngày vào làm+(địa chỉ/CCCD/bank) → login SSO được, có hồ sơ+mức lương, phiếu ca định tuyến đúng cấp trên; CCCD/bank hiển thị dạng che với người không đủ quyền.
5. Trưởng nhóm được set managerId duyệt được phiếu ca của nhân viên mình; không tự duyệt được phiếu của chính mình.
6. Danh bạ liên hệ tìm theo SĐT/tên; tạo cơ hội trên SĐT đã có → cảnh báo hiển thị cơ hội đang mở.

## Unresolved
- Không còn ở mức brainstorm — chi tiết cột nhạy cảm (mã hóa hay chỉ mask), thứ tự phase, và điểm nối chính xác với P5 seam-fixes để /plan quyết.
