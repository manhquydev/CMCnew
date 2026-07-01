# Phase 4 — Full verification

## Context links
Parent: `plan.md`. Depends on Phase 2 + Phase 3. Brainstorm: `plans/reports/
brainstorm-260701-1906-hr-role-consolidation-report.md`.

## Overview
- Date: 2026-07-01 | Priority: P1 | Status: in-progress (API suite + DB query xanh; E2E live / smoke thủ công / doc / gitnexus còn lại)
- Work-shift/check-in feature vừa ship cùng ngày (2026-07-01) dùng chính các role bị xóa
  trong permission checks — bắt buộc rerun riêng, không chỉ tin parity test.

## Key Insights
- Theo memory `erp-rebuild-build-progress`: pattern đã dùng thành công trước đây là
  code-reviewer + tester song song tìm bug thật mỗi pha — áp dụng lại ở đây.

## Requirements
- Full API integration suite xanh.
- E2E suite xanh, đặc biệt: `apps/e2e/tests/work-shift-attendance.spec.ts`,
  `work-shift-manual-punch-approval.spec.ts`.
- `apps/api/test/work-shift-attendance.int.test.ts` xanh (đặc biệt case escalation fallback
  theo nhóm ca thay cho `bgd`).
- Nav UI (`apps/admin/src/nav-permissions.ts`) không hiện mục cho role đã xóa.
- Query DB xác nhận 0 user còn role cũ.
- **[BỔ SUNG sau audit]** Cập nhật `docs/huong-dan-su-dung-giam-doc.md` (dòng 88, 103, 121,
  142-144, 211) — các đoạn mô tả "GĐ Kinh Doanh KHÔNG được setStudentLifecycle/quản lý phụ
  huynh" và "GĐ Đào Tạo chỉ tạo được head_teacher" đã sai sau khi role này bị xóa và quyền
  chuyển giao cho 2 giám đốc. Nguồn: report agent tổng hợp workflow theo vai trò.
  `docs/huong-dan-su-dung-sale-giao-vien.md` và `docs/ARCHITECTURE.md` không bị ảnh hưởng.

## Architecture
Không đổi code — chạy test suite có sẵn + smoke thủ công qua UI cho 2 giám đốc.

## Related code files
- `apps/api/test/*` (toàn bộ integration suite)
- `apps/e2e/tests/*`
- `apps/admin/src/nav-permissions.ts`

## Implementation Steps
1. Chạy `pnpm test` (API integration) toàn bộ, không chỉ file liên quan.
2. Chạy E2E work-shift/KPI/finance/CRM specs.
3. Smoke thủ công: login as giám đốc kinh doanh → tạo tài khoản ke_toan mới (xác nhận
   DIRECTOR_ROLE_GRANTS hoạt động) → duyệt 1 phiếu thu → cấu hình facilityNetwork.
4. Smoke thủ công: login as giám đốc đào tạo → tạo phòng học → duyệt level progress →
   cấu hình shift.
5. Query DB: `SELECT count(*) FROM app_user WHERE roles && ARRAY['quan_ly','head_teacher','bgd']::"Role"[]` → phải = 0.
6. Chạy `gitnexus_detect_changes({scope: "all"})` theo yêu cầu CLAUDE.md dự án trước khi commit.

## Todo list
- [x] Full API integration suite xanh — 418/419 (1 fail pre-existing: email-graph-client, không liên quan)
- [ ] E2E work-shift + finance + CRM xanh — int.test bản đã xanh; Playwright `.spec.ts` CHƯA chạy trên stack sống
- [ ] Smoke thủ công 2 giám đốc (tạo tài khoản, duyệt tiền, cấu hình network/room) — CHƯA
- [x] Query xác nhận 0 user còn role cũ — cả prod + dev DB = 0 (đã verify)
- [ ] gitnexus detect_changes trước khi commit — CHƯA (working tree chưa commit)
- [ ] Cập nhật `docs/huong-dan-su-dung-giam-doc.md` (5 đoạn stale, xem Requirements) — CHƯA (file chưa đổi)

## Success Criteria
Tất cả mục Todo list pass, không cần xử lý thêm.

## Risk Assessment
Nếu bug phát hiện ở phase này liên quan tới separation-of-duty (VD 1 giám đốc kinh doanh
vừa confirm vừa approve KPI/finance vì chỉ có 1 người ở vị trí đó) — đây là rủi ro đã biết
trước (ghi trong Phase 2), chấp nhận ở quy mô <10 người, note lại thành decision record
nếu cần khi review.

## Security Considerations
Không phát hiện thêm ở phase verify — nếu tester tìm ra escalation path mới, dừng lại,
không merge, quay lại Phase 2 sửa registry.

## Next steps
Sau khi xanh hết: commit theo conventional commit, PR develop→main theo AGENTS.md branch
workflow (không commit thẳng main).
