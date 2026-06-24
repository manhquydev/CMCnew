# CMCnew — Roadmap theo rủi ro

> Thứ tự ưu tiên: **nền tảng/phụ thuộc dữ liệu → rủi ro tenancy/bảo mật → giá trị nghiệp vụ → rủi ro tích hợp**.
> Mỗi phase là một lát cắt dọc chạy được, có done-evidence thật. Không build hết một lần.

## Phase 0 — Nền tảng (chặn mọi thứ, làm trước)

Mục tiêu: bộ khung an toàn để mọi phase sau bám vào.
- Monorepo (pnpm+turbo) + tooling (tsconfig/eslint/prettier) + CI.
- `packages/db`: Postgres + Prisma + migration đầu (facility, user, role, user_facility) + **RLS policy mẫu**.
- `packages/auth`: session/JWT/`tokenVersion`/RBAC + **RLS context per-request**.
- **Seed `super_admin` idempotent từ env** (sửa lỗi P3 hệ cũ).
- `apps/api` (Hono+tRPC) skeleton + 3 app shell (lms/teaching/admin) + `packages/ui` design tokens.
- **Done-evidence:** đăng nhập super_admin trên DB trống; test chứng minh RLS cô lập 2 facility; CI xanh.

## Phase 1 — Identity & Lõi giáo vụ

Mục tiêu: xương sống học thuật + giá trị LMS đầu tiên.
- Admin: quản lý Facility / User / Role / gán facility.
- Teaching: Course catalog, Class batch (**mã B-YYYY-NNNN nguyên tử**), Room, Schedule slot → sinh Session, Timetable, gán giáo viên/phòng.
- Enrollment + student lifecycle.
- Điểm danh (Teaching) — present/absent/late + excused.
- **🆕 Hạ tầng Audit/Chatter kiểu Odoo (cross-cutting)** — gắn vào mọi thực thể giáo vụ ngay từ Phase 1.
- (Cổng học sinh xem điểm danh/streak → Phase 2.)
- **Done-evidence:** tạo lớp → xếp lịch → điểm danh; đổi trạng thái lớp ghi đầy đủ vào chatter (ai/khi/cũ→mới + lý do). Spec chi tiết: `specs/phase-01-academic-core.md`.

## Phase 2 — Đánh giá & trải nghiệm LMS học sinh

- Exercise (3 loại) + submission + homework grading.
- `domain-grading`: 3 công thức UCREA/BI/BH + rubric → Grade/FinalGrade/QualitativeAssessment.
- Dashboard học sinh (điểm/bài tập), Dashboard phụ huynh (gradebook/học bạ).
- `domain-rewards`: Sao (ledger atomic) + Quà + Huy hiệu + Leaderboard.
- **Thông báo realtime (SSE)** + Level progress + duyệt head-teacher.
- **Done-evidence:** nộp bài → chấm → điểm + sao hiện realtime; redeem quà không double-spend. Spec chi tiết: `specs/phase-02-assessment-lms.md`.

## Phase 3 — Doanh thu & CRM

- CRM: Contact, Opportunity O1–O5 + stage transition + **lead-ingest seam** (cho website sau).
- Tài chính: Phiếu thu (draft→approve→render→send), **Voucher consume nguyên tử (sửa M2)**, Discount tiers (trần 35%), Course price effective-dated, Reconciliation.
- Test appointment + grading (entrance/periodic) gắn O3/O4.
- **Done-evidence:** lead web → O1→O5 → enrollment → phiếu thu duyệt; voucror đơn-dùng không bị over-consume.

## Phase 4 — Nhân sự, Lương & HR

- Employment profile, Salary rates (effective-dated), **Payslip (PIT 7 bậc, finalize gating — sửa M6)**, Teaching activity, Sales revenue, KPI/Quota.
- Nghỉ phép + Lịch làm việc (mutual-exclusion guard).
- **Payroll deferrals M4/M5/M9/M10/M11 nêu rõ là quyết định mở** (không âm thầm bỏ).
- **Done-evidence:** tính → duyệt → đánh dấu đã trả payslip; non-HR không thấy số lương.

## Phase 5 — After-sale, Guardian, Exec & hoàn thiện

- After-sale case + student lifecycle. _(⬜ chưa làm)_
- **Guardian link backend + UI** (sửa lỗ A3 hệ cũ). _(✅ done-by-evidence 2026-06-24 — backend+admin+LMS portal đã build; bất biến A3 khóa bằng int-test 11 surface, PH thấy đúng+đủ con, chặn con người khác/xuyên facility. Defer: SSE + student-self isolation.)_
- Dashboard BGĐ/MAES. _(⬜ chưa làm — cần định nghĩa công thức MAES trước)_
- Cron họp phụ huynh (cadence) _(✅ done — T13 auto-cadence)_, Chứng chỉ auto-gen _(⬜)_, ~~Chat CSKH~~ _(đã bỏ — operator decision, DEBT.md)_.
- (Audit/Chatter đã làm nền từ Phase 1 — Phase 5 chỉ mở rộng cho các module after-sale/exec.)
- **Done-evidence:** phụ huynh thấy đủ con; MAES tính đúng; case đổi lifecycle học sinh.

## Nhánh song song

- **Mobile app (HS/PH):** khởi động sau Phase 2 (API LMS ổn định). Expo/RN trên cùng tRPC.
- **Website management:** khi cần gom website đã có vào quản lý — chỉ qua lead-ingest seam + brand, không nằm critical path.

## Nguyên tắc gate

Mỗi phase chỉ "done" khi có **bằng chứng thế giới thật** (chạy trên URL như người dùng), không phải "test pass" hay "code merged". RLS + atomic + finalize là checklist bắt buộc ở mọi phase chạm tenant/tiền/lương.
