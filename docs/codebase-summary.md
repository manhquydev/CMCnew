# Codebase Summary

> Orientation map for the CMCnew codebase. For *why* the system is shaped this
> way, read [project-charter.md](project-charter.md) and
> [adr/0001-stack-and-architecture.md](adr/0001-stack-and-architecture.md).
> For roadmap/status, read [roadmap.md](roadmap.md). This file describes *what
> exists today* and *where to find it*.

Last reviewed: 2026-07-02 (branch `develop`).

## What this is

A unified **ERP + LMS** for CMC's three education programs (UCREA / Bright I.G /
Black Hole, ages 3–11). Single codebase, single Postgres database, no Odoo, no
sync layer. The LMS is a **homework/practice platform**, not online classes.

## Stack at a glance

| Concern | Choice |
| --- | --- |
| Language | TypeScript (ES2022, `strict`, ESM-only, `verbatimModuleSyntax`) |
| Monorepo | pnpm workspaces + Turborepo |
| Runtime | Node ≥ 22 |
| API | Hono HTTP server + tRPC v11 (`@hono/trpc-server`) |
| Validation | Zod at boundaries |
| DB | PostgreSQL + Prisma 6, **Row-Level Security (RLS)** for facility tenancy |
| Frontend | React 19 + Vite 6 + Mantine 7 (`@tabler/icons-react`) |
| Auth | `jose` JWT sessions (staff + LMS parent/student), cookie-based |
| Email | Microsoft Graph (M365) via outbox pattern |
| Jobs | `node-cron` embedded in the API process |
| Tests | Vitest (unit + integration), Playwright (e2e) |
| CI/CD | Jenkins (`Jenkinsfile`); GitHub Actions blocked on billing |

## Workspace layout

Two workspace roots (`pnpm-workspace.yaml`): `apps/*` and `packages/*`.

### Apps (`apps/`)

| App | Package | Role |
| --- | --- | --- |
| `api` | `@cmc/api` | Backend: tRPC routers, services, cron jobs, SSE. **Hub** — depends on every domain package. |
| `admin` | `@cmc/admin` | Unified staff shell (ERP + teaching). One app, panels filtered by role. `apps/teaching` was retired into this. |
| `lms` | `@cmc/lms` | Parent/student homework portal. |
| `e2e` | `@cmc/e2e` | Playwright end-to-end specs (no `src/`). |

### Packages (`packages/`)

| Package | Responsibility |
| --- | --- |
| `@cmc/db` | Prisma schema (**64 models**, ~55 migrations), client, seeds (incl. `seed-curriculum`), RLS verify scripts. |
| `@cmc/auth` | JWT sessions, `Role` enum (9 roles after consolidation: `super_admin`, `giao_vien`, `ke_toan`, `hr`, `sale`, `cskh`, `ctv_mkt`, `giam_doc_kinh_doanh`, `giam_doc_dao_tao`), and the central **PERMISSIONS registry** (`./permissions` subpath, browser-safe). |
| `@cmc/audit` | Audit-log write helpers (product records, distinct from app logs). |
| `@cmc/ui` | Shared React components, tRPC client, design tokens (`tokens.css`), notify/validators conventions. |
| `@cmc/domain-academic` | Courses, classes, terms, attendance, scheduling, curriculum-unit → session mapping (`assign-units`). |
| `@cmc/domain-finance` | Receipts, revenue, commission. |
| `@cmc/domain-grading` | Final-grade computation (per term). |
| `@cmc/domain-payroll` | Salary, compensation policy, KPI/quota (heaviest domain). |
| `@cmc/domain-rewards` | Badges, stars, level progress, leaderboard. |

**Invariant:** heavy business logic lives in `domain-*` packages, never inline in
routes. This is the anti-"chắp vá" (anti-patchwork) rule from the charter.

## Backend anatomy (`apps/api/src`)

- `index.ts` — Hono server bootstrap: CORS, health, PDF upload endpoints, SSE
  streams, cron registration, tRPC mount.
- `trpc.ts` — procedure builders: `publicProcedure`, `protectedProcedure`,
  `superAdminProcedure`, `lmsProcedure`/`parentProcedure`/`studentProcedure`,
  plus `requireRole(...)` and `requirePermission(module, action)`.
