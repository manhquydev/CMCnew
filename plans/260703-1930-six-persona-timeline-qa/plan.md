---
title: "6-persona timeline E2E QA + CI/CD dev/prod gap check"
description: "Agent-driven live QA walking the full student lifecycle across 6 personas in strict timeline order, plus a durable Playwright spec for the chained journey; separately answers whether main-only CI deploy is a gap."
status: pending
priority: P2
branch: feat/phase-d-facility-picker-and-stitch-wireframes
lane: normal
tags: [qa, e2e, testing, personas, cicd]
created: "2026-07-03"
---

## Part A — CI/CD gap check (RESOLVED, no implementation needed)

**Question:** is deploying straight to `main` → prod (no `develop` → dev split) a missed
implementation of `plans/260703-0052-dev-prod-cicd-environments/plan.md`?

**Answer: No.** Verified by reading the actual `Jenkinsfile` (not assumed) — confirmed only `main`
triggers Build+Deploy; `develop` has no deploy stage. This matches the CURRENT, INTENDED state:

- `plans/260703-0052-dev-prod-cicd-environments/plan.md` (status `pending`) already exists, is
  red-teamed + validated, and has `blockedBy: [260703-0022-devops-tier1-hardening]`.
- `260703-0022-devops-tier1-hardening` is `status: soaking`, started `2026-07-02T19:58:30Z`,
  requires 48h → deadline `2026-07-04T19:58:30Z`. As of this plan's reference time
  (`2026-07-03T12:25 UTC`), that's **~31.5h remaining** (corrected — an earlier draft of this
  section miscalculated ~7.5h; caught by red-team, see `plans/reports/code-reviewer-260703-1932-six-persona-timeline-qa-red-team-plan-review-report.md`).
