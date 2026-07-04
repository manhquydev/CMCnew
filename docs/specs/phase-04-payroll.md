# Phase 4 — Đặc tả nghiệp vụ: Nhân sự & Lương

> **Mục đích:** chốt nghiệp vụ TRƯỚC khi code (spec-first). Đụng lương + thuế → hợp đồng nghiệp vụ chặt.
> Trạng thái: ✅ **ĐÃ CHỐT** (2026-06-24) · Nguồn: tài liệu "Cơ cấu thu nhập CMC 2026" (khối Đào tạo + khối Kinh doanh, 2 QĐ + 2 mẫu KPI) + ràng buộc vận hành thực tế của chủ dự án.

## Bối cảnh vận hành (chốt phạm vi build)
Thực tế hiện tại: **3 lãnh đạo chủ chốt + vai trò Giáo viên + Sale**. Vì vậy build **payslip theo thành phần linh hoạt** (component-based) thay vì hard-code công thức từng khối — GV/sale/lãnh đạo dùng chung một khung; các phần đặc thù (hoa hồng %, vượt giờ theo đơn giá bậc, phụ cấp định mức theo giờ, parttime gói, thưởng quý/năm) **nhập dạng dòng biến đổi** ở v1 và **tự động hóa thêm sau mà không phá khung**.

## Cơ cấu thu nhập thật (tóm tắt từ tài liệu)
- **Khối Đào tạo:** `Tổng TN = LCB + PC ăn trưa + PC định mức + Thưởng KPI + Thưởng vượt giờ`. GV 4 bậc (LCB 5.7M, tổng 10–13M, KPI max 1M); Trưởng nhóm GV; GĐĐT bậc 1–3 (tổng 17–25M). Parttime PT3/PT4/PT5 (3/4/5M trọn gói). Vượt giờ 100/120/130/150k theo bậc.
- **Khối Kinh doanh:** `Tổng TN = LCD + Thưởng KPI + Hoa hồng + Thưởng hiệu quả(Quý/Năm)`. CVTV 4 bậc (LCB 5.7M, tổng 7–10M, quota 100–280M); TPKD; GĐTT bậc 1–3. PC hiệu suất gắn calls/leads. Ngân sách thưởng ≤ 8% doanh thu.
- **KPI xếp loại (chung):** A(85–100)=100% · B(70–<85)=90% · C(50–<70)=80% · D(<50)=0%.
- **Nguyên tắc chung:** LCB theo ngày công thực/ngày công chuẩn · KPI = %hưởng × mức max · kỳ tính = 1 tháng · chi trả ngày 20–25 · thu nhập là **bí mật** (non-HR không thấy số lương).

## Quyết định đã chốt
- **Vai trò v1:** `giao_vien`, `sale`, lãnh đạo (`bgd`/`quan_ly`/`super_admin`). Position trên hồ sơ là enum mở rộng được (teacher/sales/lead_teacher/center_director/training_director…), bậc là chuỗi tự do (`B1`..`B4`, `PT3`…) — không khóa cứng.
- **Mức lương hiệu lực theo thời điểm** (`SalaryRate`, effective-dated, per nhân sự): `baseSalary`, `mealAllowance`, `otherAllowance`, `kpiMax`. Áp dụng bản mới nhất có `effectiveFrom ≤ kỳ lương`.
- **Payslip** theo `(employee, periodKey=YYYY-MM)`, idempotent theo khóa. Thành phần:
  - `baseEarned = round(baseSalary × workdays / standardDays)` (lương theo ngày công).
  - `allowanceEarned` = (mealAllowance + otherAllowance) prorate theo ngày công (mặc định prorate; có thể chỉnh).
  - `kpiScore` (0–100) → `kpiRatio` (A/B/C/D) → `kpiBonus = round(kpiMax × kpiRatio)`.
  - `variablePay` (số, + ghi chú): hoa hồng/vượt giờ/thưởng khác — nhập tay v1.
  - `grossIncome = baseEarned + allowanceEarned + kpiBonus + variablePay`.
  - `insuranceDeduction` (mặc định 0 — BHXH NLĐ 10.5% nhập sau nếu cần).
  - `dependents` (số người phụ thuộc) → giảm trừ gia cảnh.
  - `taxableIncome = max(0, grossIncome − insuranceDeduction − 11.000.000 − 4.400.000 × dependents)`.
  - `pitAmount = PIT lũy tiến 7 bậc(taxableIncome)`.
  - `netIncome = grossIncome − insuranceDeduction − pitAmount`.