- `context.ts` — request context + session/RLS resolution; cookie names.
- `routers/` — ~40 feature routers (`index.ts` composes the app router). One
  file per feature: `auth`, `student`, `enrollment`, `schedule`, `finance`,
  `payroll`, `grade`, `assessment`, `crm`, `aftersale`, `rewards`, `badge`,
  `certificate`, `parent-meeting`, `notification`, `staff-notif`, `dashboard`,
  `shift-config`, `shift-registration`, `check-in-out`, `facility-ip`,
  `curriculum`, …
- `class-batch.ts` supports **1-click multi-slot class creation**: create a class
  and multiple weekly `ScheduleSlot`s (each optionally mapped to a
  `CurriculumUnit`) in one transaction; slots can be edited/removed later in the
  class schedule tab, with cascade + activity-log.
- `curriculum.ts` — read-only for the hard-coded curriculum framework
  (`CurriculumUnit`, a **global, no-RLS** table; see decision 0021). Seeded via
  `packages/db/src/seed-curriculum.ts`; any future write path must be app-layer
  permission-gated (no DB backstop).
- `services/` — cross-router workflows: `email-outbox`, `email-templates`,
  `login-otp`, `student-provisioning`, `parent-meeting-cadence/-reminder`,
  `receipt-html`/`certificate-html`, `pdf-store`, code generators.
- `lib/` — integrations & helpers: `graph-client` (email), `sso`, `callio-client`,
  `kpi-authz`, `parent-email`, `emit-staff-notif`.

## Security model (load-bearing)

1. **RLS tenancy** — Postgres policies isolate by facility (and principal). Writes
   that violate a policy raise SQLSTATE `42501`; `trpc.ts` maps that to a clean
   `FORBIDDEN` for every procedure.
2. **PERMISSIONS registry** (`@cmc/auth/permissions`) — single source of truth for
   role→procedure access. No inheritance, no wildcards; `super_admin` bypasses at
   the middleware layer. A parity test guards against drift.
3. **Parse-first boundaries** — Zod validates HTTP/session/env input before it
   reaches domain code.

Related: [auth-sso-otp-redirection.md](auth-sso-otp-redirection.md),
[prod-deploy-security-runbook.md](prod-deploy-security-runbook.md).

## Build & run

Common scripts (root `package.json`, via Turbo):

```bash
pnpm dev            # all apps + api
pnpm build          # turbo build (respects ^build deps)
pnpm lint           # eslint across workspaces
pnpm typecheck      # tsc --noEmit per package
pnpm test           # vitest unit suites
pnpm test:e2e       # playwright (@cmc/e2e)
pnpm db:up          # Postgres + Redis via docker/docker-compose.dev.yml
pnpm db:migrate     # prisma migrate deploy
pnpm db:seed        # super_admin + demo facilities
```

Local URLs: API `:4000`, admin `:5173`, lms `:5175`. Full operating procedure:
[operate-and-test-guide.md](operate-and-test-guide.md).

## Where to look first

| You want to… | Start here |
| --- | --- |
| Add an API endpoint | `apps/api/src/routers/<feature>.ts` + register in `routers/index.ts` |
| Add/restrict a permission | `packages/auth/src/permissions.ts` + `requirePermission` in the router |
| Change business math | the relevant `packages/domain-*` package (+ its vitest) |
| Change class setup or multi-slot schedule creation | `apps/api/src/routers/class-batch.ts` + `apps/admin/src/class-workspace.tsx` |
| Change the curriculum framework or its seed | `packages/db/src/seed-curriculum.ts` + `apps/api/src/routers/curriculum.ts` |
| Change Session 360 lesson workflow | `apps/admin/src/schedule-detail.tsx` |
| Change the schema | `packages/db/prisma/schema.prisma` → new migration |
| Add a shared UI component | `packages/ui/src/` (export from `index.tsx`) |
| Trace a flow / impact | GitNexus tools (see `CLAUDE.md`) |

## Known debt / gaps

See [DEBT.md](../DEBT.md) and README status section. Notably: CI runs on Jenkins
only (GitHub Actions billing-blocked); some business cadences (parent-meeting
frequency) specified but not fully enforced in code.
