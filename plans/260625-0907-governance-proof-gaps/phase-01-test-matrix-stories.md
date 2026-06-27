---
phase: 1
title: "Populate TEST_MATRIX + Story backlog"
status: pending
priority: P1
dependencies: []
---

# Phase 01: Populate TEST_MATRIX + Story backlog

## Overview

Điền `docs/TEST_MATRIX.md` với ≥40 dòng contract từ 27 int-test file thật. Điền `docs/stories/backlog.md` với story entries cho từng cluster hành vi. Không tạo bằng chứng giả — mỗi dòng TEST_MATRIX phải map sang test file:line thật.

## Requirements

- Functional:
  - Mỗi dòng TEST_MATRIX = 1 contract (hành vi quan sát được), không phải 1 test function
  - Story backlog nhóm theo domain (auth, academic, finance, payroll, aftersale, guardian)
  - Mỗi story backlog entry có: ID, title, lane, status=implemented, link tới evidence file
- Non-functional:
  - TEST_MATRIX không blank sau phase này
  - Story IDs dùng pattern `US-XXX` theo template
  - Harness-cli `story add` được gọi cho ≥8 story đại diện (không phải toàn bộ — đủ chứng minh harness hoạt động)

## Architecture

TEST_MATRIX columns (từ template hiện tại):
```
| Story | Contract | Unit | Integration | E2E | Platform | Status | Evidence |
```

Mapping strategy:
- 1 int-test file → 1–4 contract rows (theo số `it()` block có nghĩa)
- `Unit` = yes nếu domain package có unit test
- `Integration` = yes (tất cả đều có int-test)
- `E2E` = no (chưa có — phase 02 sẽ điền)
- `Evidence` = file path ngắn gọn

## Related Code Files

- Modify: `docs/TEST_MATRIX.md`
- Modify: `docs/stories/backlog.md`
- Read (source truth): `apps/api/test/*.int.test.ts` (27 files)
- Read: `packages/domain-payroll/src/*.test.ts` (unit tests)
- Read: `packages/domain-grading/src/*.test.ts`
- Read: `packages/domain-rewards/src/*.test.ts`
- CLI (không sửa): `scripts/bin/harness-cli.exe`

## Implementation Steps

### Bước 1: Scan tất cả int-test để lấy describe/it labels

```bash
grep -n "describe\|it(" apps/api/test/*.int.test.ts | grep -v "//\|import" | head -200
```

Xác định nhóm contract per file:

| File | Contract cluster | Số rows |
|---|---|---|
| `rls-coverage.int.test.ts` | Mọi bảng có facility_id phải có RLS | 1 |
| `rls-tenancy.int.test.ts` | Facility isolation + principal isolation | 3 |
| `guardian-principal-isolation.int.test.ts` | PH thấy đúng con; không xuyên facility | 5 |
| `payroll-finalize.int.test.ts` | Finalize gate + PIT marginal | 3 |
| `payroll-myslips-bulk.int.test.ts` | IDOR guard + bulk pay + period summary | 3 |
| `voucher-atomic.int.test.ts` | Concurrent consume → 1 ok 1 CONFLICT; cancel refund | 3 |
| `voucher-window-fail-early.int.test.ts` | Out-of-window reject | 1 |
| `commission-for-sale-e2e.int.test.ts` | Attribution + computation + mutation-proof | 4 |
| `parent-meeting-cadence-autogen.int.test.ts` | Auto-gen per program cadence | 2 |
| `parent-meeting-reminder-idempotency.int.test.ts` | remindedAt dedup | 2 |
| `parent-meeting-time-tbd.int.test.ts` | Auto-gen → time-TBD; xác nhận giờ | 2 |
| `class-close-cancels-future-meetings.int.test.ts` | Close → cancel future meetings | 2 |
| `class-reopen-restores-meetings.int.test.ts` | Reopen → restore cancelled meetings | 2 |
| `parent-meeting-unknown-program-warns.int.test.ts` | Warn khi program không có cadence | 1 |
| `aftersale-student-lifecycle.int.test.ts` | Case lifecycle + student-lifecycle change | 3 |
| `audit-follow-visibility.int.test.ts` | Audit follow chặn xuyên facility | 2 |
| `audit-postnote-tenancy.int.test.ts` | postNote facilityId từ server, không từ client | 2 |
| `assessment-final-grade-publish.int.test.ts` | Publish final grade | 2 |
| `badge-auto-award-idempotency.int.test.ts` | Badge auto-award idempotent | 2 |
| `batch-code-atomicity.int.test.ts` | Batch code counter atomic | 1 |
| `crm-hooks.int.test.ts` | CRM stage hooks | 2 |
| `level-progress-authz.int.test.ts` | Level approval authz | 2 |
| `level-up-no-auto-certificate.int.test.ts` | Level-up không auto-cert | 1 |
| `receipt-kind-classification.int.test.ts` | Receipt kind new/renewal/winback | 2 |
| `reward-review-refund.int.test.ts` | Reward review + refund sao | 2 |
| `star-redeem.int.test.ts` | Sao redeem atomic | 2 |
| `aftersale-student-lifecycle.int.test.ts` | (đã tính) | — |

