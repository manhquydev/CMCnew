# Business Completeness Gap Analysis — CMC core vs mature ERP/LMS

Date: 2026-06-26 · Mode: read-only advisory · Inputs: `plans/reports/xia_analysis/01..10` (already contain OpenEduCat/Odoo comparisons) + verification against `packages/db/prisma/schema.prisma` and `apps/api/src/routers/*.ts`.

## TL;DR

CMC's *engine* is not thin — grading blend, finance receipt, star ledger, payroll, RLS are genuinely stronger than OpenEduCat/Odoo equivalents (the xia docs say so repeatedly). What makes the system feel "sơ sài" is **missing connective tissue and operator-facing surface**, not missing core math:

1. **Records are still created by hand and can orphan** — the locked "provision student only at `receipt.approve`" rule is *not yet built* (receipt requires an existing `studentId`; `student.create` still live). This is the single biggest correctness gap.
2. **No activity timeline / chatter UI** — `RecordEvent` audit data exists but is never surfaced as a history sidebar, and there is no follow-up task model (`RecordActivity`). Odoo's chatter is the thing that makes its CRM/student screens feel "alive".
3. **Two latent scaling/integrity bugs in scheduling** — session conflict query loads the whole facility's history; `roomId`/`teacherId` have no FK.
4. **Config that should be data is still code** — program grading weights hardcoded; no term lock; insurance manual.

The fix is mostly *wiring + a few migrations*, not a rewrite. Most of the heavy OpenEduCat/Odoo machinery (subject/prerequisite trees, double-entry ledger, resource.calendar, Python rule engine, generic goal-definition engine) would be over-engineering for a 3–11yo tutoring center and the xia docs agree — do **not** port those.

---

## Locked decisions honored (do not contradict)

- (a) Student created only at `receipt.approve`, dedupe by **parent phone**; `student.create` removed from UI.
- (b) ERP unifies admin + teaching into one role-filtered app.
- (c) Final grade by **term**; caps are warnings only; retention config exists.

All P0/P1 items below are built to converge on these, not around them.

---

## Master gap table

Priority: P0 = needed to make core not-sơ-sài / fixes a real correctness or data-integrity hole · P1 = meaningful enrichment, mostly wiring/config · P2 = later / scaling / nice-to-have. Effort: S ≤ ~1d, M ~2–4d, L > ~1wk.

### Domain 1 — Academic / Course (doc 01)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| Flat global `Course` + `Program` enum; `LevelProgress` approval workflow | `Student.level` / `toLevel` are free-text — typo risk | OpenEduCat seeds level/grade values; here just seed an allowed-level list per program/`GradingTemplate.level` | P1 | S |
| No course sections/modules | Sectioning of exercises/sessions | Odoo `slide.slide is_category` lightweight — add a `topic` text field only if needed | P2 | S |
| No prerequisites | Enrollment gating by prior level | OpenEduCat `op_subject_rel` — **skip** (over-engineering; manual `LevelProgress` is the differentiator) | P2 | — |

### Domain 2 — Student / Enrollment (doc 02) and 6 — CRM/Admission (doc 06)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| `receipt.create` requires existing `studentId`; `student.create` still exposed (`student.ts:17`, role quan_ly/sale); no provisioning inside `finance.ts` approve (verified: no student/enrollment/guardian creation in `receipt.approve`, `finance.ts:228–284`) | **Atomic provisioning not implemented** → orphaned `admitted` students possible; contradicts locked decision (a) | OpenEduCat `enroll_student()` atomic at admission `done` → adapt to `receipt.approve`: create Student+Enrollment+link Guardian, dedupe by parent phone | **P0** | M |
| `student.create` mutation live in UI/router | Should be internal-only (seeds/migration) | Odoo blocks direct partner-as-student creation | **P0** | S |
| Guardian captured late (roles bgd/quan_ly) | Capture parent (name/phone/email/relation) at lead intake; auto-create Guardian at provisioning | Odoo unified `res.partner` at intake; allow `Role.sale` on `guardianRouter.parentCreate` | P1 | M |
| `RecordEvent` audit exists, never shown | **No chatter/history sidebar** in Opportunity & Student detail | Odoo `mail.thread` timeline — expose `getTimeline` as a sidebar | P1 | M |
| No defined rollback when an approved receipt that provisioned a student is cancelled | Lifecycle revert / soft-delete rule | Odoo restore semantics — decide + implement (revert to `admitted` or void) | P1 | S |