- **Thuế TNCN 7 bậc (lũy tiến từng phần, theo tháng, trên thu nhập tính thuế):** 5M=5% · 5–10M=10% · 10–18M=15% · 18–32M=20% · 32–52M=25% · 52–80M=30% · >80M=35%. Giảm trừ: bản thân 11.000.000đ; phụ thuộc 4.400.000đ/người (hằng số cấu hình được).
- **Vòng đời payslip (sửa M6 — finalize gating):** `draft → finalized → paid`. **Chỉ tính lại được khi `draft`**; `finalized` đóng băng số liệu; `paid` đánh dấu đã trả. Không sửa số sau finalize (phải hủy về draft có audit).
- **Quyền (non-HR không thấy lương):** `hr` + `super_admin` quản lý payslip/rate đầy đủ; `ke_toan` xem để chi trả; **nhân sự chỉ xem payslip của chính mình** (slice sau, qua LMS/portal). RLS: payslip/rate **chỉ hr/ke_toan/super_admin** (giống parent_account admin-style — siết, không để quan_ly/sale/GV đọc lương người khác).
- **Logic số thuần** ở `packages/domain-payroll` (PIT, prorate, kpiRatio, assemble) — test độc lập, VND integer.
- Audit/chatter mọi mutation trạng thái; giờ ICT; soft-delete.

## Lộ trình build (slice dọc)
- **S1 — Lõi tính lương:** `packages/domain-payroll` (PIT 7 bậc + prorate + kpiRatio + assemblePayslip) **thuần + test**. *Done:* test phủ các mốc bậc thuế + xếp loại KPI + prorate.
- **S2 — Hồ sơ & mức lương:** `EmploymentProfile` (with auto-incrementing `employeeCode` field CMC0001..) + `SalaryRate` (effective-dated) + RLS hr-only + router config + UI HR. *Done:* tạo hồ sơ + mức lương + mã nhân sự, đọc bị chặn với non-HR (live).
- **S3 — Payslip:** tính (draft) → finalize → paid (gating) + RLS + audit + UI HR. *Done:* tính kỳ → finalize đóng băng → paid; non-HR 403; số khớp domain-payroll (live).
- **S4 — Bảng lương kỳ & chi trả:** danh sách payslip theo kỳ, tổng quỹ lương, đánh dấu đã trả hàng loạt; (xem payslip cá nhân → portal nhân sự, sau).

## Bất biến kỹ thuật
- PIT lũy tiến từng phần (không phải nhân thẳng bậc cao nhất); VND integer, làm tròn đồng.
- Payslip idempotent theo `(employee, periodKey)`; **finalize gating** — sửa số chỉ khi draft.
- SalaryRate effective-dated; chọn bản theo kỳ lương.
- RLS: rate/payslip chỉ hr/ke_toan/super_admin; non-HR tuyệt đối không đọc số lương người khác.
- Logic số ở `packages/domain-payroll` thuần + test; mọi mutation trạng thái → audit.

## Bảng quyết định (khóa schema)
| Mục | Quyết định |
|---|---|
| Phạm vi v1 | giao_vien + sale + lãnh đạo; payslip component-based, mở rộng sau không phá khung |
| Mức lương | SalaryRate effective-dated per nhân sự (LCB/PC ăn trưa/PC khác/KPI max) |
| KPI | điểm 0–100 → A/B/C/D → %; bonus = kpiMax × % |
| Biến đổi | hoa hồng/vượt giờ = variablePay nhập tay v1 (tự động hóa sau) |
| Thuế | PIT 7 bậc lũy tiến; giảm trừ 11M + 4.4M/người phụ thuộc (cấu hình) |
| Bảo hiểm | insuranceDeduction nhập tay, mặc định 0 |
| Vòng đời | draft→finalized→paid; finalize gating (sửa M6); sửa số chỉ khi draft |
| Quyền | hr/ke_toan/super_admin; non-HR không thấy lương (RLS siết) |
| Logic số | packages/domain-payroll thuần + test; VND integer |
| Ngoài v1 | hoa hồng %/vượt giờ tự động, parttime gói, thưởng quý/năm, portal nhân sự xem payslip |
