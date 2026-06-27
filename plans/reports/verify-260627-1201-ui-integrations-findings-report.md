# Verify: UI + Integrations Findings (reports 07/08/09)

Date: 2026-06-27 | Mode: READ-ONLY adversarial re-verification | Branch: develop
Source reviews generated ~10:33 (pre-fix-wave). Each finding re-checked against current code.

Verdict legend: REAL (confirmed bug) / FALSE / ALREADY-FIXED / INTENTIONAL (known + documented) / OBSOLETE (apps/teaching retired).

## 07 Admin UI

| # | Finding | Verdict | OBSOLETE? | Evidence (current code) | Re-rated sev | Fix |
|---|---------|---------|-----------|-------------------------|--------------|-----|
| 1 | Hash deep links bypass nav permission gating | REAL | No | `App.tsx:556-559` `hashToSection()` validates only against `ALL_SECTION_KEYS`; `App.tsx:568-579` sets `activeSection` from hash; `renderContent()` (`App.tsx:596-746`) has **no per-section visibility guard**. Nav gating lives only in `shell.tsx:356-361 buildNavGroups.visible()`. | Med (was High) | In `renderContent`/`hashToSection`, drop to `defaultSection(me)` when section not in visible nav set; guard each case by `can()`. Backend still returns FORBIDDEN on data calls, so this is defense-in-depth/UX, not a data leak. |
| 2 | CSKH assignment dropdown breaks for assigning roles | REAL | No | `cskh-panel.tsx:97 trpc.user.list.query()` loads staff dropdown for everyone opening panel. `permissions.ts:211 user.list = ['super_admin','giam_doc_kinh_doanh','giam_doc_dao_tao']` but `afterSale.assign = ['cskh','quan_ly','giam_doc_kinh_doanh']` (`:31`). So `cskh` AND `quan_ly` can assign but get FORBIDDEN on `user.list` → dropdown errors. | **High** (kept) | Add a narrow staff-picker endpoint permitted for `afterSale.assign` roles (e.g. `user.listAssignable` scoped to facility), use it in cskh-panel instead of `user.list`. Highest-impact: breaks the primary CSKH role's core flow. |
| 3 | CSKH lifecycle mutation exposed to unauthorized roles | REAL | No | `cskh-panel.tsx:357-367` "Vòng đời HS" button rendered whenever `c.studentId` truthy, no role check. `permissions.ts:32 setStudentLifecycle = ['quan_ly']` only. So `cskh`/`giam_doc_kinh_doanh` see+submit → API 403 (`aftersale.ts`). | Med (was High) | Gate button with `can(roles, 'afterSale','setStudentLifecycle')`. UX/defense-in-depth; server enforces. |
| 4 | Class enroll exposes manual student creation | REAL | No | `class-workspace.tsx:373` `+ Tạo học sinh` button rendered unconditionally in `EnrollTab` (`:452`); calls `trpc.student.create` (`:352`). Server: `student.ts:105 create: superAdminProcedure` (break-glass). | Med (was High) | Hide `CreateStudentModal` unless `me.isSuperAdmin`. Dead UI 403s for normal class managers; not a security hole. |
| 5 | Finance student cache stale after approving new-student receipt | REAL | No | `finance-panel.tsx:454-462 approve()` calls only `loadReceipts()`; no refresh of the student list feeding the existing-student receipt selector. Provisioning happens in `finance.receiptApprove`. | Low (was Med) | After approve, also refetch the student list (or invalidate it). Minor UX; reload fixes. |
| 6 | Clickable table rows are mouse-only | REAL | No | `data-table.tsx:201-204` `Table.Tr onClick` with `cursor:pointer` but no `tabIndex`, `role`, or `onKeyDown`. | Med (a11y) | Add `tabIndex={0}`, `role="button"`, and `onKeyDown` (Enter/Space → onRowClick) when `onRowClick` set. |

