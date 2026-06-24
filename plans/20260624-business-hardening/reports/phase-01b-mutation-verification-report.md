# Phase 01b — Mutation verification: "test có thật bắt lỗi không?"

Ngày: 2026-06-24 · Phương pháp: 3 adversarial auditor (song song, read-only) → controller chạy mutation tuần tự (ground-truth).

## Câu hỏi
Test integration vừa viết có **thật sự bắt lỗi**, hay quá tự tin / lỏng lẻo?

## Cách verify (không tin suông)
1. 3 agent chuyên biệt soi tĩnh, mỗi agent 1 mảng (money+rewards / tenancy+crm / payroll+harness), liệt kê assertion lỏng + **mutation kill-list** (bug 1 dòng mà test PHẢI bắt).
2. Controller tiêm từng mutation vào **code production**, chạy test, xác nhận FAIL, rồi revert — đây là bằng chứng, không phải dự đoán.

## Phát hiện: các điểm LỎNG ban đầu (mutation "sống sót")
| # | Lỗ | Hệ quả |
|---|---|---|
| M12 | star-redeem không assert số dư ledger (SUM) | double-debit sao (trừ 20 cho 1 quà) **không bị bắt** |
| M10 | loser chấp nhận cả CONFLICT/BAD_REQUEST | bỏ advisory lock vẫn pass → lock **không được test** |
| RLS | chỉ kiểm "B thấy A = 0", thiếu positive control | vô hiệu nhánh facility-staff (B không thấy chính mình) vẫn pass |
| FWD | forward-only chỉ test happy path | cho phép opp **lùi stage** vẫn pass |
| ENTR | chỉ gửi test entrance | bỏ guard type → periodic cũng auto-advance, **không bắt** |
| PIT | params tạo taxable=0 | PIT phẳng 35% thay vì lũy tiến **không bắt** (mù) |
| CRM | lead-ingest `if(token)` | token unset trong CI → positive path **lặng lẽ skip** (false-green) |

Ghi chú: M4/M5 (refund draft/double-cancel) **không phải lỗ thật** — `receiptCancel` chặn hủy-2-lần và floor `used_count>0` che lẫn nhau; đơn lẻ không gây sai trạng thái.

## Đã siết + CHỨNG MINH bằng mutation (apply→fail→revert)
| Mutation tiêm vào production | Test phải chết | Kết quả |
|---|---|---|
| `redeemEntry(starsRequired*2)` (double-debit) | star-redeem | ✅ FAIL (đã bắt) |
| xóa `pg_advisory_xact_lock` | star-redeem | ✅ FAIL (loser thành CONFLICT≠BAD_REQUEST) |
| `advanceTo` luôn `return target` (cho lùi) | crm-hooks | ✅ FAIL (O4→O3) |
| bỏ guard `type===entrance` | crm-hooks | ✅ FAIL (periodic auto-advance) |
| PIT phẳng `round(taxable*0.35)` | payroll | ✅ FAIL (pit > taxable*0.25) |
| RLS: vô hiệu nhánh facility-staff (ALTER POLICY) | rls-tenancy | ✅ FAIL (positive control: B thấy chính mình) → **restore OK** |

→ **6/6 mutation bị bắt.** Trước siết các bug này sống sót; sau siết đều chết.

## Thêm assertion (siết)
- star-redeem: SUM ledger = 90, đúng 1 dòng `gift_redeemed` = -10; loser **BAD_REQUEST** (giết M10).
- voucher race: đúng 1 receipt `approved` (có code), 1 còn `draft` (bind count vào winner).
- voucher cap: assert `tierPercent=30` + `voucherPercent=20` (chứng minh cộng dồn thật rồi cap).
- rls: + positive control (B thấy student của B) + parent principal chỉ thấy con (thay test vacuous `toBeDefined()`).
- crm: + forward-only negative (test entrance lần 2 trên O4 không lùi) + non-entrance không advance + lead-ingest fail-loud nếu thiếu token, assert opp ở O1_LEAD.
- payroll: params taxable>0, assert PIT lũy tiến (pit < taxable×25%), **amount-freeze** (số không đổi sau finalize, đọc thẳng DB), reopen assert status=draft + finalizedById=null trực tiếp.
- CI: thêm `CRM_LEAD_TOKEN`; setup test tự đặt default (không đụng `.env` user).

## Trạng thái cuối
- **12/12 integration test PASS** (trước siết 10, +2 test mới).
- Cây src/migration **sạch** sau sweep (mọi mutation revert, RLS policy restore).
- typecheck PASS.

## Nghi vấn của audit đã làm rõ (không phải lỗi)
- "CI thiếu role `cmc_app`": **moot** — migration `20260623045316_rls_tenancy` tạo `cmc_app`.
- `gift` "thiếu RLS": **sai** — có `gift_isolation` (tạo bằng loop, grep miss); DB xác nhận.

## Kết luận
Test **không lỏng**: các invariant tiền/tenancy/rewards/crm/lương đều có assertion đủ chặt để giết bug tương ứng, đã chứng minh bằng mutation thực tế. Cơ sở vững để triển khai bước tiếp.
