# CMCnew — Roadmap theo rủi ro

> Thứ tự ưu tiên: **nền tảng/phụ thuộc dữ liệu → rủi ro tenancy/bảo mật → giá trị nghiệp vụ → rủi ro tích hợp**.
> Mỗi phase là một lát cắt dọc chạy được, có done-evidence thật. Không build hết một lần.

## Phase 0 — Nền tảng (chặn mọi thứ, làm trước)

Mục tiêu: bộ khung an toàn để mọi phase sau bám vào.
- Monorepo (pnpm+turbo) + tooling (tsconfig/eslint/prettier) + CI.
- `packages/db`: Postgres + Prisma + migration đầu (facility, user, role, user_facility) + **RLS policy mẫu**.
- `packages/auth`: session/JWT/`tokenVersion`/RBAC + **RLS context per-request**.
- **Seed `super_admin` idempotent từ env** (sửa lỗi P3 hệ cũ).
- `apps/api` (Hono+tRPC) skeleton + app shell (lms + staff; teaching shell sau này gộp vào admin) + `packages/ui` design tokens.
- **Done-evidence:** đăng nhập super_admin trên DB trống; test chứng minh RLS cô lập 2 facility; CI xanh.

## Phase 1 — Identity & Lõi giáo vụ

Mục tiêu: xương sống học thuật + giá trị LMS đầu tiên.
- Admin: quản lý Facility / User / Role / gán facility.
- Teaching: Course catalog, Class batch (**mã B-YYYY-NNNN nguyên tử**), Room, Schedule slot → sinh Session, Timetable, gán giáo viên/phòng. Tạo lớp có thể nhập khung giờ buổi học đầu tiên để tạo `ClassBatch` + `ScheduleSlot` trong cùng thao tác.
- Enrollment + student lifecycle.
- Điểm danh (Teaching) — present/absent/late + excused.
- Session 360 vertical slice — timetable/session detail là trục thao tác buổi học: trước buổi xem thông tin, T-15 mở điểm danh, sau giờ kết thúc hiện mock bài tập LMS/nhận xét/ảnh lớp/publish PH. Full persisted LMS evidence còn ở Phase 2.
- **🆕 Hạ tầng Audit/Chatter kiểu Odoo (cross-cutting)** — gắn vào mọi thực thể giáo vụ ngay từ Phase 1.
- (Cổng học sinh xem điểm danh/streak → Phase 2.)
- **Done-evidence:** tạo lớp → xếp lịch → điểm danh; đổi trạng thái lớp ghi đầy đủ vào chatter (ai/khi/cũ→mới + lý do). Spec chi tiết: `specs/phase-01-academic-core.md`.

## Phase 2 — Đánh giá & trải nghiệm LMS học sinh

- Exercise (3 loại) + submission + homework grading.
- `domain-grading`: 3 công thức UCREA/BI/BH + rubric → Grade/FinalGrade/QualitativeAssessment.
- Dashboard học sinh (điểm/bài tập), Dashboard phụ huynh (gradebook/học bạ).
- Session evidence cho PH/HS — persisted ảnh buổi học, nhận xét theo form cho từng học sinh, publish lên LMS. _(⬜ pending; vertical slice Session 360 đã có ở Phase 1, Harness: LMS-SESSION-EVIDENCE.)_
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
- **CV5 HR UI (✅ done 2026-06-25):** Tab "Nhân sự & Lương" trong admin (hr/ke_toan/super_admin); SalaryRateCard có ô quota tháng; CommissionCard gọi `commissionForSale`, hiển thị breakdown attainment/rate/HH, nút "Đưa vào variablePay". _Harness: CV5-hr-ui · Int-test: PAY-FINALIZE, PAY-MYSLIPS, FIN-COMMISSION · E2E: admin-smoke (login gate)._
- **Bell notification (✅ done 2026-06-26):** Staff bell wired in the unified admin staff shell (useStaffNotif hook, SSE + tRPC staffNotif router, Popover dropdown). Grouped NavLink sidebar (AppShell) and class-list pagination (20/page) now live in `apps/admin` after the teaching app was retired and consolidated into the unified staff shell. Docker full stack prod-ready (nginx + docker-compose.prod.yml). HR panel staff table + payslip drawer via payroll.roster. _Harness: BELL-NOTIF, HR-PANEL-UI, TEACH-SHELL, DOCKER-PROD, TEACH-PAGINATE._
- **Work Shift Registration & Attendance (✅ done 2026-06-30, migrations verified 2026-07-01):** Four-module system: ShiftConfig (shift group catalog, KINH_DOANH/GIAO_VIEN with templates), ShiftRegistration (Draft/Submitted/Approved workflow, type work|leave, supersede chain), CheckInOut (punch-based, IP validation via FacilityNetwork, late 500d/min + early 1000d/min penalty), FacilityNetwork (CIDR IP whitelist). 7 new Prisma models. `EmploymentProfile.managerId` for reporting hierarchy. Admin panels: checkin-panel, shift-reg-list-panel, shift-reg-detail-panel. Migration chain complete: 20260630139000_work_shift_tables + 20260701220000_sync_db_push_drift ensure zero drift on fresh deploy. _Backend: shift-config.ts, shift-registration.ts, check-in-out.ts, facility-ip.ts · Frontend: checkin-panel.tsx, shift-reg-list-panel.tsx, shift-reg-detail-panel.tsx._

