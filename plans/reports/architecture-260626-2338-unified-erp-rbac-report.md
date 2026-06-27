# Unified ERP RBAC — Current-State Map & Proposed Design

Date: 2026-06-26
Scope: READ-ONLY advisory. No code changed.
Decision context (accepted by user): collapse `apps/admin` + `apps/teaching` into ONE staff app gated by explicit RBAC. LMS (`apps/lms`) stays separate. Students/parents out of scope.

---

## 0. Key finding up front

The "two apps" are **two Vite frontends only**. They already share:

- ONE backend / ONE tRPC `appRouter` (`apps/api/src/routers/index.ts:36-71`).
- ONE staff session cookie `cmc.session` (`apps/api/src/context.ts:5`).
- ONE auth model (`requireRole` + RLS), identical for both.

So the API is **already unified**. `admin` (Vite port 5173, `apps/admin/vite.config.ts:6`) and `teaching` (port 5174, `apps/teaching/vite.config.ts:6`) are two SPAs hitting the same API with the same cookie. The split is purely a duplicated frontend shell + duplicated panels. **Merging is a frontend consolidation, not a backend/auth re-architecture.** This drastically lowers risk.

---

## 1. Current app split & module overlap

### apps/admin — panels (`apps/admin/src/*.tsx`)
| Section key | Panel file | Purpose |
| --- | --- | --- |
| overview | `overview-panel.tsx` | BGD/quan_ly dashboard |
| courses | `App.tsx` `Courses()` + `terms-panel.tsx` | course + academic term CRUD |
| students | `students-panel.tsx` | student profiles |
| org | `App.tsx` `OrgPanel()` | facility + user/role CRUD |
| guardians | `guardians-panel.tsx` | parent↔student linking |
| finance | `finance-panel.tsx` | price/voucher/receipt |
| crm | `crm-panel.tsx` | contacts/opportunities/tests |
| cskh | `cskh-panel.tsx` | after-sale tickets |
| rewards | `rewards-panel.tsx` | gift redemption review |
| hr | `payroll-panel.tsx` | HR profiles + payroll |
| kpi | `kpi-evaluation-panel.tsx` | KPI evaluation |
| compensation | `compensation-panel.tsx` | salary-structure config (super_admin) |

Nav built in `apps/admin/src/shell.tsx:331` (`buildNavGroups`); role gating computed in `apps/admin/src/App.tsx:712-733` (`Dashboard`).

### apps/teaching — panels (`apps/teaching/src/*.tsx`)
| Section key | Panel file | Purpose |
| --- | --- | --- |
| schedule | `schedule-panel.tsx` | teacher schedule |
| attendance | `attendance-panel.tsx` / `attendance-roster.tsx` | mark attendance |
| grading | `grading.tsx` | grade exercises |
| assessment | `assessment-panel.tsx` | report card / học bạ |
| classes | (class workspace) | class detail |
| enrollment | (class-scoped) | enroll students |
| levelup | `level-approval-panel.tsx` | level-up approval |
| certificate | `certificate-panel.tsx` | certificates |
| meetings | `meetings-panel.tsx` | parent meetings |
| classlog | (class log) | class journal |
| cskh | `cskh-panel.tsx` | after-sale tickets |
| crm | `crm-panel.tsx` | CRM |
| finance | `finance-panel.tsx` | receipts (phiếu thu) |
| my-payslips | `my-payslips-panel.tsx` | own payslips |
| payroll | `payroll-panel.tsx` | payroll |

Nav + gating in `apps/teaching/src/shell.tsx:71-157` / `:238-244`.

### OVERLAP table (modules present in BOTH apps — duplicated source)
| Module | admin file | teaching file | Same backend router |
| --- | --- | --- | --- |
| CRM | `admin/src/crm-panel.tsx` | `teaching/src/crm-panel.tsx` | `crm` |
| CSKH | `admin/src/cskh-panel.tsx` | `teaching/src/cskh-panel.tsx` | `afterSale` |
| Finance | `admin/src/finance-panel.tsx` | `teaching/src/finance-panel.tsx` | `finance` |
| Payroll | `admin/src/payroll-panel.tsx` | `teaching/src/payroll-panel.tsx` | `payroll` |

