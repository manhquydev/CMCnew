# Phase 03 completion — upload RBAC gate + delete dead PdfViewer

## Files changed
- `apps/api/src/index.ts`:
  - Added `can(session.roles, session.isSuperAdmin, 'exercise', 'upsert')` 403 gate to `POST /upload/exercise-pdf`, placed before `c.req.arrayBuffer()` (fail-fast, no body read for unauthorized callers). Updated the stale comment (which documented the old "worksheet less sensitive than photo" stance) to state the new invariant: upload authority mirrors exercise-write authority.
  - Exported `app` (`const app = new Hono()` → `export const app = new Hono()`) and guarded `serve({ fetch: app.fetch, port })` behind `process.env.NODE_ENV !== 'test'`. This was necessary to make the route testable: no existing test in the repo imports `index.ts` (all use the tRPC `appRouter` caller directly), and `index.ts` has a top-level `serve()` side effect that would bind a real port on import. Vitest sets `NODE_ENV=test` by default, so this guard is inert in prod/dev and only skips the listener under the test runner — same pattern as the existing `DISABLE_CRON` guard a few lines below.
- `packages/ui/src/index.tsx`: removed `export { PdfViewer } from './pdf-viewer.js';`
- `packages/ui/src/pdf-viewer.tsx`: deleted (dead, superseded by `PdfAnnotator`)
- `apps/api/test/upload-exercise-pdf-rbac.int.test.ts` (new): 3 cases — sale role 403s, `giam_doc_dao_tao` director 200s with a valid PDF ref, unauthenticated request 401s before any RBAC check.

## Confirmed exercise.upsert role tuple
`packages/auth/src/permissions.ts:69-71`:
```ts
exercise: {
  upsert: ['giam_doc_kinh_doanh', 'giam_doc_dao_tao'],
},
```
Matches the plan's cached assumption — no drift.

## PdfViewer grep confirmation
```
Grep pattern: PdfViewer|pdf-viewer   path: D:\project\CMCnew   glob: !{node_modules}/**
```
Zero code matches. Remaining matches (6 files) are: 2 plan `.md` docs (this plan + an older UI-hardening plan, historical record) and 3 test-file *comments* in `apps/admin/src/__tests__/nav-*-consolidation.test.ts` explaining a `DOMMatrix` stub workaround for `shell.tsx`'s transitive `@cmc/ui` import. Those comments are now slightly stale in wording (they say "pdf-viewer" specifically) but the workaround itself is still required and correct: `shell.tsx` imports `@cmc/ui`, whose barrel still exports `PdfAnnotator` (`pdf-annotator.tsx`), which also imports `pdfjs-dist` and needs the same `DOMMatrix` stub. Those test files are outside this phase's file-ownership list, so left untouched — flagging for whoever next touches them.

## Test command + result
```
cd apps/api && pnpm exec vitest run --config vitest.integration.config.ts test/upload-exercise-pdf-rbac.int.test.ts
```
```
✓ test/upload-exercise-pdf-rbac.int.test.ts (3 tests) 693ms
Test Files  1 passed (1)
     Tests  3 passed (3)
```

## Typecheck
- `pnpm --filter @cmc/api typecheck` → **pass**, clean.
- `pnpm --filter @cmc/ui typecheck` → **fails**, but the failure (`src/pdf-annotator.tsx(419,37): error TS2554: Expected 3 arguments, but got 2.`) is in a file I did not touch. `git diff --stat` confirms `packages/ui/src/pdf-annotator.tsx` (+197/-24), `apps/api/src/services/pdf-store.ts` (+118/-13), and `apps/api/package.json` (+1) are modified by a parallel in-progress workstream (Plan 2 P5 annotator UX / P4 blob store per the team task list), not by this phase. My own edits (`index.ts`, `packages/ui/src/index.tsx`, deletion of `pdf-viewer.tsx`) introduce no type errors.

## Scope check
No files outside the assigned ownership were modified. `apps/api/src/routers/submission.ts` and `apps/lms/src/student-view.tsx` untouched, as instructed.

Status: DONE_WITH_CONCERNS
Summary: RBAC gate added and verified with a passing 3-case integration test (403/200/401); dead PdfViewer deleted with zero remaining code references. `@cmc/api` typecheck is clean; `@cmc/ui` typecheck fails but solely due to a concurrent parallel workstream's edits to `pdf-annotator.tsx`, unrelated to this phase's changes.
Concerns/Blockers: `@cmc/ui` typecheck won't be fully green until the parallel P4/P5 workstreams land their own fixes to `pdf-annotator.tsx` / `pdf-store.ts` — orchestrator should re-run `pnpm --filter @cmc/ui typecheck` once those merge. Also flagging (not fixing, out of scope): the `DOMMatrix` workaround comment in the 3 `nav-*-consolidation.test.ts` files now says "pdf-viewer" but should say "pdf-annotator" for accuracy — cosmetic, no functional impact.
