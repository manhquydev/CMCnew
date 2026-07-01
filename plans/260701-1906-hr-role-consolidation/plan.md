---
title: "Gộp role RBAC dư thừa (quan_ly/head_teacher/bgd)"
description: "Xóa 3 role quản lý-cấp-trung trùng chức năng 2 giám đốc, giữ 4 role back-office thật"
status: in-progress
priority: P2
effort: 10h
branch: develop
tags: [rbac, auth, migration, prisma]
created: 2026-07-01
---

# Gộp role RBAC dư thừa — Phương án C

Brainstorm gốc: `plans/reports/brainstorm-260701-1906-hr-role-consolidation-report.md`

## Mục tiêu
12 role → 9 role. Xóa `quan_ly, head_teacher, bgd` (trùng chức năng 2 giám đốc). Giữ
`ke_toan, hr, cskh, ctv_mkt` (chức năng nghiệp vụ thật, cần khi scale 10→25 người).

## Phases

| # | Phase | Status | File |
|---|---|---|---|
| 1 | Discovery — liệt kê user thật cần remap | ✅ done | `phase-01-discovery-real-users.md` |
| 2 | Permission registry rewrite (TDD) | ✅ done | `phase-02-permission-registry-rewrite.md` |
| 3 | Prisma Role enum migration + data remap | ✅ done | `phase-03-prisma-role-enum-migration.md` |
| 4 | Verification toàn diện | 🔶 in-progress (còn E2E live / smoke / doc / commit) | `phase-04-full-verification.md` |

## Trạng thái thật (verify 2026-07-01 22:1x)
- Code + migration + test: **XONG**. `tsc` api+auth exit 0; enum Role = 9 giá trị; grep enum sạch
  (chỉ còn comment + 1 heuristic free-text `position`); API suite 418/419 (1 fail pre-existing).
- **Chưa xong (chặn coi là done thật + go-live):** (1) chưa commit working tree; (2) doc
  `huong-dan-su-dung-giam-doc.md` 5 đoạn stale chưa sửa; (3) prod DB chưa apply migration RBAC
  (kẹt sau lỗi cũ work-shift thiếu CREATE TABLE — xem memory `work-shift-missing-create-table-migration`);
  (4) Playwright `.spec.ts` + smoke 2 giám đốc chưa chạy trên stack sống.

## Dependencies
Phase 2 phụ thuộc Phase 1 (cần biết ai remap đi đâu để viết test đúng). Phase 3 phụ thuộc
Phase 2 (registry đổi trước, enum đổi sau, để parity test bắt lỗi sớm). Phase 4 chạy cuối.

## Cập nhật sau audit 3-agent song song (2026-07-01, `/cook`)
Đối chiếu plan với code sống phát hiện 2 vấn đề đã sửa vào các phase file:
1. Bảng re-map Phase 2 thiếu 11 dòng (`badge.*`, `exercise.*`, `crm.testGrade`,
   `finance.priceCreate/voucherCreate/receiptCreate/receiptMarkSent`, `submission.*`) — đã
   bổ sung theo quy tắc domain-consistent (học vụ→giam_doc_dao_tao, tài chính→
   giam_doc_kinh_doanh).
2. `apps/api/src/routers/shift-registration.ts` hardcode fallback role `bgd` cho escalation
   duyệt ca — **quyết định đã chốt**: fallback theo nhóm ca (`KINH_DOANH`→giám đốc kinh
   doanh, `DAO_TAO`→giám đốc đào tạo). Phải sửa file này TRƯỚC khi xóa enum value.
Thêm touchpoint: `crm.ts`, `class-batch.ts`, `user.ts`, 3 file frontend admin, `seed.ts`,
`seed-lms.ts`. Thêm doc-update: `docs/huong-dan-su-dung-giam-doc.md` (5 đoạn).
Chi tiết đầy đủ trong từng phase file.

## Acceptance criteria (toàn plan)
- `Role` enum chỉ còn 9 giá trị, không còn `quan_ly/head_teacher/bgd`.
- `permission-parity.test.ts` xanh; không permission nào có mảng role rỗng.
- `DIRECTOR_ROLE_GRANTS` cho giám đốc kinh doanh tự tạo được `ke_toan/hr`.
- Full API integration suite + E2E work-shift/KPI/finance/CRM xanh.
- Query xác nhận: 0 `AppUser` còn role bị xóa.

## Risks (xem chi tiết từng phase)
- Data loss nếu remap sai người thật (Phase 1 bắt buộc trước khi sửa code).
- Postgres enum không DROP VALUE trực tiếp — cần recreate type.
- Vừa ship work-shift (2026-07-01) — đổi registry cần rerun E2E riêng của tính năng này.
