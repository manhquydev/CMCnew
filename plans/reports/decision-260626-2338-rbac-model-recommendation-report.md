# RBAC Model Decision — CMC Unified Staff ERP

Date: 2026-06-26 · Mode: READ-ONLY decision (no code changed) · Author: domain review (authorization/RBAC)
Decision context: collapse `apps/admin` + `apps/teaching` into one staff app; pick the role→permission model. Backend is already unified (one `appRouter`, one `cmc.session` cookie, `requireRole` + Postgres RLS). RLS owns facility tenancy; RBAC owns module/action only.

---

## DECISION (up front)

**Choose (B) — Explicit per-role permissions, expressed as one central `module → action → Role[]` registry. Keep the single existing inheritance edge (`super_admin` implicit bypass). Do NOT build role inheritance (A) and do NOT build a per-permission override/deny layer (C).**

One sentence: the code already *is* model B, and the two anchors that model A would need — "`head_teacher` inherits `giao_vien`" and "`quan_ly` = staff superuser" — are **both empirically false** in the current routers, so inheritance would mis-model the domain, and with only 8 roles / 12 distinct role-sets a deny-override engine (C) is YAGNI.

---

## 1. Data — measured from `apps/api/src/routers/*.ts`

Method: enumerated every `requireRole(...)`, `superAdminProcedure`, and the shared `*_ROLES` consts. `super_admin` always passes implicitly (`trpc.ts:54-62`) and is excluded from the sets below.

### 1.1 Enforcement-site counts

| Metric | Count |
| --- | --- |
| Router files total | 32 |
| Routers carrying explicit role gates | 24 |
| `requireRole(...)` call sites | ~97 |
| `superAdminProcedure` sites (super_admin only) | 16 (across 4 files: user×6, compensation×4, parent-meeting×3, facility×3) |
| `protectedProcedure` (any authenticated staff) sites | 38 |
| Distinct role-sets passed to `requireRole` | **12** |
| Shared role-set consts (already factored) | 6 — `CSKH_ROLES`, `CRM_ROLES`, `TEST_GRADE_ROLES`, `ISSUE_ROLES`, `LEAD_ROLES`, `HR_ROLES` (+ `TOP_ROLES` in `lib/kpi-authz.ts`) |

### 1.2 The 12 distinct role-sets (this is the whole authorization surface)

| # | Role-set | Approx. sites | Example procedures |
| --- | --- | --- | --- |
| 1 | `{quan_ly}` | ~22 | class-batch.create/setStatus/cancel/reopen, course.create/archive, room.*, schedule.addSlot/generateSessions, rewards.*, badge.create/archive, enrollment.complete, user.listTeachers, aftersale.setStudentLifecycle |
| 2 | `{quan_ly, sale}` | 3 | enrollment.enroll, student.create/update |
| 3 | `{giao_vien, quan_ly}` | 7 | attendance.mark, exercise.create/publish, grade.grade/publish, submission.listByExercise/layerForGrading |
| 4 | `{giao_vien, head_teacher, quan_ly}` | ~11 | assessment.template/termList/upsertQualitative/computeFinalGrade, badge.grant, badge.list, certificate.list, levelProgress.propose, crm.testGrade, parentMeeting.setStatus/setSchedule |
| 5 | `{head_teacher, quan_ly}` | 4 | assessment.termCreate/termUpdate, levelProgress.listPending, certificate.issue |
| 6 | `{head_teacher}` | 1 | levelProgress.decide |
| 7 | `{cskh, quan_ly}` (`CSKH_ROLES`) | 4 | aftersale.list/create/transition/assign |
| 8 | `{sale, cskh, quan_ly}` (`CRM_ROLES`) | 9 | crm.contact*/opportunity*/test* |
| 9 | `{bgd, quan_ly}` (`LEAD_ROLES` + dashboard + kpiEvalConfirm) | 7 | guardian.parentList/create/link/unlink, dashboard.summary, payroll.kpiEvalConfirm |
| 10 | `{hr, ke_toan}` (`HR_ROLES`) | ~22 | payroll.* (roster, payslip*, rate*, kpi*) + compensation.effective |
| 11 | `{quan_ly, ke_toan}` | 10 | finance.price*/voucher*/receipt* |
| 12 | `{bgd}` | 1 | payroll.kpiEvalApprove |

### 1.3 Overlap / co-occurrence stats (these drive the decision)

| Question | Measured answer |
| --- | --- |
| Is `quan_ly` in "nearly everything"? | In **9 of 12** role-sets, ~**73 of ~97** sites (**75%**). |
| Where is `quan_ly` ABSENT? | **~24 sites**: all `HR_ROLES` payroll (~21) + `compensation.effective` (1) + `levelProgress.decide` (1) + `payroll.kpiEvalApprove` (1). So `quan_ly` is **not** a superuser — it has **no** payroll/compensation/HR write at all, and is locked out of 2 approval gates. |
| Does `head_teacher` almost always appear with `giao_vien`? | **No.** `head_teacher` is in sets #4, #5, #6. It co-occurs with `giao_vien` only in set #4. In sets #5/#6 (`termCreate`, `termUpdate`, `listPending`, `certificate.issue`, `decide` = ~5 sites) `head_teacher` appears **without** `giao_vien`. |
| Does `head_teacher` get the core `giao_vien` teaching verbs? | **No.** Set #3 (`attendance.mark`, `exercise.create/publish`, `grade.grade/publish`, `submission.*` = **7 sites**) grants `giao_vien` + `quan_ly` but **NOT** `head_teacher`. |
| True superuser? | Only `super_admin` (implicit bypass on all `requireRole` + the 16 `superAdminProcedure` sites). Exactly **one** inheritance edge exists today. |

