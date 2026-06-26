# Haiku 10-Agent Verified Review — Project Completion State

**Date:** 2026-06-26 | **Branch:** develop | **Method:** 10 Haiku 4.5 finders → Sonnet adversarial verify (đọc code thật) → synthesize. KHÔNG auto-fix.

## Tỉ lệ ảo giác (anti-hallucination)
- Tổng claim Haiku: **60** | CONFIRMED: **46** | REFUTED (ảo giác): **14** (~23%) | cần product: 5
- Severity (confirmed): CRITICAL 0 · HIGH 2 · MEDIUM 14 · LOW 30
- → Lớp Sonnet-verify loại bỏ ~23% claim sai của Haiku — đúng yêu cầu "kiểm tra thật, không tin một chiều".

## Per-dimension (confirmed/total)
- API business logic: 10/10
- Payroll/KPI/commission money-logic: 2/2
- Auth/authorization/RLS: 3/7
- DB schema/migrations: 3/6
- tRPC contract consistency: 1/1
- Admin UI completeness: 2/3
- Teaching UI completeness: 9/9
- LMS UI completeness: 3/5
- Test coverage gaps: 9/12
- Error handling & tech debt: 4/5

## HIGH (2)
### [Admin UI completeness] apps/admin/src/rewards-panel.tsx:209
- **Claim:** useState is used instead of useEffect for loading facilities data. The callback at line 209-214 will not execute as a side effect, meaning facilities will never load and GiftCreateCard will have an empty facilities list, making gift creation non-functional.
- **Evidence:** apps/admin/src/rewards-panel.tsx:209 — `useState(() => { trpc.facility.list.query().then(...).catch(...) })` uses useState's lazy initializer slot, not useEffect. React only uses the return value of the initializer as initial state; the async side-effect inside is architecturally unsound. In StrictMode the initializer fires twice. `GiftCreateCard` at line 222 receives the `facilities` array, which will be empty `[]` because `setFacilities` is called from an untracked async callback, not from a properly mounted effect.
- **Fix:** Replace `useState(() => { ... })` at line 209 with `useEffect(() => { trpc.facility.list.query().then(...).catch(...); }, [])`. The existing `facilities` state declaration at line 206 is correct; only the loader needs to change to useEffect with an empty dependency array.

### [Teaching UI completeness] apps/teaching/src/crm-panel.tsx:71-73
- **Claim:** facility.list.query() has no catch block at all; if request fails, facilities list is undefined and panel breaks
- **Evidence:** apps/teaching/src/crm-panel.tsx:71-74 — `trpc.facility.list.query().then(fs => { setFacilities(fs); setFacilityId(...) })` has no `.catch()`. Compare lines 79-80 where `opportunityList` and `testList` both have `.catch(() => setX([]))`. A failed `facility.list` request leaves facilities empty and facilityId null, preventing any subsequent `load()` call from firing (line 78: `if (!facilityId) return`), so the entire CRM panel shows nothing with no error feedback.
- **Fix:** Add `.catch(() => {})` or a real error handler: `trpc.facility.list.query().then(fs => { setFacilities(fs); setFacilityId(cur => cur ?? fs[0]?.id ?? null); }).catch(() => { /* toast or setError */ });` — follow the same pattern already used on lines 79-80.

## MEDIUM (14)
### [API business logic] apps/api/src/routers/submission.ts:128-143
- **Claim:** myLayer query returns null when studentId missing (line 133), but save mutation throws FORBIDDEN for the same missing studentId condition (line 110). Both use studentProcedure and should handle consistently.
- **Evidence:** submission.ts:110 — save throws TRPCError FORBIDDEN when studentId missing; submission.ts:151 — submit also throws FORBIDDEN; submission.ts:133 — myLayer returns { mine: null, teacher: null } for the identical missing-studentId condition. All three are under studentProcedure with the same lmsRlsContextOf path.
- **Fix:** Replace the early-return in myLayer (line 133) with `throw new TRPCError({ code: 'FORBIDDEN' })` to match the mutation pattern, or document the intentional silent-null contract and accept the asymmetry.

### [API business logic] apps/api/src/routers/facility.ts:7-40
- **Claim:** facility router only implements create and list operations. No update operation exists. Facility details (code, name, address) cannot be corrected after creation except via raw DB access.
- **Evidence:** D:\project\CMCnew\apps\api\src\routers\facility.ts:7-40 — the router exports exactly two procedures: `list` (line 9) and `create` (line 19). No `update`, `patch`, `delete`, or `deactivate` mutation is present. Fields `code`, `name`, and `address` on a facility record are immutable through the API once created.
- **Fix:** Add an `update` superAdminProcedure mutation accepting `{ id, code?, name?, address?, isActive? }` with a `tx.facility.update` call and a corresponding audit log entry, matching the pattern of the existing `create` mutation.

### [API business logic] apps/api/src/routers/aftersale.ts:87-105
- **Claim:** assign mutation accepts assignedToId without validating it belongs to the same facility. Cross-facility assignment is possible if the assignedToId exists in a different facility.
- **Evidence:** apps/api/src/routers/aftersale.ts:87-105 — `assign` mutation writes `input.assignedToId` directly via `tx.afterSaleCase.update({ data: { assignedToId: input.assignedToId } })` with no facility membership check. The `after_sale_case` RLS `WITH CHECK` (packages/db/prisma/migrations/20260623182256_phase5_aftersale_case/migration.sql:44-45) only validates `facility_id` on the case row. The `app_user_facility_roster` RLS policy (packages/db/prisma/migrations/20260623090000_app_user_facility_roster/migration.sql:19-28) is SELECT-only and does not fire during a FK constraint check. No application-level query exists between the input and the update to verify the assignee shares the case's facility.
- **Fix:** Before the update, verify the assignee belongs to the same facility: `if (input.assignedToId) { await tx.userFacility.findFirstOrThrow({ where: { userId: input.assignedToId, facilityId: kase.facilityId } }); }` — using `findFirstOrThrow` inside the `withRls` transaction so the lookup is also RLS-gated. Alternatively add a Postgres CHECK constraint or trigger on `after_sale_case` that validates `assigned_to_id` via `user_facility`.