These 4 are literal duplicate files (two implementations of the same screen, same API). Plus both shells re-implement the same `AppShell`/topbar/notification dropdown (`StaffNotifDropdown` exists in both `shell.tsx` files). This is the DRY debt the merge removes.

Modules unique to admin: overview, courses/terms, students, org (facility+user), guardians, rewards, kpi, compensation.
Modules unique to teaching: schedule, attendance, grading, assessment, classes, enrollment, levelup, certificate, meetings, classlog, my-payslips.

---

## 2. Current auth model

### Identity & roles
- Role enum (10 roles): `packages/db/prisma/schema.prisma:15-26` — `super_admin, quan_ly, head_teacher, giao_vien, ke_toan, hr, sale, cskh, ctv_mkt, bgd`.
- A user has `roles: Role[]` + `primaryRole` + `facilities[]` (`packages/auth/src/index.ts:35-50`). `isSuperAdmin = roles.includes(super_admin)`.
- Login (`packages/auth/src/index.ts:52`) issues a JWT (HS256, 12h) carrying `{sub, roles, primaryRole, tokenVersion}` (`packages/auth/src/jwt.ts:6-30`). **Facility scope is deliberately NOT in the JWT** — re-resolved from DB each request (`jwt.ts:4-5`, `index.ts:96-101`) so role/facility/active changes revoke immediately via `tokenVersion` mismatch.

### Enforcement (two independent layers)
1. **Role check (coarse, app-level):** `apps/api/src/trpc.ts`.
   - `protectedProcedure` (`:42`) → requires a session.
   - `superAdminProcedure` (`:48`) → super_admin only.
   - `requireRole(...roles)` (`:54-62`) → passes if `isSuperAdmin` OR `roles` intersect. super_admin always bypasses.
2. **Facility scope (fine, row-level):** Postgres RLS. `withRls(ctx, fn)` opens a tx and runs `set_config('app.facility_ids', …), set_config('app.is_super_admin', …)` (`packages/db/src/index.ts:33-49`), transaction-local. Reads outside scope return 0 rows; writes that violate `WITH CHECK` raise SQLSTATE 42501, mapped to a clean `FORBIDDEN` by `mapRlsErrors` middleware (`trpc.ts:16-36`).

### Where role→capability lives today: SCATTERED. Confirmed — there is **no central permission map.**
- Each router hard-codes its allowed roles inline at every procedure (see matrix §3).
- Role *sets* are re-declared per file as ad-hoc consts: `CSKH_ROLES` (`aftersale.ts:8`), `CRM_ROLES`/`TEST_GRADE_ROLES` (`crm.ts:8-9`), `ISSUE_ROLES` (`certificate.ts:7`), `LEAD_ROLES` (`guardian.ts:11`), `HR_ROLES` (`payroll.ts:27`), `TOP_ROLES` (`lib/kpi-authz.ts:10`). No shared source — `quan_ly` appears in ~12 files independently.
- The **frontend re-derives the same rules a third time** as `can*` booleans (`admin/src/App.tsx:714-733`, `teaching/src/shell.tsx:238-244`). These are maintained by hand and can (and do) drift from the backend `requireRole` lists. Nav visibility is cosmetic only; the API is the real gate.

Net: the permission model exists 3× (backend inline, backend role-consts, frontend booleans) with no single source of truth.

---

## 3. Module × Role matrix (reverse-engineered, current de-facto)

Cell = action level allowed. `R`=read/list, `W`=write/mutate, `—`=no access, `SA`=super_admin only. super_admin implicitly passes everything (omitted). Sources cited inline in §1/§2 greps; router files `apps/api/src/routers/*.ts`.

