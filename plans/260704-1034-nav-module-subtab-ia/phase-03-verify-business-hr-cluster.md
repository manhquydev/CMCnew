# Phase 3 — Verify business/HR cluster (CRM & KD, Tài chính, Nhân sự)

Status: pending
Blocked by: Phase 1 (independent of Phase 2).
Owns (files): `nav-modules.ts` (subtab refinement for these 3 modules), relevant nav-test
assertions. No panel/business-logic changes.

## Scope (modules)

4. `crm-kinh-doanh` — crm / cskh / rewards / badges.
5. `tai-chinh` — finance / email-outbox / revenue-report / reconcile-worklist.
6. `nhan-su` — hr / kpi / compensation / my-payslips / payroll-checkin.

## Verification matrix (live, per role)

| Role | Expect |
|---|---|
| `ke_toan` | `tai-chinh`→finance/revenue-report/reconcile-worklist (email-outbox is GĐKD-only, `nav-permissions.ts:86`); default landing = finance → tai-chinh active. `nhan-su`→my-payslips only (open). |
| `sale` / `ctv_mkt` | `crm-kinh-doanh`→crm only (cskh/rewards/badges gated out); default = crm. |
| `cskh` | `crm-kinh-doanh`→crm+cskh (afterSale.list); NOT rewards/badges. |
| `giam_doc_kinh_doanh`-only | `crm-kinh-doanh`→all four; `tai-chinh`→all four incl. email-outbox; `nhan-su`→hr/kpi. NOTE: this persona's DEFAULT lands on `biz-director-cockpit` (Quản trị), Phase 4. |
| `giao_vien`-only | `crm-kinh-doanh`→`badges` only (`badge.list=[giao_vien,giam_doc_dao_tao]`, `permissions.ts:63`; crm/cskh/rewards gated out); `nhan-su`→`payroll-checkin` only (aggregate, `shell.tsx:689`; hr/kpi/compensation/my-payslips hidden). Both single-subtab → rail shows module label, bar suppressed (§5.4). |
| `hr` | `nhan-su`→`my-payslips` only (open). NOTE: `payroll.roster=[giam_doc_kinh_doanh,giam_doc_dao_tao]` (`permissions.ts:217`) does NOT include the `hr` **role**, so the `hr` **section** is hidden to the hr role; kpi/compensation also hidden. (Verify against `nav-consistency`; if the hr role is intended to see the roster, that is a permissions-registry question, out of scope for this presentation-only plan.) |

## Steps

1. Per role above, confirm each module's subtab set == pre-change flat visible leaves.
2. CRM: confirm the `crm` subtab still consumes `oppId` (`App.tsx:789-790`) and the
   `/crm/opportunities/:oppId` deep-link activates `crm-kinh-doanh`+crm.
3. Confirm `email-outbox` / `rewards` appear ONLY for `giam_doc_kinh_doanh`
   (`nav-permissions.ts:86,102`).
4. Confirm giao_vien-only `nhan-su` single-subtab suppression.
5. **hr-role landing edge (pre-existing quirk, design §4):** `defaultSection` lands the `hr`
   role on section `hr`, which its gate (`payroll.roster`) hides from that role. Confirm the
   SubTabBar tolerates this `activeSection`-not-in-visible-set case — renders `nhan-su`'s visible
   subtabs (`my-payslips`) and highlights none, without crashing or inventing an `hr` tab. Do
   NOT "fix" `defaultSection` here (out of scope — presentation-only plan; log it separately).

## Tests / validation

- `nav-consistency.test.ts` D2 (rewards), D3 (kpi) guards green (`:91-117`).
- Typecheck; `gitnexus_detect_changes`; `code-reviewer`.

## Risks / rollback

- Risk: email-outbox/rewards leak to a non-GĐKD role via a module grouping bug.
  Mitigation: per-subtab `visible` reused verbatim; D2/D3 tests. Rollback: revert cluster
  subtab tweaks.