---

## 2. Why B, not A or C

### Reject (A) Hierarchical / inheritance
Model A needs two inheritance anchors. The codebase falsifies both:

1. **`head_teacher ⊇ giao_vien` is false.** 7 sites give the teaching verbs (attendance/grade/exercise/submission) to `giao_vien` but exclude `head_teacher` (set #3). If `head_teacher` inherited `giao_vien`, it would silently gain `attendance.mark`, `grade.grade`, `exercise.publish` — a behavior change nobody approved. The spec-audit explicitly lists "should `head_teacher` inherit teacher verbs?" as an **undecided policy question** (`spec-audit-...teacher-permissions-report.md` §4 Q2). You cannot encode an inheritance edge the business has not decided exists.
2. **`quan_ly` = staff superuser is false.** `quan_ly` is absent from ~24 sites — it has zero payroll/compensation/HR access and is excluded from `levelProgress.decide` and `kpiEvalApprove`. Modeling `quan_ly` as a superuser that inherits everything would over-grant the entire HR/finance-sensitive payroll surface. The real superuser is `super_admin`, which already exists as the one bypass edge.

Also note the locked decision "class/schedule creation = `quan_ly` + `head_teacher`": that makes `head_teacher` need **more** than `giao_vien` in provisioning while having **less** in teaching verbs. The two roles are **overlapping, not nested** — the defining signature of a model that inheritance cannot express cleanly.

### Reject (C) Hybrid base-inheritance + override/deny
C only earns its keep when an inheritance base removes enough duplication to justify a precedence engine (allow vs deny ordering, "deny beats allow", per-permission exceptions). Here the base (A) is already rejected, so C would be inheritance-that-doesn't-hold plus a deny layer to patch the holes — strictly more machinery than B for an identical result. With **8 roles and 12 sets**, the duplication B leaves on the table is trivial (the 6 `*_ROLES` consts already de-dupe most of it). Deny-override pays off at hundreds of roles/resources (enterprise IAM), not a tutoring-center ERP. KISS/YAGNI says no.

### Accept (B) Explicit per-role, centralized
B = exactly what runs today, minus the scatter. Every gate already lists its roles explicitly; the only defect is that the list lives in 3 places (backend inline, backend `*_ROLES` consts, frontend `can*` booleans) with no single source of truth (architecture report §2). B fixes that by moving the 12 sets into one registry. No semantic change, no inheritance to reason about, behavior-preserving, testable.

### Reference patterns (OpenEduCat / Odoo — treated as untrusted, pattern only)
Odoo's `ir.model.access.csv` is literally a flat table of `(model, group, read/write/create/unlink)` rows — i.e. **explicit per-group-per-resource grants**, which is model B. Odoo *does* have group inheritance via `res.groups.implied_ids` (a group implies another's rights), but that is an **optional convenience for deeply nested orgs**, and Odoo still lets `ir.model.access` rows grant access directly without it. Odoo's record rules / domain filters are row-scoping (ABAC) — CMC already covers that with Postgres RLS and should **not** reimplement it. Net borrow: the **flat (resource × group × action) table**. Skip: `implied_ids` inheritance (anchors don't hold here) and record rules (RLS owns it).

---

## 3. Concrete shape — the permission registry

One module, e.g. `packages/auth/src/permissions.ts`. Plain typed data; `super_admin` implicit; no inheritance machinery.

```ts
import { Role } from '@cmc/db';

// Reusable sets (absorb the existing *_ROLES consts so they live in ONE home)
const CRM   = [Role.sale, Role.cskh, Role.quan_ly] as const;
const CSKH  = [Role.cskh, Role.quan_ly] as const;
const HR    = [Role.hr, Role.ke_toan] as const;
const TEACH = [Role.giao_vien, Role.quan_ly] as const;            // teaching verbs (NO head_teacher — verified set #3)
const ACAD  = [Role.giao_vien, Role.head_teacher, Role.quan_ly] as const;

export const PERMISSIONS = {
  classBatch: { read: 'authenticated', create: [Role.quan_ly], setStatus: [Role.quan_ly],
                cancel: [Role.quan_ly], reopen: [Role.quan_ly] },
  schedule:   { read: 'authenticated', addSlot: [Role.quan_ly], generateSessions: [Role.quan_ly] },
  attendance: { read: 'authenticated', mark: TEACH },
  grade:      { grade: TEACH, publish: TEACH },
  assessment: { read: ACAD, upsert: ACAD, computeFinal: ACAD,
                termCreate: [Role.head_teacher, Role.quan_ly], termUpdate: [Role.head_teacher, Role.quan_ly] },
  levelup:    { propose: ACAD, listPending: [Role.head_teacher, Role.quan_ly], decide: [Role.head_teacher] },
  finance:    { read: [Role.ke_toan, Role.quan_ly], write: [Role.ke_toan, Role.quan_ly] },
  payroll:    { read: HR, write: HR, kpiConfirm: [Role.quan_ly, Role.bgd], kpiApprove: [Role.bgd] },
  crm:        { read: CRM, write: CRM, gradeTest: ACAD },
  aftersale:  { read: CSKH, write: CSKH, setLifecycle: [Role.quan_ly] },
  // ...one entry per router, seeded mechanically from §1.2
} as const;
```