Tổng ước tính: **~56 contract rows**.

### Bước 2: Viết TEST_MATRIX.md

Format mỗi row:
```markdown
| US-RLS-01 | Mọi bảng có facility_id phải có RLS enabled và ≥1 policy | no | yes | no | no | implemented | `apps/api/test/rls-coverage.int.test.ts` |
```

Điền tuần tự theo domain:
1. Security/RLS (4 rows)
2. Guardian/Parent (8 rows)
3. Academic/ClassBatch (6 rows)
4. Finance/Voucher (6 rows)
5. CRM/AfterSale (5 rows)
6. Payroll/Commission (6 rows)
7. LMS/Rewards/Badge (8 rows)
8. Assessment/Grade (4 rows)
9. Audit/Chatter (4 rows)

Unit = yes cho các domain có `*.test.ts` trong packages/:
- `domain-payroll` → commission.test.ts, payroll.test.ts ✓
- `domain-grading` → check packages/domain-grading/src/
- `domain-rewards` → check packages/domain-rewards/src/
- `domain-finance` → check packages/domain-finance/src/

### Bước 3: Viết stories/backlog.md

```markdown
## Implemented (có evidence)

| ID | Title | Lane | Evidence |
|---|---|---|---|
| US-SEC-01 | RLS isolation per facility | normal | rls-coverage, rls-tenancy |
| US-SEC-02 | Guardian principal isolation (A3) | high-risk | guardian-principal-isolation |
...
```

### Bước 4: Gọi harness-cli story add cho 8 story đại diện

```bash
# Một ví dụ:
.\scripts\bin\harness-cli.exe story add \
  --id "US-SEC-01" \
  --title "RLS isolation: mọi bảng facility_id bị cô lập, principal-aware" \
  --lane "high-risk" \
  --contract "Mọi bảng có facility_id phải có RLS enabled; staff chỉ thấy facility mình; PH chỉ thấy con mình" \
  --verify "pnpm --filter @cmc/api test:int -- --reporter=verbose rls-coverage rls-tenancy"
```

Gọi cho: SEC-01, SEC-02, FIN-01 (voucher atomic), PAY-01 (payslip finalize), PAY-02 (commission), ACA-01 (parent meeting cadence), AFS-01 (aftersale lifecycle), REW-01 (star redeem).

## Success Criteria

- [ ] `docs/TEST_MATRIX.md` có ≥40 dòng contract (không counting header/blank)
- [ ] Mỗi dòng có evidence path trỏ tới file thật
- [ ] `docs/stories/backlog.md` có ≥15 story entries với status=implemented
- [ ] 8 harness story records tồn tại (`harness-cli query matrix` hiện ≥9 entries)
- [ ] Không có dòng nào ghi "no evidence" hoặc "TBD" trong implemented rows

## Risk Assessment

**Risk:** Int-test files có nhiều `it()` nhỏ, granularity phức tạp.
**Mitigation:** Nhóm theo `describe()` block, không phải từng `it()`. 1 describe = 1-2 contract rows.

**Risk:** Unit test trong domain packages chưa verify xem tồn tại không.
**Mitigation:** `find packages/*/src -name "*.test.ts"` trước khi điền cột Unit.
