# Payroll Director Domain Scoping

Date: 2026-07-02

## Status

Accepted

## Context

Payroll and KPI procedures were historically owned by `hr` and `ke_toan`. After the role
consolidation, the operating model has two directors instead:

- `giam_doc_kinh_doanh` owns business/support staff: sale, CSKH, marketing collaborator, HR,
  and accounting.
- `giam_doc_dao_tao` owns teachers.

Read surfaces still need to support executive review across the facility, but writes must not let
one director update their own pay, peer director pay, or the other director's staff domain.

## Decision

Payroll permission gates move from `hr`/`ke_toan` to both directors.

Handler-level authorization in `apps/api/src/routers/payroll.ts` enforces write scope:

- super_admin bypasses scope checks.
- No actor can mutate their own payroll or KPI target.
- No director can mutate another director or super_admin target.
- Business Director can mutate business/support staff payroll and KPI records.
- Education Director can mutate teacher payroll and KPI records.
- Bulk payroll writes filter down to manageable target staff.
- Read/list procedures remain director-any and rely on facility RLS for tenant scope.

## Alternatives Considered

1. Keep HR/accounting as payroll owners. Rejected: conflicts with the two-director operating model.
2. Split permission registry by every payroll domain action. Rejected: static RBAC cannot express
   target-relative self/domain checks.
3. Hide non-domain rows on every read surface. Rejected for now: directors need facility-level review;
   only writes require domain ownership.

## Consequences

Positive:

- Payroll ownership matches the current org chart.
- Static UI gates stay simple.
- Sensitive writes get target-relative enforcement in the API.

Tradeoffs:

- Permission snapshots alone are no longer enough to prove payroll write safety.
- Any new payroll write must call the same target-domain guard before mutating staff records.
