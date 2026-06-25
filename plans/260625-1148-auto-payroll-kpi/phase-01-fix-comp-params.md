# Phase 01 — Sửa compensation params đúng tài liệu gốc

## Context

- `packages/domain-payroll/src/params.ts` (DEFAULT_PARAMS), `commission.ts`, `payslip.ts`.
- Nguồn: tài liệu "Cơ cấu thu nhập CMC 2026" (agent extraction 2026-06-25).
- Decision [0011](../../docs/decisions/0011-auto-kpi-with-tree-override-audit.md).

## Requirements (đã rõ — build được)

1. **KPI band sale = 5 bậc** (hiện 4): A(90-100)=100% · B(70-90)=80% · C(50-70)=70% ·
   D(40-50)=60% · E(<40)=0%. Sửa `DEFAULT_PARAMS.kpi.sales` + cho phép `kpiBandSchema` ratio
   không đổi (đã 0..1). Band GV giữ A/B/C/D như cũ (khớp tài liệu khối Đào tạo).
2. **Renewal CVTV = 4 bậc theo retention** (hiện flat): <50%=0 · 50-70%=1.5% · 70-90%=2% ·
   ≥90%=2.2%. Đổi `renewal.cvtv` từ scalar sang tiered cho CVTV; manager/gv/cskh giữ flat-by-floor
   hoặc tier riêng (xem schema). `renewalRate()` nhận thêm bậc.
3. **PC định mức GV theo giờ** (hiện tĩnh): `allowanceEarned` phần "định mức" =
   `max(0.5, actual_hours/quota_hours) × allowance`. Thêm hàm `quotaAllowance(hours, quotaHours, allowance)`.

## Blocker (cần user chốt — xem báo cáo)

**Hoa hồng khách mới CVTV: mô hình nào?**
- Code hiện tại (CV4, verified 23 test): theo **% đạt quota** (50/80/100/120/150%).
- Tài liệu gốc: theo **doanh thu tuyệt đối** (50/80/100/160/240M VND), rate 1/2/3/4/5%.
→ Hai mô hình khác bản chất. KHÔNG tự đảo. Chờ quyết định.

## Files

- `packages/domain-payroll/src/params.ts` — sửa DEFAULT_PARAMS + schema nếu renewal tiered.
- `packages/domain-payroll/src/commission.ts` — renewal tiered, (CVTV new tùy blocker).
- `packages/domain-payroll/src/payslip.ts` — quotaAllowance vào allowanceEarned.
- `*.test.ts` — cập nhật mốc band/tier; thêm test PC định mức sàn 50%.

## Validation

- Unit: 5-band sale mốc 89/90/49/40/39; renewal CVTV 0.49/0.5/0.69/0.7/0.89/0.9; PC định mức
  hours=0 → 50%, hours=quota → 100%, hours>quota → cap theo overtime (tách riêng).
- `pnpm --filter @cmc/domain-payroll test`.

## Risks

- Đổi schema params = cần migrate CompensationPolicy.params cũ (seed lại DEFAULT) — forward-only.
