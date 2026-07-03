# 7-Plan ERP UI rebuild (P1–P7) shipped autonomously; every plan caught real architectural gaps, not just styling

**Date**: 2026-07-03 18:49
**Severity**: High (shipped 7 sequenced framework changes totaling ~4000+ LOC across ui/admin/lms/api; no blocking issues post-commit)
**Component**: UI primitives, design tokens, admin/LMS reskins, CRM dashboard, staff profile, meetings/attendance, navigation
**Status**: Completed (all 7 plans committed on feat/phase-d-facility-picker-and-stitch-wireframes; PR deferred to user per original /goal loop instruction)

## What Happened

Seven sequenced ERP UI rebuild plans executed autonomously in a single /goal harness loop (Plan → Red-team → Implement → Review → Test → Audit → Fix per plan). All committed, zero blocking issues survived to merge.

**Commit sequence (41fef4a → e6bc66a)**:
1. P1 (41fef4a): Shadow-token remap to Zero Elevation doctrine (decorative shadows flattened, functional depth-cues preserved)
2. P2 (731f03b): `record-detail.tsx` generic primitive (parameterized detail-page component)
3. P3 (09aee0a): `calendar-view.tsx` primitive (hand-built week/month grid, no deps)
4. P4 (32f3e0b): CRM cockpit re-skin + director dashboard (4 KPI cards, funnel, leaderboard)
5. P7 (2cdb892): List/Kanban re-skin + profile/avatar menu + checkin nav fix (P7 landed before P5 due to parallelization)
6. P5 (11ae211): Staff profile migration onto record-detail primitive (first real primitive consumer, proved P2)
7. P6 (c8c7872): Meetings/attendance report migration + student attendance discoverability fix
8. Docs sync (e6bc66a): Plan status sync-back

## The Brutal Truth

This session was exhausting but **evidence-based at every step**. The dominant pattern that's worth recording: **EVERY SINGLE PLAN had at least one real, substantive architectural or scope gap caught by red-team or code review BEFORE or DURING implementation — not just style nits or typos.** This is not luck. It's what happens when you treat red-team as a trust boundary, not a rubber stamp.

Examples:

- **P3 phantom dependency** (red-team caught before implement): Plan claimed `packages/ui` could borrow `apps/admin`'s dayjs locale side effect to support Vietnamese week start (Monday). That's not inheritance; that's a phantom dependency. Locale must be self-contained in the package. Fixed by making `calendar-view.tsx` not depend on external locale config.

- **P4 scope gap** (red-team verified code-only, THEN implementation found hidden scope): Red-team confirmed "re-skin the CRM files" was a no-op — all 3 files already inherited P1's flat defaults, zero explicit overrides. Verification looked clean. **Then**, during implementation, finding #26 surfaced: the actual user need wasn't "keep the shipped CRM UI looking the same," it was "build a CRM director team-metrics dashboard" (4 KPI stat cards, 5-stage opportunity funnel, consultant leaderboard). The red-team caught the scope gap AFTER proving code-safety. Had to build a new component. Added 2.5h to P4's budget.

- **P5 architectural gaps** (red-team found real implementation blockers): Red-team of P2's already-shipped `record-detail.tsx` found 2 genuine architectural gaps in the primitive's interface:
  1. `RecordDetailHandle` exposes `busy`/`isDirty` as plain values via `ref.current.X` — but ref mutation doesn't trigger re-render in the holder. Caller-owned header buttons would show stale state.
  2. `staff-profile.tsx` auto-clears `primaryRole` when removed from `roles` — a cross-field side effect with no hook on `RecordDetailField` to express it.
  
  These weren't "nice-to-haves"; they were blockers to using the primitive as-is. Resolved by extending P2 with 3 backward-compatible additions: `RecordDetailHandle.data`, `RecordDetailPanelProps.onStateChange`, `RecordDetailField.onFieldChange` (decision 0032). **This is why P2 was unproven until P5 actually tried to use it — the red-team caught what static code review alone missed.**

- **P6 finding #11 DROPPED** (red-team caught stale persona-QA result): Original scope included "build new LMS parent-meeting screen." Red-team discovered `MeetingsCard` already exists in `apps/lms/src/parent-view.tsx` (lines 164-240, shipped in commit ce2c7ba), calling `trpc.parentMeeting.myMeetings.query()` and rendering upcoming/past meetings. The persona-QA complaint was factually already resolved. Dropped the redundant feature. **But:** implementation found a NEW gap the red-team missed — students had zero attendance visibility under the "Buổi học (ảnh & nhận xét)" tab (only session evidence photos/comments; `AttendanceHistoryCard` was missing). Fixed by extracting `AttendanceHistoryCard` from parent-view into shared LMS component, wired into student-view too. This was a real data-access bug hiding under a labeling problem, not just relabeled.

