# Code Review — F0 Part B: Unified Admin Shell Nav

Date: 2026-06-27
Branch: feature/erp-unify-rbac-f0
Scope: `git diff HEAD` (uncommitted) — apps/admin/src/shell.tsx, apps/admin/src/App.tsx, apps/admin/package.json
Reviewer focus: nav role-logic drift vs backend permission registry; browser-safe share feasibility; dedupe; my-payslips; build; empty-nav.

## Lead Verdict: FIX-FIRST

The predicted risk is real and live. The inline `buildNavGroups` role logic in `shell.tsx` diverges from the backend `PERMISSIONS` registry in **4 modules**, exposing nav items to roles that get FORBIDDEN (one of them a hard error on panel load). Build is clean, my-payslips exists, no role is locked out. Fixes are localized — not a rework.

Drift blockers: **4** (guardians/cskh, rewards, kpi, org) + 2 minor (attendance, students).

---

## 1. DRIFT — inline nav vs backend registry (CORE FINDING)

The implementer re-implemented role→module visibility as hardcoded role arrays in `shell.tsx:353-369` instead of consuming `can()` + `PERMISSIONS`. The arrays do **not** match the registry. Verified module-by-module (nav `visible` predicate vs `packages/auth/src/permissions.ts` vs the actual procedure the rendered panel calls first).

### CRITICAL / HIGH — UI shows a module the role cannot use

| # | Module (nav line) | Nav grants to | Backend reality | Effect |
|---|---|---|---|---|
| D1 | **guardians** `shell.tsx:368` `canGuardians = any('quan_ly','bgd','cskh')` | adds **cskh** | `guardian.*` = `[bgd, quan_ly]` only (`permissions.ts:135-141`; every proc in `guardian.ts` is `requirePermission`). Panel's first query is `guardian.parentList` (`guardians-panel.tsx:41`). | **cskh opens "Phụ huynh" → immediate FORBIDDEN on load.** Worst case: hard error, no read fallback. |
| D2 | **rewards** `shell.tsx:364` `canRewards = any('quan_ly','head_teacher','bgd')` | adds **head_teacher, bgd** | `rewards.giftCreate` / `rewards.review` = `[quan_ly]` only (`permissions.ts:177-180`, `rewards.ts:17,111`). | head_teacher/bgd open "Đổi quà" (facility.list read succeeds) but every action (create/review) → FORBIDDEN. |
| D3 | **kpi** `shell.tsx:366` `canKpi = any('hr','ke_toan','quan_ly','bgd','head_teacher')` | adds **head_teacher** (+quan_ly/bgd, see note) | head_teacher has **zero** kpi perms anywhere (`permissions.ts:167-174`). Panel loads `payroll.kpiList` (`kpi-evaluation-panel.tsx:337`) = `[hr, ke_toan]`. | head_teacher sees "Đánh giá KPI" → no data, no actions. Also `quan_ly`/`bgd` only have `kpiEvalConfirm`/`kpiEvalApprove`, **not** `kpiList` read — panel won't load rows for them either (secondary backend gap). |
| D4 | **org** `shell.tsx:369` `canOrg = any('quan_ly','bgd','hr')` | grants quan_ly/**bgd**/**hr** | `OrgPanel` queries `user.list` = `superAdminProcedure` (`App.tsx:510`, `user.ts:23`) + `facility.list` (protected). User-mgmt mutations all super_admin. | Even **quan_ly** can't load the users list; bgd/hr have nothing. Errors are `.catch`-swallowed (`App.tsx:510`) so no crash, but "Cơ sở & Users" is effectively a super_admin tool shown to 3 roles that can't use the user half. |

### LOW / MINOR

- **D5 attendance** `shell.tsx:354` adds `head_teacher`; `attendance.mark` = `[giao_vien, quan_ly]` (`permissions.ts:36`). head_teacher can read `listBySession` (protected) but the mark action fails. Read-only viewing may be intended — confirm.
- **D6 students (hides a usable module)** `shell.tsx:367` restricts "Học sinh" to `quan_ly/sale/bgd`, but `student.list`/`detail` = `protectedProcedure` (any staff, `student.ts:10,19`). giao_vien/head_teacher/ke_toan/hr/cskh/ctv_mkt are hidden from a panel they could legitimately read. Likely intentional scoping; flag for confirmation.

### Modules that DO match (no action)
schedule, grading, assessment, meetings, levelup, certificate, finance, crm, cskh, hr, compensation, my-payslips — all verified consistent with registry / panel read gating.

**Root cause:** `shell.tsx:352` comment claims "mirrors permission registry entries" but the arrays were hand-copied and have drifted. This is exactly the single-source-of-truth violation F0 Part A was meant to prevent.