| Router (module) | quan_ly | head_teacher | giao_vien | sale | cskh | ke_toan | hr | bgd | ctv_mkt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| facility | R | R | R | R | R | R | R | R | R |  ← list `protectedProcedure`; create/update `SA` (`facility.ts:9,19,45`) |
| user | RW(teachers R) | — | — | — | — | — | — | — | — |  ← list/create/setRoles/setFacilities/setActive all `SA`; `listTeachers` quan_ly (`user.ts:23-166`) |
| course | W | — | — | — | — | — | — | — | — |  ← list `protectedProcedure`; create/archive quan_ly (`course.ts:11,17,39`) |
| room | W | — | — | — | — | — | — | — | — |  ← list all; CUD quan_ly (`room.ts`) |
| student | W | R | R | W | R | R | R | R | R |  ← list all; create/update quan_ly+sale (`student.ts:11,17,52`) |
| classBatch | W | R | R | R | R | R | R | R | R |  ← list/get all; create/setStatus/cancel/reopen quan_ly (`class-batch.ts`) |
| schedule | W | R | R | R | R | R | R | R | R |  ← list all; addSlot/generateSessions quan_ly (`schedule.ts`) |
| enrollment | W | R | R | W | R | R | R | R | R |  ← enroll quan_ly+sale; complete quan_ly (`enrollment.ts:51,132`) |
| attendance | W | R | W | R | R | R | R | R | R |  ← mark giao_vien+quan_ly (`attendance.ts:8,17`) |
| exercise | W | R | W | R | R | R | R | R | R |  ← create/publish giao_vien+quan_ly (`exercise.ts:33,74`) |
| submission | W | — | W | — | — | — | — | — | — |  ← list/grade giao_vien+quan_ly (`submission.ts:35,83`) |
| grade | W | — | W | — | — | — | — | — | — |  ← grade/publish giao_vien+quan_ly (`grade.ts:25,77`) |
| assessment | W | W | W(no term CUD) | — | — | — | — | — | — |  ← template/upsert/computeFinal giao_vien+ht+ql; term create/update ht+ql (`assessment.ts`) |
| levelProgress | W | W(decide) | W(propose) | — | — | — | — | — | — |  ← propose gv+ht+ql; listPending ht+ql; **decide head_teacher ONLY** (`level-progress.ts:14,52,72`) |
| certificate | W | W | R | — | — | — | — | — | — |  ← list ht+ql+gv; issue ht+ql (`certificate.ts:10,22`) |
| badge | W | W(grant) | W(grant) | — | — | — | — | — | — |  ← list ql+ht+gv; create/archive ql; grant gv+ht+ql (`badge.ts`) |
| parentMeeting | W | W | W | R | R | R | R | R | R |  ← list all; setStatus/setSchedule gv+ht+ql; reminders `SA` (`parent-meeting.ts`) |
| crm | W | — | — | W | W | — | — | — | — |  ← all ops sale+cskh+quan_ly; testGrade gv+ht+ql (`crm.ts` `CRM_ROLES`) |
| afterSale (cskh) | W | — | — | — | W | — | — | — | — |  ← list/create/transition/assign cskh+ql; setLifecycle ql (`aftersale.ts`) |
| guardian | W | — | — | — | — | — | — | W | — |  ← parentList/create/link/unlink bgd+quan_ly (`guardian.ts` `LEAD_ROLES`) |
| finance | W | — | — | — | — | W | — | — | — |  ← price/voucher/receipt all ke_toan+quan_ly (`finance.ts`) |
| rewards | W | — | — | — | — | — | — | — | — |  ← giftCreate/review quan_ly (`rewards.ts:17,111`) |
| dashboard | R | — | — | — | — | — | — | R | — |  ← summary bgd+quan_ly (`dashboard.ts:8`) |
| payroll | — | — | — | — | — | W | W | — | — |  ← roster/profile/rate/payslip/kpi all `HR_ROLES`=hr+ke_toan; kpiEvalConfirm ql+bgd; kpiEvalApprove **bgd only** (`payroll.ts`) |
| payroll.myPayslips | self | self | self | self | self | self | self | self | self |  ← `protectedProcedure`, own data (`payroll.ts:698`) |
| compensation | — | — | — | — | — | R(effective) | R(effective) | — | — |  ← list/create/defaults `SA`; effective hr+ke_toan (`compensation.ts:35,42,49,52`) |
| audit | RW | RW | RW | RW | RW | RW | RW | RW | RW |  ← timeline/note/follow `protectedProcedure` (all staff) (`audit.ts`) |
| staffNotif | self | self | self | self | self | self | self | self | self |  ← `protectedProcedure` (`staff-notif.ts:8`) |

