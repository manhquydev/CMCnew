# Carve-out plan + red-team (Track 2 — DEFERRED until after MVP live)

> Nguồn: workflow w1nvqkbjf. rewards/stars = LMS (KEEP). DELETE routers: finance, payroll, compensation, crm, aftersale, dashboard, shift-config, shift-registration, check-in-out, facility-ip.

## Synthesized phased plan

# Carve-Out Plan Structure: teacher-lite + LMS standalone (delete ERP)

**Slug:** `260708-1455-erp-carveout-teacher-lms`
**Scope locks (given):** (1) `apps/teacher` is a NEW app; (2) migrate-DROP strategy preserving teacher/LMS data on the shared DB; (3) grading KEPT; (4) retire `packages/domain-*` ERP domains only AFTER prod verify.

---

## 0. Rewards/stars ambiguity — RESOLVED: **KEEP `domain-rewards` + all star/badge models/routers**

Scout 5 flagged it "ambiguous," but scouts 2 and 3 provide hard disconfirming evidence. Definitive verdict: **KEEP.**

Reason (cited): `packages/domain-rewards/src/stars.ts`+`badges.ts` are pure student-facing gamification — star ledger credited on `homework_completed`, debited on `gift_redeemed`, badges on `stars_total`/`homework_count`; txn types are `homework_completed | gift_redeemed | gift_rejected_refund | manual`, zero staff-commission concepts (Scout 3). Models `StarTransaction` (schema.prisma:765, FK→Student), `Reward` (782, FK→Student+Gift), `Gift` (741), `Exercise.starReward` (683), `Badge`/`StudentBadge`/`LevelProgress` are all Student-keyed LMS gamification (Scout 2). LMS FE calls `trpc.rewards.redeem/balance/gifts` directly (Scout 1: 7 LMS calls; Scout 2). Importers are teacher grade-publish (`grade.ts` → `earnEntry`+`evaluateBadges`) and LMS student redeem (Scout 3).

**Staff commission is the true DELETE and lives elsewhere:** `packages/domain-payroll` (`commission.ts`, `kpi.ts`, `payslip.ts`, `pit.ts`), keyed by `userId`/AppUser (Scouts 2,3). No model named "reward" touches staff pay — no naming collision.

**Only carve inside `rewards.ts` router:** staff-facing gift-catalog mutations (`giftCreate`, `giftListAdmin`, gated `requirePermission('rewards','giftUpdate')`) must re-home into `apps/teacher`; the `rewards` permission resource stays in `@cmc/auth` (Scouts 1,3,5).

---

## 1. Master KEEP vs DELETE lists

### 1a. API routers (`apps/api/src/routers/`)
**KEEP (28):** `index.ts` (EDIT-only), `auth.ts`, `lms-auth.ts`, `teacher-lite.ts`, `schedule.ts`, `attendance.ts`, `session-evidence.ts`, `submission.ts`, `exercise.ts`, `grade.ts`, `assessment.ts`, `level-progress.ts`, `student.ts`, `guardian.ts`, `enrollment.ts`, `class-batch.ts`, `curriculum.ts`, `course.ts`, `facility.ts`, `room.ts`, `audit.ts`, `notification.ts`, `rewards.ts`, `badge.ts`, `leaderboard.ts`, `certificate.ts`, `parent-meeting.ts`, `staff-notif.ts`.

**DELETE (10):** `finance.ts`, `payroll.ts`, `compensation.ts`, `crm.ts`, `aftersale.ts`, `dashboard.ts`, `shift-config.ts`, `shift-registration.ts`, `check-in-out.ts`, `facility-ip.ts`.

**RESOLVE-then-decide (Scout 1 flags):**
- `user.ts` → **KEEP (trimmed):** teacher app still provisions teachers + reads staff roles; not imported by any KEEP router. Prune ERP-role grant sets + delete `user.listAssignableForAfterSale` (permissions.ts:312). Answers Scout Q "who provisions teachers."
- `search.ts` → **DELETE** (KISS): covers CRM opportunities + staff; not consumed by LMS/teacher panels. Re-add a student+classBatch-only variant later only if teacher UX demands.
- `email.ts` (outbox read router) → **DELETE**; KEEP the sending infra `services/email-outbox.ts` + cron `runEmailOutbox` (parent OTP/notify channel).