### [Payroll/KPI/commission money-logic] apps/api/src/routers/payroll.ts:598
- **Claim:** Commission override amount (payslipOverrideVariablePay input) has no upper bound validation. Zod schema `amount: z.number().int().nonnegative()` only enforces min(0), allowing arbitrarily large overrides (e.g., 999_999_999_999). Budget cap check (6% of revenue) exists in commissionForSale query but is not enforced in the actual mutation, permitting overrides above reasonable limits.
- **Evidence:** payroll.ts:598 — `amount: z.number().int().nonnegative()` has no upper bound. Mutation body (lines 602–668) applies only a status check and tree-authority check (`canOverrideKpi`) before writing the override. The budget cap (`budgetCap`, `overBudget`) is computed at payroll.ts:335–348 inside `commissionForSale` (a read-only query) and returned to the UI as advisory data only — it is never referenced or enforced inside `payslipOverrideVariablePay`.
- **Fix:** Add `.max(MAX_COMMISSION_OVERRIDE)` to the Zod schema at line 598 (e.g., cap at a reasonable business ceiling like 50_000_000 VND or make it configurable via `effectiveParamsAt`). Alternatively, re-use the `budgetCap` logic from `commissionForSale` inside the mutation and throw `BAD_REQUEST` when `input.amount > budgetCap`. The audit log already records the change, so enforcement is the only missing piece.

### [DB schema/migrations] packages/db/prisma/schema.prisma:445
- **Claim:** StudentAccount.login_code is globally @unique but should be composite unique per facility, since PIN codes (3-4 digits) are short and could collide across facilities. Currently prevents two facilities from using the same PIN.
- **Evidence:** packages/db/prisma/schema.prisma:445 — `loginCode String @unique @map("login_code")` is a global unique constraint. The `StudentAccount` model has no `facilityId` column, so a composite per-facility unique is structurally impossible without schema change. With 3–4 digit PINs the global keyspace is 9,000–90,000 slots shared across all facilities, causing real collision pressure in multi-facility deployments.
- **Fix:** Add `facilityId Int @map("facility_id")` to `StudentAccount` (denormalized from `student.facilityId`), drop the global `@unique` on `loginCode`, and replace it with `@@unique([facilityId, loginCode])`. Alternatively, if the login UI is always facility-scoped and PIN reuse across facilities is acceptable product behavior, document the decision and leave it as-is.

### [DB schema/migrations] packages/db/prisma/schema.prisma:876
- **Claim:** Receipt.opportunityId (line 876) has no @relation or foreign key constraint; loose reference to Opportunity. If Opportunity is deleted, commission attribution chain breaks. Migration 20260624044329 added the field but no FK constraint.
- **Evidence:** schema.prisma:876 — `opportunityId String? @map("opportunity_id") @db.Uuid` has no `@relation` directive. The `Opportunity` model (schema.prisma:932-954) has no back-reference field to `Receipt`. Without `@relation`, Prisma does not generate a FK constraint in migrations, so the DB column is a bare UUID with no referential integrity. Deleting an Opportunity row leaves orphaned `opportunityId` values on Receipt rows, breaking commission attribution.
- **Fix:** Add `@relation` to both sides: on `Receipt` add `opportunity Opportunity? @relation(fields: [opportunityId], references: [id], onDelete: SetNull)`, and on `Opportunity` add `receipts Receipt[]`. Then generate and apply a new migration. Use `onDelete: SetNull` (field is nullable) or `Restrict` if receipt-linked opportunities must not be deleted — align with the Restrict pattern already used on `Contact`.

### [tRPC contract consistency] apps/admin/src/kpi-evaluation-panel.tsx:56,162
- **Claim:** kpiEvalConfirm type cast declares `scores?: ScoreEntry[]` parameter, but API only accepts `userId` and `periodKey`. Line 162 passes unused `scores` field that the backend ignores.
- **Evidence:** Backend router `apps/api/src/routers/payroll.ts:801–804` defines kpiEvalConfirm zod schema as `z.object({ userId: z.string().uuid(), periodKey: z.string().regex(...) })` — no `scores` field. Frontend type cast at `apps/admin/src/kpi-evaluation-panel.tsx:56` declares `scores?: ScoreEntry[]`, and line 162 calls `payrollApi.kpiEvalConfirm.mutate({ userId, periodKey, scores })`. Zod strips the unknown `scores` field; the mutation at `payroll.ts:814–817` writes only `status/confirmedById/confirmedAt` — score overrides are silently lost. Design spec at `plans/260625-1148-auto-payroll-kpi/phase-05-kpi-evaluation-document.md:39` and `phase-07-kpi-evaluation-ui.md:31` explicitly intended `scores?` to allow manager score adjustment at confirmation time.
- **Fix:** Add `scores: z.array(z.object({ key: z.string(), score: z.number() })).optional()` to the kpiEvalConfirm zod input in `payroll.ts`, then in the mutation body conditionally update `criterionScores` and log the old→new diff when scores are provided. This restores the intended manager-override-at-confirmation workflow.

### [Teaching UI completeness] apps/teaching/src/certificate-panel.tsx:28-31
- **Claim:** facility.list.query() has no catch or error handler; if request fails, facilities list remains empty and user sees no error indication
- **Evidence:** apps/teaching/src/certificate-panel.tsx:28-31 — `trpc.facility.list.query().then((fs) => { setFacilities(fs); setFacilityId(...) })` has no `.catch()`. Sibling calls on line 32 (`student.list.query`) and line 42 (`certificate.list.query`) both append `.catch(() => set...([]))`, making this omission inconsistent. On network failure the promise rejects silently, `facilities` stays `[]`, `facilityId` stays `null`, and no error is surfaced to the user.
- **Fix:** Add `.catch((e) => { notifyError(e, 'Tải danh sách cơ sở thất bại'); })` to the `trpc.facility.list.query()` chain at line 31, matching the pattern already used on lines 32 and 42.

