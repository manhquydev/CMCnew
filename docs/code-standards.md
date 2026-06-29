# Code Standards

> Conventions the CMCnew codebase already follows, derived from the actual
> tooling config and source. New code should match these. For structure and
> dependency rules see [codebase-summary.md](codebase-summary.md); for the
> architectural rationale see
> [adr/0001-stack-and-architecture.md](adr/0001-stack-and-architecture.md).

Last reviewed: 2026-06-29 (branch `develop`).

## Language & module system

- **TypeScript, `strict` mode.** From `tsconfig.base.json`: also
  `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames`.
- **ESM only.** Every `package.json` is `"type": "module"`. Use
  `verbatimModuleSyntax` — `import type { … }` for type-only imports.
- **Relative imports use the `.js` extension** even from `.ts` sources (NodeNext
  resolution): `import { createContext } from './context.js'`.
- Target `ES2022`, `moduleResolution: Bundler`, `isolatedModules`.
- Prefer named exports; packages expose a curated surface via the `exports` map
  (e.g. `@cmc/auth` exposes `.` and `./permissions`). Don't import deep paths
  that aren't in `exports`.

## Formatting (Prettier)

From `.prettierrc` — non-negotiable, enforced by Prettier:

- `semi: true`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`.

## Linting (ESLint flat config)

`eslint.config.js` is the source of truth. Highlights:

- Base: `@eslint/js` recommended + `typescript-eslint` recommended.
- **Unused vars are an error**, but `^_`-prefixed names are ignored (args, vars,
  caught errors). Prefix deliberately-unused bindings with `_`.
- `no-explicit-any` is a **warn**, not error — avoid `any`, but it won't block.
  Tighten over time.
- `no-unsafe-*` rules are **off** (they fire on legitimate tRPC procedure chains
  and Prisma patterns).
- Empty functions / catch blocks: **warn** (fire-and-forget patterns are common).
- React apps + `@cmc/ui`: `react-hooks/rules-of-hooks` is **error**,
  `exhaustive-deps` is **warn**; `react/prop-types` off (types come from TS),
  `react-in-jsx-scope` off (React 19 JSX transform).
- Not linted: `node_modules`, `dist`, `.next`, Prisma `generated/` and
  `migrations/`, `.claude/`, `scripts/`.

Run `pnpm lint` (Turbo fans out to each workspace's `eslint src`).

## File & naming conventions

- **Files: kebab-case** for `.ts`/`.tsx` (`student-provisioning.ts`,
  `parent-meeting-reminder.ts`, `data-table.tsx`).
- One feature per router file under `apps/api/src/routers/`; one cohesive concern
  per service under `services/`.
- Keep files focused (~200 LOC guideline); split by responsibility, not by size
  alone.
- Workspace package names are scoped `@cmc/*`; internal deps use
  `"workspace:*"`.

## API / tRPC conventions

- **Pick the right procedure builder** (`apps/api/src/trpc.ts`), never re-check
  auth by hand:
  - `publicProcedure` — unauthenticated (already wraps RLS→FORBIDDEN mapping).
  - `protectedProcedure` — any valid staff session.
  - `requirePermission(module, action)` — **preferred** for staff authorization;
    binds to the central registry in `@cmc/auth`. Use over `requireRole(...)`
    for all new/refactored procedures.
  - `superAdminProcedure`, `lmsProcedure`, `parentProcedure`, `studentProcedure`
    for the remaining audiences.
- **Authorize through the registry.** Add the role list in
  `packages/auth/src/permissions.ts` (`PERMISSIONS[router][procedure] = [...]`).
  No inheritance, no wildcards; `super_admin` bypasses upstream. Keep it
  browser-safe — **no `@cmc/db` import** in that file.
- **Validate input with Zod** at the procedure boundary; let typed DTOs flow
  inward.
- **Don't leak internals.** The tRPC `errorFormatter` already strips stack
  traces — don't re-add them. Error messages shown to users are in Vietnamese
  (e.g. `'Không có quyền trên tài nguyên này'`).
- **Heavy logic belongs in `domain-*`**, not in the router. Routers orchestrate;
  domains compute and own invariants.

## Database conventions

- Schema-first via Prisma (`packages/db/prisma/schema.prisma`). Every schema
  change ships a **migration** (`prisma migrate dev` locally → committed SQL).
- **RLS is part of the contract.** Tenancy isolation is enforced in Postgres, not
  just in app code. Run the verify scripts after touching policies:
  `tsx packages/db/src/verify-rls.ts` (and `verify-grading-rls`,
  `verify-notification-rls`).
- Code/uniqueness rules are facility-scoped — follow the existing migration
  patterns (e.g. student-code uniqueness per facility).
- Don't hand-edit generated Prisma client output.

## Frontend conventions

- React 19 + Mantine 7. Use `@cmc/ui` primitives (`data-table`, `page-header`,
  `stat-card`, `status-badge`, `empty-state`, `notify`, `validators`) before
  building new ones.
- Design tokens live in `packages/ui/src/tokens.css`; consume tokens rather than
  hard-coding colors/spacing. See [design-system.md](design-system.md).
- Icons from `@tabler/icons-react`. Dates via `dayjs`.
- The admin app is **one role-filtered shell** — gate panels by permission so
  non-entitled roles never hit a `FORBIDDEN`.

## Testing conventions

- **Unit:** Vitest, colocated/`__tests__` per package (`pnpm test`). Domain math
  must have unit coverage.
- **Integration:** `apps/api` runs `vitest --config vitest.integration.config.ts`
  against a real DB; these **lock invariants** (money, tenancy, payroll) and are
  expected to be mutation-proven, not happy-path only.
- **E2E:** Playwright specs in `apps/e2e` (`pnpm test:e2e`).
- Run the narrowest useful suite first; broaden when a shared contract changed.
  Don't weaken a test to make it pass.

## Commits & branches

- **Never commit to `main`** — it only takes reviewed PRs. Work on `develop` or a
  feature branch cut from it (see `AGENTS.md`).
- Conventional commits: `feat|fix|refactor|test|chore`, no AI references. Scope
  by area (`feat(email): …`, `fix(admin): …`).
- Don't put plan IDs / phase numbers / audit labels in commit messages, code
  comments, test names, or migration names — describe the behavior instead.
- Never commit secrets, `.env*`, tokens, or credentials.

## Secrets & config

- Config via environment variables; templates in `.env.example` /
  `.env.production.example`. Real `.env*` files are git-ignored.
- Production requires explicit `CORS_ORIGINS` — the server throws on boot if it's
  missing in `NODE_ENV=production`.

## Engineering principles

YAGNI → KISS → DRY, in that order. Change existing files over adding new ones;
introduce a new module only at a real boundary. Handle edge cases and errors
explicitly. Match the surrounding code's style, comment density, and naming.
