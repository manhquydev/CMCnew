# Phase 3 — Prisma Role enum migration + data remap

## Context links
Parent: `plan.md`. Depends on Phase 1 (bảng remap user thật) + Phase 2 (registry đã đổi).
Brainstorm: `plans/reports/brainstorm-260701-1906-hr-role-consolidation-report.md`.

## Overview
- Date: 2026-07-01 | Priority: P1 | Status: done
- Postgres enum không có `DROP VALUE` trực tiếp — cần: remap data trước → tạo enum mới →
  swap → drop enum cũ. Đây là bước rủi ro cao nhất trong plan, chạy sau khi Phase 1 đã
  user-confirm bảng remap.

## Key Insights
- `Role` enum tại `packages/db/prisma/schema.prisma:15-28`.
- `AppUser.roles: Role[]` + `AppUser.primaryRole: Role` — 2 cột cần remap.
- **[CẬP NHẬT sau audit]**: grep toàn bộ migration SQL xác nhận KHÔNG có RLS policy/CHECK
  constraint nào hardcode literal `quan_ly/head_teacher/bgd` trong executable SQL (chỉ có ở
  comment và ở lệnh `CREATE TYPE`/`ADD VALUE` gốc) → enum recreate an toàn về mặt SQL.
- **[CẬP NHẬT — GAP NGHIÊM TRỌNG]**: `apps/api/src/routers/shift-registration.ts:31-54`
  (`resolveManager`) query cứng `roles: { has: 'bgd' }` làm fallback "next manager" khi hết
  chain quản lý trực tiếp — đây là logic nghiệp vụ SỐNG (escalation duyệt ca làm/chấm
  công), không chỉ permission-grant. **Quyết định đã chốt với user (2026-07-01)**: fallback
  theo nhóm ca của `resolveShiftGroup` — nhóm `KINH_DOANH` → `giam_doc_kinh_doanh`, nhóm
  `DAO_TAO`/giáo dục → `giam_doc_dao_tao`. Phải sửa code này TRƯỚC khi xóa enum value
  `bgd`, không phải sau (nếu không sẽ compile-fail và feature vừa ship 2026-07-01 vỡ).
- Migration command: `packages/db/package.json` → `migrate:dev` (prisma migrate dev, local)
  / `migrate` (prisma migrate deploy, prod). Không có wrapper riêng. Backup trước khi chạy
  prod dùng `scripts/db-backup.sh` (đã có sẵn).

## Requirements
1. Migration data (chạy trước khi đổi enum): với mỗi user trong bảng remap Phase 1,
   UPDATE `roles[]` (xóa giá trị cũ, thêm giá trị mới) và `primaryRole` nếu primaryRole
   đang là 1 trong 3 role bị xóa.
2. Migration schema: recreate `Role` enum bỏ `quan_ly, head_teacher, bgd` (theo pattern
   Prisma: tạo enum mới `Role_new`, ALTER COLUMN dùng USING cast, drop enum cũ, rename).
3. Cập nhật seed script (dev bootstrap) nếu seed có tạo user với 3 role này.

## Architecture
2 file migration riêng biệt trong `packages/db/prisma/migrations/`: 1 data-only (UPDATE),
1 schema-only (ALTER TYPE), theo đúng thứ tự để rollback dễ nếu cần.

## Related code files
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/<timestamp>_remap_legacy_roles/migration.sql` (mới)
- `packages/db/prisma/migrations/<timestamp>_drop_legacy_role_enum_values/migration.sql` (mới)
- `packages/db/src/seed.ts:115-117` (tạo 3 AppUser bootstrap với `Role.quan_ly/bgd/
  head_teacher` — sửa tường minh, không phải "seed script" chung chung)
- `packages/db/src/seed-lms.ts:23-24,38-39,241` (tạo user `head_teacher`/`quan_ly` làm
  `primaryRole`, comment dòng 241 gọi là "Leadership account (quan_ly)" — sửa)
- `apps/api/src/routers/shift-registration.ts:10-55` (**sửa TRƯỚC bước migration enum** —
  thay `roles: { has: 'bgd' }` bằng logic theo nhóm ca đã chốt, xem Key Insights)

## Implementation Steps
1. Sửa `shift-registration.ts` trước tiên (thay fallback `bgd` bằng logic theo nhóm ca) —
   chạy lại `work-shift-attendance.int.test.ts` để xác nhận không vỡ trước khi đụng enum.
2. Grep toàn `packages/db` + `seed.ts`/`seed-lms.ts` tìm mọi reference tới 3 role bị xóa.
3. Viết migration data (UPDATE app_user SET roles=..., primary_role=... theo bảng Phase 1).
4. Chạy migration data trên DB dev, verify bằng query (0 row còn 3 role cũ).
5. Viết migration schema (enum recreate), chạy trên DB dev.
6. `prisma generate` lại, build packages/db + tất cả app phụ thuộc (bắt lỗi compile ở
   `user.ts` `ROLE_LABELS`/picker nếu Phase 2 bỏ sót).
7. Cập nhật `seed.ts`/`seed-lms.ts` để không seed 3 role đã xóa.

## Todo list
- [x] Sửa `shift-registration.ts` fallback theo nhóm ca (TRƯỚC migration enum)
- [x] Test lại `work-shift-attendance.int.test.ts` sau khi sửa fallback
- [x] Grep toàn bộ reference 3 role trong packages/db + seed.ts + seed-lms.ts
- [x] Migration data (remap theo bảng Phase 1) — chạy dev DB
- [x] Verify 0 row còn role cũ (query xác nhận)
- [x] Migration schema (drop enum values)
- [x] `prisma generate` + build toàn monorepo
- [x] Cập nhật seed.ts/seed-lms.ts

## Success Criteria
- `SELECT DISTINCT unnest(roles) FROM app_user` không còn `quan_ly/head_teacher/bgd`.
- `\dT+ "Role"` (psql) chỉ liệt kê 9 giá trị.
- Build toàn monorepo (`packages/db`, `apps/api`, `apps/admin`) không lỗi type.

## Risk Assessment
- **Cao nhất trong plan**: sai sót ở migration data = mất quyền truy cập thật của nhân
  viên. Bắt buộc chạy trên DB dev trước, verify kỹ, backup trước khi chạy prod
  (`scripts/db-backup.sh` đã có sẵn theo memory).
- Nếu RLS policy SQL có hardcode role name (cần grep xác nhận), enum swap có thể phá RLS.

## Security Considerations
Backup DB bắt buộc trước khi chạy trên prod (`scripts/db-backup.sh`). Không chạy migration
enum trên prod ngoài giờ thấp điểm nếu team đã lên >10 người đang dùng hệ thống.

## Next steps
Phase 4 — chạy full test suite + E2E xác nhận không regression.