### 1b. DB models (`packages/db/prisma/schema.prisma`) — Scout 2
**KEEP:** Facility, AppUser, UserFacility, ParentAccount, StudentAccount, Guardian, GuardianLinkRequest, LoginOtp, Course, CurriculumUnit, CurriculumLesson, Student, StudentCodeCounter, BatchCodeCounter, ClassBatch, Room, ScheduleSlot, ClassSession, Enrollment, Attendance, ParentMeeting, SessionEvidence(+Photo,+StudentComment), Exercise, Submission, Grade, Gift, StarTransaction, Reward, Badge, StudentBadge, LevelProgress, GradingTemplate, QualitativeAssessment, FinalGrade, AcademicTerm, RecordEvent, RecordFollower, Notification, EmailOutbox, Certificate.

**DELETE:** CoursePrice, DiscountTier, Voucher, Receipt, RefundRecord, ReceiptCodeCounter, Contact, Opportunity, OpportunityAssignment, TestAppointment, AfterSaleCase, EmploymentProfile, EmployeeCodeCounter, CallMetric, KpiScore, SalaryRate, CompensationPolicy, Payslip, ShiftGroup, ShiftTemplate, ShiftRegistration, ShiftRegistrationEntry, TimePunch, ManualAttendanceTicket, FacilityNetwork, ShiftCodeCounter.

**Enums KEEP/DELETE** per Scout 2 lists. `Role` enum: **keep all values initially** (pruning ERP roles is a separate risky migration — see §4 warning).

### 1c. Packages — Scout 3
**KEEP:** `domain-rewards`, `domain-grading`, `domain-academic`, `audit`, `auth`, `ui`, `db`.
**DELETE (after prod verify — lock 4):** `domain-payroll`, `domain-finance`.

### 1d. apps/admin surfaces — see §2.

### 1e. Permissions (`packages/auth/src/permissions.ts`) — Scout 5
**KEEP modules:** assessment, attendance, course, badge, classBatch, teacherLite, exercise, sessionEvidence, certificate, grade, levelProgress, guardian, parentMeeting, room, schedule, submission, student(prune `sale`), user(prune ERP roles), rewards(KEEP — LMS star loop), facility.
**DELETE modules:** afterSale, crm (except academic `crm.testGrade`=[giao_vien,giam_doc_dao_tao] — re-home or keep), finance, compensation, payroll, email.
**enrollment module:** prune `enroll`=[sale,gdkd]; KEEP `complete`/`transfer`=[giam_doc_dao_tao].

---

## 2. apps/teacher extraction manifest (move/copy from apps/admin/src) — Scout 4

**Shared shell (COPY + trim ERP keys):** `app-surface.ts`, `shell.tsx` (buildNavGroups teacher branch), `nav-permissions.ts` (trim `NAV_GATES` to kept `SectionKey`s), `nav-modules.ts`, `App.tsx` (**rewrite** — strip ~25 ERP imports + inline `Facilities/Users/UserCreateModal/OrgPanel/HrPayrollSection/ShiftRegSection`), `main.tsx`, `link-preview-metadata.ts`, `vite-env.d.ts`.

**Panels to move (KEEP):** teacher-today-panel, session-workspace, session-evidence-panel, teacher-schedule, teacher-schedule-session-detail, session-status.ts, attendance-panel, attendance-roster, attendance-report-panel, homework-feed, assessment-panel, class-workspace, courses-panel, course-exercise-manager, terms-panel, student-management-panel, students-panel, student-detail, guardians-panel, meetings-panel, level-approval-panel, teacher-staff-lite-panel, teacher-lite-intake-panel, teacher-lite-class-control-panel, edu-director-cockpit-panel, biz-director-cockpit-panel, profile-settings-panel.

**Transitive KEEP (ERP-origin but reachable):** `overview-panel.tsx` (both cockpits render `<OverviewPanel/>` unconditionally — MUST carry).