---

## 2. Can the registry be SHARED to the browser? — YES, feasible (recommended fix)

The implementer's stated reason for duplicating is **correct but solvable**:

- `@cmc/auth` re-exports from `@cmc/db` (`packages/auth/src/index.ts:1`), and `@cmc/db/index.ts:1,12` does `import { PrismaClient }` + `new PrismaClient()` **at module load**. So importing `@cmc/auth` as-is *does* drag Prisma (and a live client instantiation) into the Vite browser bundle. Claim verified.
- BUT `permissions.ts` uses `Role` only as **enum string values** (`Role.giao_vien`, etc., `permissions.ts:15,17-216`). At runtime these are plain strings — proven by the fact that the inline nav already compares against string literals `'giao_vien'`, `'quan_ly'`, … successfully (`shell.tsx:354-369`).

**Verdict: inline duplication is NOT genuinely necessary.** A browser-safe share is feasible:

1. Make `permissions.ts` Prisma-free: change `import { Role }` → `import type { Role }` and replace `Role.giao_vien` value references with the literal strings (or define a local `ROLES` const / string-union in a leaf module). `PERMISSIONS` + `can()` then have zero runtime `@cmc/db` dependency.
2. Expose them via a browser-safe entrypoint (e.g. a `@cmc/auth/permissions` subpath export, or a tiny new leaf package `@cmc/permissions`) that does not transitively import `@cmc/db`. Backend middleware (`requirePermission`) and the frontend both import the same module.
3. Frontend builds nav from a `section → {module, action}` map and calls `can(roles, isSuperAdmin, module, action)` per section. Drift becomes structurally impossible.

This eliminates D1–D6 by construction. Recommended before F0 is considered "done."

---

## 3. Dedupe integrity — one-line verdict

Low immediate **runtime** risk (apps/admin and apps/teaching are separate bundles, so stale teaching copies don't corrupt admin), but real **maintenance/drift debt**: two sources of truth for finance/payroll/crm/cskh means future fixes can land in one app only — decommission the teaching staff panels (or stop building them) rather than leaving both canonical-ambiguous.

---

## 4. my-payslips — NOT a blocker

`trpc.payroll.myPayslips` exists as `protectedProcedure` (`apps/api/src/routers/payroll.ts:694`); the ported `my-payslips-panel.tsx:26` calls it correctly. Any-staff access matches nav `canMyPayslips = true`. Resolved.

---

## 5. Build / typecheck — PASS (0 new errors)

`pnpm --filter @cmc/admin exec tsc --noEmit` surfaces only the **pre-existing** Azure module errors in apps/api (`graph-client.ts`, `sso.ts` — `@azure/identity`, `@azure/msal-node` missing), pulled in via project references. No errors in `shell.tsx` or `App.tsx`. Confirmed clean for admin code.

---

## 6. Empty-nav lockout check — PASS

No role is locked out. Every role gets unconditional items: `classes` (`shell.tsx:385` visible:true), `overview`/`courses` (`:424-425`), `schedule` (`:353` true), `my-payslips` (`:360` true). Even a minimal role (e.g. ctv_mkt) sees classes/overview/courses/schedule/my-payslips/crm. No UX blocker.

---

## Recommended Actions (priority order)

1. **D1 (blocker):** remove `cskh` from `canGuardians` (`shell.tsx:368`) — it hard-FORBIDs on panel load. Or add cskh to `guardian.*` backend if intended (high-risk: authorization change → decision record).
2. **D3:** remove `head_teacher` from `canKpi`; reconcile the `kpiList` read gate so `quan_ly`/`bgd` (who confirm/approve) can actually load rows, OR gate kpi nav to `hr/ke_toan` only.
3. **D2:** gate `canRewards` to `quan_ly` (+ super_admin) to match `rewards.*`.
4. **D4:** gate `canOrg` to `super_admin` (or split: facilities-read for quan_ly, users for super_admin); stop swallowing the `user.list` error silently.
5. **Structural (kills the class of bug):** implement the browser-safe shared `can()` from §2 and delete the inline arrays.
6. Confirm intent on D5 (attendance read-only for head_teacher) and D6 (students hidden from teachers).
7. Decommission stale apps/teaching staff panels (§3).

## Unresolved Questions

- Is head_teacher meant to *view* attendance and KPI read-only (justifying nav visibility), or fully excluded? Drives whether the fix is nav-removal or backend read-grant.
- Is the `kpiList` read intended to exclude quan_ly/bgd despite their confirm/approve role? Looks like a backend gap independent of this diff.
- Is apps/teaching still deployed, or already slated for removal?
