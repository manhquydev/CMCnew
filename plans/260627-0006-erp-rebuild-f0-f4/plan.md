# ERP Rebuild — Roadmap F0..F4

Status: ✅ COMPLETE + E2E REAL-RUN VERIFIED — F0..F4 build, verify đa vòng + edge case, committed (8 commit 17a2efc→aacda0e). Integration api 210 pass/2 pre-existing email (R6 GRAPH_*), ui 6/6, admin+teaching build ✓. **E2E Playwright 19/19** (boot 4 app thật → login → nav lọc role → onboard HS-mới). Phát hiện chạy thật: thiếu COOKIE_SECURE=false → login hỏng trên HTTP local (đã fix .env + .env.example). Chưa push/PR (chờ user).
Branch nền: develop · Tạo: 2026-06-27

## Tiến độ
- [x] F0 Part A — permission registry @cmc/auth + requirePermission, 107 procedure migrate, parity 6/6, review SHIP (commit 17a2efc).
- [x] F1 — provisioning atomic @receipt.approve + rollback provenance; adversarial test tìm 2 BLOCKER (UI new-student unreachable, concurrency race) + 2 HIGH (sibling dedupe, facility filter) → đã fix & verify đa vòng (unit 12, int approve 6, edge 8 incl. concurrency, parity 6); commit c7198b1.
- [x] F2 — Student Detail (6 tab) + edit thu hẹp fullName/dateOfBirth+audit + fix 2 bug lịch (date-filter + FK room/teacher); review tìm 2 blocker (empty re-run crash, dead lifecycle validator) → fixed + regression test; commit 49da18a.
- [x] F0 Part B — gộp frontend→apps/admin, port 9 panel teaching, nav lọc role + persona-landing; review tìm 4 drift blocker → fix bằng registry browser-safe (@cmc/auth/permissions) dùng chung can(), 8 test nav-consistency; commit 8d99f1c. **F0 DONE.**
- [x] F3 — 6 primitive packages/ui (PageHeader/EmptyState/StatCard/StatusBadge/DataTable+utils) + redesign overview/students/crm; ui test 6/6, admin 8/8; commit 2428937. (Defer: MasterDetail/FilterBar/CRM kanban — follow-up.)
- [x] F4 — chatter history sidebar (RecordEvent timeline + follower→SSE) + term lock + grading weights config-as-code; review tìm 1 BLOCKER (default weight 1.0/0.0 sai cho BRIGHT_IG/BLACK_HOLE trên seed mới — parity test giả) → fix bằng null-override (null→charter) + parity test thật đọc DB; commit 3947daa. (Defer: RecordActivity inbox.)
Owner: manhquy

## Mục tiêu
Biến CMC ERP từ "engine mạnh nhưng sơ sài bề mặt" → hệ vận hành 1 mối, phân quyền chặt, luồng học sinh đúng nghiệp vụ, UI chuyên nghiệp. Mỗi pha là 1 đơn vị loop chạy độc lập, có acceptance đo được.

## Nguồn quyết định (đọc trước khi code)
- `plans/reports/synthesis-260626-2338-erp-lms-comprehensive-clarification-report.md` (master)
- `plans/reports/architecture-260626-2338-unified-erp-rbac-report.md`
- `plans/reports/spec-audit-260626-2338-teacher-permissions-report.md`
- `plans/reports/gap-analysis-260626-2338-business-completeness-report.md`
- `plans/reports/ui-audit-260626-2338-unified-erp-redesign-direction-report.md`
- `plans/reports/decision-260626-2338-rbac-model-recommendation-report.md`
- `plans/reports/decision-260626-2338-receipt-reversal-student-rollback-report.md`
- `plans/reports/compare-260626-2218-erp-lms-vs-openeducat-odoo-admissions-report.md`

## Nền tảng đã có (đã build & merge develop — KHÔNG làm lại)
- **Staff ERP login = Microsoft SSO/OIDC** (Entra app CMC; `@azure/msal-node`; `apps/api/src/lib/sso.ts`, `routers/auth.ts`; `mintStaffSession`; domain @cmcvn.edu.vn). Password chỉ super_admin break-glass.
- **LMS phụ huynh = Email OTP 6 số** (`services/login-otp.ts`); HS giữ loginCode+password.
- **Email outbound = MS Graph outbox** (`lib/graph-client.ts`, `services/email-outbox.ts`), no-op tới khi set `GRAPH_*`.
- R1–R5 DONE & verified (184 test). **Còn R6** = IT config (ENTRA_CLIENT_SECRET + redirect URI + Mail.Send consent + GRAPH_SENDER_*) — ngoài phạm vi F0..F4.
- **Hệ quả:** F0 chỉ lắp RBAC registry LÊN TRÊN session SSO đã phát; KHÔNG viết lại auth. Roles từ DB AppUser, không từ Entra groups.

## Quyết định đã khóa
- ERP gộp 1 SPA staff, nav lọc theo role; LMS riêng.
- RBAC = explicit per-role, registry tập trung `module → action → Role[]`, super_admin bypass, không kế thừa.
- Tạo lớp/xếp lịch = quan_ly + head_teacher. head_teacher KHÔNG có verb dạy. ctv_mkt = CRM tối thiểu (lead O1).
- Student sinh atomic tại `receipt.approve`; dedupe SĐT phụ huynh; gỡ `student.create` khỏi UI; thêm `createdByReceiptId`.
- Rollback receipt: không hard-delete; void-do-nhầm → soft-archive+withdraw; hoàn-tiền-thật → giữ HS.

## Các pha

| Pha | File | Mục tiêu | Rủi ro | Phụ thuộc |
|----|----|----|----|----|
| F0 | phase-00-rbac-registry-unified-shell.md | Registry quyền tập trung + gộp admin/teaching → 1 StaffShell lọc theo role | TB (auth) | — |
| F1 | phase-01-student-provisioning-atomic.md | receipt.approve → tạo Student+Enrollment+Guardian atomic; gỡ student.create UI; rollback | **CAO** (data/finance) — high-risk story | F0 |
| F2 | phase-02-student-detail-schedule-fixes.md | Trang chi tiết HS; fix 2 bug lịch (date filter, FK room/teacher) | TB | F1 |
| F3 | phase-03-ui-primitives-redesign.md | 8 primitive packages/ui + redesign màn trọng điểm + /design | Thấp | F0 |
| F4 | phase-04-chatter-activity-config.md | RecordActivity + follower→SSE + sidebar lịch sử; weight DB; khóa kỳ | TB | F2 |

Song song được: F0 → (F1, F3). F2 sau F1. F4 sau F2.

## Acceptance toàn cục
- pnpm build + typecheck xanh toàn monorepo sau mỗi pha.
- Không hồi quy RLS (test đa cơ sở), JWT tokenVersion vẫn vô hiệu hóa token cũ.
- Không còn đường tạo Student ngoài seam receipt.approve trong UI vận hành.
- Mỗi pha có test/parity-check riêng (xem file pha).

## Còn mở (quyết trong pha tương ứng)
- Multi-program enrollment (F1/F2): 1 HS học nhiều chương trình cùng lúc?
- Staff inbox RecordActivity (F4): cần task inbox hay chỉ sidebar lịch sử?
- Field bất biến ở Student sau khi thành HS (F2).
