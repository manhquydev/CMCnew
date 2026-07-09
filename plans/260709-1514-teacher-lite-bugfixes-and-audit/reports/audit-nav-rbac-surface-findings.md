# NAV / RBAC / SURFACE — Latent-Bug Audit (report-only)

Date: 2026-07-09
Branch: develop
Scope: `packages/auth/src/permissions.ts`, `apps/admin/src/app-surface.ts`,
`apps/admin/src/shell.tsx`, `apps/admin/src/App.tsx`, `apps/api/src/trpc.ts`,
`apps/admin/src/nav-permissions.ts`, `apps/admin/src/nav-modules.ts`,
`apps/api/test/permission-parity.test.ts`, and every router `requirePermission(...)` call.

Method: cross-checked the registry against all 150+ `requirePermission` call sites, then
traced each persona through `defaultSection` → `isReachableSection` → `buildNavGroups` →
panel primary query. Server-side enforcement (`requirePermission` / `superAdminProcedure` /
RLS) was confirmed intact for every finding — **none of these are privilege escalations or
data leaks; they are broken-landing / broken-direct-URL (403) and reachability-gap defects.**

---

## F1 — HIGH — `hr` persona's default landing page always 403s

**Files:** `apps/admin/src/App.tsx:135` (defaultSection) · `apps/admin/src/App.tsx:566-583`
(`HrPayrollSection` → `PayrollPanel`) · `apps/admin/src/payroll-panel.tsx:840` (roster query)
· `packages/auth/src/permissions.ts:239` (`payroll.roster`) · `apps/admin/src/nav-permissions.ts:111`.

**Defect:** `defaultSection` routes the `hr` role to the `hr` section:

```
if (me.roles.includes('hr')) return 'hr';   // App.tsx:135
```

But the `hr` section renders `HrPayrollSection` → `PayrollPanel`, whose first query is
`payroll.roster`, and `payroll.roster = ['giam_doc_kinh_doanh','giam_doc_dao_tao']`
(`permissions.ts:239`). `hr` is **not** in that list — the parity test even asserts
"hr/ke_toan no longer own payroll gates" (`permission-parity.test.ts:281-287`). So the panel's
roster load returns FORBIDDEN and the page shows the "Lỗi tải nhân sự" error alert
(`payroll-panel.tsx:855`).

**Repro:** Log in as a user whose only role is `hr` on the ERP surface (or hit `/` / `/hr`
directly). Landing renders the HR & Payroll panel with a red load error.

**Why it's latent:** payroll ownership was moved to the two directors (3-heads decision), but
`defaultSection` still hard-routes `hr → 'hr'` *before* the safe `return 'schedule'` fallback
(App.tsx:147). The `hr` nav item is itself hidden for `hr` (gate `payroll.roster`), so the
section is only ever reached through this broken default. Nothing else in `defaultSection`
misfires — `super_admin/giao_vien/sale/ctv_mkt/ke_toan/cskh/directors` all land on a gate they
actually hold; `hr` is the sole persona whose landing target it cannot open.

**Fix direction (not applied):** route `hr` to an open/held section (e.g. `shift-registration`
— `shiftRegistration.list` includes `hr` — or fall through to `schedule`).

---

## F2 — MEDIUM — placeholder `{ kind: 'open' }` gates defeat the direct-URL recheck for 5 aggregate sections

**Files:** `apps/admin/src/nav-permissions.ts:126-142` (`student-mgmt`, `payroll-checkin`,
`staff-lite`, `biz-director-cockpit`, `edu-director-cockpit` all gated `open`) ·
`apps/admin/src/App.tsx:642-662` (`isReachableSection`) · real visibility lives in
`apps/admin/src/shell.tsx:680,689,697,805-816,887`.

**Defect:** For these five sections the *real* visibility decision lives in `buildNavGroups`
(single-role `isTeacherOnly` / `isBizDirectorOnly` / `isEduDirectorOnly` flags, or the
teacher-surface `staff-lite` `roles.includes('giam_doc_dao_tao')` check). `NAV_GATES` only
carries an `open` placeholder. But `isReachableSection` — the guard added for bug #7 to stop a
direct URL/bookmark from bypassing nav hiding — trusts `NAV_GATES`: `if (gate.kind === 'open')
return true` (App.tsx:658-660). So the recheck is a no-op for exactly these sections, and any
role the nav deliberately hides them from can still reach the panel by typing the URL, landing
on a 403-ing panel.

**Concrete repros:**
- **ERP, any authenticated staff** (e.g. `sale`, `ke_toan`, `hr`): navigate to
  `/biz-director-cockpit` or `/edu-director-cockpit`. `isReachableSection` returns `true`
  (gate `open`, not `family-intake`, not the `finance` special-case), so it is *not* redirected
  to the persona default. The cockpit panel's first query is `dashboard.summary` /
  `dashboard.myApprovals` (directors only) → FORBIDDEN; broken page.
- **Teacher surface, `giao_vien`:** navigate to `/staff-lite`, `/biz-director-cockpit`, or
  `/edu-director-cockpit`. All are in `TEACHER_SURFACE_SECTIONS` and gated `open`, so
  `isReachableSection` returns `true`; the panels (`user.listTeachers` / director dashboard
  queries) 403.
