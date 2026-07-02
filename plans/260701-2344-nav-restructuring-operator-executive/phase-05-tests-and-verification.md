# Phase 5 — Test + nav-consistency guard + verification

## Context links
Parent: `plan.md`. Phụ thuộc Phase 1-4 xong. Pattern test tham chiếu: scout mục E —
`apps/admin/src/__tests__/nav-teacher-consolidation.test.ts` (88 dòng) và
`apps/admin/src/__tests__/nav-consistency.test.ts` (154 dòng).

## Overview
- Priority: P1 | Status: pending (blocked by Phase 1-4)

## Requirements
1. **`nav-sale-pipeline-view.test.ts`** — chỉ cần nếu Phase 2 có thay đổi hành vi test-được (vd
   default view state); KHÔNG cần test nav visibility (Phase 2 không đổi gate).
2. **`nav-director-kd-cockpit-consolidation.test.ts`** — theo mẫu `keysOf`/`grantedByRegistry`
   (`nav-teacher-consolidation.test.ts:29-45`):
   - `isBizDirectorOnly` account thấy cockpit, KHÔNG thấy `overview`.
   - Multi-role (`giam_doc_kinh_doanh`+bất kỳ role khác) giữ nav gốc, không gộp.
   - `it.each` role khác (`giam_doc_dao_tao`, `sale`, `hr`, `ke_toan`) KHÔNG thấy
     `biz-director-cockpit`.
3. **`nav-director-dt-cockpit-consolidation.test.ts`** — tương tự cho `giam_doc_dao_tao`.
4. **`nav-consistency.test.ts` cập nhật**: `expectedOpen` (`:151`) thêm 2 key placeholder mới
   (`biz-director-cockpit`, `edu-director-cockpit`) — theo đúng cách `student-mgmt`/
   `payroll-checkin` đã được note là placeholder-only (`:141-153`).
5. **API test cho Phase 1** — đã liệt kê trong `phase-01-approval-inbox-backend.md` Todo list,
   verify lại ở đây: chạy full, không chỉ file liên quan.
6. **Full verification giống pattern Phase 4 của `hr-role-consolidation`** (đã dùng thành công,
   xem `plans/260701-1906-hr-role-consolidation/phase-04-full-verification.md`):
   - `pnpm --filter admin test` toàn bộ (không chỉ file mới).
   - `pnpm --filter api test` toàn bộ.
   - `tsc --noEmit` cho `apps/admin`, `apps/api`.
   - Build `apps/admin` (`vite build`).
   - `gitnexus_detect_changes({scope:"all"})` trước khi commit (bắt buộc theo CLAUDE.md dự án).

## Architecture
Không đổi code sản phẩm ở phase này — chỉ test + verification.

## Related code files
- `apps/admin/src/__tests__/nav-director-kd-cockpit-consolidation.test.ts` (mới)
- `apps/admin/src/__tests__/nav-director-dt-cockpit-consolidation.test.ts` (mới)
- `apps/admin/src/__tests__/nav-consistency.test.ts` (cập nhật `expectedOpen`)
- `apps/api/test/dashboard-my-approvals.int.test.ts` (mới, hoặc gộp vào file test dashboard có sẵn
  nếu tồn tại — kiểm tra trước khi tạo file mới, theo nguyên tắc "check existing modules before
  creating new")

## Implementation Steps
1. Viết 2 file test nav director theo đúng cấu trúc `nav-teacher-consolidation.test.ts` (dynamic
   import + `DOMMatrix` stub, `:22-27`).
2. Cập nhật `nav-consistency.test.ts` `expectedOpen`.
3. Viết/gộp test API cho `dashboard.myApprovals` (role-aware + separation-of-duty).
4. Chạy full suite admin + api, không chỉ file mới.
5. `tsc --noEmit` + build admin.
6. `gitnexus_detect_changes({scope:"all"})`.
7. Nếu tất cả xanh: sync-back plan.md + 4 phase file (status → done), theo Mandatory Sync-Back
   Guard của `project-management` skill.

## Todo list
- [ ] Test nav KD cockpit (isolation + multi-role safety + other-role exclusion)
- [ ] Test nav DT cockpit (isolation + multi-role safety + other-role exclusion)
- [ ] `nav-consistency.test.ts` cập nhật + xanh
- [ ] API test `dashboard.myApprovals` role-aware + separation-of-duty
- [ ] Full `pnpm --filter admin test` xanh (không chỉ file mới)
- [ ] Full `pnpm --filter api test` xanh
- [ ] `tsc --noEmit` sạch (admin + api)
- [ ] Build admin pass
- [ ] `gitnexus_detect_changes({scope:"all"})` — không có symbol ngoài dự kiến
- [ ] Sync-back toàn bộ plan (plan.md + 4 phase file) status → done

## Success Criteria
Tất cả mục Todo list pass. Không cần xử lý thêm.

## Risk Assessment
Thấp — phase kiểm chứng thuần, không code sản phẩm mới. Rủi ro duy nhất là bỏ sót
regression ở nav-consistency guard nếu quên cập nhật `expectedOpen` — sẽ fail rõ ràng, không
silent.

## Next steps
Sau khi xanh: hỏi user có muốn commit (theo `git-manager` subagent, conventional commit,
KHÔNG tự ý push) — theo đúng flow finalize của `/ck:cook`.
