# Báo cáo hoàn thành — Docs / E2E / Frontend / Chất lượng (CMCnew)

Ngày: 2026-06-28 00:10 · Branch: develop · Goal: nâng chất lượng dự án tự động (agents + workflow + gitnexus)

## Trạng thái kiểm thử (đã verify lần cuối)
- ✅ **324/324 integration test** (64 file) — xanh.
- ✅ **18/18 E2E** (Playwright, chạm React thật) — xanh (13 cũ + 5 mới gồm 4 luồng + fail-closed 2 case).
- ✅ typecheck `@cmc/api` + `@cmc/admin` + `@cmc/auth` — sạch. admin **lint xanh** (trước đỏ).

## Việc đã làm (goal này)

### A. Tài liệu vai trò — đã sửa đúng/đủ (commit 5e2f91a)
4-agent audit phát hiện docs lệch (viết trước thay đổi tối nay). Đã sửa 7 điểm:
- Chứng chỉ → đánh dấu **tạm ẩn** (cả 2 doc).
- Doc sale/GV: bỏ "tự nộp KPI", "huy hiệu", "menu Duyệt cấp độ" (không có UI tới được) → mô tả đúng thực tế.
- Doc GĐ: thêm trang xem chung read-only, trường "Vai trò chính", ghi rõ form không có ô mật khẩu (SSO).
- Không còn nhắc: nhập mật khẩu khi tạo nhân sự, GV tự nhập điểm chuẩn.

### B. Frontend thừa/thiếu/hỏng — đã sửa (commit 3252a00 + credential fix)
- **C1** gỡ import `Select` thừa (lint đỏ → xanh).
- **C2** wire nút "Điều chỉnh KPI" (kpiOverride) — sửa điểm có lý do + ghi log (đúng ý owner).
- **C3** gỡ type `scores?` thừa ở kpiEvalConfirm.
- **C4** chặn hash route `#certificate` (đã ẩn nav).
- **Frontend-missing**: `receiptApprove` trả về tài khoản LMS (mã đăng nhập + mật khẩu tạm) cho nhân viên đưa phụ huynh, nhưng UI bỏ qua → **đã thêm modal hiển thị** (mã đăng nhập facility-prefixed `HQ-HS-...`).

### C. E2E — lấp gap "chỉ test backend" (commit nhiều)
Audit: E2E cũ 4 file smoke, 0/8 luồng quan trọng phủ đầy đủ. Đã thêm 4 luồng frontend thật (chạy trên dev stack auto-start):
- **B2** Tạo nhân sự qua form SSO-only — **khẳng định KHÔNG có ô mật khẩu** (chốt chặn thay đổi tối nay).
- **B5** Login fail-closed cho nhân sự (chỉ super_admin password; staff SSO-only).
- **B6** Tạo cơ hội CRM qua form.
- **B1** [P0] Duyệt phiếu thu → sinh học sinh + tài khoản LMS, **mã đăng nhập facility-prefixed** hiển thị thật — phủ trọn đường tiền + provisioning qua frontend.

### D. Robustness hạ tầng test (commit cuối)
- Phát hiện + sửa **flaky thật**: `commission-for-sale-e2e` afterAll xóa toàn bộ contact theo facility → tích tụ rác + xung đột FK khi E2E và int dùng chung dev DB. Đã thu hẹp về chỉ xóa contact của chính nó → **xanh kể cả khi E2E tạo dữ liệu facility 1 trước**.

## Còn lại (tracked — không chặn vận hành)
- **E2E B3/B4/B7** (KPI confirm/approve UI, LMS làm bài→chấm→xem điểm, điểm danh): cần **fixture-seed** (phiếu KPI submitted, exercise published, class session) vì seed dev chưa có (0 session, 0 exercise). Là hạng mục E2E-infra kế tiếp.
- **Prod infra** (cần SSH/cert của owner): TLS/HTTPS + `COOKIE_SECURE=true`, `.env.production`, đổi mật khẩu `cmc_app`, cron backup — đã có runbook `docs/prod-deploy-security-runbook.md` + `scripts/backup-db.sh`.
- Các quyết định product trước đó đã xử lý: passMark server-controlled, chứng chỉ tắt, KPI nhân sự chỉ xem.

## Báo cáo nguồn
- Audit gốc: `plans/reports/qa-260627-2327-docs-e2e-frontend-audit-report.md`
- Plan security/prod: `plans/260627-2229-prod-security-readiness/plan.md`

## Câu hỏi mở
- Có cần dựng E2E fixture-seed (global-setup) để phủ nốt B3/B4/B7 không, hay để khi build CI (Jenkins)?