**CRM coupling decision (Scout 4 flag 2) — RESOLVE (b) refactor out:** drop `<CrmDirectorDashboardCard/>` from `biz-director-cockpit-panel.tsx:242`; do NOT carry `crm-director-dashboard.tsx`/`crm-shared.ts`. Also drop cockpit `onNavigateToKpi`/`/kpi` nav path. Keeps CRM domain fully out.

**Tests to carry:** `__tests__/nav-consistency.test.ts`, `nav-teacher-consolidation.test.ts`, the two director-cockpit-consolidation tests.

**DELETE (stay in retired apps/admin, never moved):** finance-panel (+embedded ERP FamilyIntakePanel), email-outbox-panel, revenue-report, reconcile-worklist, crm-panel, cskh-panel, opportunity-detail, contact-directory-panel, view-defaults, rewards-panel, badge-panel (admin mgmt), payroll-panel, payroll-checkin-panel, my-payslips-panel, compensation-panel, kpi-evaluation-panel, attendance-monthly-report-panel, staff-profile, checkin-panel, shift-reg-list/detail-panel, facility-network-panel, shift-config-panel, schedule-panel, schedule-detail, grading.tsx, shallow-trpc.ts, design-showcase.tsx (dev-only, drop).

---

## 3. Migration strategy — DROP ERP, PRESERVE teacher/LMS data (Scout 2)

**Dev:** clean reinstall acceptable (drop+recreate+reseed). **Prod (LIVE):** forward destructive migration, order-sensitive; single shared DB retained.

**FK cleanup FIRST (the 6 dangerous KEEP→DELETE edges):**
1. `Student.createdByReceiptId`→Receipt (SetNull, schema:229-230) + `Student.receipts` reverse.
2. `Enrollment.createdByReceiptId`→Receipt (390-391) + `Enrollment.opportunityId` loose column (387).
3. `Course.receipts`+`Course.prices` (161,160) reverse.
4. `ClassBatch.receipts` (273) reverse.
5. `Facility.staffNotifications` (104) + `AppUser.staffNotifications` (123) — only if StaffNotification dropped (see §5 decision).
6. `Receipt↔Opportunity` mutual link — break before dropping either.

**Drop order:**
1. Drop dangling FK columns/relations on KEEP tables (`student.created_by_receipt_id`, `enrollment.created_by_receipt_id`, `enrollment.opportunity_id`) + remove Prisma relation fields on Student/Enrollment/Course/ClassBatch/Facility/AppUser.
2. Drop leaf children: RefundRecord→Receipt; OpportunityAssignment+TestAppointment→Opportunity.
3. Drop ERP tables in FK-safe order: finance → CRM → after-sale → HR → payroll → shift.
4. Drop ERP enums.

**Data preserved:** all KEEP tables untouched except column drops (no row loss). Prune only migration-forward; do NOT rewrite migration history on a live DB.

---

## 4. RLS / permission / auth pruning (Scout 5)

- RLS is in-migration (`ALTER TABLE ... ENABLE RLS` + `CREATE POLICY` inside migration SQL, e.g. `20260623045316_rls_tenancy`). Dropped ERP tables carry their policies away automatically; no separate policy files to edit.
- `permissions.ts`: delete ERP module blocks + strip roles `sale,cskh,ctv_mkt,ke_toan,hr` from KEEP modules (`shiftRegistration/shiftConfig/checkInOut/user/student`). Delete `DIRECTOR_ROLE_GRANTS` `giam_doc_kinh_doanh` ERP row; keep `giam_doc_dao_tao:['giao_vien']`. **Registry pruning is safe/fail-closed** (`can()` returns false for unknown module/role) — independent of the DB enum.
- **CRITICAL — do NOT drop `Role` enum values while prod accounts hold them.** `toSession` (index.ts:56-63) + `verifySession` (jwt.ts:35-39) map `user.roles` directly; a stored value missing from the enum breaks login and the enum migration fails. Precondition: reassign/deactivate prod ERP-role accounts first. Defer enum pruning to a separate later migration — NOT required for carve-out.
- KEEP auth files whole: `index.ts`, `lms.ts`, `jwt.ts`, `login-phone.ts`, `permissions.ts` (prune entries only), `teaching-authz.ts` (already clean — only super_admin/giao_vien/giam_doc_dao_tao).
- `apps/api/src/index.ts`: DELETE `GET /files/receipt/:id` (190-228) with finance; KEEP `/files/{certificate,transcript,exercise,session-photo}`, both `/sse/*`, SSO routes, `runEmailOutbox` cron.

