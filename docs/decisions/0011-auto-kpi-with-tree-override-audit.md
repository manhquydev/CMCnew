# 0011 KPI tự động + override theo cây quyền + audit

Date: 2026-06-25

## Status

Accepted

## Context

Hiện tại điểm KPI (0–100) do HR nhập tay vào `payslipCompute`. Mục tiêu: hệ thống tự tính KPI
từ dữ liệu thật, nhưng quản lý vẫn cần sửa khi hệ thống tính sai hoặc có yếu tố thực tế (dự giờ).
Yêu cầu minh bạch: mọi thay đổi phải ghi log.

Nguồn công thức: tài liệu "Cơ cấu thu nhập CMC 2026" (khối Đào tạo + Kinh doanh).

## Decision

**Mô hình hybrid: auto-compute + manager override + full audit.**

- **KPI = điểm tổng hợp có trọng số (0–100)** → band (A/B/C/D[/E]) → ratio → `kpiBonus`.
  Band/ratio lấy từ `CompensationPolicy` (đã effective-dated), KHÔNG hardcode.
- **Giáo viên (4 tiêu chí):** Chất lượng giảng dạy 35% · Tái tục HS 35% · Chủ nhiệm 20% ·
  Tuân thủ 10%. Tái tục + tuân thủ auto từ DB (enrollment + attendance/session). Chất lượng
  giảng dạy = **bán tự động (hướng B)**: hệ thống đề xuất từ điểm kiểm tra HS, quản lý điều chỉnh
  thêm phần dự giờ (có log). Chủ nhiệm auto từ chatter log, override được.
- **Sale:** quota attainment (doanh thu thực thu / quota) + cuộc gọi hợp lệ Callio (decision 0010)
  + số lead (= Opportunity có TestAppointment entrance status=done, do sale `ownerId` phụ trách).
- **Hoa hồng khách mới CVTV = theo % HOÀN THÀNH QUOTA** (chốt cuối 2026-06-25 sau đối soát 3 agent;
  **Excel là nguồn chuẩn**): bậc <50/50-80/80-100/100-120/>120-150/>150% → 0/1/2/3/4/5%. (docx
  GĐ/Phó-GĐTT mô tả theo doanh thu tuyệt đối 50/80/100/160/240tr — MÂU THUẪN; Excel thắng. Chi tiết
  + cách xử lý: `plans/reports/from-3agent-recon-260625-1446-payroll-doc-conflicts-bottleneck-report.md`.)
  Renewal CVTV = retention 50/70/90% → 1.5/2/2.2% (khớp cả 2 nguồn). KPI sale = 4 bậc (Excel)
  A90=100/B80=80/C60=50/D<60=0. Ngân sách ≤6% (Excel). Đã revert `domain-payroll`+`commissionForSale`+test.
- **Override theo cây quyền:** quản lý trực tiếp của nhân sự + mọi cấp cao hơn được sửa điểm
  từng tiêu chí và điểm tổng. Không ai sửa KPI của chính mình.
- **Audit bắt buộc:** mỗi override ghi `kpi_override_log` (entity, tiêu chí, giá trị cũ → mới,
  actor, lý do bắt buộc, thời điểm ICT). Snapshot điểm auto gốc giữ nguyên để so sánh.
- **Đổi bậc/mức lương** (`SalaryRate`/`EmploymentProfile.grade`) ghi chatter kiểu Odoo
  (record_event): ai, cũ → mới, lý do.

## Mô hình phiếu KPI đã chốt (2026-06-25, từ ảnh hệ cũ erp.teky + 2 file Excel)

- **KPI = "Phiếu đánh giá" kiểu Odoo per (nhân sự, kỳ)**, KHÔNG phải số auto thuần. Mỗi tiêu chí
  chấm điểm, có **trọng số**; tổng hợp qua `weightedKpi` → band.
- **2 phiếu liên kết:** Phiếu KPI riêng; khi **Approved** → điểm cuối đổ sang Payslip đã có
  (finalize gating giữ nguyên). Không gộp vào payslip.
- **Workflow 4 trạng thái:** `draft → submit → confirm → approved`.
  - draft: HR/hệ thống tạo (auto-prefill các ô định lượng: cuộc gọi Callio, tái tục, điểm HS).
  - submit: nhân sự tự đánh giá + nộp.
  - confirm: quản lý trực tiếp (N+1) duyệt.
  - approved: cấp trên (N+2)/HR chốt → khóa, đổ điểm sang payslip. Mọi chuyển trạng thái + sửa
    điểm ghi chatter (record_event).
- **Bộ tiêu chí + trọng số cấu hình trong `CompensationPolicy`** (theo khối GV/sale), super_admin
  sửa, hiệu lực theo kỳ.
- **Band KPI sale = 4 bậc** (file Excel cột "% thưởng KPI", verify 2026-06-25): A 90-100=100% ·
  B 80-<90=80% · C 60-<80=50% · D <60=0%. KPI GV giữ band khối Đào tạo.
- Ngân sách thưởng hoa hồng = **≤6% doanh thu thực** (chốt 2026-06-25 theo file Excel; `budgetPct=0.06`).

## Alternatives Considered

1. **Giữ manual hoàn toàn**: đơn giản nhưng không minh bạch, không tận dụng dữ liệu đã có → loại.
2. **Auto hoàn toàn, không cho sửa**: không xử được sai số/ngoại lệ thực tế (dự giờ) → loại.
3. **Override tự do không log**: vi phạm yêu cầu minh bạch → loại.

## Consequences

Positive:

- Minh bạch: mọi can thiệp người dùng có vết; điểm auto gốc luôn truy được.
- Khách quan phần lớn KPI; con người chỉ chỉnh phần dữ liệu không nắm được.
- Tái dùng hạ tầng audit/chatter + CompensationPolicy sẵn có.

Tradeoffs:

- Cần "cây quyền" (ai quản ai). v1 dùng role + facility scope; reporting-line `managerId`
  chi tiết hoãn (mọi `quan_ly`/`bgd` cùng facility coi là cấp trên của giao_vien/sale).
- Công thức "chất lượng giảng dạy" từ điểm HS cần chuẩn hóa thang điểm → rủi ro lệch, mitigate
  bằng override + log.
