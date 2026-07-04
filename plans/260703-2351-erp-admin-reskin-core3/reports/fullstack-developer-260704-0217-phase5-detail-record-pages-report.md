# Phase 5 — Detail/record pages restyle

Date: 2026-07-04
Plan: `plans/260703-2351-erp-admin-reskin-core3/phase-05-detail-record-pages.md`

## Scope executed

Styling-only restyle of the shared `record-detail.tsx` primitive plus 5 consumer panels, per
the Core 3 wireframe (`template_chi_ti_t_b_n_ghi_erp_vietnamese_core`, `h_s_nh_n_vi_n`,
`b_n_m_u_chi_ti_t_..._2_c_t`). Zero data/handler/tabs-logic changes.

## GitNexus impact analysis — not available this session

No `gitnexus_*` MCP tools were present in this session's tool list (only the standard
Glob/Grep/Read/Edit/Write/Bash/WebFetch/WebSearch/Agent/SendMessage set was available), so I
could not run `gitnexus_impact`/`gitnexus_detect_changes` as CLAUDE.md/AGENTS.md mandate.
Substituted with manual analysis:

- `Grep` for `RecordDetailPanel` usage across `apps/admin/src` found exactly **one** real
  consumer: `staff-profile.tsx` (the `profile-settings-panel.tsx` hit was a comment reference
  only — that panel is explicitly bespoke, not `RecordDetailPanel`-based, per its own header
  comment). Blast radius from restyling the primitive is therefore low (1 consumer), not the
  "several panels" the plan anticipated.
- `record-detail.test.ts` only exercises the primitive's pure helper functions
  (`resolveOptions`, `displayValue`, `getValidationError`, `applyFieldChange`) — no
  component-render assertions exist in this package (`packages/ui/vitest.config.ts` scope), so
  no structural lock was at risk from styling changes. Confirmed green before and after.
- `git status`/`git diff` used as a `detect_changes` substitute — diff is scoped to exactly the
  6 target files (plus pre-existing unrelated `AGENTS.md`/`CLAUDE.md`/`flow/.lock` changes
  already present before this task started, not touched by me).

**Flag for the user**: if `gitnexus_impact`/`gitnexus_detect_changes` are expected to run every
session per CLAUDE.md, the MCP server may not be registered in this environment/session — worth
checking `claude mcp list` or the harness MCP config outside this task.

## Files modified