---

## 5. Phase breakdown

| Phase | Deliverable | Risk | Rollback |
|---|---|---|---|
| **P1 — Scaffold apps/teacher** | New Vite app; copy shell + KEEP panels (§2); rewrite `App.tsx`; refactor biz-cockpit to drop CRM card; carry tests. No api/db change yet. Builds green against existing api. | Low. Transitive CRM/overview coupling — mitigated by manifest. | Delete app dir; nothing shared touched. |
| **P2 — Strip api routers** | EDIT `index.ts` to unregister 10 DELETE routers + search/email; delete those router files; re-home `giftCreate/giftListAdmin` + academic `crm.testGrade` into kept routers; delete `/files/receipt` handler. | Med. Cross-router imports confined to DELETE cluster (Scout 1) → clean. Verify no KEEP router imports deleted. | Revert commit; routers restore. |
| **P3 — Prune auth/RLS registry** | Prune `permissions.ts` modules/roles + `DIRECTOR_ROLE_GRANTS`. Keep `Role` enum values. | Low (fail-closed). | Revert; registry additive. |
| **P4 — Prune db schema (FK cleanup + drop)** | Migration per §3: drop 6 KEEP→DELETE FK columns/relations, then DROP 27 ERP tables + enums in FK order. Dev clean reinstall; prod forward migrate. | **HIGH — destructive on live prod.** Requires FK cleanup or `prisma migrate` errors; requires prod backup. | DB restore from pre-migration backup; no down-migration for prod destructive. |
| **P5 — Verify + deploy** | Live-verify teacher + LMS end-to-end on prod-like stack (login, schedule, grade-publish→stars, gift redeem, parent views). Deploy apps/teacher + trimmed api. | Med. | Keep apps/admin deployed in parallel until green. |
| **P6 — Retire ERP (AFTER prod verify — lock 4)** | Delete `apps/admin`; delete `packages/domain-finance` + `domain-payroll`; drop dead `EmailOutbox.transport=graph` path (harmless, no migration). | Low (already unreferenced). | Revert deletion commit. |

**Ordering rationale:** extract first (P1) so teacher app never depends on soon-deleted code; strip api (P2) before db (P4) so nothing queries dropped tables; auth (P3) before db so registry doesn't reference dropped modules; domains retired last (P6) after prod-verify per lock 4.

---

## 6. Decision 0041 content (supersedes 0039 keep-ERP clause)

**File:** `docs/decisions/0041-erp-carveout-teacher-lms-standalone.md` (from `docs/templates/decision.md`). Update `DECISION_INDEX.md` row + `harness-cli decision add`. Keep 0039, mark superseded.

**Title:** Carve teacher-lite + LMS into standalone; delete ERP; one shared DB.

**Context:** 0039 kept the ERP monolith. Product now requires a clean teacher+LMS product; ERP (finance/CRM/HR/payroll/shift/after-sale) is retired.

**Decision:**
1. NEW `apps/teacher` staff app + existing `apps/lms`, both over shared `apps/api`; `apps/admin` deleted.
2. ONE shared Postgres retained; ERP tables/columns DROPPED via forward destructive migration preserving all teacher/LMS rows.
3. **`domain-rewards` = LMS gamification → KEPT.** ERP commission is `domain-payroll` → DELETED. (Resolves 0039/scout ambiguity definitively.)
4. Grading KEPT (`domain-grading`).
5. `Role` enum values retained through carve-out; ERP-role pruning deferred to a separate migration gated on reassigning prod accounts.
6. ERP domains (`domain-finance`, `domain-payroll`) + `apps/admin` retired only AFTER prod verify.

