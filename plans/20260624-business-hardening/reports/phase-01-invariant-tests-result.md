# Phase 01 — Kết quả: Integration test khóa invariant

Ngày: 2026-06-24 · Chế độ: /cook --auto (execute plan)

## Done-evidence

### Test chạy thật (Postgres local, qua router tRPC)
```
✓ test/voucher-atomic.int.test.ts (3 tests)
✓ test/rls-tenancy.int.test.ts    (3 tests)
✓ test/payroll-finalize.int.test.ts (1 test)
Test Files  3 passed (3)
     Tests  7 passed (7)
```

### Chứng minh test có răng (intentional break → fail → revert)
Tạm bỏ guard `AND "used_count" < "max_uses"` trong `finance.ts:receiptApprove`:
```
× voucher atomic consume > two concurrent approvals ... → 1 ok, 1 CONFLICT
  (2 approve cùng thắng → 0 failed thay vì 1)
Tests  1 failed | 2 passed
```
→ Revert guard → 3/3 PASS lại. Test thật sự bắt được hồi quy.

## Invariant đã phủ
| Lớp | Test | Nguồn invariant trong code |
|---|---|---|
| Tiền | voucher đua maxUses=1 → 1 OK/1 CONFLICT, used_count≤max | `finance.ts:214` |
| Tiền | refund khi cancel → used_count về 0 | `finance.ts:327` |
| Tiền | tier 30% + voucher 20% → cap 35% | `domain-finance/pricing.ts:66` |
| Tenancy | facility-B không đọc được HS facility-A; super đọc được | RLS `student_isolation` |
| Tenancy | facility-B ghi vào A → WITH CHECK 42501 (không rò) | RLS WITH CHECK |
| Lương | payslip finalized → tính lại = CONFLICT; reopen → tính lại được | `payroll.ts:188` |

## Verify phụ
- `apps/api typecheck`: PASS (gồm test files).
- `apps/api/src` diff: **rỗng** — không đụng logic production.
- Domain unit test: 112 PASS (không đổi).
- Review độc lập: APPROVE_WITH_NITS (3 nit LOW, không chặn).

## CI (Phase 02)
Thêm vào `.github/workflows/ci.yml` (sau seed+verify-rls):
- `Unit tests` → `pnpm -r test` (112).
- `Integration tests` → `pnpm --filter @cmc/api test:int` (7).
- Lint: chưa thêm (repo chưa có eslint) — ghi nợ.

## Nit non-blocking (theo dõi, không sửa vòng này)
- WITH CHECK test match theo text lỗi PG (`/row-level security|42501/`) — có check 0-leak bù; chấp nhận.
- Cap-35% test dựa `DEFAULT_DISCOUNT_TIERS` fallback — nếu facility 1 seed tier khác sẽ lệch; cân nhắc seed tier tường minh.

## Còn lại trong plan
- Mở rộng test: star redeem race (LMS), CRM O3/O4 auto-hook, principal-aware parent/student read.
- Phase 03 (chatter UI + chốt hoa hồng), Phase 04 (go-live backlog).
