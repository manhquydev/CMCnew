# Phase 01 — Integration test khóa invariant (P0)

> Khóa các bất biến tiền/tenancy/lương đã verify thủ công thành test tự động chạy trên Postgres thật.

## Context
- Seam: `withRls(ctx, fn)` trong `packages/db/src/index.ts` (ctx: `{ facilityIds, isSuperAdmin, principalKind?, studentIds? }`).
- Mẫu có sẵn: `packages/db/src/verify-rls.ts` (đã chứng minh cô lập facility bằng tsx).
- Test runner: vitest (domain packages đang dùng, config mặc định).
- CI đã provision Postgres + `db:migrate` + `db:seed` → tái dùng được cho integration.

## Quyết định cấu trúc
- Tạo package test tích hợp: `apps/api` (hoặc `packages/db/test/`) với `vitest.config.ts` riêng, tag `integration`, chạy tuần tự (`--no-threads`/`singleThread`) vì đụng DB chung.
- Test gọi qua `withRls` + Prisma trực tiếp (đúng tầng router thực thi), seed dữ liệu tối thiểu trong `beforeAll`, cleanup trong `afterAll` (hoặc transaction rollback nơi có thể).
- Không mock DB — phải là Postgres thật để RLS/atomic có hiệu lực.

## Files
- TẠO `apps/api/test/voucher-atomic.int.test.ts`
- TẠO `apps/api/test/rls-tenancy.int.test.ts`
- TẠO `apps/api/test/payroll-finalize.int.test.ts`
- TẠO `apps/api/test/star-redeem.int.test.ts`
- TẠO `apps/api/vitest.integration.config.ts` (+ script `test:int` trong `apps/api/package.json`)
- THAM CHIẾU (không sửa): `apps/api/src/routers/{finance,rewards,payroll,crm}.ts`, `packages/db/src/index.ts`

## Invariant phải phủ (mỗi cái = 1 test thật, có bằng chứng vị trí)
1. **Voucher đua** (`finance.ts:213`): 2 lần `receipt.approve` song song trên cùng voucher `maxUses=1` → đúng 1 thành công, 1 `CONFLICT`; `used_count` cuối = 1.
2. **Voucher refund** (`finance.ts:326`): approve rồi cancel → `used_count` trả về 0.
3. **Cap 35%** (`pricing.ts:66`): tier 30 + voucher 20 → effectiveDiscount = 35, không phải 50.
4. **RLS xuyên cơ sở**: `withRls({facilityIds:[A]})` không đọc/ghi được record của facility B (student, receipt, payslip).
5. **RLS principal-aware**: `withRls({principalKind:'parent', studentIds:[s1]})` chỉ thấy submission/grade/reward của s1; không thấy của HS khác cùng/khác cơ sở.
6. **Non-HR đọc lương**: ctx role quan_ly/sale/giao_vien → đọc `salary_rate`/`payslip` ra rỗng (RLS) **và** router `requireRole` → FORBIDDEN.
7. **Finalize gating M6** (`payroll.ts:188`): payslip `finalized` → gọi compute lại → `CONFLICT`; chỉ `draft` mới tính lại được.
8. **Sao double-spend** (`rewards.ts:64`): 2 redeem song song trên gift `stock=1` → 1 OK, 1 CONFLICT; số dư sao = SUM(ledger) đúng, không âm.
9. **Mã atomic**: tạo nhiều ClassBatch/Receipt song song cùng facility-năm → mã `B-`/`PT-YYYY-NNNN` không trùng.

## Steps
1. Dựng `vitest.integration.config.ts` (singleThread, testTimeout cao, include `**/*.int.test.ts`).
2. Helper seed: 2 facility, 1 voucher maxUses=1, 1 gift stock=1, 1 student mỗi facility, 1 payslip draft.
3. Viết 9 test theo danh sách trên; với test "đua" dùng `Promise.allSettled` 2 lời gọi đồng thời.
4. Chạy local: `pnpm --filter @cmc/api test:int` trên `pnpm db:up` + migrate + seed.

## Tests / Validation (done-evidence)
- [ ] `test:int` PASS toàn bộ 9 invariant trên Postgres local.
- [ ] Cố tình phá 1 invariant (vd bỏ `WHERE used_count<max_uses`) → test tương ứng FAIL (chứng minh test có răng).
- [ ] Dán output PASS + 1 lần FAIL-có-chủ-đích vào reports/.

## Rủi ro & rollback
- Test đụng DB chung → chạy tuần tự, seed/cleanup cô lập theo prefix dữ liệu test; không chạy song song với dev DB đang dùng tay.
- Nếu seed xung đột seed mặc định → dùng facility/code riêng cho test, xóa cuối run.