## 08 Teaching & LMS UI

Note: `apps/teaching` is retired. This report was already correctly scoped to `apps/lms`, `packages/ui`, and `apps/admin/src/shell.tsx` — **no finding references apps/teaching**, so none are OBSOLETE. The concerns were checked in their ported/current locations.

| # | Finding | Verdict | OBSOLETE? | Evidence (current code) | Re-rated sev | Fix |
|---|---------|---------|-----------|-------------------------|--------------|-----|
| 1 | Staff notif bell polling-only despite SSE contract | REAL (design) / INTENTIONAL | No | `use-staff-notif.ts:62 setInterval(fetchUnread, 30_000)`; admin shell consumes this hook. SSE `/sse/notifications` (`notification-stream.ts`) is LMS-only (filters to principal's students). | Low (was High) | Acceptable: 30s staleness, no correctness/security impact. Wiring staff to SSE is an enhancement, not a defect. If desired, add a staff SSE channel. |
| 2 | Student annotation state leaks to a no-PDF exercise | REAL | No | `student-view.tsx:321-324 openExercise` sets `active`; `close()` (`:289`) only flips `opened`, never `setActive(null)` → `{active && <ExerciseModal/>}` (`:412`) keeps one mounted instance. `ExerciseModal` effect (`:117-133`) resets answer/msg/err but loads/clears annotation **only if `exercise.basePdfRef`** — a no-PDF exercise keeps prior `annotation`/`teacherLayer`. `saveDraft`/`submitWork` (`:143`,`:172`) send `annotationLayer: annotation`. | Med (was High) | In the effect, `else { setAnnotation(null); setTeacherLayer(null); }` for no-PDF; or add `key={exercise.id}` to `<ExerciseModal>`; or `setActive(null)` on close. Data-integrity bug. |
| 3 | LMS session expiry/revocation not reflected in shell | REAL | No | `notification-stream.ts:48 es.onerror = () => setConnected(false)`; callers (`student-view`/`parent-view`) ignore `connected`. EventSource auto-reconnects; revocation surfaces only on next tRPC 401 or reload. | Low (was Med) | Optional: on persistent `connected=false`/repeated 401, force `setPrincipal(null)`. Minor UX. |
| 4 | Parent OTP request failures have no visible error | REAL | No | `lms-login-gate.tsx:70-85 onOtpRequest` uses `try/finally` with **no catch**; on `throttle`/network rejection no `otpError` is set and step does not advance (silent). | Low (was Med) | Add `catch { setOtpError('Không gửi được mã, thử lại sau.') }`. |

## 09 Integrations & Async

| # | Finding | Verdict | OBSOLETE? | Evidence (current code) | Re-rated sev | Fix |
|---|---------|---------|-----------|-------------------------|--------------|-----|
| 1 | OTP request succeeds even when email never sent | REAL (conditional) | No | `login-otp.ts:39-43` creates row, `:51 void sendEmailNow(...).catch(log)` fire-and-forget; route `lms-auth.ts:72-73` returns `{ok:true}`. `verifyLoginOtp:70 orderBy createdAt desc` = newest-wins. A failed newest send invalidates an older *delivered* code. Currently Graph is unconfigured (`graphMailerFromEnv()===null`) so dev returns `devCode`; bug bites only once Graph (R6) is live. | Med (was High) | Await send (or send-before-create) and surface failure; or only invalidate prior codes after confirmed send. Note dependency on R6 Graph config. |
| 2 | Email outbox claim not DB-safe across replicas | REAL / INTENTIONAL | No | `email-outbox.ts:122-140` `findMany` then `updateMany` (not atomic across processes); guarded by in-process `workerRunning` flag (`:91,104`). Code comment `:86-90` explicitly documents single-instance scope and that a 2nd replica needs `SELECT ... FOR UPDATE SKIP LOCKED`. Cron embedded per API process (`index.ts`). | Low now / Med if multi-replica | Only fix if prod runs >1 API replica (open question in memory: docker single instance). Then switch claim to raw `FOR UPDATE SKIP LOCKED`. Documented, deliberate. |
| 3 | Callio transient failures: no retry/backoff | REAL | No | `callio-client.ts:64 if(!res.ok) throw` (no retry). `payroll.ts:1166-1178` `fetchPeriodCdrs` awaited with no try/catch inside one `withRls` txn → any 429/5xx mid-paging aborts+rolls back whole sync. | Low (was Med) | Add bounded retry/backoff on 429/5xx in `fetchPeriodCdrs`. Mitigated: sync is manual, idempotent (upsert), safely re-runnable. |
| 4 | Email audit logs include recipient email + provider detail | REAL / likely INTENTIONAL | No | `email-outbox.ts:165` success body includes `row.toAddress`; `:202` failure body includes address + `message.slice(0,200)` (Graph detail via `graph-client.ts`). | Low | Policy decision (open question). If PII-minimization required, log outbox id only, drop address from body. |
| 5 | Staff notification RLS is facility-only | REAL (defensive only) | No | Migration policy facility-scoped; **route already filters by recipient**: `staff-notif.ts:17,30 where:{ recipientId: ctx.session.userId, facilityId }`. Current behavior safe; risk is future query forgetting recipient filter. | Low | Optional hardening: add recipient predicate to RLS policy. Not a current leak. |
| + | (cross-report) Public CRM lead ingest unthrottled, caller chooses facility | REAL | No | `crm.ts:335 leadIngest: publicProcedure`; gated by shared static `CRM_LEAD_TOKEN` (`:349-352`), **no `throttle()`**; `facilityId` caller-supplied and RLS built from it (`:353`). Leaked token → unbounded lead spam into any facility. | Med | Add `throttle()` keyed by IP; consider per-facility token or server-pinned facility. Overlap with auth report — confirmed. |

## Summary

- Findings reviewed: 16 (6 admin + 4 lms/ui + 5 integrations + 1 cross-report CRM).
- REAL: 16 (3 also flagged INTENTIONAL/conditional: 09-#2 outbox, 09-#4 audit PII, 08-#1 polling).
- FALSE / ALREADY-FIXED: 0.
- OBSOLETE (apps/teaching retired): **0** — report 08 was already scoped to lms/ui/admin; no finding pointed at deleted apps/teaching code.
- Net severity correction: most "High" UI findings are real but defense-in-depth/UX (backend enforces) → downgraded to Medium/Low. Two stayed materially high-impact.

### Top 3 confirmed-REAL (by impact)
1. **07-#2 CSKH assignment flow broken for `cskh` + `quan_ly`** — `user.list` permission excludes the very roles allowed to assign (`afterSale.assign`); the assign dropdown errors out, breaking the core CSKH workflow. Functional, not just cosmetic. (`cskh-panel.tsx:97` vs `permissions.ts:211/31`)
2. **08-#2 Student annotation leaks onto a no-PDF exercise** — single persisted `ExerciseModal` + effect that never clears `annotation` for no-PDF exercises → prior PDF marks saved/submitted on a text-only exercise. Data-integrity. (`student-view.tsx:117-133`, `:289/321/412`)
3. **09-#1 OTP newest-wins + fire-and-forget send** — once Graph (R6) is configured, a transient send failure on the newest code silently invalidates an older delivered code; request still returns ok. (`login-otp.ts:39-51/70`)
   Honorable mention: CRM `leadIngest` unthrottled + caller-chosen facility (token-gated) — Medium.

### Unresolved questions
- Will prod run >1 API replica? (gates 09-#2 outbox severity)
- Is recipient email allowed in email audit bodies? (09-#4 policy)
- Should `org`/user-management be director-accessible or super-admin-only? (affects 07-#1/#2 fix shape)

Status: DONE
