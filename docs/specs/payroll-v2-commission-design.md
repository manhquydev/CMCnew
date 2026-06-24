# Thiết kế: Tự động tính hoa hồng (payroll v2) — sale-attribution + mới/tái tục + quota

> Trạng thái: 🔬 **ĐỀ XUẤT** (2026-06-24) — tổng hợp từ 2 nghiên cứu agent (Odoo CRM + map hiện trạng CMCnew). Chờ chủ dự án chốt 3 quyết định mở (cuối file) trước khi build.
> Nguồn nghiên cứu: Odoo Commissions/Subscriptions docs + audit codebase CMCnew (file:line trong báo cáo agent).

## Nguyên tắc rút ra (học Odoo, lọc cho trung tâm nhỏ)
- **Attribution "đi theo bản ghi", một chủ sở hữu** (Odoo: `crm.lead.user_id` → `sale.order` → invoice `invoice_user_id`). Bỏ split-credit nhiều sale. → CMCnew: `Opportunity.ownerId` (CVTV) lan tới `Receipt.soldById`.
- **Commission = quota → tỷ lệ đạt → bậc thang** (Odoo Commission Plans "Target-based, Monthly"). Trùng PA2 gần như 1:1.
- **Khác biệt CÓ CHỦ Ý:** Odoo chốt hoa hồng trên **doanh thu đã xuất hóa đơn**; PA2 trên **doanh thu THỰC THU**. Giữ "thực thu" — phù hợp học phí. Không để "cho giống Odoo" lật ngược về sau.
- **Mới vs tái tục = mượn khái niệm MRR-movement của Odoo** (New/Renewal), KHÔNG bê nguyên module Subscriptions (thừa cho 1 sản phẩm = học phí).

## Thiết kế dữ liệu (tối thiểu, hợp pattern "đóng băng tại approve" sẵn có)
1. **`Opportunity.ownerId String?`** + index — CVTV phụ trách. Set tại create/leadIngest (mặc định người tạo, admin gán lại được). Opportunity CHÍNH LÀ phần việc bán hàng.
2. **`Receipt.soldById String?` + `Receipt.kind ReceiptKind?` (`enum {new, renewal}`) + `Receipt.opportunityId String?`** — quy gán + phân loại, **đóng băng khi approve** (giống cách khóa code/voucher hiện tại). Snapshot (không suy động) để lương tái lập được kể cả khi opp bị gán lại sau. `collectedById` giữ nguyên = thủ quỹ.
3. **Quota → `SalaryRate.monthlyQuota Int`** (KHÔNG tạo bảng mới). `SalaryRate` **đã effective-dated + admin sửa được** — đúng yêu cầu "config thu nhập effective-dated, sửa UI, forward-only"; quota đi theo bậc lương. Tái dùng, không thêm bảng.

## Luồng quy gán
```
opportunityCreate/leadIngest:  ownerId := sale tạo/được gán
   ▼ enrollment.enroll(opportunityId)   ← đã có sẵn
   ▼ receiptCreate nhận opportunityId (UI prefill từ opp đã won của HS)
receiptApprove:  soldById := opp.ownerId ; kind := suy (dưới) ; ĐÓNG BĂNG cả hai
```

## Quy tắc mới vs tái tục (suy tại approve, admin sửa được + audit)
- **MỚI** ⇔ receipt gắn Opportunity đã tới O5_ENROLLED **VÀ** là receipt approved đầu tiên của HS trong chương trình đó.
- **TÁI TỤC** ⇔ HS đã có receipt approved trước đó (cùng chương trình), không qua opp test mới — HS cũ đóng tiếp.
- **Ca quay lại sau gián đoạn** (HS hết khóa, nghỉ, quay lại qua test mới): có receipt cũ → suy "tái tục", nhưng đi qua phễu mới → có thể muốn "mới (win-back)". **Quyết định chính sách của chủ dự án** (xem Q2).

## Tính hoa hồng (domain-payroll, thuần + test)
```
Gom theo soldById theo kỳ (receipt approved/sent/reconciled, theo approvedAt YYYY-MM):
  new_revenue, renewal_revenue
attainment% = new_revenue / monthlyQuota → bậc thang PA2 → rate_new
commission = new_revenue × rate_new(attainment) + renewal_revenue × rate_renewal
→ ghi vào Payslip.variablePay (tự động hóa đúng ô đang nhập tay)
Ngân sách ≤6% doanh thu thực (PA2) — cảnh báo nếu vượt.
```

## CTO tự chốt (ít mơ hồ, cả 2 báo cáo đồng thuận)
- **Snapshot tại approve** (không suy động) — lương tái lập được, gán lại opp không dịch chuyển hoa hồng đã duyệt.
- **Kỳ theo `approvedAt`** ("thực thu"), không theo createdAt.

## Quyết định đã chốt (chủ dự án, 2026-06-24)
1. **Config đầy đủ sửa-được trên UI** (ưu tiên chất lượng lâu dài, không ngại thời gian): tạo entity **`CompensationPolicy` effective-dated** chứa TOÀN BỘ tham số (bảng % hoa hồng theo bậc quota, % tái tục, KPI band theo khối, đơn giá vượt giờ theo bậc, gói parttime, bậc thuế PIT + giảm trừ, quota mặc định). Chỉ `super_admin` sửa, áp dụng **về sau** (payslip đọc bản hiệu lực tại kỳ; finalize đóng băng → quá khứ an toàn). Logic `domain-payroll` tham số hóa theo policy (hằng số hiện tại thành DEFAULT seed).
2. **Quay lại sau gián đoạn = KHÁCH MỚI (win-back)** nếu đi qua phễu test đầu vào mới (có Opportunity + TestAppointment entrance mới). Không cần ngưỡng thời gian.
3. **Hoa hồng team (TNKD/GĐTT) HOÃN** — v1 chỉ cá nhân CVTV. Team rollup cần `managerId` (reporting-line) → slice sau khi cần.

## Lộ trình build (epic — slice dọc, verify từng slice)
- **CV1 — Config foundation:** `CompensationPolicy` effective-dated + Zod `CompensationParams` + `DEFAULT_PARAMS` (PA2 + Đào tạo) + tham số hóa `domain-payroll` (functions nhận params). *Done:* test domain với params; migrate áp được.
- **CV2 — Config router + UI:** CRUD policy (super_admin), `getEffective(period)`; UI super_admin sửa tham số (form/JSON có validate). *Done:* tạo version mới hiệu lực tương lai; non-super bị chặn (live).
- **CV3 — Sale attribution:** `Opportunity.ownerId` + `Receipt.soldById/kind/opportunityId` + enum `ReceiptKind`; set owner; đóng băng + suy kind (win-back=new) tại approve. *Done:* tạo opp→enroll→receipt→approve gán đúng sale + kind (live).
- **CV4 — Quota + commission compute:** `SalaryRate.monthlyQuota`; gom doanh thu theo sale/kỳ; tính attainment→hoa hồng theo policy hiệu lực; ghi `Payslip.variablePay` (auto). Cảnh báo ngân sách ≤6%. *Done:* phiếu lương sale có hoa hồng tự tính khớp domain (live).
- **CV5 — UI HR + verify end-to-end:** hiển thị cấu phần hoa hồng trên payslip; chốt luồng. *Done:* end-to-end live.