### Domain 3 — Classroom / Scheduling (doc 03)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| `generateSessions` conflict query loads **all** non-cancelled facility sessions (verified `schedule.ts:151–153`, no date filter) | Memory/CPU blowup as history grows (50k+ sessions) | OpenEduCat filters by date range — add `sessionDate` gte/lte bound | **P0** | S |
| `ClassSession.roomId/teacherId` are raw `String?`, no FK (verified `schema.prisma:269–288`); same on `ScheduleSlot` | Dangling refs if room/teacher deleted | PostgreSQL FK `onDelete: Restrict` to `Room`/`AppUser` | **P0** | S–M (migration) |
| `detectConflicts` checks room+teacher only | No same-batch partial-overlap check; no room-capacity check | OpenEduCat capacity + batch overlap constraints — add `'batch'` conflict kind; capacity as **warning** (per locked (c) spirit) | P1 | S |
| Read-committed, no row locks | Concurrent double-booking possible | `pg_advisory_xact_lock` / `SELECT FOR UPDATE` on room+teacher during generation | P2 | S |

### Domain 4 — Grading / Assessment (doc 04)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| Program weights (UCREA 100/0, BRIGHT_IG 60/40, BLACK_HOLE 30/70) hardcoded in `programWeights`; `GradingTemplate` has `formula`/`criteria` JSON only (verified `schema.prisma:736–750`) | Admin cannot tune blend without code deploy | OpenEduCat DB-configurable grade scales — add `qualitativeWeight`/`quantitativeWeight` cols to `GradingTemplate` | P1 | S–M |
| No `isLocked` on `AcademicTerm`/`FinalGrade` (verified `schema.prisma:817–831`) | Teacher can edit `Grade` after report card published | Exam/marksheet finalize-lock — add `isLocked` + guard | P1 | S |
| `computeFinalGrade` manual mutation only (`assessment.ts:144`) | Parent dashboard stale until teacher recomputes | Odoo cron refresh — optional nightly recompute (cron infra already exists: parent-meeting, email-outbox) | P2 | S |
| Required parent-meeting cadence (UCREA 5/mo, others 3/mo) not enforced | Completeness warning | Add `requiredMeetingsCount` to template/term as a soft check | P2 | S |

### Domain 5 — Gamification / Rewards (doc 05)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| `badge.ts:104` manual grant bypasses criteria, no quota | Badge inflation by teachers | Odoo `remaining_monthly_sending` — add monthly per-teacher grant quota | P1 | S |
| Criteria JSON only `stars_total`/`homework_count` | Can't express streaks/attendance | Keep JSON but standardize schema (`attendance_streak_count`) | P2 | S |
| Leaderboard computed live (fine at 10–30 roster) | Caching only if rosters scale | Odoo cron-persisted ranks / Redis — **defer** | P2 | — |

Note: star ledger, advisory-lock redemption, anonymized leaderboard are already best-in-class — keep.

### Domain 7 — Financial / Receipts (doc 07)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| Single-table cash-basis `Receipt`; frozen commission at approve; atomic voucher/seq via advisory locks | Core is strong — only the provisioning hook is missing (see Domain 2 P0) | — | (P0 via Domain 2) | — |
| No GL export | Future corporate accounting | Odoo `account.move` — **defer**; periodic export cron if ever needed, not a refactor | P2 | — |

### Domain 8/9 — Employee / Payroll / Commission (docs 08, 09)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| `insuranceDeduction` manual input (verified `payroll.ts`) | BHXH not parameterized | Odoo DED rules — add VN insurance rates + 20× cap to `CompensationPolicy`; auto-compute | P2 | M |
| Manager (tpkd/gdtt) rollup commission placeholder only | Team quota roll-ups | Odoo subscription/CRM rollups — traverse center org; **defer to v2** | P2 | L |
| `CompensationPolicy.params` JSON edits unlogged | Audit trail on policy change | Log full JSON diff on update | P1 | S |
| Source records not frozen at payslip finalize | Retroactive drift if receipt/KPI changes post-finalize | Odoo validation lock — flag source rows frozen when payslip `finalized`/`paid` | P1 | M |

