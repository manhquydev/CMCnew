# Phase 2 — Permission registry rewrite (TDD)

## Context links
Parent: `plan.md`. Depends on Phase 1 (bảng remap). Brainstorm: `plans/reports/
brainstorm-260701-1906-hr-role-consolidation-report.md`.

## Overview
- Date: 2026-07-01 | Priority: P1 | Status: done
- TDD: sửa `apps/api/test/permission-parity.test.ts` để mô tả kỳ vọng MỚI (9 role, các
  chỗ re-map) TRƯỚC, chạy fail, rồi mới sửa `permissions.ts` cho tới khi xanh.

## Key Insights
- Đa số dòng có `quan_ly/head_teacher/bgd` đã có giám đốc tương ứng đứng cùng dòng → xóa
  an toàn.
- `DIRECTOR_ROLE_GRANTS` cần thêm `ke_toan, hr` vào bộ giám đốc kinh doanh delegate được.
- **[CẬP NHẬT sau audit 3-agent 2026-07-01]**: bảng re-map ban đầu (9 dòng) THIẾU 11 dòng
  khác không có giám đốc cùng dòng nhưng vẫn còn `giao_vien`/`ke_toan` (không rỗng nên
  parity test không bắt được) — âm thầm mất tầng giám sát quản lý. Đã bổ sung bảng dưới.
  Nguồn: `plans/260701-1906-hr-role-consolidation/reports/code-reviewer-260701-1930-
  permission-remap-completeness-audit-report.md` (nếu tồn tại) hoặc kết quả agent audit.
- **[CẬP NHẬT]**: phạm vi sửa KHÔNG chỉ `permissions.ts` — còn hardcode role literal ở
  `apps/api/src/routers/crm.ts` (`CRM_MANAGER_ROLES`), `apps/api/src/routers/
  class-batch.ts` (`.includes('quan_ly')` filter thông báo), `apps/api/src/routers/
  user.ts` (`ROLE_LABELS` map + `hasSome` picker CSKH), `apps/admin/src/checkin-panel.tsx`,
  `apps/admin/src/shift-reg-list-panel.tsx`, `apps/admin/src/App.tsx` (role literal
  frontend). Các dòng dùng `Role` enum trực tiếp sẽ lỗi compile khi xóa enum value (fail-
  safe, bắt được ở bước build) — nhưng cần sửa chủ động, không chờ lỗi build.

## Requirements
Re-map permission (permissions.ts) — xóa `quan_ly/head_teacher/bgd` khỏi mọi mảng role,
riêng 9 dòng sau cần thêm role thay thế (không chỉ xóa suông):

| Module.action | Role thêm vào |
|---|---|
| `guardian.*` (parentList/parentCreate/listForStudent/link/unlink) | cả `giam_doc_kinh_doanh` + `giam_doc_dao_tao` |
| `room.create/update/archive` | `giam_doc_dao_tao` |
| `badge.create/archive` | `giam_doc_dao_tao` |
| `enrollment.complete` | `giam_doc_dao_tao` |
| `enrollment.enroll` | `+ giam_doc_kinh_doanh` (giữ `sale`) |
| `afterSale.setStudentLifecycle` | `giam_doc_kinh_doanh` |
| `student.update` | `+ giam_doc_kinh_doanh` (giữ `sale`) |
| `facilityNetwork.list/create/delete` | `+ giam_doc_kinh_doanh, giam_doc_dao_tao` (giữ `super_admin`) |
| `finance.receiptApprove/receiptCancel/receiptReconcile` | `+ giam_doc_kinh_doanh` (giữ `ke_toan`) |

`DIRECTOR_ROLE_GRANTS`:
```
giam_doc_kinh_doanh: ['sale', 'cskh', 'ctv_mkt', 'ke_toan', 'hr']
giam_doc_dao_tao: ['giao_vien']
```

### Bảng re-map bổ sung (11 dòng phát hiện thiếu ở audit — domain-consistent rule)
Quy tắc: domain học vụ mất giám sát → thêm `giam_doc_dao_tao`; domain tài chính mất giám
sát → thêm `giam_doc_kinh_doanh` (khớp cách xử lý `receiptApprove/Cancel/Reconcile`).

