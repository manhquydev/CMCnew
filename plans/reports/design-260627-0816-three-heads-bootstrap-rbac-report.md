# Design — Three-Heads Bootstrap RBAC

Date: 2026-06-27
Branch: feature/erp-unify-rbac-f0
Status: design only (no code changed)

## Org model being implemented

Three leadership heads, each builds/owns a team:

1. IT head = `super_admin` — the single seeded first account. Creates the other two directors.
2. Business head = `giam_doc_kinh_doanh` (new) — creates `{sale, cskh, ctv_mkt}` scoped to their facilities.
3. Education head = `giam_doc_dao_tao` (new) — creates `{giao_vien, head_teacher}` scoped to their facilities.

`super_admin` may assign any role to any facility. Directors are facility-scoped and role-scoped.

---

## 1. Schema — Role enum + migration

Current enum (`packages/db/prisma/schema.prisma:15`):
`super_admin, quan_ly, head_teacher, giao_vien, ke_toan, hr, sale, cskh, ctv_mkt, bgd`.

Add two values:

```prisma
enum Role {
  super_admin
  quan_ly
  head_teacher
  giao_vien
  ke_toan
  hr
  sale
  cskh
  ctv_mkt
  bgd
  giam_doc_kinh_doanh   // Business Director (head of KD team)
  giam_doc_dao_tao      // Education Director (head of GD team)
}
```

Migration approach (Postgres native enum — values cannot be added inside the same tx that uses them, and `ALTER TYPE … ADD VALUE` is the only safe path; do NOT drop/recreate the enum, that would cascade every column):

```sql
-- migration: add_director_roles
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'giam_doc_kinh_doanh';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'giam_doc_dao_tao';
```

Notes:
- `prisma migrate dev` generates exactly this for an enum addition. `IF NOT EXISTS` keeps it idempotent (Postgres 12+; repo is on PG with these features).
- `ADD VALUE` auto-commits and cannot run in a transaction block. Prisma runs each migration statement directly so this is fine, but the migration must contain only these statements (no data backfill in the same file).
- **RLS impact: NONE.** Verified — no RLS policy or GUC enumerates role values (see §RLS audit). New roles need only (a) permission-registry entries (§3) and (b) the delegated-create guard (§2). The enum addition alone changes no policy.

### RLS audit (does RLS enumerate roles?) — NO

GUCs set by `withRls` (`packages/db/src/index.ts:48`): `app.facility_ids`, `app.is_super_admin`, `app.principal_kind`, `app.student_ids`. No role list.
Policy predicates use only `app_is_super_admin()`, `app_facility_ids()`, `app_principal_kind()`, `app_student_ids()` (e.g. `20260623100000_principal_aware_rls`, `20260624090000_identity_system_wide_rls`). Roles never appear in SQL. Director facility scoping therefore works automatically: a director session has `isSuperAdmin=false` + their `facilityIds`, so every facility-scoped table filters to their facilities with zero RLS changes.

**One real blocker found (not RLS-on-roles, but RLS-on-app_user):** `app_user` INSERT/UPDATE is governed by `app_user_admin_only` → `WITH CHECK (app_is_super_admin())` (`20260623053955_app_user_rls_and_token_trigger`). A SELECT-only roster policy was later added (`20260623090000`), but **writes are still super-admin-only**. So a director (non-super) calling `user.create` would fail the `WITH CHECK` → SQLSTATE 42501 → mapped to FORBIDDEN. This must be handled in §2.

---

## 2. Delegated `user.create` (and setRoles/setActive)

File: `apps/api/src/routers/user.ts`. Today every mutation uses `superAdminProcedure`.

### Allowed-role map (single source, put in `packages/auth`)

```ts
// packages/auth/src/permissions.ts (or a sibling director-scope.ts)
export const DIRECTOR_ROLE_GRANTS: Partial<Record<Role, Role[]>> = {
  giam_doc_kinh_doanh: ['sale', 'cskh', 'ctv_mkt'],
  giam_doc_dao_tao:    ['giao_vien', 'head_teacher'],
};

/** Roles this session may assign. super_admin → all roles; director → their grant set. */
export function assignableRoles(session: { isSuperAdmin: boolean; roles: string[] }): Set<string> {
  if (session.isSuperAdmin) return new Set(ALL_ROLES);
  const out = new Set<string>();
  for (const r of session.roles) for (const g of DIRECTOR_ROLE_GRANTS[r as Role] ?? []) out.add(g);
  return out;
}
```

