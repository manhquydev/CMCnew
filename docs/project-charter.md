# CMCnew — Project Charter (Scope & Làm rõ)

> Tài liệu nguồn-sự-thật về **phạm vi**. Mọi quyết định build bám vào đây. Cập nhật khi scope đổi.
> Ngày lập: 2026-06-23 · Nguồn: audit hệ cũ `D:\project\CMC` + 4 lượt phỏng vấn chốt hướng.

## 1. Tầm nhìn

Nền tảng **ERP + LMS thống nhất** cho Creative Maieutic Center — trung tâm giáo dục sáng tạo theo phương pháp Maieutic (Socratic), 3 chương trình theo độ tuổi 3–11. Một codebase, một database, không Odoo, không tầng sync.

**Lý do build lại** (không refactor): hệ cũ khởi đầu bằng Odoo rồi xóa đi xây ERP custom giữa chừng → kẹt ở trạng thái 3 kho dữ liệu song song (Odoo + LMS Prisma + internal RLS), tài liệu lỗi thời, code chắp vá khó kiểm soát.

## 2. Phạm vi

### Trong phạm vi (v1 = parity sạch)
- **2 app** dùng chung 1 backend + 1 DB:
  - **LMS** — học sinh + phụ huynh
  - **Staff (apps/admin)** — app nhân viên hợp nhất, nav lọc theo role: giáo viên, kế toán, HR, sale, CSKH, CTV marketing, quản lý, super_admin, BGĐ. _(Trước đây tách thành Teaching/ERP + Admin; apps/teaching đã retire, gộp vào apps/admin.)_
- Toàn bộ module nghiệp vụ của hệ cũ (xem §5).
- Multi-facility (đa cơ sở) + RLS.
- Seam nhận lead từ website ngoài vào CRM.

### Bổ sung so với hệ cũ (đã chốt)
- **Realtime push** (SSE) thay cơ chế polling cho thông báo & chat.
- **Mobile app** (HS/PH) — **nhánh sau**, dùng chung tRPC API.

### Ngoài phạm vi (khóa cứng)
- ❌ Website marketing `cmcvn.edu.vn` — đã có sẵn, không làm lại (sau gom vào quản lý).
- ❌ Thanh toán online (VietQR/PayOS), hóa đơn điện tử, auto-invoice cron — **giữ phiếu thu thủ công**.
- ❌ Migration dữ liệu thật — hệ cũ chưa có dữ liệu thật; chỉ seed/demo.
- ❌ Nâng cấp AI ngoài chat Gemini parity (xét sau).
- ❌ Đa ngôn ngữ — tiếng Việt.

## 3. Người dùng & vai trò (RBAC)

| Role | App | Quyền chính |
|---|---|---|
| `student` (học sinh) | LMS | Nộp bài, xem điểm/điểm danh, sao thưởng (read-only) |
| `parent` (phụ huynh) | LMS | Xem con: điểm/điểm danh/học bạ, chat CSKH, lịch họp |
| `giao_vien` (giáo viên) | Teaching | Điểm danh, chấm điểm, feedback. **Không vào LMS** |
| `sale` (kinh doanh) | Teaching | CRM, enrollment |
| `cskh` | Teaching | After-sale case, contact |
| `ctv_mkt` (CTV marketing) | Teaching | CRM (hạn chế, không fork) |
| `ke_toan` (kế toán) | Teaching | Phiếu thu, voucher/discount; xem payslip (che lương) |
| `hr` (nhân sự) | Teaching | Employment, payroll đầy đủ |
| `quan_ly` (quản lý) | Teaching/Admin | Duyệt lớp/enrollment/level-up, KPI decide |
| `super_admin` | Admin | Toàn quyền, cross-facility (break-glass) |
| `bgd` (ban giám đốc) | Admin | Dashboard KPI/MAES read-only |

**Quy tắc RBAC bất biến:** facility scope qua RLS (DB-resolved, không nhét trong JWT); `tokenVersion` thu hồi tức thì; che trường lương cho non-HR; teacher không bao giờ truy cập LMS.

## 4. Business rules cốt lõi (giữ nguyên từ hệ cũ)

- **3 chương trình & công thức điểm:**
  | Chương trình | Tuổi | Định tính | Định lượng |
  |---|---|---|---|
  | UCREA | 3–6 | 100% | 0% |
  | Bright I.G | 6–9 | 60% | 40% |
  | Black Hole | 9–11 | 30% | 70% |
