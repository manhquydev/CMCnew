# Phase 4 — ESLint RLS-bypass guard

## Context links
- Report §"PLAN 7" item 4: `plans/reports/brainstorm-260702-1109-fullproject-completeness-p4-p7-report.md:46`
- Config: `eslint.config.js` (flat config; no `no-restricted-imports` today; ignores `scripts/**` at `:23`)
- Raw client source: `packages/db/src/index.ts:21` exports `prisma` singleton; `:4` re-exports `* from '@prisma/client'`
- Correct pattern: `withRls(ctx, tx => ...)` from `@cmc/db` (used across all `apps/api/src/routers/*`, e.g. `email-outbox.ts:132`)

## Overview
`packages/db` exports both the RLS-safe `withRls` and the raw `prisma` singleton (`index.ts:21`). Any app code that
imports `{ prisma }` from `@cmc/db` or `@prisma/client` directly bypasses row-level security. Today **no** `apps/api/src`
file does this (verified) — so this phase is a **regression guard** that locks in the good state, not a cleanup.

## Key Insights
- Verified current surface (grep across the full `apps/**` rule scope, not just API): the only non-`packages/db` raw
  importers are `apps/api/test/helpers.ts:2` (`import { prisma, withRls } from '@cmc/db'` — legit test harness) and
  `packages/db` seeds. `apps/api/src/**`, `apps/admin/src/**`, and `apps/lms/src/**` all = 0 raw prisma imports. The
  guard therefore starts green across every glob it covers.
- Two bypass vectors to forbid in app source: (1) `import ... from '@prisma/client'`, (2) named `prisma` from `@cmc/db`.
  `@typescript-eslint/no-restricted-imports` with `paths[].importNames: ['prisma']` catches the named-import vector while
  still allowing `withRls`, `Role`, `Prisma` types from the same module (DRY — one module, selective ban).
- **Whitelist = allow raw client only where RLS-bypass is intended:** `packages/db/**` (client construction, seeds) and
  `apps/api/test/**` (harness). Achieve this by scoping the rule to app source globs only, so test/ and packages/db are
  naturally excluded — no explicit override needed.

## Requirements
- New lint rule block scoped to app source (`apps/api/src/**/*.ts`, `apps/*/src/**/*.{ts,tsx}`) that errors on:
  - any import from `@prisma/client`
  - named import `prisma` from `@cmc/db`
- `withRls`, `Role`, and `type Prisma` from `@cmc/db` remain allowed.
- `packages/db/**`, `apps/api/test/**` unaffected (rule not applied there).
- Rule = `error`, so it blocks CI (P3 lint stage runs `pnpm -r lint`).

## Architecture
```
eslint.config.js
  └─ new config block  files: ['apps/api/src/**/*.ts', 'apps/{admin,lms}/src/**/*.{ts,tsx}']
       rules:
         '@typescript-eslint/no-restricted-imports': ['error', {
            paths: [
              { name: '@prisma/client', message: 'Use withRls from @cmc/db — raw prisma bypasses RLS.' },
              { name: '@cmc/db', importNames: ['prisma'], message: 'Import withRls, not the raw prisma singleton.' },
            ],
         }]
```

## Related code files
- MODIFY `eslint.config.js` — add the scoped `no-restricted-imports` block (append after existing blocks so it merges via flat-config ordering). Note: `apps/` currently holds only `admin`, `api`, `e2e`, `lms` (no `teaching` — retired into `admin`). Use `apps/{admin,lms}/src/**`, NOT `apps/{admin,teaching,lms}/src/**`. The existing stale `apps/teaching/src/**` glob at `eslint.config.js:74` matches zero files — trim it while touching the file rather than propagating the dead app name.

## Implementation Steps
1. Add the config block scoped to app source globs (exclude tests/packages by not matching them).
2. Confirm `@typescript-eslint/no-restricted-imports` is the right rule (the base ESLint `no-restricted-imports` is disabled when the TS variant is used; use the TS one to support `importNames` on type-aware imports).
3. Run `pnpm -r lint` → expect PASS (surface already clean).
4. Sanity check: temporarily add `import { prisma } from '@cmc/db'` into an `apps/api/src` file → lint errors; revert.

## Todo list
- [x] Add scoped no-restricted-imports block to eslint.config.js (also trimmed the stale retired `apps/teaching/src/**` glob)
- [x] pnpm -r lint passes (clean baseline; packages/ui's 3 pre-existing errors are unrelated no-unused-vars, confirmed via git-stash diff)
- [x] Negative test: raw prisma import in app src → error (verified, temp file removed)

## Success Criteria
- `pnpm -r lint` passes with the new rule (no existing violations).
- A newly introduced `@prisma/client` import or named `prisma` import in `apps/*/src` fails lint.
- `apps/api/test/helpers.ts` and `packages/db` seeds still lint clean.

## Risk Assessment
- **Over-broad glob catching tests (LOW×MED):** if the glob accidentally includes `apps/api/test/**`, `helpers.ts:2` breaks. Mitigation: scope to `apps/api/src/**` (not `apps/api/**`); verify with step 3.
- **Rule name mismatch (LOW×LOW):** using base vs TS-eslint variant. Mitigation: step 2 confirmation; flat config already loads `typescript-eslint`.
- **Future legit bypass (LOW):** if a real bypass is ever needed, use a scoped `eslint-disable-next-line` with justification — visible in review rather than silent.

## Security Considerations
- This IS the security control: prevents silent RLS bypass that would expose cross-facility PII/financials. Aligns with the RLS threat model (teacher/guardian isolation enforced at DB row level).

## Next steps
- Guard is preventative; combined with P3 it becomes CI-enforced on every PR. No runtime change, no migration.