Observations:
- `quan_ly` is a near-superuser of operational modules (write on almost everything except payroll/compensation).
- `ctv_mkt` has **no dedicated grants** anywhere — only the universal `protectedProcedure` reads. Dead-ish role.
- Several single-role gates are deliberate: `levelProgress.decide` = head_teacher; `payroll.kpiEvalApprove` = bgd; all `user.*` = super_admin.
- `bgd` mostly read/oversight (dashboard, guardian, kpi approve).

---

## 4. Proposed unified RBAC (one staff app)

### Design principle: KISS — centralize the model, keep the two existing enforcement layers.
Do **not** build an ABAC engine. Keep RBAC (role→action) for app logic + RLS for tenancy. The only real change is **collapsing the 3 scattered copies into 1 registry** and merging the two SPAs.

### (a) Central permission registry (replace scattered `requireRole`)
Create one module, e.g. `packages/auth/src/permissions.ts`, exporting a typed map: `module → action → Role[]`. Example shape (KISS, plain data):

```ts
// modules & actions are string-literal unions; values are allowed roles (super_admin implicit)
export const PERMISSIONS = {
  finance:  { read: [ke_toan, quan_ly], write: [ke_toan, quan_ly] },
  crm:      { read: CRM_ROLES, write: CRM_ROLES, gradeTest: [giao_vien, head_teacher, quan_ly] },
  payroll:  { read: HR_ROLES, write: HR_ROLES, kpiConfirm: [quan_ly, bgd], kpiApprove: [bgd] },
  levelup:  { propose: [...], approve: [head_teacher] },
  // ...one entry per router
} as const;
```

Then derive procedures from it: `const can = (mod, action) => requireRole(...PERMISSIONS[mod][action])`. The existing `requireRole` (`trpc.ts:54`) stays the enforcement primitive — only the role lists move into the registry. This is a mechanical refactor; behavior-preserving if the registry is seeded from §3 exactly. Move the per-file `*_ROLES` consts here too (single home for `CRM_ROLES`, `HR_ROLES`, etc.).

Benefit: backend gates, nav visibility, and any client `can*` checks all read from ONE source — drift becomes impossible.

### (b) Role-filtered nav for the single app
- Define ONE `MODULES` array `{ key, label, icon, group, action: PERMISSIONS[key].read }`.
- Expose a tiny client helper `can(me, module)` that reuses the SAME registry (ship the registry, or a derived `role→modules[]` map, to the client via a `auth.capabilities` query so the client never re-hardcodes lists).
- Nav = `MODULES.filter(m => can(me, m.key))`. The existing `Shell` already renders `navGroups` with per-item `visible` (`admin/src/shell.tsx:289-305`) — keep that component, feed it the filtered list. Each staff role then sees only its modules automatically. Replace the hand-written `canHr/canCrm/...` booleans (`admin/src/App.tsx:714-733`, `teaching/src/shell.tsx:238-244`) with registry lookups.
- Default landing per role (e.g. giao_vien → schedule, ke_toan → finance, hr → payroll) via a small `role→defaultModule` map.

