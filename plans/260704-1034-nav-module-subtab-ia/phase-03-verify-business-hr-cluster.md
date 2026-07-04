# Phase 3 — Verify business/HR cluster (CRM & KD, Tài chính, Nhân sự)

Status: verified (2 verification-matrix predictions above corrected against actual registry
grants — see outcome below; both are pre-existing plan-doc inaccuracies, not Plan D defects)

## Verification outcome (2026-07-04)

No `nav-modules.ts` changes needed — same as Phase 2, the mechanism is fully derived. Deterministic
`buildNavGroups()` checks for `ke_toan`, `sale`, `ctv_mkt`, `cskh`, `giam_doc_kinh_doanh`,
`giao_vien`, `hr` found 2 discrepancies against this phase file's own predicted matrix (both are
stale-documentation issues in the codebase/plan, NOT bugs in Plan D's nav mechanism, which
correctly reflects whatever NAV_GATES + PERMISSIONS actually grant):

1. **`sale` also sees `cskh`, not just `crm`.** `afterSale.list = ['sale', 'cskh',
   'giam_doc_kinh_doanh']` (`packages/auth/src/permissions.ts:43`) — `sale` IS granted. The stale
   culprit was `nav-permissions.ts`'s own comment ("cskh: afterSale.list = [cskh,
   giam_doc_kinh_doanh]", missing `sale`), which this phase's matrix inherited. Fixed the comment
   (doc-only, zero behavior change) in the same commit as this verification.
2. **`giam_doc_kinh_doanh`-only sees 3 of 4 `crm-kinh-doanh` subtabs, not all 4** — `badges` is
   NOT visible (`badge.list = ['giao_vien', 'giam_doc_dao_tao']`,
   `packages/auth/src/permissions.ts:63`, does not include `giam_doc_kinh_doanh`). The matrix's
   "all four" claim was wrong; corrected here for the record.

Everything else matched exactly: `ke_toan`→`tai-chinh`=[finance, revenue-report,
reconcile-worklist] (email-outbox correctly GĐKD-only), `nhan-su`=[my-payslips]; `ctv_mkt`→
`crm-kinh-doanh`=[crm] only; `giao_vien`-only→`crm-kinh-doanh`=[badges] only,
`nhan-su`=[payroll-checkin] only (both single-subtab, bar correctly suppressed); `hr`→
`nhan-su`=[my-payslips] only — confirming the pre-existing `hr`-role landing quirk (design §4) is
currently **unreachable** in practice: since `nhan-su` always resolves to exactly 1 visible
subtab for the `hr` role, `SubTabBar`'s `subtabs.length <= 1` suppression fires before the
unmatched-`activeSection` case could ever render (same conclusion the Phase 1 code review
reached independently for this exact scenario).

`/crm/opportunities/:oppId` deep-link re-confirmed live (already verified in Phase 1's smoke) —
activates `crm-kinh-doanh` module + `crm` subtab with the record rendered.
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