Example single entry, read in full:

```ts
levelup: { propose: ACAD, listPending: [Role.head_teacher, Role.quan_ly], decide: [Role.head_teacher] }
// "teacher/HT/manager may propose a level-up; HT or manager may see the queue; only head_teacher decides"
```

Enforcement primitive is unchanged — derive procedures from the table:

```ts
const can = (mod, action) => {
  const v = PERMISSIONS[mod][action];
  return v === 'authenticated' ? protectedProcedure : requireRole(...v);
};
// class-batch.ts:  create: can('classBatch','create').input(...).mutation(...)
```

Client gets the same truth via one `auth.capabilities` query (derived `role → modules[]`), so nav visibility and the `can*` booleans stop being hand-maintained and can no longer drift.

If `head_teacher` should later inherit teacher verbs (open policy Q), it is a **one-line data edit** — change `TEACH` to `ACAD` on `attendance`/`grade`/`exercise`. That is the YAGNI win: B makes the *future* inheritance decision a data change, instead of forcing an inheritance engine *now* before the business has decided.

---

## 4. Migration impact

The ~97 `requireRole` sites + 6 `*_ROLES` consts + the frontend `can*` booleans collapse into **one ~30-entry registry**. Mechanical, behavior-preserving:

| Step | Work | Effort |
| --- | --- | --- |
| Author `permissions.ts` seeded exactly from §1.2 | move 12 sets + 6 consts into the table | 0.3 day |
| Re-point ~97 call sites to `can(mod, action)` | per-procedure mechanical edit | 0.5–0.7 day |
| Parity test: assert each procedure's allowed-role set == registry entry | guards against silent grant/loss during seeding | 0.3 day |
| Ship `auth.capabilities`; replace frontend `can*` with registry lookups | kills 3-way drift | 0.3 day |
| **Total (registry only)** | | **~1.5 days** |

This is the authz slice of the larger 4–5 day app-merge in the architecture report; the SPA consolidation (dedupe crm/cskh/finance/payroll panels, one shell) is separate and unaffected by the model choice.

---

## 5. Risks + what the user must confirm

**Risks**
- **Seeding drift (medium, the only real authz risk).** If the registry doesn't mirror §1.2 exactly, a role silently gains/loses access. Mitigated entirely by the parity test (assert registry == current `requireRole` lists before refactor).
- **RLS (low).** Untouched — tenancy stays in Postgres `withRls`. Registry is module/action only.
- **JWT/session (low).** No token shape change; same `cmc.session` cookie; no forced logout.

**Must confirm (these are policy, not code-discoverable):**
1. **`head_teacher` teaching verbs** — keep flat (HT cannot `attendance.mark` / `grade.grade` / create exercises, as today, set #3), or grant them? This is the single question that decides whether any inheritance is ever wanted. Recommendation: keep flat unless ops asks; it is a one-line `TEACH→ACAD` edit later.
2. **`head_teacher` class/schedule provisioning** — the locked decision says class/schedule creation = `quan_ly` + `head_teacher`, but the current code is `quan_ly`-only (`class-batch.ts:60`, `schedule.ts:23`). Confirm the registry should **add** `head_teacher` to `classBatch.create`/`setStatus`/`cancel`/`reopen` and `schedule.addSlot`/`generateSessions` (this is a deliberate grant change, not a seed of current state — flag it explicitly in the parity test as an intended diff).
3. **`ctv_mkt`** — has zero grants in all 12 sets (read-only via `protectedProcedure`). Drop from the staff app, or give it a module? (Recommend drop until a use case exists.)

---

Status: DONE
Summary: Chose **(B) explicit per-role**, centralized into one `module→action→Role[]` registry. The deciding evidence: across ~97 enforcement sites the authorization surface is just **12 distinct role-sets among 8 roles**, and the two anchors model A needs both fail — `head_teacher` is denied all 7 core `giao_vien` teaching-verb sites, and `quan_ly` is absent from ~24 payroll/compensation/approval sites — so inheritance would mis-grant, while a deny-override layer (C) is YAGNI at this scale.
Unresolved: §5 confirmations 1–3 (head_teacher teaching verbs, head_teacher class provisioning per the locked decision, `ctv_mkt` fate).
</content>
</invoke>
