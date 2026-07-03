## Phase Implementation Report

### Executed Phase
- Phase: phase-04-lists-tables-kanban (batch 1 — 6 explicitly-named files)
- Plan: `D:\project\CMCnew\plans\260703-2351-erp-admin-reskin-core3`
- Status: completed (batch 1); batch 2 (~33 other list-style panels) intentionally deferred, not silently dropped

### Files Modified
- `apps/admin/src/crm-panel.tsx` (+40/-6 net vs stat: 40 lines touched)
  - `OppKanban`: column/card `radius="md"` (10px) → `radius="sm"` (8px, matches wireframe #12 `rounded-lg`). Count badge per column header already existed (`openCount` Badge) — kept as-is, no invention needed.
  - No "active/current-stage" left-accent state exists in current data model (no such concept in `Opp`/stage data) — did NOT invent one, per instruction to not force-fit undefined state.
  - Kanban card owner line: plain "Phụ trách: {name}" text → `InitialsAvatar` (18px) + name.
  - Kanban card closed-status: `StatusBadge` gained `pill` prop (tinted pill per wireframe #11/#12).
  - `DataTable` "owner" column: plain text → `InitialsAvatar` (22px) + name.
  - `DataTable` "status" column: `StatusBadge` gained `pill`.
  - `DataTable` "name" column (Học sinh/Liên hệ): plain text → `InitialsAvatar` + name (consistency with other person-name columns across the batch).
  - Drag-drop, stage-transition, filter/query, `createLead`/`trpc.*` mutation code: untouched (verified by diff grep for `.mutate(`/`trpc.`/`useEffect` — zero matches).
- `apps/admin/src/students-panel.tsx`
  - "Họ tên" column: plain text → `InitialsAvatar` (22px) + name.
  - Lifecycle `StatusBadge`: gained `pill`.
  - `DataTable` density: already defaulted to `compact` (no explicit prop existed or was needed — confirmed via `data-table.tsx` `density = 'compact'` default).
- `apps/admin/src/guardians-panel.tsx`
  - Guardian table "Phụ huynh" column: plain text → `InitialsAvatar` + name.
  - `LinkRequestQueue`'s `requestedBy.displayName`: added `InitialsAvatar`.
  - Two ad-hoc colored `Badge` (matched/unmatched student lookup state) → `StatusBadge` (`pill`, tone `active`/`inactive`) — this is exactly the "ad-hoc colored-dot+text status pattern" the phase spec calls out for replacement. Wrapped in `Box mt={4}` to preserve original spacing (StatusBadge has no margin prop).
  - "Quan hệ" (relation: father/mother/guardian) Badge left as raw `Badge` — it's a category/tag, not a status (no active/pending/rejected semantic fits), consistent with CRM's "stage" Badge treatment.
  - Uses raw `<Table>` (not `DataTable`) — no density prop exists there; left structural pattern as-is (already uses the same uppercase 11px header style as `--cmc-dt-header-*` tokens via local `TH_STYLE`).
- `apps/admin/src/finance-panel.tsx` (CAUTION file — verified zero touch to approve-flow logic)
  - Local `STATUS` map converted from `{label, color}` to `StatusDef` (`{label, tone}`): draft→draft, approved→active, sent→info, reconciled→active, cancelled→rejected.
  - Receipts table "Trạng thái" column: raw `<Badge color={st.color}>` → `StatusBadge ... pill`.
  - Receipts table "Học sinh" column: plain text → `InitialsAvatar` + name (skipped avatar for the `—` placeholder case).
  - Removed now-unused Mantine `Badge` import (only usage was the status cell).
  - Verified via `git diff | grep -iE "mutate|trpc\.|onApprove|skipApprove|confirmApprove|approve\(|Modal"` → **zero matches**. `approve`/`onApproveClick`/`skipApproveEmail`/`confirmApproveWithEmail` functions and the approve-email Modal are byte-for-byte unchanged.
  - `CoursePriceCard`, `VoucherCard`, `DiscountTierCard`, `ReceiptCreateCard` (all the other cards in this file): untouched — no status/owner columns in scope there.
- `apps/admin/src/contact-directory-panel.tsx`
  - "Liên hệ" column: plain text → `InitialsAvatar` + name.

### Not Modified (in-scope file, confirmed inapplicable)
- `apps/admin/src/student-management-panel.tsx` — read in full. It is a 35-line `Tabs` wrapper (Lớp học / Khóa học / Học bạ) delegating to `Workspace`, `CoursesPanel`, `AssessmentPanel`. It contains **no** `DataTable`/`<Table` usage directly — confirmed by grep before assuming any change. Skipped per the task's own instruction not to force-fit a change that doesn't apply. (Whichever of `Workspace`/`CoursesPanel`/`AssessmentPanel` render actual tables would be candidates for batch 2, not this file.)

### Shared file (`packages/ui/src/data-table.tsx`)
- **Not modified.** Confirmed `density` prop already exists (`'comfortable' | 'compact'`, defaults to `'compact'`) and all `--cmc-dt-*` tokens (row padding, header font/uppercase/letter-spacing, radius, hover/selected fills) already exist in `packages/ui/src/tokens.css` lines 151-161. No shared-file gap found — nothing to isolate/re-review.

### Tasks Completed
- [x] Grep `apps/admin/src` for `DataTable`/`<Table` usage — 39 files total found (list below).
- [x] `crm-panel.tsx` `OppKanban` card restyle (radius, owner avatar, status pill).
- [x] StatusBadge/InitialsAvatar/density polish applied to the 5 applicable named files.
- [x] `student-management-panel.tsx` correctly identified as out-of-scope and skipped.
- [x] Control-flow diff check (grep `if (`, `?.`, `.mutate(`, `trpc.`, `useEffect`) — zero logic changes confirmed across all 5 modified files.

### Tests Status
- Type check: **pass** (`pnpm -w typecheck`, all 12 packages, 24s, no errors)
- ESLint: **clean** (`eslint` on all 6 named files, zero warnings/errors)
- Unit tests: **pass** — `@cmc/admin test` 27/27 (4 files); `@cmc/ui test` 55/55 (5 files, incl. `data-table-utils.test.ts`, `theme.test.ts`, `avatar-initials.test.ts` all green, confirming no shared-primitive regression)
- Integration/Playwright: **not run** — no local dev stack was running in this session (no `pnpm --filter e2e reskin:capture` executed). This is a validation gap, flagged below.
- `gitnexus_detect_changes`: not available as a direct tool in this session context; substituted with `git status`/`git diff --stat` scoped to `apps/admin/src` + `packages/ui/src` — confirmed exactly the 5 expected files touched (`contact-directory-panel.tsx`, `crm-panel.tsx`, `finance-panel.tsx`, `guardians-panel.tsx`, `students-panel.tsx`), zero unexpected files, `packages/ui` diff-clean.

### Batch 1 vs Batch 2 scope note (per instructions)
The phase file's own "Files" section names "other list-style `*-panel.tsx`" as in-scope too. This execution was **explicitly scoped by the task prompt to the 6 named files only** as batch 1. Grep found **39 files** repo-wide using `DataTable`/`<Table`. The remaining ~33 (39 minus the 6 named, one of which — `student-management-panel.tsx` — turned out inapplicable) are an **intentionally deferred batch 2**, not silently dropped:

```
App.tsx, attendance-monthly-report-panel.tsx, attendance-report-panel.tsx,
attendance-roster.tsx, badge-panel.tsx, biz-director-cockpit-panel.tsx,
certificate-panel.tsx, checkin-panel.tsx, class-workspace.tsx,
compensation-panel.tsx, course-exercise-manager.tsx, courses-panel.tsx,
crm-director-dashboard.tsx, cskh-panel.tsx, design-showcase.tsx,
edu-director-cockpit-panel.tsx, email-outbox-panel.tsx, facility-network-panel.tsx,
grading.tsx, kpi-evaluation-panel.tsx, level-approval-panel.tsx,
my-payslips-panel.tsx, opportunity-detail.tsx, payroll-panel.tsx,
reconcile-worklist.tsx, revenue-report.tsx, rewards-panel.tsx,
schedule-detail.tsx, schedule-panel.tsx, session-evidence-panel.tsx,
shift-config-panel.tsx, shift-reg-detail-panel.tsx, shift-reg-list-panel.tsx,
staff-profile.tsx, student-detail.tsx, terms-panel.tsx
```

Highest-traffic candidates for a batch 2 pass (staff/schedule/payroll-adjacent, likely
daily-use screens): `payroll-panel.tsx`, `compensation-panel.tsx`, `schedule-panel.tsx`,
`staff-profile.tsx`, `checkin-panel.tsx`, `attendance-roster.tsx`,
`shift-reg-list-panel.tsx`, `facility-network-panel.tsx`. Note some of these (e.g.
`biz-director-cockpit-panel.tsx`, `crm-director-dashboard.tsx`, `revenue-report.tsx`) were
already owned by Phase 3 (dashboards/cockpits) — cross-check Phase 3's status before
batching to avoid double-touching.

### Issues Encountered
- No file ownership conflicts.
- `finance-panel.tsx` required extra care due to same-day approve-flow business logic; verified via targeted `git diff` grep that zero lines in `approve`/`onApproveClick`/`skipApproveEmail`/`confirmApproveWithEmail` or the approve-email `Modal` changed.
- Playwright visual spot-check was not performed (no live dev stack running this session) — recommend a follow-up visual pass against `#11`/`#12` wireframe crops before this phase is marked fully done in `plan.md`.

### Next Steps
- Human/code-reviewer visual diff pass (screenshot vs wireframe) recommended before commit, per plan's acceptance criteria ("typecheck passing is NOT sufficient proof for this presentation work").
- Batch 2 scoping decision needed from plan owner: continue with the ~33 remaining panels (dedupe against Phase 3/5/6 ownership first) or close Phase 4 as "batch 1 only, rest deferred to a new phase."

Status: DONE_WITH_CONCERNS
Summary: 5/6 named files restyled (StatusBadge pill + InitialsAvatar + kanban radius/owner polish), 1 correctly identified as inapplicable and skipped; typecheck/lint/unit-tests all green, zero business-logic diff verified in finance-panel.tsx's approve flow.
Concerns/Blockers: Playwright visual verification against wireframe screenshots was not performed (no live dev stack this session) — recommend before final sign-off. ~33 other list panels remain out of this batch's scope, listed above for a deliberate batch-2 decision.