### New procedure gate

Replace `superAdminProcedure` on `create` (and `setRoles`/`setActive`, see below) with a director-or-super gate. Add to `trpc.ts`:

```ts
export const userAdminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const s = ctx.session;
  const isDirector = s.roles.includes(Role.giam_doc_kinh_doanh) || s.roles.includes(Role.giam_doc_dao_tao);
  if (!s.isSuperAdmin && !isDirector) throw new TRPCError({ code: 'FORBIDDEN' });
  return next();
});
```

### create guard (pseudocode)

```ts
create: userAdminProcedure
  .input(/* same shape: email, displayName, password, roles[], primaryRole, facilityIds[] */)
  .mutation(async ({ ctx, input }) => {
    const allowed = assignableRoles(ctx.session);
    // 1. Role scope: every requested role must be assignable by this caller.
    const bad = input.roles.filter((r) => !allowed.has(r));
    if (bad.length) throw new TRPCError({ code: 'FORBIDDEN',
      message: `Bạn không có quyền cấp vai trò: ${bad.join(', ')}` });
    // 2. Director cannot create another director or super_admin (covered by allowed set;
    //    super_admin/director roles are simply never in DIRECTOR_ROLE_GRANTS).
    // 3. Facility scope: a director may only place users in their own facilities.
    if (!ctx.session.isSuperAdmin) {
      const own = new Set(ctx.session.facilityIds);
      const outside = input.facilityIds.filter((f) => !own.has(f));
      if (outside.length) throw new TRPCError({ code: 'FORBIDDEN',
        message: `Ngoài phạm vi cơ sở của bạn: ${outside.join(', ')}` });
      if (input.facilityIds.length === 0) throw new TRPCError({ code: 'BAD_REQUEST',
        message: 'Phải chọn ít nhất một cơ sở' });
    }
    // 4. Write. app_user INSERT WITH CHECK is super-admin-only at the DB layer, so the
    //    actual insert runs under an elevated RLS context AFTER the app-layer scope checks
    //    above have constrained roles + facilities. Mirrors emailSecurityAlert's SYSTEM_CTX.
    const ELEVATED = { facilityIds: [] as number[], isSuperAdmin: true };
    return withRls(ELEVATED, async (tx) => {
      const user = await tx.appUser.create({ /* …unchanged… */ });
      await logEvent(tx, { entityType: 'user', entityId: user.id, type: 'created',
        actorId: ctx.session.userId });
      return user;
    });
  })
```

Why elevated write instead of a new RLS policy: keeps `app_user_admin_only` (super-only writes) intact as the DB invariant, and the app-layer guard fully constrains what a director can do (roles ∈ grant set, facilities ⊆ own). The facility subset check in step 3 is load-bearing precisely because the elevated context bypasses facility RLS on the insert. This matches the existing `SYSTEM_CTX` pattern already in this file.

Alternative (rejected for now): broaden `app_user` INSERT policy to allow non-super staff whose target facilities ⊆ `app_facility_ids()`. More "pure" (defence-in-depth at DB) but: (a) app_user is system-wide with no facility column, so the policy would need an EXISTS over the to-be-inserted user_facility rows — awkward on INSERT ordering; (b) it weakens a deliberately strict invariant. Note as a possible hardening follow-up, not F0 scope.

### setRoles / setActive / setFacilities — recommended scope

Recommendation: **directors manage only their own team, super_admin manages everyone.** Concretely:

- `setRoles`: switch to `userAdminProcedure` + guard that (a) the **target user's current roles** are all within the caller's grant set (director can't touch a teacher if they're the Business head), and (b) the **new roles** are all within the grant set. Run the update under elevated context (same reason as create). Keep `tokenVersion` bump + security-alert email.
- `setActive`: same — director may deactivate/reactivate only users whose roles ⊆ their grant set and who share ≥1 facility. super_admin unrestricted.
- `setFacilities`: directors may only set facilities ⊆ their own; super_admin unrestricted. Lower priority — can stay super-only in F0 if we want to ship the bootstrap path first (KISS). Flag for product: do directors need to move their staff between facilities? If unsure, keep super-only initially.
- `list` / `listTeachers`: `list` stays super-only (system-wide roster) **or** broaden to directors filtered to grant-set roles + own facilities; simplest is to let directors use a facility/role-filtered list. The existing `app_user_facility_roster` SELECT policy already lets a director read co-facility staff, so a director `list` would naturally return only their facility's users — acceptable.

Helper to centralize the "may this caller manage this target user" check:

```ts
function canManageTarget(session, target: { roles: string[]; facilityIds: number[] }) {
  if (session.isSuperAdmin) return true;
  const grant = assignableRoles(session);
  const roleOk = target.roles.every((r) => grant.has(r));
  const facOk  = target.facilityIds.some((f) => session.facilityIds.includes(f));
  return roleOk && facOk;
}
```

---

## 3. Permission registry entries for the 2 new roles

File: `packages/auth/src/permissions.ts`. The two directors are **team leads**, so they get at least the read/oversight surface of their team plus user-management. Add the role string to the relevant `module.action` arrays. (Parity test `apps/api/test/permission-parity.test.ts` + `permission-snapshot.json` must be updated in the same change.)

### Business Director — `giam_doc_kinh_doanh`

Sees CRM / CSKH / Finance(read) / rewards oversight. Suggested additions:

| Module.action | Add | Rationale |
|---|---|---|
| `crm.contactList`, `crm.opportunityList`, `crm.testList` | `giam_doc_kinh_doanh` | read pipeline of their team |
| `crm.opportunityCreate/Transition/MarkLost/Reopen`, `crm.contactCreate`, `crm.testCreate` | `giam_doc_kinh_doanh` (write optional) | if director also works deals; otherwise read-only — **ask product** |
| `afterSale.list` | `giam_doc_kinh_doanh` | oversee CSKH cases |
| `finance.receiptList`, `finance.priceList`, `finance.voucherList` | `giam_doc_kinh_doanh` | revenue visibility (read) — NOT receipt approve/create |
| `rewards.giftCreate`, `rewards.review` | `giam_doc_kinh_doanh` (optional) | if KD owns referral gifts — **ask product** |
| `dashboard.summary` | `giam_doc_kinh_doanh` | leadership overview |

Default to read-only on CRM/CSKH writes unless product says directors actively work the pipeline. Finance is read-only by design (approve/create stay `ke_toan`/`quan_ly`).

### Education Director — `giam_doc_dao_tao`

Sees academic / classes / schedule / grading / certificate / level-approval. Suggested additions:

| Module.action | Add | Rationale |
|---|---|---|
| `assessment.template/termList/termCreate/termUpdate/termLock/termUnlock` | `giam_doc_dao_tao` | owns assessment terms across their team |
| `assessment.upsertQualitative`, `assessment.computeFinalGrade` | `giam_doc_dao_tao` | grading oversight |
| `classBatch.create`, `classBatch.setStatus/cancel/reopen` | `giam_doc_dao_tao` | open/close classes (currently quan_ly±head_teacher) |
| `schedule.addSlot`, `schedule.generateSessions` | `giam_doc_dao_tao` | build timetables |
| `attendance.mark` | `giam_doc_dao_tao` (optional) | usually teacher-only; add only if director covers classes |
| `grade.grade`, `grade.publish` | `giam_doc_dao_tao` | grading oversight |
| `certificate.list`, `certificate.issue` | `giam_doc_dao_tao` | issue certificates |
| `levelProgress.propose/listPending/decide` | `giam_doc_dao_tao` | approve level-ups (esp. `decide`, today head_teacher-only) |
| `badge.list/create/grant` | `giam_doc_dao_tao` (optional) | academic rewards |
| `course.create/archive` | `giam_doc_dao_tao` (optional) | curriculum ownership — **ask product** |
| `dashboard.summary` | `giam_doc_dao_tao` | leadership overview |

