# Phase 2f — Global search backend

## Executed Phase
- Phase: phase-02-shared-components.md, sub-phase 2f (global search backend)
- Plan: `plans/260703-2351-erp-admin-reskin-core3`
- Status: completed (see Concerns for one deliberately-unresolved navigation gap)

## Files Modified
- `apps/api/src/routers/search.ts` (new, 141 lines) — `search.global` tRPC query.
- `apps/api/src/routers/index.ts` (+2 lines) — registers `search: searchRouter`.
- `apps/api/test/search-global.int.test.ts` (new, 7 tests) — integration coverage against real DB.
- `apps/admin/src/shell.tsx` (+188/-16 lines) — wires the existing search `TextInput` to the
  backend: debounce, grouped `Popover` dropdown, click-to-navigate.
- `plans/260703-2351-erp-admin-reskin-core3/phase-02-shared-components.md` — status note updated
  to cover 2f (previously said 2f was explicitly out of scope for the earlier pass).

## Tasks Completed
- [x] `search.global`: `{ q: string, facilityId?: number }` input, zod-validated, `q.length < 2`
  → empty groups (not a 400 — autosuggest-safe).
- [x] Students: name (`fullName contains, insensitive`) OR `studentCode` OR linked guardian's
  `ParentAccount.phone` (`guardians.some.parent.phone contains`).
- [x] CRM opportunities: linked `Contact.fullName`/`Contact.phone`.
- [x] Staff (`AppUser`): `displayName`/`email`, `isActive: true` only.
- [x] Class batches: `code`/`name`.
- [x] Facility-scoped via `withRls(rlsContextOf(ctx.session), ...)` — read the `withRls`
  implementation (`packages/db/src/index.ts:44`) first to confirm the GUC-based RLS mechanism;
  `facilityId` input is an optional narrowing filter layered on top of RLS, never a substitute.
- [x] Per-entity limit 5, no "see all" pagination (YAGNI, per spec).
- [x] `protectedProcedure` (no extra permission gate) — verified this is correct for staff search
  specifically by reading the `app_user_facility_roster` RLS policy migration
  (`20260623090000_app_user_facility_roster/migration.sql`): staff rows are already SELECT-scoped
  to co-facility rosters (or super_admin) at the Postgres level, so a global-search staff lookup
  exposes nothing a facility-scoped user couldn't already see via `user.list`. No permission
  ambiguity found — did not need to escalate.
- [x] Registered in `routers/index.ts`.
- [x] Frontend: 300ms debounce (`@mantine/hooks` `useDebouncedValue`, already a dependency — no
  new debounce utility invented), grouped `Popover` dropdown (`GlobalSearchDropdown`), opens on
  2+ chars.
- [x] Navigation on select: CRM opportunities → `useNavigate('/crm/opportunities/:oppId')`, the
  real existing deep-link route (confirmed in `app.tsx`, reused exactly). Students/staff/class
  batches → `onSectionChange` to the parent section (existing mechanism) — see Concerns for why
  full per-record deep-link isn't wired for these three.

## Tests Status
- Type check: pass (`pnpm -w typecheck`, 12/12 packages, cache-verified clean run).
- ESLint: clean on `apps/api/src/routers/search.ts`, `apps/api/src/routers/index.ts`,
  `apps/admin/src/shell.tsx`.