**Consequences:** teacher account provisioning stays in trimmed `user.ts`; global `search.ts` dropped; email-outbox sending infra kept, monitoring router dropped; `EmailOutbox.transport=graph` dead-but-harmless.

---

## Unresolved questions (need product/user call before P2/P4)
1. **StaffNotification (model 1383 + enum StaffNotifEvent 1369):** delete entirely (teacher uses generic `Notification`) or keep + prune ERP enum values? Lean DELETE (duplicates Notification). Drives whether Facility/AppUser `staffNotifications` reverse-relations are dropped in P4. `staff-notif.ts` router currently KEEP — reconcile.
2. **crm.testGrade / TestAppointment:** does teacher app score entrance/periodic tests? If yes, keep `crm.testGrade` permission + re-home; if no, delete with CRM.
3. **Confirm** Receipt/Opportunity models are DROPPED (not left orphaned) — enrollment/student compile fine after FK-column removal since relations are dropped too.
4. **Prod ERP-role account reassignment timeline** — precondition for any future `Role` enum prune (not blocking carve-out).

Status: DONE — synthesis complete, read-only, no files modified.

## Red-team

Validated the plan against actual source. Multiple plan claims are contradicted by the code. Findings below, evidence-cited.

---

# RED-TEAM: ERP carve-out plan (260708-1455) — adversarial review

Verdict up front: **NO-GO as written.** The KEEP/DELETE lists are internally inconsistent — at least four surfaces the plan marks KEEP or "must-carry" hard-depend on routers the plan marks DELETE. The phase ordering hides these breaks until P2, so the plan's "P1 builds green" gate gives false confidence. Fixable, but the manifest and phase gates must change first.

## (1) DATA-LOSS / broken-query on KEEP tables

**F1 — `student.ts` (KEEP) reads `receipts { opportunity }` include. HIGH.**
`apps/api/src/routers/student.ts:59-72` does `include: { receipts: { select: { ... opportunity: {...} } } }`. When Receipt/Opportunity + `Student.receipts` relation are dropped (P4), this KEEP router fails to compile (Prisma client loses the field) and would 500 at runtime. Plan §1a lists `student.ts` as KEEP-untrimmed and P2 never mentions editing it; §Unresolved Q3 wrongly asserts "student compile fine after FK-column removal" — the FK column isn't the problem, the `include`/`select` in router code is.
Fix: P2 must strip the `receipts`/`opportunity` sub-selects from `student.ts` (and re-verify the student-detail FE that consumes it). Add `student.ts` to the "KEEP-trimmed" list, not "KEEP as-is."

**F2 — `enrollment.ts` (KEEP) reads/writes `opportunityId`. MEDIUM-HIGH.**
`enrollment.ts:58` (zod input `opportunityId`), `:82` (create writes it), `:203` (transfer copies it). Plan handles the *column* in P4 FK-cleanup but leaves the *router code* referencing it → build break after column drop. Fix: P2 removes the `opportunityId` input field + write sites in `enrollment.ts` in the same commit that P4's column drop lands (or before).

No true cascade-nuke found: `Student.createdByReceiptId` / `Enrollment.createdByReceiptId` are `onDelete: SetNull` (schema 230, 391), so dropping Receipt rows will not delete Student/Enrollment rows. That part of the plan is sound.

## (2) BROKEN IMPORTS — KEEP/carry surfaces import DELETE routers

**F3 — Shared shell depends on `search.ts`, which the plan DELETES. HIGH.**
`shell.tsx:256` + `:396` call `trpc.search.global` (the global search box). Plan §2 says COPY `shell.tsx` unmodified into `apps/teacher`; §1a says DELETE `search.ts` with the claim "not consumed by LMS/teacher panels." That claim is false — the shell IS the teacher app chrome. Deleting the router makes the copied shell fail typecheck.
Fix: pick one and write it into the plan — either (a) keep a trimmed `search.ts` (students + classBatches + staff only; drop CRM/opportunity), or (b) strip the global-search box from the copied shell. Do not leave both "delete" and "carry unmodified."