### user module

`user.create` / `setRoles` / `setActive` move off `superAdminProcedure`. Their registry rows currently say `['super_admin']` (audit-map only). Update to reflect both directors so the parity map + nav stay truthful:

```ts
user: {
  list: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  listTeachers: ['quan_ly', 'giam_doc_dao_tao'],
  create: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  setRoles: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  setActive: ['super_admin', 'giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
  setFacilities: ['super_admin'], // or add directors if §2 enables it
}
```

Note the registry is the read/visibility source of truth; the **actual** role/facility scoping for directors is enforced by the §2 guard, not by `can()` alone (which is role-presence only, not scope-aware).

---

## 4. Nav (`apps/admin/src/nav-permissions.ts`)

Nav already derives `visible` from `can(roles, isSuperAdmin, module, action)` against `NAV_GATES` — **no role arrays in the nav file**. So once §3 adds the director role strings to the gated `module.action` entries, the sidebar updates automatically. Specifically:

- Business Director will see: `crm` (opportunityList), `cskh` (afterSale.list), `finance` (receiptList — needs director added to `finance.receiptList`), `overview`/`schedule`/`classes`/`courses` (open), and `org` if we change its gate (below).
- Education Director will see: `attendance`, `grading`, `assessment`, `meetings`, `levelup`, `certificate` once added to the respective primary actions, plus the open panels.

`org` panel gate is `{ kind: 'superAdmin' }` (`nav-permissions.ts:42`). Directors need user management, so change it to a permission gate keyed to the new delegated action:

```ts
org: { kind: 'permission', module: 'user', action: 'create' },
```

This makes `org` visible to super_admin (bypass) + both directors. The shell still renders the same panel; the §2 guards make sure a director only successfully creates in-scope users. The user-list inside the panel should ideally filter to the director's scope (the roster RLS policy already does this for reads).

`compensation` gate stays `superAdmin`. `kpi`/`hr` stay `hr`/`ke_toan`.

---

## 5. Reset + seed — IT head only

Goal: a dev-only, idempotent reset that wipes data and seeds **only** the `super_admin` IT head (no other staff, no LMS demo).

Current `packages/db/src/seed.ts` seeds super_admin **plus** a full staff roster + LMS demo. For the 3-heads bootstrap we want a minimal seed. Two options:

### Recommended: env-flagged minimal seed in the existing seed.ts (KISS, one file)

Add a guard so the staff-roster + LMS blocks are skipped unless explicitly requested:

```ts
const MINIMAL = process.env.SEED_MINIMAL !== 'false'; // default minimal for bootstrap
// …seed facilities + super_admin (unchanged, idempotent upsert/find)…
if (!MINIMAL) { /* existing STAFF loop + LMS seed */ }
```

Then `SEED_MINIMAL=true pnpm db:seed` (the default) seeds only HQ/CS2 facilities + the IT-head super_admin. `SEED_MINIMAL=false` keeps today's full demo. Keep the production password guard already present (`seed.ts:13`).

### Reset script (dev-only, safe, idempotent)

There is no `db:reset` script today (`package.json` has `db:up/down/migrate/seed/generate`). Add one that is explicit and dev-guarded:

```jsonc
// root package.json scripts
"db:reset": "prisma migrate reset --force --schema packages/db/prisma/schema.prisma && pnpm db:seed"
```

`prisma migrate reset` drops the schema, re-applies all migrations, then runs the configured seed (`packages/db/package.json` → `prisma.seed`). Safety:
- Refuses implicitly in CI/non-interactive only with `--force`; gate it behind an env check at the top of seed (`if (process.env.NODE_ENV === 'production') throw`).
- Idempotent because seed uses `upsert`/`findUnique` guards.
- Document it as **dev/staging only** in the operate guide; never wire it into deploy.

For a from-truly-empty bootstrap demo, `pnpm db:reset` with `SEED_MINIMAL` default → DB containing exactly: 2 facilities + 1 super_admin. The IT head then creates the two directors in the UI, each director creates their team. This is the cleanest expression of the org model.