- Integration tests: `pnpm --filter @cmc/api exec vitest run test/search-global.int.test.ts` — 7/7
  pass against the live local dev Postgres (`localhost:5433`). Covers: sub-2-char → empty groups;
  student match by name/code/guardian-phone; RLS cross-facility isolation (facility-scoped caller
  never sees another facility's student); opportunity match by contact name/phone; staff match by
  name/email; class-batch match by code/name; unauthenticated caller rejected.
- Manual live-stack verification (most important step per the task): logged in via
  `POST /trpc/auth.login` as `admin@cmc.local` against the running dev API
  (`http://localhost:4000`), then called `search.global` with the session cookie:
  - `q=sale` → 5 real students (`Sale Student` seed rows, facilityId 1), 5 real staff
    (`Delegated Sale` rows) — limit-5 respected.
  - `q=Giáo` → 1 staff hit (`Giáo Viên` / `giaovien@cmc.local`) — confirms Postgres
    `mode: 'insensitive' contains` matches Vietnamese diacritics correctly.
  - `q=TEST-001` → exact studentCode match (`Nguyễn Thị Test`).
  - `q=x` (1 char) → `{students:[],opportunities:[],staff:[],classBatches:[]}`, no error.
  - No session cookie → `UNAUTHORIZED` (401), confirming `protectedProcedure` gate.
  - `pnpm --filter @cmc/admin test` (27/27) — no shell.tsx regression, nav-consistency suites
    unaffected.
- Did NOT open the admin app in a browser to click through the dropdown UI manually (no browser
  automation tool available in this session) — the curl-over-tRPC verification above exercises
  the exact same endpoint the frontend calls, and the frontend code compiles/lints clean, but a
  human/browser-driven click-test of the dropdown rendering itself was not performed.

## Issues Encountered
- The phase spec (and its embedding task prompt) claims "this admin app has NO URL router...
  it's SPA section-state navigation, not route-based." This is **factually wrong** — `app.tsx`
  uses `react-router-dom` (`Routes`/`Route`/`useNavigate`/`useParams`) with real paths including a
  per-record deep link `/crm/opportunities/:oppId` (`CrmPanel selectedOppId={oppId}`). I verified
  this by reading `app.tsx` directly rather than trusting the spec, and built navigation on the
  real mechanism (`useNavigate`) instead of inventing a fake "SPA state" approach the spec assumed
  didn't exist.
- GitNexus MCP tools (`gitnexus_impact`, `gitnexus_detect_changes`) were not present in this
  session's tool set despite CLAUDE.md mandating them before/after edits. Used `git diff --stat`
  as the closest available substitute to confirm scope (`apps/admin/src/shell.tsx`,
  `apps/api/src/routers/index.ts`, plus the two new files — nothing else touched). Flagging this
  tool-availability gap rather than silently skipping the self-check.

## Next Steps
- **Deliberately unresolved navigation gap (flagging per instructions, not resolving myself):**
  students, staff, and class batches lack a per-record deep-link route or externally-settable
  selection prop today — `students-panel.tsx` (`detailStudentId`), the staff/org panel, and
  `class-workspace.tsx` all hold selection as component-local state. Only CRM opportunities have
  the `selectedOppId` prop + route CRM got in an earlier phase. Right now, clicking a
  student/staff/class-batch search result takes the user to the correct *list* section, not the
  specific record — a real but partial UX gap. Fixing it requires adding a selection prop to
  those three panels and threading it from `app.tsx` (both outside this sub-phase's file
  ownership: `shell.tsx` + `apps/api/src/routers/search.ts` only). Recommend a small follow-up
  phase mirroring the CRM `selectedOppId` pattern for these three entities if deep-linking from
  search is a priority.
- No RLS/permission ambiguity to escalate — staff search via `protectedProcedure` was verified
  safe against the existing `app_user_facility_roster` RLS policy (see Tasks Completed above).

Status: DONE_WITH_CONCERNS
Summary: search.global backend is real, RLS-correct, tested (7 int tests + live-stack curl
verification), and wired into shell.tsx with debounce + grouped dropdown; CRM opportunity results
deep-link correctly, but students/staff/class-batch results only navigate to the parent list
section because those panels have no externally-settable per-record selection today (flagged as a
scoped follow-up, not silently worked around).
Concerns/Blockers: (1) student/staff/class-batch deep-link gap above, needs a follow-up phase
touching app.tsx + those panels; (2) GitNexus MCP tools unavailable this session, self-check done
via `git diff --stat` instead; (3) phase spec's "no URL router" claim was wrong — corrected by
reading app.tsx directly, worth fixing in the source doc so future agents aren't misled.