## Phase 5 — After-sale, Guardian, Exec & hoàn thiện

- After-sale case + student lifecycle. _(✅ done-by-evidence 2026-06-25 — AfterSaleCase CRUD + transition open→in_progress→resolved→closed + assign + setStudentLifecycle; khóa bằng aftersale-student-lifecycle.int.test.ts 3 tests. Harness: AFS-LIFECYCLE · E2E: admin-smoke (login gate).)_
- **Guardian link backend + UI** (sửa lỗ A3 hệ cũ). _(✅ done-by-evidence 2026-06-24 — backend+admin+LMS portal đã build; bất biến A3 khóa bằng int-test 11 surface, PH thấy đúng+đủ con, chặn con người khác/xuyên facility. Defer: SSE + student-self isolation. Harness: SEC-GUARDIAN · E2E: lms-smoke.)_
- Dashboard BGĐ/MAES. _(⬜ chưa làm — cần định nghĩa công thức MAES trước)_
- Cron họp phụ huynh (cadence) _(✅ done — T13 auto-cadence. Harness: ACA-CADENCE, ACA-REMIND, ACA-TBD, ACA-CLOSE, ACA-REOPEN, ACA-WARN.)_, ~~Chứng chỉ auto-gen~~ _(bỏ auto — chỉ cấp tay; LMS = nền làm bài tập, decision 0008)_, ~~Chat CSKH~~ _(đã bỏ — operator decision, DEBT.md)_.
- (Audit/Chatter đã làm nền từ Phase 1 — Phase 5 chỉ mở rộng cho các module after-sale/exec.)
- **Done-evidence:** phụ huynh thấy đủ con; MAES tính đúng; case đổi lifecycle học sinh.

## Nhánh song song

- **Mobile app (HS/PH):** khởi động sau Phase 2 (API LMS ổn định). Expo/RN trên cùng tRPC.
- **Website management:** khi cần gom website đã có vào quản lý — chỉ qua lead-ingest seam + brand, không nằm critical path.

## Nguyên tắc gate (cập nhật 2026-06-25)

Mỗi phase chỉ "done" khi có **cả 3 lớp bằng chứng**:
1. **Harness story record** — `harness-cli story add --id ... --contract ...` đã ghi, status=implemented
2. **Integration test PASS** — `*.int.test.ts` kiểm tra tầng DB + RLS + business rule
3. **E2E smoke PASS** — Playwright smoke test xác nhận login và landing page trên URL thật

"done-by-evidence (self-reported)" không còn hợp lệ nếu không có harness story ID đi kèm.
RLS + atomic + finalize là checklist bắt buộc ở mọi phase chạm tenant/tiền/lương.

### Evidence registry (2026-06-26)

| Domain | Harness IDs | E2E coverage |
|---|---|---|
| Security/RLS | SEC-RLS-COV, SEC-RLS-TEN, SEC-GUARD, SEC-AUD-FOL, SEC-AUD-NOTE | admin-smoke, lms-smoke |
| Parent meetings | ACA-CADENCE, ACA-REMIND, ACA-TBD, ACA-CLOSE, ACA-REOPEN, ACA-WARN | admin-smoke (login gate) |
| Finance | FIN-VOUCHER, FIN-VOW-WIN, FIN-RECEIPT, FIN-COMM | admin-smoke |
| Payroll | PAY-FINAL, PAY-MYSLIP, CV5-hr-ui | admin-smoke |
| LMS/Rewards | LMS-BADGE, LMS-ASSESS, LMS-LEVEL, LMS-NO-CERT, LMS-SESSION-EVIDENCE, LMS-STAR, LMS-REWARD | lms-smoke |
| CRM/After-sale | AFS-LIFECYCLE, CRM-HOOKS, CRM-BATCH | unified-staff-shell, admin-smoke |
| UI/Infra | BELL-NOTIF, HR-PANEL-UI, TEACH-SHELL, DOCKER-PROD, TEACH-PAGINATE | admin-smoke, admin-hr-panel, unified-staff-shell |