### (c) Migration 2 apps → 1 without losing facility RLS
RLS is **untouched** by this — it lives in `withRls`/Postgres and is keyed off the session's `facilityIds`, independent of which SPA called. Steps:
1. Pick one app dir as the host (recommend a fresh `apps/staff` or reuse `apps/admin`). Merge the union of all `SectionKey`s into one nav.
2. De-duplicate the 4 overlapping panels (crm/cskh/finance/payroll): keep one copy, ideally promoted into `packages/ui` so it's shared (note: `@cmc/ui` already hosts shared `useSession`, `useStaffNotif`, `LoginGate`, `Shell` candidates). Delete the duplicate `StaffNotifDropdown`/`Shell` in the loser app.
3. Wire every panel behind a registry-driven route guard mirroring its backend gate.
4. Cookie/session/JWT: NO change. Both apps already use `cmc.session`; one app uses the same cookie. `tokenVersion` revocation unaffected.
5. Retire the second Vite app + its dev port; update nginx/host to serve one staff bundle. (No nginx mapping found in repo — `docker-compose*/nginx*` returned nothing in `§search`; serving is via Vite dev ports today, so deployment wiring must be confirmed with the user.)

### Pattern reference (OpenEduCat, treat as untrusted, pattern only)
OpenEduCat (Odoo) models access as `ir.model.access.csv` rows: `(model, group, read, write, create, unlink)` booleans, with users assigned to `res.groups`. The transferable idea is exactly the **central CSV-like table of (resource × group × action)** — which §4(a)'s `PERMISSIONS` map reproduces in TypeScript. We deliberately do NOT adopt Odoo's record rules / domain filters (that is ABAC) — our facility scoping is already handled by Postgres RLS, which is simpler and DB-enforced. So: borrow the *registry table* concept; ignore the engine.

---

## 5. Risks, effort, decisions needed

### Risks
- **Behavior drift during registry seeding (medium).** If the registry doesn't exactly mirror §3, some role silently gains/loses access. Mitigation: seed mechanically from §3, add a unit test asserting each procedure's allowed-role set equals the registry entry. This is the only place real authz risk lives.
- **RLS (low).** Untouched. As long as sessions still carry `facilityIds` and procedures still run inside `withRls`, tenancy holds. Main pitfall: a merged panel that forgets a facility selector — but that's a data-display bug, not an RLS bypass (RLS denies server-side regardless).
- **JWT / tokenVersion (low).** No token shape change. Same cookie name means existing sessions keep working through the merge; no forced logout.
- **Route consolidation (medium).** Section-key collisions are unlikely (admin and teaching key sets are disjoint except `crm/cskh/finance`), but the 3 shared keys must resolve to the single shared panel. Deep links / `window.location.hash` routing (`admin/src/App.tsx:707`) must be reconciled into one key namespace.
- **Frontend `can*` drift removed (positive).** Consolidation eliminates the current 3-way duplication.

### Rough effort
- Permission registry + refactor `requireRole` call sites: ~1–1.5 days (≈30 procedures, mechanical) + authz test.
- Merge SPAs (one shell, dedupe 4 panels into `@cmc/ui`, unified nav + route guard): ~2–3 days.
- Deployment rewire (one bundle, drop 2nd port): ~0.5 day, pending host config.
- Total ≈ 4–5 days. Low architectural risk (backend already unified); risk concentrated in the authz-parity test.

### Decisions the user must make
1. **Host app:** new `apps/staff` vs. reuse `apps/admin` in place?
2. **Promote shared panels to `packages/ui`** (recommended) or keep in the host app?
3. **`ctv_mkt` role:** currently grant-less — define its modules, or drop it from the staff app?
4. **`quan_ly` scope:** keep it as near-superuser of operational modules, or split some (e.g. finance/payroll) out? Affects nav defaults.
5. **Per-role default landing module** mapping — confirm desired first screen per role.
6. **Deployment topology:** how are the SPAs served in prod today (no nginx/compose mapping found in repo)? Needed to plan the single-bundle cutover.
7. Should the client fetch capabilities via a new `auth.capabilities` query (recommended, keeps registry single-source) vs. shipping the registry into the bundle?

---

Status: DONE
Summary: The admin/teaching split is frontend-only — both already share one API, one `cmc.session` cookie, and one `requireRole`+RLS model; the report maps every panel, the full module×role matrix, and proposes a single central permission registry (Odoo-style table, no ABAC) plus a 4–5 day low-risk merge.
Unresolved questions: see §5 decisions 1–7 (host app, shared-panel placement, ctv_mkt fate, quan_ly scope, role defaults, prod serving topology, capabilities delivery).