- **CRM pipeline O1→O5:** O1 lead → O2 contacted (manual) → O3 đặt lịch test (auto-hook) → O4 đã test (auto-hook) → O5 nhập học (manual close-won). 1 opportunity = 1 học sinh / số điện thoại.
- **Học phí/giảm giá:** giảm cố định 15%/20%/30% theo 1/2/3 năm; **trần tổng 35%**; voucher consume **nguyên tử** tại `receipt.approve`.
- **Lương:** PIT 7 bậc; giảm trừ bản thân 11M/năm, người phụ thuộc 4.4M/năm; BHXH 10.5%; **input phải "finalize" trước khi tính payslip**.
- **Họp phụ huynh:** UCREA mỗi 5 tháng; Bright I.G & Black Hole mỗi 3 tháng; auto-gen idempotent.
- **Sao thưởng:** earn theo bài hoàn thành; redeem nguyên tử chống double-spend (advisory lock + `stock > 0`); bài giáo viên chấm (ảnh/PDF) chỉ cộng sao khi có điểm.
- **Điểm danh:** present/absent/late + cờ excused đã có. **Streak chưa build** (kế hoạch sau; khi làm: chuẩn timezone ICT UTC+7, chỉ tính present).
- **North star:** MAES (Monthly Active Engaged Students) — mục tiêu 65%.

## 5. Master list module (parity)

### ① LMS (học sinh + phụ huynh)
Bài tập & nộp bài (text / annotate ảnh / annotate PDF nhiều trang) · Điểm & học bạ (Grade, FinalGrade, QualitativeAssessment) · Điểm danh (streak chưa build) · Sao thưởng (ledger) + Quà + Huy hiệu + Leaderboard · Thông báo (16 loại, **realtime**) · Chat CSKH (FAQ + Gemini) · Lịch họp phụ huynh · Chứng chỉ · Level progress.

### ② Teaching/ERP (staff surface — nay delivered bởi app nhân viên hợp nhất `apps/admin`)
- **Giáo vụ:** Lớp/khóa (mã B-YYYY-NNNN nguyên tử), Enrollment + student lifecycle, Phòng, Lịch tuần → sinh buổi học, Timetable, gán giáo viên/phòng.
- **Chấm điểm:** Mark attendance, Test appointment + grading (entrance/periodic), Homework grading, Learning profile.
- **CRM:** Contact, Opportunity O1–O5, Stage transition (audit), Lead ingest.
- **Tài chính:** Phiếu thu (draft→approve→render→send), Voucher, Discount tiers, Course price (effective-dated), Reconciliation.
- **Lương/HR:** Employment profile, Payslip, Salary rates, Teaching activity, Sales revenue, KPI/Quota, Nghỉ phép, Lịch làm việc (mutual-exclusion).
- **After-sale/CSKH:** Case (bảo lưu/chuyển lớp/rút/khiếu nại) → student lifecycle.
- **Guardian:** liên kết phụ huynh ↔ học sinh.

### ③ Admin
User/Role/Facility management (RBAC) · Catalog khóa học · Config (discount/price) · Dashboard BGĐ/MAES · Activity log/audit polymorphic.

### ④ Xuyên suốt
Multi-facility + RLS · Audit/record event · Notifications (SSE) · Background jobs (cron họp PH, KPI snapshot, chứng chỉ, fan-out thông báo).

## 6. Bẫy hệ cũ phải né (nợ kỹ thuật đã biết)

| Bẫy | Cách xử lý ở CMCnew |
|---|---|
| Trùng thực thể 3 kho (user/student/attendance/grade) | **1 DB duy nhất**, không bản sao |
| `course` không có RLS (hở tenancy) | RLS bắt buộc trên **mọi** bảng tenant + test |
| Voucher consume non-atomic (M2) | `WHERE used_count < max_uses`, 0-row = CONFLICT |
| Không seed super_admin đầu (P3) | Seed idempotent từ env ngay Phase 0 |
| Payroll đọc input chưa finalize (M6) | Bắt buộc finalize trước khi tính |
| Số điện thoại nhiều định dạng | Chuẩn hóa khi ghi (0XXXXXXXXX) |
| Polling tự-DoS | Chuyển sang SSE realtime |
| Payroll deferrals M4/M5/M9/M10/M11 | Nêu rõ là **quyết định mở**, không âm thầm bỏ |

## 7. Glossary (rút gọn)

Maieutic = phương pháp Socratic gợi mở · Giáo vụ = academic ops · CTV = cộng tác viên marketing · CSKH = chăm sóc khách hàng · BGĐ = ban giám đốc · Tổ trưởng/Hiệu trưởng = head teacher · Phiếu thu = receipt · Học bạ = electronic report card · Sao = reward currency · MAES = Monthly Active Engaged Students.