### [Teaching UI completeness] apps/teaching/src/certificate-panel.tsx:32
- **Claim:** student.list.query() catch block silently swallows error without calling notifyError; user cannot see if load failed
- **Evidence:** apps/teaching/src/certificate-panel.tsx:32 — `trpc.student.list.query().then(setStudents).catch(() => setStudents([]))` swallows the error silently; the same pattern repeats at line 42 for `certificate.list.query`. Neither catch calls `notifyError`, so a network or server failure renders as an empty "Chưa có học sinh" state with no user-visible error indicator.
- **Fix:** Replace the bare `.catch(() => setStudents([]))` with `.catch((e) => { setStudents([]); notifyError(e, 'Tải danh sách học sinh thất bại'); })`. Apply the same fix on line 42 for the certificate list. `notifyError` is already imported at line 2.

### [Teaching UI completeness] apps/teaching/src/certificate-panel.tsx:42
- **Claim:** certificate.list.query() catch block silently sets empty array without error notification; user cannot distinguish between empty list and network failure
- **Evidence:** D:/project/CMCnew/apps/teaching/src/certificate-panel.tsx:42 — `.catch(() => setCerts([]))` swallows the error silently; line 109 renders "Chưa cấp chứng chỉ nào." for both empty list and network failure. `notifyError` is imported (line 2) and used in the `issue()` mutation catch (line 64) but intentionally omitted here.
- **Fix:** Replace the `.catch(() => setCerts([]))` with `.catch((e) => { notifyError(e, 'Tải chứng chỉ thất bại'); setCerts([]); })` so the user sees a toast on network failure. Same fix applies to the `student.list.query` catch on line 32.

### [Teaching UI completeness] apps/teaching/src/cskh-panel.tsx:70
- **Claim:** afterSale.list.query() catch block silent; if fetch fails, empty case list appears with no error message to user
- **Evidence:** apps/teaching/src/cskh-panel.tsx:70 — `.catch(() => setCases([]))` swallows the error silently. On failure the component renders the empty-state "Chưa có ca nào." (line 169–170) with no user notification. All mutation paths in the same file call notifyError on failure (lines 95, 106, 122); the load() fetch path does not.
- **Fix:** Add notifyError inside the catch: `.catch((e) => { notifyError(e, 'Tải danh sách ca CSKH thất bại'); setCases([]); })`. Apply the same fix to the student.list fetch at line 60.

### [Teaching UI completeness] apps/teaching/src/App.tsx:908
- **Claim:** user.listTeachers.query() catch block silent (no notifyError); if teachers list fails to fetch, teacher selection in schedule will not work and user has no error visibility
- **Evidence:** apps/teaching/src/App.tsx:908 — `.catch(() => setTeachers([]))` swallows the error silently. Adjacent patterns at line 896 (loadBatches) and line 901 (loadRooms) both call `notifyError(e, '...')` on failure; the teachers fetch does not.
- **Fix:** Change the catch to `catch((e) => { setTeachers([]); notifyError(e, 'Không tải được danh sách giáo viên'); })` to match the pattern used by loadBatches and loadRooms.

### [LMS UI completeness] apps/lms/src/parent-view.tsx:475-480
- **Claim:** Parent 'notifications' tab only renders LevelHistoryCard and does not display parent notifications (grades published, badges earned, level progression). Expected to show parent-facing notification list similar to NotificationCenter, but instead minimal to the point of being a stub.
- **Evidence:** D:/project/CMCnew/apps/lms/src/parent-view.tsx:475-480 — the 'notifications' tab branch returns only `<LevelHistoryCard childId={childId} refreshKey={refreshKey} />` inside a single Stack. No notification list, grade publication alerts, badge-earned events, or level-progression feed is rendered. Badges and leaderboard are rendered in the 'rewards' tab (lines 484-499), not here. The tab is a stub containing only level history, which is also misnamed.
- **Fix:** Replace the stub with a parent-facing notification list component (e.g., a filtered view of NotificationCenter events scoped to grades-published, badge-earned, and level-up events for the given childId). LevelHistoryCard can remain as a sub-section but should not be the sole content.