**F4 — edu-director cockpit (KEEP, teacher persona) + overview-panel (must-carry) depend on `dashboard.ts`, which the plan DELETES. CRITICAL.**
`edu-director-cockpit-panel.tsx:16,86` → `trpc.dashboard.myApprovals`; `overview-panel.tsx:20,39` → `trpc.dashboard.summary`. Both are on the KEEP / "MUST carry" list (§2). `dashboard.ts` is on the DELETE list (§1a). `dashboard.ts` is therefore **not** pure-ERP — it feeds the teacher approval inbox and overview. Deleting it breaks the two most important teacher landing surfaces.
Fix: do not delete `dashboard.ts` wholesale. Re-home a trimmed `dashboard.myApprovals` (levelProgress only) and `dashboard.summary` (student/class/attendance metrics, no revenue/finance) into a kept router, or rewrite the cockpit/overview to call `levelProgress`/`attendance` directly. This is a P2 design item the plan currently omits entirely.

**F5 — edu-director cockpit (KEEP) inlines ERP approvals. HIGH.**
`edu-director-cockpit-panel.tsx:118` `trpc.shiftRegistration.approve`, `:121` `trpc.checkInOut.approveManual`, plus KPI routing — all DELETE routers. Plan §2 carries this panel with no mention of trimming these. Fix: trim `INLINE_APPROVE_DOMAINS` to `levelProgress` only; drop shiftRegistration/manualPunch/kpi branches and the `onNavigateToKpi` plumbing.

**F6 — biz-director cockpit is deeply ERP-coupled; plan under-scopes it to "drop CRM card." HIGH.**
`biz-director-cockpit-panel.tsx:111` `trpc.finance.receiptApprove`, `:119` `trpc.shiftRegistration.approve`, `:124` `trpc.checkInOut.approveManual`, `:84` `trpc.dashboard.myApprovals`. This is the `giam_doc_kinh_doanh` (business/sales director) surface — a pure ERP persona, not teacher/LMS. Carrying it (plan §2 lists it under "panels to move (KEEP)") drags finance + shift + checkin + dashboard coupling into the teacher app.
Fix: **DROP `biz-director-cockpit-panel.tsx` entirely** from `apps/teacher` (and its role branch in `App.tsx:138,757`). It is out of product scope for a teacher+LMS standalone. This also removes most of the CRM/KPI coupling the plan is trying to surgically excise.

Good news: at the router-import level the KEEP routers are clean — no KEEP router imports a DELETE router or `domain-finance`/`domain-payroll` (verified by grep across all 28 KEEP routers). `domain-finance`/`domain-payroll` are imported only by `finance.ts`/`payroll.ts`/`compensation.ts`/`services/receipt-code.ts` (all DELETE). The coupling is entirely in the FE panels above, not the API domain graph.

## (3) RLS / MIGRATION DRIFT

**F7 — Hand-authored destructive drop migration on a repo with drift history. MEDIUM.**
77 migrations exist; memory records prior "migrate-staleness" and "missing CREATE TABLE" drift bugs. Plan §3 hand-authors FK-safe drop SQL. Any mismatch vs. what Prisma expects → every future `migrate dev` reports drift.
Fix: generate the drop migration with `prisma migrate diff --from-migrations ... --to-schema-datamodel schema.prisma --script` (old→new) instead of hand-writing, then only reorder/wrap for FK-safety. Run `migrate diff` again post-apply to assert 0 drift, mirroring the repo's existing 0-drift discipline.

**F8 — Dev "clean reinstall" does NOT exercise the prod destructive path. HIGH (verify gap).**
Plan §3: "Dev: clean reinstall (drop+recreate+reseed); Prod: forward destructive migrate." A clean reinstall replays the 77 create-migrations then the single drop — it never runs the order-sensitive FK cleanup against **populated** teacher/LMS data. The prod migration is thus deployed having never been executed on realistic data. Also unverified: whether `packages/db/prisma/seed-data/` seeds any ERP table/enum — if so, reseed after schema-prune fails.
Fix: before P5, restore a prod snapshot into a dev DB and run the actual forward destructive migration there (not a clean reinstall). Add "seed-data references no dropped table/enum" to the P4 checklist.

