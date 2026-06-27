# Phase 02 — Salary-grade + rate change audit (Odoo-style)

## Context

- `apps/api/src/routers/payroll.ts` (rateCreate / profile mutations).
- Hạ tầng chatter sẵn có: `logEvent(tx, {...})` (đã dùng cho payslip compute).
- Decision [0011](../../docs/decisions/0011-auto-kpi-with-tree-override-audit.md).

## Requirements

- Mọi thay đổi `SalaryRate` (tạo bản effective-dated mới) → ghi chatter:
  entityType=`salary_rate`, body "Mức lương hiệu lực {effectiveFrom}: LCB {x}, quota {y}…", actorId.
- Thay đổi `EmploymentProfile.grade`/`position` → chatter entityType=`employment_profile`,
  body "Đổi bậc {cũ}→{mới}" + lý do (input bắt buộc khi đổi bậc).
- Giữ effective-dated (không sửa tại chỗ — thêm bản mới); audit bổ sung lớp "ai/khi/tại sao".

## Files

- `apps/api/src/routers/payroll.ts` — wrap mutation + logEvent; thêm input `reason` cho grade change.
- `apps/api/test/salary-rate-audit.int.test.ts` (mới).

## Validation

- Int-test: tạo rate → có record_event; đổi grade với reason → event body chứa cũ→mới + reason;
  đổi grade thiếu reason → 400.
- `pnpm --filter @cmc/api test salary-rate-audit`.

## Risks

- Thấp — additive, tái dùng logEvent. Không đổi schema (chatter dùng bảng record_event sẵn có).