- `packages/ui/src/record-detail.tsx` (+77/-30 lines net)
  - Read-mode field row: label column now `width/minWidth: var(--cmc-form-label-w)` (160px),
    right-aligned, `var(--cmc-form-label-font)`/`var(--cmc-form-label-color)`, value left-aligned
    in the remaining flex space (was `justify="space-between"` pushing the value fully right —
    matches the wireframe's `form-label` CSS class + `flex items-center` row exactly).
  - `Fieldset legend` is now a `ReactNode`: a 4×20px `var(--cmc-brand)` accent bar + the section
    title at `var(--cmc-form-group-title)`, matching the wireframe's `w-1 h-5 bg-primary` pattern.
  - Card radius ≤8px: confirmed no explicit radius override existed in this file — `Fieldset`
    doesn't carry a Card surface, and the theme's `Card` default (`radius: 'sm'` = 8px, see
    `theme.ts:139`) already satisfies the requirement. No change needed there.
  - Right rail: replaced the `Grid`/`Grid.Col` 8/4 split with a `display:flex; flexWrap:wrap`
    layout — main content `flex: 1 1 480px`, rail `flex: 0 1 var(--cmc-chatter-w); width:
    var(--cmc-chatter-w)` (340px), `position: sticky; top: 12`. `flex-wrap` gives a natural
    single-column fallback on narrow viewports without needing a media query. Dropped the now-
    unused `Grid` import.
  - `record-detail.test.ts` untouched — no assertion needed changing (pure-function tests only).

- `apps/admin/src/staff-profile.tsx` (+40 lines, additive only)
  - No pre-existing avatar to "swap" — added a new header `Card` (128px `InitialsAvatar`, green
    `var(--cmc-status-active)` dot overlay gated on `view.isActive` — reusing the existing
    `isActive` concept already driving the "Ngừng" badge, not inventing a new one) placed between
    the header actions and `RecordDetailPanel`. Role badges rendered via `StatusBadge` with
    `pill tone="info"`. Purely additive JSX block — no state, handlers, or `RecordDetailConfig`
    touched.

- `apps/admin/src/student-detail.tsx` (hand-rolled, not a `RecordDetailPanel` consumer)
  - Added local `Field`/`SectionHeading` helpers mirroring the primitive's new conventions;
    replaced `InfoTab`'s ad-hoc `Group`+`Text w={130}` rows with `Field`, and the "Tài khoản LMS"
    `Title` with `SectionHeading`. Fixed 5× table-wrapper `Card radius="md"` (10px) → `radius="sm"`
    (8px) across `GuardiansTab`/`EnrollmentsTab`/`OpportunitiesTab`/`ReceiptsTab`/`GradesTab`.

- `apps/admin/src/opportunity-detail.tsx` (hand-rolled — **caution zone**, see below)
  - Updated its existing `Field` helper to the 160px right-aligned label convention; added a
    local `SectionHeading`; applied it to the "Thông tin liên hệ"/"Phân bổ & nguồn"/"Phiếu thu
    của tôi" card headers (all outside any Modal); fixed `Card radius="md"`→`"sm"` on those 3
    cards plus the stage-bar card, bumped their padding `p="md"`→`p="lg"`.
  - **Explicitly left untouched**: the receipt-create `Modal` (its `Select`/`TextInput` fields,
    `receiptClassBatchId`/`classBatches` state, `createOpportunityReceipt`) — confirmed via
    `git diff | grep receiptClassBatchId|classBatches|Modal` returning no hits in that region.
    I did not attempt any record-shell restyling inside that Modal at all (Modal forms don't use
    the record-shell label pattern anyway, so nothing was skipped that the wireframe requires).

- `apps/admin/src/schedule-detail.tsx` (hand-rolled)
  - Same `Field` convention update; added an inline-composable `HeadingAccent` (a bare accent-bar
    span, since several headings here share a row with a badge/button and can't use a full
    block-level `SectionHeading`). Applied to "Quy trình buổi học 360", the class-card title,
    "Học viên trong buổi", "Điểm danh". Fixed `radius="md"`/`radius="lg"` → `"sm"` on 4 cards,
    bumped `WorkflowCard` padding `p="md"`→`p="lg"`.

- `apps/admin/src/profile-settings-panel.tsx` (hand-rolled — best visual match for the
  `h_s_nh_n_vi_n` wireframe crop, alongside `staff-profile.tsx`)
  - `SectionCard` gained the accent-bar heading + `radius="sm"`; added the `Field` label
    convention; added a header `InitialsAvatar` (64px, self-profile context — no isActive/online
    concept exists for the caller's own session, so no status dot); role `Badge`→`StatusBadge
    pill`. Did not touch the `Switch`/`toggleNotif` state or handlers, or the SSO/logout `Button`
    logic.

## Validation

- `pnpm --filter @cmc/ui test` — 5 files, 55 tests pass (`record-detail.test.ts`: 15/15 green,
  unchanged assertions).
- `pnpm -w typecheck` — 12/12 packages pass (including `@cmc/admin`, `@cmc/ui`, `@cmc/lms`).
- `pnpm --filter @cmc/admin test` — 4 files, 27 tests pass.
- `pnpm --filter @cmc/ui lint` / `pnpm --filter @cmc/admin lint` — 0 errors (1 pre-existing
  `react-hooks/exhaustive-deps` warning in `course-exercise-manager.tsx`, unrelated file, not
  touched this phase).
- Dev stack reachability: `curl http://localhost:5173` → 200, confirmed reachable, but no
  Playwright/screenshot tooling was available in this session's tool list to capture visual
  captures against the wireframe crops — skipped per tool availability, not by choice.
- `git status --short` scoped to exactly the 6 target files (plus pre-existing unrelated
  `AGENTS.md`/`CLAUDE.md`/`flow/.lock` changes already present before this task).

## Deviations from the plan worth flagging

1. **GitNexus tools unavailable** (see above) — used grep-based impact analysis instead.
2. **`RecordDetailPanel` blast radius is 1 consumer, not "several panels"** — the plan's
   phase-05 context note said "several panels consume it"; only `staff-profile.tsx` actually
   does. `student-detail`/`opportunity-detail`/`schedule-detail`/`profile-settings-panel` are
   all hand-rolled per their own code comments, and were restyled by applying the same
   label/heading/radius conventions directly (as the plan itself anticipated as the fallback:
   "if it's hand-rolled, apply the same conventions directly").
3. **No screenshot/visual capture done** — no browser-automation tool was in this session's
   available tool set; dev stack reachability was confirmed via `curl` only.
4. **staff-profile.tsx had no pre-existing avatar** — the task said "swap the avatar," but there
   wasn't one; added a new additive header card instead of modifying an existing element.

## Unresolved questions

- None blocking. If GitNexus MCP tools should have been available, worth checking why they
  weren't registered for this task.

Status: DONE_WITH_CONCERNS
Summary: Primitive + 5 panels restyled to Core 3 record-shell conventions (160px labels, accent-bar headings, ≤8px radius, 340px sticky rail); all tests/typecheck/lint green; opportunity-detail.tsx's receipt-create Modal and its finance-flow state left fully untouched.
Concerns/Blockers: GitNexus MCP tools weren't in this session's tool list (used manual grep-based impact analysis instead); no visual/screenshot capture done (no browser tool available) — recommend a follow-up visual QA pass against the wireframe crops before merge.