- **ERP, non-teacher roles:** `/student-mgmt` and `/payroll-checkin` (intended for
  `giao_vien`-only) are reachable by direct URL for anyone; sub-queries 403 piecemeal.

**Severity rationale:** No data exposure — the server enforces every query. Impact is a
broken/confusing page reachable by URL, and it contradicts the stated intent of the bug #7
recheck ("a direct URL/bookmark/back-forward bypasses [nav hiding] … reproducing the error the
nav hiding was meant to prevent entirely", App.tsx:638-641). By contrast the *properly* gated
sections (e.g. `/overview` for `giao_vien`) redirect correctly, proving the pattern works when
the gate is real.

**Fix direction:** give these five sections real gates (or special-case them in
`isReachableSection` the way `finance`/`family-intake` already are) so direct-URL reachability
matches nav visibility.

---

## F3 — LOW — multi-role director (`giam_doc_kinh_doanh` + `giam_doc_dao_tao`) cannot reach manual check-in approval

**Files:** `apps/admin/src/shell.tsx:680,689,697` (all three collapse flags require
`roles.length === 1`) · `apps/admin/src/App.tsx:139-146` · `apps/admin/src/nav-permissions.ts:117`
(`checkin` gate = `checkInOut.punch`) · `packages/auth/src/permissions.ts:348,352-354`.

**Defect:** `checkInOut.pendingManual/approveManual/rejectManual` are director-only
(`permissions.ts:352-354`). Their only UIs are `checkin-panel.tsx` and the two director cockpits
(`edu-director-cockpit-panel.tsx:123`, `biz-director-cockpit-panel.tsx:124`). A user holding
*both* director roles: (a) gets neither cockpit, because `isBizDirectorOnly`/`isEduDirectorOnly`
require `roles.length === 1` (shell.tsx:689,697), and `defaultSection` sends them to `overview`
(App.tsx:145-146); (b) cannot see the `checkin` nav item, because its gate is
`checkInOut.punch = ['giao_vien','sale','cskh']` (directors excluded), and `isReachableSection`
blocks direct-URL `/checkin` for the same reason. Net: no route to the pending-manual approval
queue.

**Repro:** Assign one account both `giam_doc_kinh_doanh` and `giam_doc_dao_tao`; it lands on
`/overview`, has no cockpit nav and no `checkin` nav, and cannot reach manual check-in approval.

**Severity rationale:** Rare persona (single-role directors are the norm; super_admin unaffected).
Functional gap only.

---

## F4 — LOW/INFO — nav-gate vs. panel-capability mismatches (hidden-but-permitted panels)

The `checkin` nav gate is `checkInOut.punch`, but `hr`/`ke_toan` hold
`checkInOut.monthlyReport` and `checkInOut.history` (`permissions.ts:350-351`) with no ERP nav
entry to reach their own check-in history / monthly report. Not a 403 (they simply can't
navigate to a panel they'd be allowed to read). Documented as design tension, not a defect to
fix blindly — the gates deliberately pick the panel's *primary work action*
(`nav-permissions.ts:13-16`).

---

## Verified-clean (hypotheses checked and rejected)

- **Registry ↔ router parity is complete.** Every `requirePermission(module, action)` call site
  in `apps/api/src/routers/**` has a matching `PERMISSIONS[module][action]` entry, and every
  registry entry is either called via `requirePermission` or intentionally `super_admin`-only
  (`compensation.list/defaults/create`, `facility.*`, `parentMeeting.runReminders/runCadence`,
  `shiftConfig.create/update/archive/createTemplate`, `user.setRoles/setFacilities/setActive`).
  No procedure is silently locked to super_admin by a missing/misspelled registry key; no
  registry key is orphaned. The parity snapshot test guards value-level drift.
- **No anti-escalation hole in `teacherLite.*`.** `teacher-lite.ts` gates every procedure; the
  only one granting `giao_vien` is `overviewStats` (a read for the teacher "today" cards,
  `permissions.ts:93`). All mutations (`createFamilyStudentAndEnroll`, `createClass`,
  `cancelClass`, `cancelSession`, `studentArchive`, `enrollExistingStudent`) are
  directors-only. `giao_vien` cannot call any teacherLite mutation.
- **`giam_doc_dao_tao` `/finance` special-case is intentional and safe.** `isReachableSection`
  (App.tsx:651-657) lets GĐĐT reach `/finance` on ERP; `FinancePanel` internally per-card-gates
  on `can(...)` (finance-panel.tsx:1873-1920), so GĐĐT sees only the `ReceiptCreateCard`
  (`receiptCreate` granted) and nothing they'd 403 on. Not a broken page.
- **No privilege escalation / PII leak in F1–F3.** Server middleware enforces every gate; the
  cockpit/staff-lite/payroll panels 403 for non-eligible callers rather than returning data.

---

Status: DONE
Counts by severity — HIGH: 1 (F1) · MEDIUM: 1 (F2) · LOW: 2 (F3, F4) · Verified-clean: 4.

Unresolved questions:
1. F1: intended landing for a pure-`hr` account — `shift-registration`, or a neutral open
   section? (product call)
2. F2: should the 5 aggregate sections get real per-role gates, or be special-cased in
   `isReachableSection` like `finance`/`family-intake`?