---

## 6. Login for local testing — `ssoConfigFromEnv()` gating

Problem: `auth.ts:33` blocks password login for non-super_admin when `ssoConfigFromEnv()` is truthy. The directors + their teams must password-login locally.

Good news: `ssoConfigFromEnv()` (`apps/api/src/lib/sso.ts:20`) **already requires the client secret** — it returns `null` unless ALL of tenantId, clientId, **clientSecret**, redirectUri, emailDomain are set (`sso.ts:26`). So in local dev (no `ENTRA_CLIENT_SECRET` / `STAFF_EMAIL_DOMAIN`), it is already `null` and password login is open for every role. The task's premise ("IDs are set → blocks") only bites if a dev sets the IDs but not the secret — which `sso.ts` already tolerates (returns null).

So the minimal robustness fix is to make the intent explicit and impossible to half-configure. Recommended **1-line** change — add an explicit kill switch to the guard in `auth.ts`:

```ts
// auth.ts line 33 — require SSO to be both configured AND enabled before blocking password login
if (process.env.SSO_ENABLED === 'true' && ssoConfigFromEnv() && !result.session.isSuperAdmin) {
```

This guarantees local dev (where `SSO_ENABLED` is unset) always allows password login for all roles, regardless of which ENTRA_* vars happen to be present, and production opts in deliberately with `SSO_ENABLED=true`. (If you prefer zero new env vars, the existing secret-requirement in `ssoConfigFromEnv()` is already sufficient — just document "never set ENTRA_CLIENT_SECRET locally"; but the explicit flag is safer against misconfig.)

---

## 7. Operate-guide rewrite outline

Rewrite `docs/operate-and-test-guide.md` around the 3-heads, single-staff-app (post-F0B) flow:

1. **Prerequisites & reset** — `pnpm db:up`, `pnpm db:migrate`, `pnpm db:reset` (dev-only warning). Result: empty system + IT head only. `.env` for local: no `SSO_ENABLED`, `COOKIE_SECURE=false`.
2. **First login — IT head (super_admin)** — `admin@cmc.local` / `SEED_SUPERADMIN_PASSWORD`. Lands on org panel. Explain super_admin = full access.
3. **IT head creates the two directors** — org → create user: Business Director (`giam_doc_kinh_doanh`) and Education Director (`giam_doc_dao_tao`), each assigned their facilities. Set passwords.
4. **Each director builds their team** —
   - Business Director logs in → org panel (scoped) → creates `sale`, `cskh`, `ctv_mkt` in their facilities. Can't pick education roles (UI hides / API rejects).
   - Education Director logs in → creates `giao_vien`, `head_teacher`.
5. **Daily flows per role** (condensed, one sub-section each): teacher (schedule, attendance, grading, level-up propose), head_teacher (level-up decide, certificate), sale (CRM pipeline, enroll), cskh (after-sale cases), ke_toan/hr (finance/payroll — created by super_admin or quan_ly path), directors (oversight dashboards + team management).
6. **Scope/negative tests** — director cannot create out-of-team role (expect FORBIDDEN), cannot place users outside their facilities, cannot see other facility's roster.
7. **SSO note** — production sets `SSO_ENABLED=true` + ENTRA_* + secret; then only super_admin uses password (break-glass), everyone else uses Microsoft SSO.

(Full guide written during implementation.)

---

## Unresolved questions (for product)

1. Do directors **write** in their team's modules (work deals / mark attendance / create courses) or are they **read-only oversight**? Defaults above lean read-only for finance, ambiguous for CRM writes & academic writes.
2. `setFacilities` for directors: should a director move their own staff between facilities, or is that super_admin-only? (KISS default: super-only in F0.)
3. Does `quan_ly` / `bgd` relationship to the two new directors need defining (are they above/below directors, or parallel)? Out of scope here but will affect future permission rows.
4. Should the elevated-write approach (§2) eventually be replaced by a facility-scoped `app_user` INSERT RLS policy for defence-in-depth? (Recommended as later hardening, not F0.)