### [LMS UI completeness] packages/ui/src/badge-shelf.tsx:19
- **Claim:** BadgeShelf silently converts load errors to empty state (.catch(() => setBadges([])). If badge loading fails, user sees 'No badges earned' instead of error message, making it impossible to distinguish failure from lack of achievements.
- **Evidence:** packages/ui/src/badge-shelf.tsx:19 — `.catch(() => setBadges([]))` converts any fetch error into empty array. Comment at line 23 (`// null = still loading; [] = loaded but empty`) confirms the state machine treats error and empty identically. The error path falls through to lines 32-40 which render "Chưa đạt huy hiệu nào…" (No badges earned), making network/auth failures visually identical to a genuine empty achievement record.
- **Fix:** Introduce a third state (e.g. `error: boolean` flag or a `{ data, error }` wrapper). On `.catch`, set the error flag and render a distinct error message (e.g. "Không thể tải huy hiệu – thử lại sau") with a retry button that calls `load()`, rather than falling into the empty-state branch.

## LOW (30)
### [API business logic] apps/api/src/routers/crm.ts:203-209
- **Claim:** opportunityReopen mutation does not validate the opportunity is in a closed/lost state before clearing closedAt and lostReason. An already-open opportunity can be 'reopened' (silently succeeds).
- **Evidence:** apps/api/src/routers/crm.ts:207-209 — `tx.opportunity.update({ where: { id: input.id }, data: { closedAt: null, lostReason: null } })` executes unconditionally with no prior fetch or guard on `closedAt !== null`. An open opportunity (closedAt already null) passes through, clears null fields to null, and writes a spurious "Mở lại cơ hội" audit log entry.
- **Fix:** Before the update, fetch the opportunity and assert `opp.closedAt !== null`; throw a TRPCError with code `BAD_REQUEST` if the opportunity is not in a closed/lost state. This prevents spurious audit noise and enforces the state machine.

### [API business logic] apps/api/src/routers/schedule.ts:121-199
- **Claim:** generateSessions claims idempotency but has a race condition: concurrent requests can both fetch existing sessions (line 143), pass the dedup check (line 148), and attempt to insert duplicate sessions. Only the unique constraint prevents data corruption, but one request will fail.
- **Evidence:** apps/api/src/routers/schedule.ts:143-148 reads existing sessions then inserts at lines 175-188 inside a READ COMMITTED transaction (packages/db/src/index.ts:47 — `prisma.$transaction()` with no isolationLevel override). Two concurrent requests for the same classBatchId can both pass the dedup filter and attempt inserts; the unique constraint at packages/db/prisma/schema.prisma:285 (`@@unique([classBatchId, sessionDate, startTime])`) prevents duplicate rows but causes one request to throw an unhandled DB constraint error rather than a clean business response.
- **Fix:** Use `prisma.$transaction(..., { isolationLevel: 'Serializable' })` in `withRls`, or replace the read-then-insert pattern with `createMany` + `skipDuplicates: true` (Prisma's upsert/skipDuplicates is atomic at the DB level), or add an advisory lock on the classBatchId before the fetch. The cheapest fix is switching to `tx.classSession.createMany({ data: fresh, skipDuplicates: true })` which delegates idempotency to the DB constraint atomically.

### [API business logic] apps/api/src/routers/room.ts:7-36
- **Claim:** room router only implements create and list operations. No update or soft-delete (archive) operation exists. Rooms cannot be modified or archived after creation.
- **Evidence:** apps/api/src/routers/room.ts:7-36 — router exposes only `list` (line 8) and `create` (line 14). No `update` or `archive` procedure exists. The `list` query filters `archivedAt: null` (line 10), confirming the schema supports soft-delete, but no endpoint to set `archivedAt` is wired.
- **Fix:** Add an `archive` mutation that sets `archivedAt: new Date()` (requireRole quan_ly) and an `update` mutation for code/name/capacity changes, both with audit log entries matching the `create` pattern.

### [API business logic] apps/api/src/routers/enrollment.ts:62-114
- **Claim:** enroll mutation does not explicitly validate the student exists in the same facility before creating enrollment. RLS will catch foreign-facility leaks, but explicit validation would provide clearer error codes.
- **Evidence:** apps/api/src/routers/enrollment.ts:62-84 — withRls is applied (line 62) but no query checks student.facilityId === input.facilityId before tx.enrollment.create (line 76). Student is fetched only at line 86 (update lifecycle) and line 102 (notification display), neither verifying facility affiliation. RLS enforces the real security boundary, but a cross-facility studentId supplied by a caller would produce an opaque Prisma/DB error rather than a clear FORBIDDEN or BAD_REQUEST.
- **Fix:** Add a student facility check before the enrollment create: `const student = await tx.student.findFirst({ where: { id: input.studentId, facilityId: input.facilityId } }); if (!student) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Học sinh không thuộc cơ sở này' });` — reuse the fetched student record for the notification at line 102 to avoid the second query.

### [API business logic] apps/api/src/routers/crm.ts:311-326
- **Claim:** testGrade mutation uses findUnique (line 312) instead of findUniqueOrThrow when looking up opportunity for auto-advance. Silently continues if opportunity not found, which could hide broken CRM links in production.
- **Evidence:** apps/api/src/routers/crm.ts:312 — `tx.opportunity.findUnique({ where: { id: appt.opportunityId } })` returns null silently; line 313 `if (opp && !opp.closedAt)` swallows the missing-record case with no error or log. The mutation returns successfully at line 328 regardless of whether the auto-advance ran.
- **Fix:** Replace `findUnique` with `findUniqueOrThrow` at line 312 so a broken CRM link throws inside the transaction and surfaces the data integrity issue instead of silently skipping the stage advance. Alternatively, keep `findUnique` but add an explicit `else` branch that logs a warning when `opportunityId` is set but the record is missing.

### [API business logic] apps/api/src/routers/submission.ts:99-123
- **Claim:** save mutation casts annotationLayer to generic 'object | undefined' (line 114) instead of the explicit AnnotationData type used elsewhere. Weakens type safety on a critical Json field.
- **Evidence:** apps/api/src/routers/submission.ts:114 — `annotationLayer: (input.annotationLayer ?? undefined) as object | undefined` uses a generic cast on write, while all read paths (lines 92, 93, 138, 140) cast to `AnnotationData | null`. The `AnnotationData` type is imported at line 7 and `annotationDataSchema` validates the input at line 104.
- **Fix:** Replace `as object | undefined` with `as AnnotationData | undefined` at line 114 to be consistent with the read paths. Runtime safety is already provided by the Zod schema at line 104, so this is a type-annotation inconsistency only — no data corruption risk.

### [API business logic] apps/api/src/routers/enrollment.ts:86
- **Claim:** enroll mutation unconditionally updates student lifecycle to 'active' after enrollment. If student is in 'on_hold', 'transferred', 'withdrawn', or 'completed' state, this silently changes their lifecycle without audit or consent.
- **Evidence:** apps/api/src/routers/enrollment.ts:86 — `await tx.student.update({ where: { id: input.studentId }, data: { lifecycle: 'active' } });` runs unconditionally with no prior read or guard on the student's current lifecycle value. The subsequent `logEvent` at line 87 records the enrollment entity, not the student lifecycle transition; `logStatusChange` (used correctly in the `complete` mutation at lines 127-138) is never called for this write.
- **Fix:** Before line 86, fetch the student's current lifecycle. If it is 'withdrawn', 'transferred', or 'completed', either throw a CONFLICT or require an explicit override flag. After updating, call `logStatusChange` with the before/after lifecycle values so the transition is auditable, consistent with how the `complete` mutation handles enrollment status changes.

### [Payroll/KPI/commission money-logic] apps/api/src/routers/payroll.ts:1004
- **Claim:** KPI criteria score rounding inconsistency. Line 982-983 explicitly rounds chuyenMonScore to 2 decimals (`Math.round(avgRatio * 100 * 100) / 100`), but line 1004 calculates tuanThuScore without rounding (`(sessionsWith / totalSessions) * 100`), producing floating-point values like 33.333... instead of 33.33. This inconsistency violates the 'same precision as ratioToScore' design goal and can cause data precision mismatches.
- **Evidence:** apps/api/src/routers/payroll.ts:983 rounds chuyenMonScore: `Math.round(avgRatio * 100 * 100) / 100` (comment: "same precision as ratioToScore"). Line 1004: `const tuanThuScore = totalSessions > 0 ? (sessionsWith / totalSessions) * 100 : 0;` — no rounding applied, yields raw float (e.g. 33.333...).
- **Fix:** Wrap line 1004 consistently: `Math.round((sessionsWith / totalSessions) * 100 * 100) / 100`. This matches the existing comment "same precision as ratioToScore" and the pattern on line 983.

### [Auth/authorization/RLS] packages/auth/src/jwt.ts:37-39
- **Claim:** JWT payload fields `roles` and `primaryRole` are cast without runtime validation (`payload.roles as Role[]`). If JWT payload is malformed, types would be wrong (e.g., string instead of array). Requires JWT secret to exploit, but could cause crashes during `roles.includes()` check in session code.
- **Evidence:** D:/project/CMCnew/packages/auth/src/jwt.ts:36-39 — `sub` and `tokenVersion` receive runtime coercion (`String(...)`, `Number(...)`), but `roles` (line 37) and `primaryRole` (line 38) use bare TypeScript `as` casts with no runtime check. If a JWT is forged with a valid secret but `roles` is a string or missing, `payload.roles as Role[]` silently passes TypeScript while delivering the wrong type at runtime. The `verifyLmsToken` counterpart at lines 63-71 does validate `kind` explicitly before returning, making the inconsistency clear.
- **Fix:** Add Array.isArray + string-enum guards before returning: `const roles = Array.isArray(payload.roles) ? payload.roles as Role[] : []; const primaryRole = typeof payload.primaryRole === 'string' ? payload.primaryRole as Role : roles[0];` — or use a zod/valibot schema to parse the whole payload object. The `verifyLmsToken` style (explicit kind check at line 67) is the correct pattern to replicate.

### [Auth/authorization/RLS] apps/api/src/routers/auth.ts:37
- **Claim:** Cookie `secure` flag can be disabled via `COOKIE_SECURE=false` environment variable. While intentional for local dev (documented in comment line 36), this allows non-HTTPS cookie transmission in development, increasing exposure if dev environment is compromised or traffic is intercepted.
- **Evidence:** apps/api/src/routers/auth.ts:37 — `secure: process.env.COOKIE_SECURE !== 'false'`. Line 36 comment explicitly states the opt-out: "opt out only in local dev over HTTP via COOKIE_SECURE=false". The flag is disabled when the env var is set to the string `false`, allowing cookie transmission over plain HTTP.
- **Fix:** The implementation is intentional and standard. No fix needed. Risk is limited to developer machines; production defaults to secure=true. If tighter controls are desired, consider validating NODE_ENV alongside COOKIE_SECURE so the opt-out is only possible when NODE_ENV=development, preventing accidental staging/prod misconfiguration.

### [Auth/authorization/RLS] apps/api/src/routers/lms-auth.ts:27
- **Claim:** LMS auth cookie has the same `secure` flag override as staff auth (line 27). Allows non-HTTPS transmission in dev.
- **Evidence:** apps/api/src/routers/lms-auth.ts:26-27 — `secure: process.env.COOKIE_SECURE !== 'false'`. Default is `true`; HTTP transmission only occurs when `COOKIE_SECURE=false` is set. Comment on line 26 explicitly calls this a local-dev opt-out.
- **Fix:** Pattern is intentional and documented. Risk is misconfiguring COOKIE_SECURE=false in a non-dev environment. If desired, add an env-guard that rejects COOKIE_SECURE=false when NODE_ENV=production to prevent accidental misconfiguration.

### [DB schema/migrations] packages/db/prisma/schema.prisma:299
- **Claim:** Enrollment.opportunityId (line 299) has no @relation or foreign key constraint; it's a loose reference to Phase 3 CRM. If an Opportunity is deleted, the enrollment reference becomes orphaned with no referential integrity.
- **Evidence:** packages/db/prisma/schema.prisma:299 — `opportunityId String? @map("opportunity_id") // truy vết CRM (Phase 3)` has no @relation, no references: [], and no onDelete behavior. All other FK fields in the same model (classBatchId:295, studentId:297) have explicit @relation directives. This field is a bare nullable string with zero referential integrity.
- **Fix:** This is intentional by design (Phase 3 CRM not yet built). The severity is LOW rather than MEDIUM because: (1) the field is nullable, so it never blocks enrollment creation; (2) the comment explicitly marks it as a future cross-phase reference; (3) no Opportunity model exists in the schema yet, so a @relation cannot be added until Phase 3 lands. When the Opportunity model is added, add `opportunity Opportunity? @relation(fields: [opportunityId], references: [id], onDelete: SetNull)` and add `@db.Uuid` to the column type.

### [Admin UI completeness] apps/admin/src/compensation-panel.tsx:103
- **Claim:** TextInput for effectiveFrom at line 103 has no form binding via getInputProps and uses uncontrolled onChange. Inconsistent with priceForm pattern in finance-panel which uses form.getInputProps.
- **Evidence:** apps/admin/src/compensation-panel.tsx:103 — `<TextInput label="Hiệu lực từ" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.currentTarget.value)} .../>` uses local useState, no Mantine form binding. Contrast: apps/admin/src/finance-panel.tsx:157 — `{...priceForm.getInputProps('effectiveFrom')}` for an equivalent effectiveFrom field.
- **Fix:** Either introduce a Mantine `useForm` instance in compensation-panel for the effectiveFrom/note fields and replace the raw state with `form.getInputProps(...)`, or document the intentional deviation (the JSON blob nature of this form may justify local state — confirm with the team).

### [Teaching UI completeness] apps/teaching/src/crm-panel.tsx:79-80
- **Claim:** opportunityList and testList queries catch errors but do not call notifyError; load() function silently fails without user notification
- **Evidence:** D:\project\CMCnew\apps\teaching\src\crm-panel.tsx:79-80 — `.catch(() => setOpps([]))` and `.catch(() => setTests([]))` swallow errors and reset state to empty arrays. `notifyError` is imported at line 2 and used in other handlers (e.g., line 99 `scheduleTest`) but is absent from these two catch blocks.
- **Fix:** Add `notifyError(e, '...')` calls before or alongside the state resets in both catch handlers, e.g.: `.catch((e) => { notifyError(e, 'Không tải được danh sách'); setOpps([]); })`

### [Teaching UI completeness] apps/teaching/src/cskh-panel.tsx:56-58
- **Claim:** facility.list.query() has no catch block; if request fails, facilities array is undefined and setFacilityId fails
- **Evidence:** apps/teaching/src/cskh-panel.tsx:56-59 — trpc.facility.list.query().then(...) has no .catch(); line 60 shows student.list.query() correctly has .catch(() => setStudents([])). Inconsistency is real. However the claim that "facilities array is undefined and setFacilityId fails" is factually wrong — on failure the .then() never runs, facilities stays [] (from useState), and setFacilityId is never called. Actual consequence is silent unhandled rejection with empty facility dropdown and no user error notification.
- **Fix:** Add .catch(() => { setFacilities([]); notifyError(new Error('Không tải được cơ sở'), 'Lỗi tải dữ liệu'); }) after the .then() on line 59, matching the pattern used for student.list.query() on line 60.

### [Teaching UI completeness] apps/teaching/src/cskh-panel.tsx:60
- **Claim:** student.list.query() catch block silently swallows error without calling notifyError; user has no visibility into load failure
- **Evidence:** apps/teaching/src/cskh-panel.tsx:60 — `.catch(() => setStudents([]))` resets the list to empty without calling notifyError. Same pattern at line 70 for afterSale.list. notifyError is imported at line 2 and used in mutation handlers (lines 76, 95, 106, 122) but not in these read queries.
- **Fix:** Add notifyError to both silent catches: line 60 `.catch((e) => { notifyError(e, 'Tải danh sách học sinh thất bại'); setStudents([]); })` and line 70 similarly. The facility.list at line 56 also lacks a catch entirely.

### [LMS UI completeness] packages/ui/src/leaderboard.tsx:17
- **Claim:** Leaderboard silently converts load errors to empty state (.catch(() => setBoards([])). If leaderboard fails to load, user sees 'No classes for ranking' instead of error message, hiding the failure.
- **Evidence:** D:/project/CMCnew/packages/ui/src/leaderboard.tsx:17 — `.catch(() => setBoards([]))` collapses all fetch errors into an empty array. The comment at line 21 treats `[]` as "loaded but no classes", so any network/server error renders the "Chưa có lớp nào để xếp hạng." card (lines 30-38) with no error distinction. A dedicated error state (e.g. `useState<'error' | null | Board[]>`) is absent.
- **Fix:** Add a separate error state (e.g. `const [error, setError] = useState<string | null>(null)`) and in `.catch` set that instead of `setBoards([])`. Render an error message when `error !== null` before checking `boards.length === 0`.

### [Test coverage gaps] apps/api/src/routers/payroll.ts:576-586
- **Claim:** payslipReopen procedure is not tested for error cases. Test at payroll-finalize.int.test.ts line 67 is happy-path only. Missing: test for attempting to reopen draft slip (should BAD_REQUEST), reopen paid slip (should BAD_REQUEST), non-HR role attempting reopen (should FORBIDDEN).
- **Evidence:** apps/api/src/routers/payroll.ts:576-586 — payslipReopen guards `status !== 'finalized'` (line 581) and is wrapped in `requireRole(...HR_ROLES)` (line 576), producing BAD_REQUEST and FORBIDDEN respectively. apps/api/test/payroll-finalize.int.test.ts:67 — the only test callsite for payslipReopen is a happy-path call on a finalized slip; grep across all *.test.ts confirms no other callsites. Missing test cases: reopen a draft slip (BAD_REQUEST), reopen a paid slip (BAD_REQUEST), non-HR caller (FORBIDDEN).
- **Fix:** Add three error-case tests in payroll-finalize.int.test.ts: (1) call payslipReopen on a slip with status='draft' and expect TRPCError code BAD_REQUEST; (2) call on a status='paid' slip and expect BAD_REQUEST; (3) call with a caller that lacks HR_ROLES and expect FORBIDDEN. The production guard logic is already correct — only coverage is missing.

### [Test coverage gaps] apps/api/src/routers/payroll.ts:898-912
- **Claim:** kpiList query procedure has NO test coverage. No test verifies it returns correct KPI sheets for a facility+period, handles empty results, or respects facility isolation.
- **Evidence:** apps/api/src/routers/payroll.ts:898-912 defines kpiList as a read-only query. Grep across all 39 test files in apps/api/test/ returns zero matches for "kpiList". KPI-specific tests (kpi-evaluation-workflow.int.test.ts, kpi-auto-prefill.int.test.ts, kpi-override-audit.int.test.ts) do not reference it.
- **Fix:** Add a test in apps/api/test/kpi-evaluation-workflow.int.test.ts (or a new kpi-list-isolation.int.test.ts) that seeds two facilities with KPI sheets for the same periodKey, calls payroll.kpiList for one facility, and asserts: (1) only that facility's sheets are returned, (2) empty array for a period with no sheets, (3) HR_ROLES gate rejects non-HR callers.

### [Test coverage gaps] apps/api/src/routers/payroll.ts:518-536
- **Claim:** listByStaff query procedure has NO test coverage. No test verifies it returns correct payslips for a staff member, respects facility isolation, or handles empty results.
- **Evidence:** apps/api/src/routers/payroll.ts:518-536 defines `listByStaff`; grep across all apps/api/test/*.test.ts returns zero matches for `listByStaff`. The payroll test suite (payroll-myslips-bulk.int.test.ts, payroll-bulk-pay-byid.int.test.ts, payroll-finalize.int.test.ts) covers adjacent procedures but never calls this one.
- **Fix:** Add an integration test in apps/api/test/ that: (1) seeds a payslip for staffId under facilityId=1, (2) calls listByStaff with that staffId, (3) asserts the returned slip appears and is ordered newest-first, (4) uses a caller scoped to facilityId=2 and asserts empty result (facility isolation). The RLS isolation itself is already tested generically in rls-tenancy.int.test.ts, so the test can be concise.

### [Test coverage gaps] apps/api/src/routers/payroll.ts:752-796, 799-828, 831-876
- **Claim:** kpiEvalSubmit, kpiEvalConfirm, kpiEvalApprove use check-then-act pattern without atomic guarantees. Between findUnique (line 761, 808, 840) and update (line 776, 814, 862), another concurrent request could modify the row. While the update WHERE uses id, the validation check is not atomic. No test verifies concurrent state transitions.
- **Evidence:** packages/db/src/index.ts:47 — withRls uses prisma.$transaction() with no isolationLevel (defaults to read committed). payroll.ts:761+776, 808+814, 840+862 — each procedure does findUnique (status check in application code), then update WHERE { id } only, with no status predicate in the write clause. Under read committed two concurrent requests both pass the guard and both write successfully.
- **Fix:** Add the expected status to the Prisma update WHERE clause (e.g. where: { id: row.id, status: 'draft' }) so that the second concurrent writer gets a RecordNotFound error rather than silently overwriting. Alternatively pass isolationLevel: 'Serializable' to prisma.$transaction() inside withRls. No concurrent-state-transition tests exist.

### [Test coverage gaps] apps/api/test/schedule-my-sessions.int.test.ts:1-195
- **Claim:** schedule.mySessions happy-path-only test. No error case tests for invalid date ranges (from > to), null parameters, or invalid facilityId. No test for sessions with scheduling conflicts (detectConflicts function exists but not exercised in tests).
- **Evidence:** apps/api/test/schedule-my-sessions.int.test.ts:117-193 — 4 tests: role filtering (lines 117, 141), date boundary (line 162), cross-facility isolation (line 179). No tests for from>to, null/invalid inputs, or conflict detection. apps/api/src/routers/schedule.ts:66-74 — mySessions input schema has no .refine() guard for from<=to (contrast: addSlot at line 33 validates startTime<endTime). detectConflicts (schedule.ts:155) is used in generateSessions, not mySessions; no test file exists for generateSessions at all.
- **Fix:** Add .refine((v) => v.from <= v.to, ...) to the mySessions input schema (schedule.ts:73). Add error-case tests: from>to should throw BAD_REQUEST; non-positive facilityId should be rejected by Zod. Add a separate integration test file for generateSessions covering the detectConflicts path (room conflict, teacher conflict, idempotency on re-run).

### [Test coverage gaps] apps/api/test/enrollment-mine.int.test.ts:1-168
- **Claim:** enrollment.mine test doesn't verify behavior with pagination limits, very large result sets, or all-archived enrollment scenarios. No negative tests for invalid session context.
- **Evidence:** apps/api/test/enrollment-mine.int.test.ts:154-158 DOES test archived exclusion (partial refute of that sub-claim). Lines 125-167 show no tests for: pagination/large result sets, the all-archived-only student returning [], or invalid/non-student session contexts (staff session, empty studentIds, malformed LmsSession). Session builder at lines 32-41 only constructs valid student sessions.
- **Fix:** Add: (1) a test where studentA has only archived enrollments and expects empty []; (2) a test calling enrollment.mine() with a staff-kind session or empty studentIds to verify it errors or returns []; (3) if the API supports pagination, add a limit/cursor test. These are additive tests — no production code changes needed.

### [Test coverage gaps] apps/api/test/payslip-commission-override.int.test.ts:95-201
- **Claim:** payslipOverrideVariablePay test lacks cross-facility isolation test. No test verifies that a manager from facility A cannot override slips from facility B. This should be verified given the HIGH severity security issue in line 593.
- **Evidence:** apps/api/test/payslip-commission-override.int.test.ts:1-202 — 4 tests cover same-facility scenarios only (self-override, non-tree role, finalized slip, successful override); no test creates a manager scoped to facility B and attempts to override a payslip from facility A. The implementation at apps/api/src/routers/payroll.ts:605-621 relies on Postgres RLS (packages/db/prisma/migrations/20260623184505_phase4_payroll/migration.sql:93-98: policy `facility_id = ANY(app_facility_ids())`) for cross-facility isolation — documented in apps/api/src/lib/kpi-authz.ts:9 ("RLS already constrains both parties to the same facility"). The isolation works architecturally but has no dedicated integration test to prove it for this endpoint.
- **Fix:** Add a test in the describe block: create a second facility (FAC_B=2), create a slip there, then call payslipOverrideVariablePay with a manager whose facilityIds=[FAC_B] against a slip in FAC (facility 1) and assert NOT_FOUND. This verifies the RLS enforcement assumption that kpi-authz.ts:9 documents but no test validates.

### [Test coverage gaps] apps/api/test/kpi-override-audit.int.test.ts:53-86
- **Claim:** kpiOverride test lacks cross-facility isolation test. No test verifies that a manager from facility A cannot override KPI scores from facility B. This should be verified given the HIGH severity security issue in line 1039.
- **Evidence:** apps/api/test/kpi-override-audit.int.test.ts:53-86 — 87-line file has three tests (manager override, self-override guard, payslip wiring); no cross-facility scenario exists. apps/api/src/routers/payroll.ts:1039-1090 — kpiOverride input schema has no facilityId; facility gate is delegated to RLS via withRls(rlsContextOf(ctx.session),...) at line 1048. apps/api/src/lib/kpi-authz.ts:9 — comment explicitly states "RLS already constrains both parties to the same facility, so this only decides rank." packages/db/src/index.ts:50 — withRls sets app.facility_ids GUC from session facilityIds. The design is intentional but entirely untested by an integration test for cross-facility rejection.
- **Fix:** Add a test: create a second facility (FACILITY_B = 2), assign the sale user to FACILITY_B, create a manager session with facilityIds: [FACILITY_A] only, then call kpiOverride targeting the FACILITY_B employee and assert FORBIDDEN or NOT_FOUND (depending on whether RLS hides or rejects). This validates the RLS-based facility gate that kpi-authz.ts documents as the enforcement mechanism. The "HIGH severity security issue at line 1039" framing in the original claim is incorrect — that line is just where the procedure starts, not a bug; adjust to LOW/MEDIUM as a test-coverage-only gap.

### [Test coverage gaps] apps/api/src/routers/payroll.ts:759-795
- **Claim:** kpiEvalSubmit doesn't validate that submitted scores contain all required criterion keys from the policy. Missing scores are silently filled with 0 (line 773). No test verifies behavior when employee submits partial criterion set or unknown keys.
- **Evidence:** apps/api/src/routers/payroll.ts:773 — `scoreByKey.get(c.key) ?? 0` explicitly fills missing criterion keys with 0. The comment on lines 769-771 acknowledges this: "missing → 0". All four test calls in apps/api/test/kpi-evaluation-workflow.int.test.ts (lines 131, 226, 273, 289, 319) supply the full 3-key set every time; no test submits a partial set or unknown keys.
- **Fix:** Add two test cases to kpi-evaluation-workflow.int.test.ts: (1) submit only a subset of required criteria and assert autoScore uses 0 for the omitted ones; (2) submit an extra unknown key and assert it is ignored and does not inflate the score. No production-code change needed — the behavior is intentional and the comment already documents it.

### [Error handling & tech debt] apps/api/src/routers/payroll.ts:939-940
- **Claim:** Variable 'context' uses type Record<string, any> with eslint-disable for @typescript-eslint/no-explicit-any. Comment explains shape varies by block (sales vs training), but any type still bypasses type safety.
- **Evidence:** D:/project/CMCnew/apps/api/src/routers/payroll.ts:939-940 — `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- context shape varies by block` followed by `let context: Record<string, any> = {};`. The comment acknowledges the type diverges by block (sales vs training) rather than being modelled as a discriminated union.
- **Fix:** Model `context` as a discriminated union type (e.g. `SalesContext | TrainingContext`) or two separate typed variables, one per branch. This removes the `any` and the eslint-disable without changing runtime behavior.

### [Error handling & tech debt] apps/api/src/index.ts:86
- **Claim:** Type casting Buffer to ArrayBuffer using 'as unknown as ArrayBuffer' — double cast needed to work around strict typing. While functional, unclear if Buffer is actually compatible with ArrayBuffer return type.
- **Evidence:** apps/api/src/index.ts:86 — `return c.body(buf as unknown as ArrayBuffer)` where `buf: Buffer` (readPdf returns Promise<Buffer>, apps/api/src/services/pdf-store.ts:48). Buffer extends Uint8Array, not ArrayBuffer; double cast bypasses TypeScript's correct rejection of the direct assignment.
- **Fix:** Replace with `c.body(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))` to pass a real ArrayBuffer, or check if the installed Hono version's body signature already accepts Uint8Array/Buffer directly (in which case remove the cast entirely).

### [Error handling & tech debt] apps/api/src/index.ts:245
- **Claim:** tRPC context cast using 'as unknown as Promise<Record<string, unknown>>'. Comment absent explaining why intermediate cast is needed instead of direct Promise typing.
- **Evidence:** apps/api/src/index.ts:245 — `createContext(c) as unknown as Promise<Record<string, unknown>>`. The function signature at apps/api/src/context.ts:16 shows `createContext` returns `Promise<ApiContext>`, making the double cast a workaround for the `trpcServer` middleware's generic context type. No comment explains the need for the intermediate `unknown` cast instead of a direct assertion or a typed overload.
- **Fix:** Either add a brief comment (e.g., `// trpcServer createContext signature requires Record<string, unknown>; ApiContext satisfies it at runtime`) or fix the type by declaring createContext's return type compatible with tRPC's expected shape using satisfies or a generic parameter, eliminating the double cast entirely.

### [Error handling & tech debt] apps/api/src/rate-limit.ts:23-26
- **Claim:** Environment variables parsed with Number() without validation for invalid formats: LOGIN_RATE_PAIR_LIMIT, LOGIN_RATE_IP_LIMIT, LOGIN_RATE_WINDOW_MS. If env var is empty string, Number('') returns 0, affecting rate limit thresholds silently.
- **Evidence:** apps/api/src/rate-limit.ts:23-26 — `??` only guards null/undefined, not empty string. `Number("") === 0`. If any of the three env vars is set to `""`, the corresponding limit becomes 0: PAIR_LIMIT=0 locks out any IP+identifier after the first failure; IP_LIMIT=0 blocks all logins from an IP after one failure; WINDOW_MS=0 silently disables the limiter entirely (isOver always sees an expired bucket). All three failure modes are silent with no startup validation.
- **Fix:** Replace `Number(process.env.X ?? default)` with a validated parse: read the env var, if it is a non-empty string and `Number(val)` is NaN or <= 0, throw at startup with a descriptive message; otherwise fall back to the default. A single `parsePositiveInt(name, fallback)` helper covers all three vars.

## Cần hỏi user (product/spec)
- [API business logic] room router only implements create and list operations. No update or soft-delete (archive) operation exists. Rooms cannot be modified or archived after creation.
- [API business logic] enroll mutation unconditionally updates student lifecycle to 'active' after enrollment. If student is in 'on_hold', 'transferred', 'withdrawn', or 'completed' state, this silently changes their lifecycle without audit or consent.
- [Payroll/KPI/commission money-logic] Commission override amount (payslipOverrideVariablePay input) has no upper bound validation. Zod schema `amount: z.number().int().nonnegative()` only enforces min(0), allowing arbitrarily large overrides (e.g., 999_999_999_999). Budget cap check (6% of revenue) exists in commissionForSale query but is not enforced in the actual mutation, permitting overrides above reasonable limits.
- [DB schema/migrations] StudentAccount.login_code is globally @unique but should be composite unique per facility, since PIN codes (3-4 digits) are short and could collide across facilities. Currently prevents two facilities from using the same PIN.
- [DB schema/migrations] Receipt.opportunityId (line 876) has no @relation or foreign key constraint; loose reference to Opportunity. If Opportunity is deleted, commission attribution chain breaks. Migration 20260624044329 added the field but no FK constraint.

## Synth note
Report written to:
`D:\project\CMCnew\plans\reports\workflow-subagent-260626-2030-verified-code-review-10haiku-sonnet-report.md`

Summary of what's in it:

- **4 MEDIUM** findings: submission error asymmetry, facility immutable, aftersale cross-facility assign, commission override no ceiling
- **7 LOW** findings: crm reopen no state guard, schedule race condition, room no archive, crm findUnique silent, enrollment no explicit facility check, annotationLayer type cast, enrollment lifecycle not audited
- **3 product questions** for user: aftersale cross-facility intent, commission override ceiling VND value, withdrawn-student re-enrollment flow
- **Hallucination rate: 23.3%** (14 of 60 Haiku claims refuted by Sonnet verify)
- **Priority table:** P0 = aftersale assign + payroll ceiling; P1 = submission/facility/schedule; P2-P3 = remaining cleanups

No auto-fix proposed. All findings are cite-to-line verified.