| Permission | Trước | Sau |
|---|---|---|
| `badge.list` | `quan_ly, head_teacher, giao_vien` | `+ giam_doc_dao_tao` (giữ `giao_vien`) |
| `badge.grant` | `giao_vien, head_teacher, quan_ly` | `+ giam_doc_dao_tao` (giữ `giao_vien`) |
| `exercise.create` | `giao_vien, quan_ly` | `+ giam_doc_dao_tao` (giữ `giao_vien`) |
| `exercise.publish` | `giao_vien, quan_ly` | `+ giam_doc_dao_tao` (giữ `giao_vien`) |
| `crm.testGrade` | `giao_vien, head_teacher, quan_ly` | `+ giam_doc_dao_tao` (giữ `giao_vien`) |
| `finance.priceCreate` | `quan_ly, ke_toan` | `+ giam_doc_kinh_doanh` (giữ `ke_toan`) |
| `finance.voucherCreate` | `quan_ly, ke_toan` | `+ giam_doc_kinh_doanh` (giữ `ke_toan`) |
| `finance.receiptCreate` | `ke_toan, quan_ly` | `+ giam_doc_kinh_doanh` (giữ `ke_toan`) |
| `finance.receiptMarkSent` | `ke_toan, quan_ly` | `+ giam_doc_kinh_doanh` (giữ `ke_toan`) |
| `submission.listByExercise` | `giao_vien, quan_ly` | `+ giam_doc_dao_tao` (giữ `giao_vien`) |
| `submission.layerForGrading` | `giao_vien, quan_ly` | `+ giam_doc_dao_tao` (giữ `giao_vien`) |

## Architecture
Không đổi shape file, chỉ đổi nội dung mảng role trong `PERMISSIONS` map + grants object.
Không đụng `can()`/`assignableRoles()` logic.

## Related code files
- `packages/auth/src/permissions.ts` (285 dòng — sửa)
- `apps/api/test/permission-parity.test.ts` (sửa trước — TDD)
- `apps/api/src/routers/crm.ts` (`CRM_MANAGER_ROLES` hardcoded array — sửa)
- `apps/api/src/routers/class-batch.ts:223` (`.includes('quan_ly')` notif filter — sửa)
- `apps/api/src/routers/user.ts:45,317,320,327` (`hasSome` picker + `ROLE_LABELS` map — sửa)
- `apps/admin/src/checkin-panel.tsx:39`, `apps/admin/src/shift-reg-list-panel.tsx:52`,
  `apps/admin/src/App.tsx:96` (frontend role literal — sửa)
- `apps/admin/src/nav-permissions.ts` (chỉ comment stale, không phải logic — cập nhật
  comment để bước grep-check ở Step 7 không false-fail)

## Implementation Steps
1. Đọc `permission-parity.test.ts` hiện tại để hiểu format assertion.
2. Cập nhật test: kỳ vọng 9 role, assert 9 dòng re-map đúng bảng trên, assert
   `quan_ly/head_teacher/bgd` không xuất hiện ở bất kỳ đâu trong `PERMISSIONS`.
3. Chạy test → phải FAIL (registry cũ chưa đổi).
4. Sửa `permissions.ts`: xóa 3 role khỏi mọi mảng, thêm role theo bảng re-map.
5. Sửa `DIRECTOR_ROLE_GRANTS`.
6. Chạy lại test → xanh.
7. Grep toàn repo `quan_ly|head_teacher|bgd` ngoài permissions.ts (UI nav-permissions,
   seed script, docs) để không sót reference chết.

## Todo list
- [x] Sửa permission-parity.test.ts trước (assert kỳ vọng mới)
- [x] Chạy test, xác nhận FAIL đúng lý do
- [x] Sửa permissions.ts theo bảng re-map
- [x] Sửa DIRECTOR_ROLE_GRANTS
- [x] Test xanh
- [x] Grep toàn repo tìm reference còn sót (nav-permissions.ts, seed, docs)

## Success Criteria
`permission-parity.test.ts` xanh; `grep -r "quan_ly\|head_teacher\|'bgd'"` trong
`packages/auth`, `apps/admin/src/nav-permissions.ts` không còn kết quả.

## Risk Assessment
- Finance approve giờ có thêm `giam_doc_kinh_doanh` — nếu chỉ có 1 giám đốc kinh doanh
  duy nhất và họ cũng là người tạo phiếu, mất tách bạch trách nhiệm ở quy mô rất nhỏ (đã
  note trong brainstorm, chấp nhận rủi ro này ở giai đoạn <10 người).
- Sót reference ở UI (`nav-permissions.ts`) → nav hiện sai cho role đã xóa. Bắt buộc grep
  bước 7.

## Security Considerations
`can()` fail-closed khi role không có trong map — nếu quên thêm role thay thế ở 1 trong 9
dòng, hành động đó sẽ KHÔNG ai làm được nữa (an toàn nhưng gây bug chức năng, không phải
lỗ hổng bảo mật).

## Next steps
Phase 3 — migration Prisma enum + data remap, dùng đúng bảng từ Phase 1.