## (4) AUTH

**F9 — `StaffNotification` model vs `staff-notif.ts` router contradiction. MEDIUM.**
Plan keeps `staff-notif.ts` (§1a) but Unresolved-Q1 leans DELETE on the `StaffNotification` model. The router (`staff-notif.ts:16,29,40,52`), `lib/emit-staff-notif.ts`, `staff-notification.ts`, and `index.ts` all use the model. Deleting the model while keeping the router = build break. `StaffNotifEvent` enum also carries ERP values (manualAttendance etc.), so pruning enum values has the same live-DB hazard as `Role`.
Fix: resolve Q1 before P2/P4 as **KEEP model, KEEP enum values** (defer enum prune like Role), or drop router+model+emitters together. Don't split them.

**F10 — Role-enum handling is correct. (Confirming, not a defect.)** Plan §4's decision to retain all `Role` values through carve-out and defer pruning is right — `toSession`/`verifySession` map stored roles directly and a missing enum value breaks login. Permission-registry pruning is fail-closed (`can()` → false on unknown module/role), safe. Keep as-is.

## (5) ORDERING HAZARD

**F11 — P1 "builds green against existing api" masks F3/F4/F5. HIGH.**
P1 compiles `apps/teacher` while `dashboard.ts`/`search.ts`/shift/checkin routers still exist, so it goes green — then P2 deletes them and the teacher app breaks. The plan's own gate misleads.
Fix: P1's exit criterion must be "teacher app typechecks against the **post-P2 trimmed** AppRouter." Practically: decide all router trims (F1-F6) as part of P1 scoping, and run P2 router deletion + P1 teacher build as one verification unit before P4 touches the DB.

---

## Go / No-Go

**NO-GO until F3, F4, F5, F6 are folded into the manifest** — they are build-breaking contradictions between the KEEP list and the DELETE list, not edge cases. The migration strategy (F7/F8) and StaffNotification (F9) are must-fix before P4 but don't block starting P1/P2. Role-enum handling and the domain-import graph are sound.

## Top 5 must-fix before implementation

1. **F4 (CRITICAL):** `dashboard.ts` is not pure-ERP — edu-director cockpit + overview-panel need `dashboard.myApprovals`/`summary`. Re-home trimmed versions or rewrite those panels; do not blind-delete.
2. **F3 (HIGH):** Resolve the `search.ts` contradiction — shell's global search uses `trpc.search.global`. Keep a trimmed search router or strip the shell search box.
3. **F6 + F5 (HIGH):** Drop `biz-director-cockpit` entirely (ERP/sales persona) and trim `edu-director-cockpit` approvals to `levelProgress` only — removes finance/shift/checkin/kpi coupling.
4. **F1 + F2 (HIGH/MED):** Add `student.ts` (drop `receipts/opportunity` include) and `enrollment.ts` (drop `opportunityId`) to P2 "KEEP-trimmed"; they break when P4 drops Receipt/Opportunity.
5. **F8 + F7 (HIGH/MED):** Verify the prod destructive migration on a restored prod snapshot (not a clean reinstall), and generate the drop migration via `prisma migrate diff` to avoid reintroducing the repo's known drift bug.

## Unresolved questions for product/user
- Is `giam_doc_kinh_doanh` (biz director) in scope for the teacher+LMS standalone at all? If no (recommended), F6 simplifies dramatically.
- Does the teacher app need a global search box (drives F3 option a vs b)?
- Keep `StaffNotification`/`StaffNotifEvent` (defer enum prune) or drop the whole staff-notif stack? (F9)
- Does `dashboard.summary` need a teacher-scoped rewrite, or can the overview landing be replaced by an existing teacher panel? (F4)

Status: DONE — read-only, no files modified. Evidence from `apps/api/src/routers/{student,enrollment,rewards,grade,staff-notif}.ts`, `apps/admin/src/{shell,edu-director-cockpit-panel,biz-director-cockpit-panel,overview-panel,App}.tsx`, `packages/db/prisma/schema.prisma`, `apps/api/src/services/login-otp.ts`, migrations dir (77 migrations).