- **P5 delegation died mid-session** (operational lesson, not a code gap): P5 was originally delegated to a background agent. The agent died mid-session when the harness process was interrupted (not the agent's own failure — external interruption). On resume, rather than trusting a stale/unknown-state agent, the work was re-verified from scratch (checked actual file diffs, found zero progress had landed) and re-implemented directly in the main session. **Lesson: background agent death is silent.** Always verify actual file state before assuming partial progress. Don't blindly retry; start over if you can't trust the prior state.

## Technical Details

**P1 (41fef4a) — Shadow token remap**:
- 19+ edit locations across theme.ts, tokens.css, design-showcase.tsx, student-shell.tsx
- Red-team blast-radius correction: initial estimate was ~12; actual was ~19
- Decorative shadows (Card, Paper, Notification) → fully flat; functional shadows (Modal, Menu, Select, Drawer) → kept `--cmc-shadow-sm` minimum (user confirmed via decision #1)
- Review found 1 blocking issue: login-screen shadow accidentally touched (violates explicit exclusion). Fixed post-review, re-verified.
- 14/14 tests pass, typecheck clean, gitnexus scope confirmed

**P2 (731f03b) — record-detail primitive**:
- `packages/ui/src/record-detail.tsx`: 2-col label|value grid + Tabs + right-rail ActivityLog
- Parameterized: `fieldLabels`, `formatValue`, `tabs[]`, `sections[]`, `entityType`, permission callbacks
- Reference: `staff-profile.tsx` (pre-existing pattern)
- Interface initially incomplete (no reactive state, no cross-field hooks) — gaps only revealed when P5 tried to use it

**P3 (09aee0a) — calendar-view primitive**:
- Hand-built `packages/ui/src/calendar-view.tsx` (Mantine has no week/month view native)
- Week grid default (7-day columns, hour-of-day rows), month secondary (6-week x 7-day, overflow chips)
- Monday-first convention (VN), via configurable `weekStartDay` param
- Red-team: `attendance` dropped from first-consumer scope (Attendance has no scheduling field, one ClassSession has many rows; no 1:1 event mapping)

**P4 (32f3e0b) — CRM director cockpit**:
- `biz-director-cockpit-panel.tsx`, `crm-panel.tsx`, `opportunity-detail.tsx` re-skinned to P1 tokens
- No code changes needed (already inherited P1 defaults) — BUT finding #26's actual requirement was new: `CrmDirectorDashboardCard` built:
  - 4 KPI stat cards (open pipeline, new leads, conversion %, avg cycle + week-over-week delta)
  - 5-stage opportunity funnel (O1–O5 with cumulative conversion %)
  - Consultant leaderboard table
- 27/27 tests pass, typecheck clean

**P7 (2cdb892) — List/Kanban re-skin + profile/settings + checkin**:
- `data-table.tsx`, `view-switcher.tsx` re-skinned (no-op, already compliant)
- Finding #19: Avatar dropdown menu + profile/settings page built (new screen, not re-skin; `RecordDetailPanel` didn't fit, used plain Mantine form)
- Finding #12: Checkin relabeled for discoverability ("Chấm công" surfaced separately from "Lương & chấm công"). Appeared to be 1-line rename; actually required 5 coordinated edits (SectionKey union, SECTION_TITLES, NAV_GATES, renderContent switch, nav-consistency.test.ts)

**P5 (11ae211) — Staff profile migration**:
- Refactored `apps/admin/src/staff-profile.tsx` onto `record-detail.tsx`
- Zero visual/behavior change expected (re-implementation, not redesign)
- Extended P2 with 3 backward-compatible additions per decision 0032
- Implementation choices documented (isActive as two fields, roles/facilityIds keep pill-badge via `field.render`, EmploymentTab/PayrollTab wrapped in data-synced adapters, cancel remounts via `key` bump)
- 40/40 tests pass (ui), 12/12 packages typecheck clean, ESLint clean
- No jsdom/RTL infra for component-render tests (repo-wide gap, not introduced here)

**P6 (c8c7872) — Meetings/attendance report migration**:
- `meetings-panel.tsx`: Migrated `parentMeeting` onto `CalendarView` (P3). Synthesize 60-minute `end` (no native duration). Per-row actions moved into click-triggered modal (no inline-action slot on CalendarView)
- `attendance-report-panel.tsx`: Redesigned into StatCard KPIs + hand-built trend bar chart + facility-wide drill-down table
- Backend extended: `attendance.ts` `report` procedure added `scope: 'facility'` reusing existing `byMonth`/`ictMonthKey` pattern over trailing 6 calendar-month window
- Finding #32: "Buổi học (ảnh & nhận xét)" tab relabeled to "Điểm danh & buổi học"; students now have attendance visibility (extracted `AttendanceHistoryCard` into `apps/lms/src/attendance-history-card.tsx`, wired into both parent + student LMS shells)
- 27/27 tests pass (admin), typecheck clean across api/admin/ui/lms, ESLint clean

## What We Tried

Each plan followed the identical chain: **Plan → Red-team → Implement → Review(mandatory code-reviewer subagent) → Test → Audit(gitnexus_detect_changes) → Fix per plan**. No variant path, no shortcuts.

- Red-team reports identified: blast-radius undercounts, missing file references, scope gaps (P4 #26, P6 #11/#32), interface gaps (P2 reactive-state, P5 cross-field hooks), sequencing conflicts (P4↔P7), permission boundaries (P6 facility RLS).
- Code reviewer (subagent) catches: P1 login-shadow regression, P2/P3 import paths, P5 stale form state, P6 RLS boundary validation.
- Pre-commit audits (gitnexus_detect_changes): blast radius confirmed, no unexpected symbol changes, affected processes matched intent.

## Root Cause Analysis

**Why did every plan catch real gaps, not just style nits?**

1. **Red-team ran on plans BEFORE code existed** — not on diffs afterward. Caught conceptual/scope gaps (P4 missing #26 substance, P6 #11 already shipped) that code review alone can't detect.
2. **P2 went to production unproven** — first consumer (P5) had to validate it. That's when the reactive-state + cross-field-hook gaps surfaced. Should have built P5 in parallel with P2 and treated both as high-risk-lane (but that's a past-session decision).
3. **Persona-QA agent didn't individually verify findings** — finding #11 (no parent-meeting screen) was marked RESOLVED in production (commit ce2c7ba), but the agent's output didn't catch the contradiction. Good that red-team caught it.
4. **Phantom dependencies are easy to miss in code** — (P3 dayjs locale). Red-team reading the plan prose caught it; code review wouldn't (the code never calls the dependency, so there's no import to fail).

## Lessons Learned

1. **Red-team before code, not after. Scope gaps hide in plans; code review finds them too late.** P4's finding #26 (dashboard vs re-skin) and P6's finding #11 (already shipped) would have been mega-churn to fix post-commit. Catching them during red-team saved rework.

2. **Primitives are unproven until a real consumer uses them.** P2's interface looked complete until P5 tried to use it. The reactive-state + cross-field-hook gaps only surfaced in practice. This is why P5 was correctly flagged as high-risk lane — primitives deserve that scrutiny.

3. **Background agent death is silent; always verify actual file state.** P5's original delegation died mid-session. Rather than blindly retrying or assuming stale partial progress, the work was re-verified (git diff check: zero progress landed) and re-implemented. This added session time but prevented silent corruption.

4. **"Simple" cosmetic changes often hide coordinated edits.** P7's checkin relabel looked like a 1-line change; it was actually 5 coordinated file edits (union type, config object, permission guard, switch case, test). Never assume "just relabel" without tracing all the sites that reference the old key.

5. **Finding discovery is iterative, not comprehensive.** Persona-QA found #11 as "no parent-meeting screen." Red-team found it was already shipped (ce2c7ba). Implementation found finding #32 was the REAL gap (students had zero attendance visibility, not just a labeling problem). Trust evidence, not first-order surface complaints.

6. **RLS is the trust boundary, not app-layer filters.** P6's facility-wide attendance scope added an app-layer filter, but the real security was Postgres RLS (`withRls`/`rlsContextOf`). Caller can't escape that regardless of what `facilityId` they pass. Code reviewer explicitly verified this.

7. **Every plan going through the full chain (red-team + code review + audit) prevented any blocking issue from surviving to commit.** This is not fragile; it's the baseline. Don't skip any step.

## Next Steps

- [x] All 7 plans committed on feat/phase-d-facility-picker-and-stitch-wireframes
- [x] gitnexus_detect_changes confirmed scope match for all 7
- [x] No blocking issues post-commit across any plan
- [ ] PR NOT opened (deferred to user per original /goal loop instruction — autonomous agent does not merge to main autonomously)
- [ ] User manual verification on running admin/LMS app for P2, P5 UI-level migrations (jsdom/RTL test infra doesn't exist; manual proof is the acknowledged gate)
- [ ] Consider building P5/P6 as high-risk lane in future (both have tight data-access/permission dependencies)
- [ ] Add `_prisma_migrations` pre-flight check in Jenkinsfile post-merge (separate from this session, noted for completeness)

**Files modified across all 7 plans**: packages/ui (record-detail, calendar-view, data-table, view-switcher, theme, tokens), apps/admin (staff-profile, meetings-panel, crm-panel, opportunity-detail, biz-director-cockpit, attendance-report, profile-settings), apps/lms (student-shell, parent-view, attendance-history), apps/api (attendance router), docs/design-system, docs/decisions, docs/journals.