- Reason for the block (documented in 0052's own plan.md): both plans independently edit the same
  4 files (`Jenkinsfile`, `docker-compose.prod.tls.yml`, `docker-compose.jenkins.yml`,
  `prod-server-deploy.sh`) — running them in parallel would collide.

**Action: none this round.** Do not start 0052's Phase 4 (Jenkins branch split) until 0022's soak
completes and its `status` field flips to `done`. Re-check after `2026-07-04T19:58:30Z`.

## Part B — 6-persona timeline E2E QA

### Overview

Comprehensive testing across the full student lifecycle, walked in strict chronological order (no
step-skipping) by 6 role personas, each gated on the previous persona's output — not a parallel
fan-out. Covers business logic AND UI, not just API correctness.

**Scope decision (defaults auto-selected after a 60s no-response window on the original
3-question clarification — explicitly flagged here for override before/during execution):**

| Decision | Selected | Why this default |
| --- | --- | --- |
| Test mode | Agent-driven live QA (browser automation) **+** selective Playwright spec encoding | Live QA surfaces real UI issues fastest; encoding the chained journey into a durable spec gives lasting CI value instead of a one-off report |
| Environment | Local dev stack (`docker-compose.dev.yml`, port 5433) | Fully isolated from live prod (`cmcnew-prod-postgres-1` has zero exposed host ports — verified via `docker port`); safe to run without risk to real business data |
| Story scope | Full lifecycle: Sale → lớp học → điểm danh → báo cáo | Exercises all 6 personas' real interaction points, matches how the existing 20 e2e specs already validate individual steps of this exact chain |

### Grounded journey script

Built from reading actual existing `apps/e2e/tests/*.spec.ts` test titles (not invented) — each
step below already has a validated individual-step spec; this plan CHAINS them into one continuous
cross-persona story sharing one seed dataset, which does not exist today.

| Step | Persona | Action | Grounded in |
| --- | --- | --- | --- |
| 0 | **Giám đốc Đào tạo (hoặc Admin)** | 1-click tạo lớp mới: chọn khung chương trình **đã chốt** (Course/CurriculumUnit catalog — program+level, hard-coded, không sửa được ở đây), điền config lớp: cơ sở/tên/ngày khai giảng/thứ+giờ/GV đứng lớp/phòng/sĩ số → hệ thống tự sinh buổi (`generateSessions`) map đúng unit theo `order_global` | `plans/260701-2246-curriculum-framework-oneclick-class/` (status `done`, P1-P6 shipped) — `classBatch.create` (accepts `slots[]`), `CreateClassModal` multi-slot wizard |
| 1 | **Sale** | Create O1 opportunity for a prospective student → pipeline | `admin-crm-opportunity.spec.ts` |
| 2 | **Sale** | Draft receipt from the opportunity, **explicitly binding it to the class created in Step 0** (`classBatchId`) | `admin-commission-chain.spec.ts` (verified: `receiptCreate`'s `classBatchId` is optional and the existing spec does NOT set it — this chain's Step 2 MUST set it, or Step 4's enrollment never happens) |
| 3 | **Giám đốc Kinh doanh** | Approve the receipt → opportunity auto-wins to O5 | `admin-commission-chain.spec.ts` |
| 4 | **Sale/Admin** | Receipt approve provisions the student + LMS login code + enrolls into Step 0's batch (verified: `finance.ts`'s `receiptApprove` only creates an `Enrollment` `if (receipt.classBatchId)` was set at Step 2 — this is a hard dependency, not automatic) | `admin-receipt-provision.spec.ts`, `apps/api/src/routers/finance.ts` (`receiptApprove`) |
| 5 | **Giáo viên** | Class session runs; teacher marks STUDENT class-session attendance | **NET-NEW, unvalidated path** — red-team confirmed `work-shift-attendance.spec.ts` tests staff clock-in (chấm công), NOT student attendance; no existing e2e spec covers this UI at all. Treat Step 5 as the plan's first real discovery risk, not a "re-chain of known-good steps." Real code: `attendance-panel.tsx` / `attendance-roster.tsx`, `apps/api/src/routers/attendance.ts` (`mark`) |
| 6 | **Giáo viên** | Publishes session photos/comments (session evidence) | `session-evidence-publish.spec.ts` |
| 7 | **Giáo viên/Admin** | Sets/confirms a parent-meeting schedule | `admin-meeting-set-schedule.spec.ts`, P6's `meetings-panel.tsx` |
| 8 | **Giám đốc Đào tạo** | Views monthly report drilldown (academic side) | `admin-monthly-report-drilldown.spec.ts` |
| 9 | **Giám đốc Kinh doanh** | Views CRM director dashboard (P4's new KPI/funnel/leaderboard) | `crm-director-dashboard.tsx` (P4, this session) |
| 10 | **Phụ huynh (PH)** | LMS: sees confirmed meeting time, session evidence (read-only), attendance history | `admin-meeting-set-schedule.spec.ts`, `session-evidence-publish.spec.ts`, `attendance-history-card.tsx` (P6, this session) |
| 11 | **Học sinh (HS)** | LMS: sees own session evidence + attendance, draws on exercise PDF | `lms-autosave-and-parent-readonly.spec.ts` |

This exercises every one of the 6 requested personas (sale, giáo viên, giám đốc kinh doanh, giám
đốc đào tạo, PH, HS) in one continuous timeline, and touches UI surfaces from BOTH this session's
P1-P7 rebuild (attendance report, meetings calendar, CRM dashboard, staff-profile) and pre-existing
flows — the two haven't been exercised together as one story before.

**Red-team correction applied (see `plans/reports/code-reviewer-260703-1932-six-persona-timeline-qa-red-team-plan-review-report.md`):**
the original draft claimed all steps were "re-chaining already-individually-tested steps" —
false for Step 5 (net-new UI path, zero prior test coverage) and Step 4→5 (wiring requires an
explicit `classBatchId` at receipt-creation time that no existing spec sets). Both fixed above.

### Seed data audit (reviewed, not guessed)

Read `packages/db/src/seed.ts`, `seed-demo.ts` directly rather than assuming:

| Need | Status | Source |
| --- | --- | --- |
| Sale account | ✅ exists | `seedFull`: `sale@cmc.local` |
| Giáo viên account | ✅ exists | `seedFull`: `giaovien@cmc.local` |
| Giám đốc Kinh doanh account | ✅ exists | `seedFull`: `quanly@cmc.local` / `bgd@cmc.local` (role `giam_doc_kinh_doanh`) |
| Giám đốc Đào tạo account | ✅ exists | `seedFull`: `headteacher@cmc.local` (role `giam_doc_dao_tao`) |
| Phụ huynh account | ✅ exists | `seedFull`: `parent@cmc.local`, linked via `Guardian` to `TEST-001` |
| Học sinh account | ✅ exists | `seedFull`: `StudentAccount` loginCode `TEST-001` |
| Curriculum content (bài học/chủ đề per level) | ✅ exists, git-tracked | `packages/db/prisma/seed-data/curriculum_units_seed.csv` (60 rows, UCREA program, committed `64bce29`) → `seed-curriculum.ts`'s `seedCurriculum()` upserts one `Course` per (program, level) + one `CurriculumUnit` per CSV row, idempotent. Run via `pnpm --filter @cmc/db seed:curriculum`. Confirmed present and wired — user recalled providing this file but wasn't sure where it landed; it was never lost, just not yet run as part of this plan's dependency chain (see Dependencies section). |
| Work-shift/ca system | ✅ exists | `seedWorkShift`: KINH_DOANH (3 ca) + GIAO_VIEN (3 ca) per facility |
| Priced course (for receipt flow) | ✅ exists | `seedFull`: course `CRS_10512_5483` + `CoursePrice` |
| "Khóa học đã chốt" — **CONFIRMED 2026-07-03 by user** | ✅ exists | = the `Course`/`CurriculumUnit` catalog (program+level+units+content, from `curriculum_units_seed.csv`), hard-coded and NOT editable at class-creation time. Directly confirmed against `plans/260701-2246-curriculum-framework-oneclick-class/plan.md` (status `done`): "Trường **khóa cứng**: program/level/units/số buổi/loại buổi/assessment/nội dung. **Cấu hình** [khi tạo lớp]: cơ sở/tên/ngày KG/thứ+giờ/GV/phòng/sĩ số." Matches user's own description exactly. Earlier `ClassStatus.running` guess was WRONG — struck out, not the right concept at all. |
| Existing enrollment tied to the new O1→O5→receipt chain | ❌ missing | `seedFull` enrolls the TEST-001 student into "first available class batch" — but Steps 1-4 of this journey create a NEW student via receipt-approve provisioning, which is a DIFFERENT student than `TEST-001`. The journey's own Step 4 output (new student + new enrollment) must feed Step 5-11, not the pre-seeded `TEST-001`. This is by design (the whole point is chaining), not a seed gap — flagging so the test script doesn't accidentally mix the two students. |

### Test mechanics

- **Sequencing**: strictly chronological, single shared dataset threaded through all 12 steps (Step 0-11) —
  NOT parallel persona fan-out. Step N's assertions gate whether Step N+1 proceeds (e.g. Step 5
  can't mark attendance until Step 4's receipt-approve has actually provisioned the student +
  enrolled them in a class).
- **Execution**: one live QA pass first (agent driving a real browser against the local dev stack
  via browser-automation MCP), capturing screenshots/console errors/UX issues per step. Findings
  reported before any spec-encoding work starts.
- **Encoding**: after the live pass confirms the chain works, encode it as ONE new Playwright spec
  (`apps/e2e/tests/persona-timeline-full-lifecycle.spec.ts`) reusing the existing `webServer`
  config — not touching the 20 existing specs.
- **UI + logic**: every step checks both the business-logic outcome (DB state via API response /
  visible UI text) AND the UI surface itself (does the right panel render, is the right nav item
  reachable, no raw error leaks) — matches the "không chỉ logic nghiệp vụ mà cả giao diện" requirement.
- **Data-accumulation note (red-team, minor)**: existing specs don't reset/truncate the dev DB —
  they rely on `Date.now()`-suffixed unique data on a persistent shared dev DB
  (`fullyParallel: false`, 1 worker). This plan's new spec follows the same convention; repeated
  runs will accumulate data over time. Not a correctness risk for this round, just an operational
  note for whoever maintains `apps/e2e/` long-term.

## Dependencies

- Depends on, in order: (1) local dev stack startup
  (`docker compose -f docker/docker-compose.dev.yml up -d`, currently NOT running — verified via
  `docker ps`), (2) `pnpm db:migrate` (red-team correction: the `cmc_app` DB role is created by a
  migration, not by the compose file itself — omitting this step fails `db:seed` on a fresh
  volume), (3) `pnpm db:seed` (`seedFull` mode), (4) `pnpm --filter @cmc/db seed:curriculum` (the
  `curriculum_units_seed.csv` the user asked about — confirmed present and git-tracked, just needs
  running like any other seed step; not previously in this plan's dependency list).
- Independent of: Part A's CI/CD soak wait (this is local-only, no deploy involved).

## Acceptance Criteria

- [x] Local dev Postgres (port 5433) running + `seedFull` + `seed:curriculum` applied, confirmed
      via direct DB query (owner role), not assumed.
- [x] "Khóa học đã chốt" definition confirmed with user directly — resolved, see Unresolved
      Questions #1.
- [ ] All 12 steps (Step 0-11) pass in strict sequence on a live browser session (agent-driven),
      each step's assertion gated on the PRIOR step's actual output (same student/class/receipt
      threaded through, not independently seeded per step).
- [ ] Each step verified for BOTH business-logic correctness AND UI correctness (right panel,
      right nav item, no raw error/enum leaks).
- [ ] New chained Playwright spec (`persona-timeline-full-lifecycle.spec.ts`) committed, passing
      locally.
- [ ] `pnpm -w typecheck` clean if any new spec/helper code is added.
- [ ] Mandatory `code-reviewer` subagent review of the new spec before commit.
- [ ] `gitnexus_detect_changes` confirms scope matches (only the new spec file + any seed fixture
      addition, no unrelated files).
- [ ] Findings report (live QA issues found, if any) written to `plans/reports/`.

## Unresolved Questions

1. ~~Exact meaning of "khoa hoc da chot"~~ **RESOLVED 2026-07-03, confirmed by user directly** = the
   `Course`/`CurriculumUnit` catalog (program+level+units+content, hard-coded from
   `curriculum_units_seed.csv`), selected but not editable at class-creation time — a class only
   fills in class-specific config (facility/name/start-date/day+time/teacher/room/capacity).
   Matches `plans/260701-2246-curriculum-framework-oneclick-class/plan.md` (status `done`)
   verbatim. Journey Step 0 (class creation via the shipped 1-click wizard) now encodes this
   correctly. Question #4 below (the `ClassStatus.running` tangent) was a wrong hypothesis.
2. User confirmed (before an interruption to point out the CSV question above): "Đúng, giữ nguyên"
   for all 3 original defaults (test mode = live QA + spec encoding; environment = local dev stack;
   story scope = full lifecycle). Treat these 3 as CONFIRMED, not defaults, from this point forward.
3. **(Red-team-found)** Step 5 risk — **resolved via recommended default (no response within 60s,
   applying documented default per this session's established pattern)**: test Step 5 in-place
   inside the 12-step chain (Step 0-11) (real context: student just provisioned via receipt, class already
   bound from Step 2) rather than an isolated pre-flight smoke pass. If Step 5 fails, the failure
   itself is informative (shows exactly what's missing/broken), and no extra setup time is spent
   building a throwaway isolated harness.

4. ~~Live DB inspection showed all seeded `ClassBatch` at HQ are `status: 'planned'` — is that
   what "khóa học đã chốt" means?~~ **WRONG HYPOTHESIS, struck 2026-07-03**: `ClassStatus` is an
   unrelated scheduling-lifecycle field; "khóa học đã chốt" is answered by Question #1 above
   instead. `status: 'planned'` batches are fine to use for this journey's Step 0 — planned is the
   default state right after 1-click creation, before the first session actually runs.

**Status: ALL questions resolved (2 confirmed by user directly, 1 resolved by investigation + user
confirmation, 1 applied via documented default) — plan ready for execution, no remaining open items.**