Keep: pure-TS calc engine, effective-dated rates, PIT brackets, cash-collected commission — all verified superior to Odoo's Python `safe_eval` engine. Do **not** port the rule engine.

### Domain 10 — Notification / Chatter (doc 10)

| CMC current | Gap (missing/thin) | Reference pattern | Priority | Effort |
|---|---|---|---|---|
| `RecordFollower` exists; `getFollowers` only read via `audit.ts:53`; `logEvent` does **not** dispatch to followers | Following a record does nothing | Odoo `mail.followers` → notification fan-out — bridge `logEvent` → resolve followers → `/sse/staff` | P1 | M |
| No `RecordActivity` model (verified: none in schema/api) | No follow-up tasks (call parent, review student) | Odoo `mail.activity` — add `RecordActivity` (assignee, dueDate, summary, status) | P1 | M |
| No read/unread per-event state | No staff inbox unread count | Odoo `mail.notification` — add read flag when inbox is built | P2 | S |
| SSE backed by in-memory `EventEmitter` | Breaks on multi-instance | Redis Pub/Sub or PG LISTEN/NOTIFY — **defer until horizontally scaled** | P2 | M |

---

## Recommended phasing

### P0 wave — "stop the bleeding, close the loop" (the minimum to not be sơ-sài)
Coherent because it makes record creation trustworthy and removes two latent bugs. ~1 sprint.
1. Atomic provisioning at `receipt.approve`: create Student+Enrollment+link Guardian, dedupe by parent phone (Domain 2/6). **M**
2. Demote `student.create` to internal/seed-only; remove from UI (Domain 2). **S**
3. Schedule conflict query date-range filter (Domain 3). **S**
4. Add `Room`/`AppUser` FKs to `ClassSession` + `ScheduleSlot` (Domain 3). **S–M, one migration**

Net effect: no orphan students, financial gate is the single source of truth (aligns locked (a)), scheduling stops being a time-bomb.

### P1 wave — "make it feel like a real product" (operator surface + config)
1. Chatter/history sidebar from `RecordEvent` in Opportunity + Student detail (Domain 2/6). **M**
2. Capture guardian at intake + allow `Role.sale` (Domain 6). **M**
3. `RecordActivity` follow-up tasks + follower→SSE dispatch bridge (Domain 10). **M each**
4. Program weights → `GradingTemplate` columns; `isLocked` on term/final grade (Domain 4). **S–M**
5. Batch-overlap + room-capacity warning in `detectConflicts` (Domain 3). **S**
6. Manual badge monthly quota (Domain 5). **S**
7. Receipt-cancel → student lifecycle rollback rule (Domain 2). **S**
8. Payroll: log policy JSON diff; freeze source rows at finalize (Domain 9). **S–M**

### P2 wave — scaling / statutory / deferred
Insurance auto-calc, manager rollup commission, Redis SSE, session advisory locks, nightly grade recompute, streak badges, level-value seeding, GL export. Pull individual items in only when the triggering pressure appears (multi-instance deploy, audit/tax requirement, roster growth).

### Explicit "do NOT build" (over-engineering for a tutoring center)
OpenEduCat subject/prerequisite trees · Odoo double-entry `account.move` ledger · `resource.calendar` work-entry engine · Python `safe_eval` salary-rule engine · generic `gamification.goal.definition` query engine · configurable `op.admission.register` intake. The xia docs independently reach the same conclusion for each.

---

## Unresolved questions (need a human/product call)
1. Receipt-cancel rollback: soft-delete the provisioned student, or revert lifecycle to `admitted`? (doc 02 Q1, doc 06 Q1)
2. Can a student be enrolled across programs (UCREA + BRIGHT_IG) simultaneously? Affects provisioning + `final_grade` unique key. (doc 02 Q2, doc 04 Q1)
3. Should level values be enum/seeded or stay free-text? (doc 01 Q1)
4. BHXH: statutory auto-config now, or stay manual through current phase? (doc 09 Q1)
5. Read/unread inbox needed for staff, or is live SSE enough? (doc 10 Q1)

---

Status: DONE
Summary: Synthesized all 10 xia docs into a per-domain gap table verified against schema/routers; core engine is strong, the real "sơ sài" is unbuilt atomic provisioning, missing chatter/activity surface, and two latent scheduling bugs — sequenced into a 4-item P0 wave plus P1 enrichment and P2 deferrals.
