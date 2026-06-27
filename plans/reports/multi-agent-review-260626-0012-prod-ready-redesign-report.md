# Multi-Agent Review — Prod-Ready Redesign (2026-06-26)

> Commit reviewed: `0749d09` (develop) — staff notify SSE + bulk pay + commission auto + full ERP UI redesign  
> Agents: 5 launched (4 reported, 1 e2e-coverage idle/silent)  
> Result: **SHIP-BLOCKER found — 1 CRITICAL (RLS missing)**

---

## 1. CRITICAL — Must fix before ship

### C1 · `staff_notification` has NO Row-Level Security _(confirmed by 2 agents)_

**Files:** `packages/db/prisma/migrations/20260625163636_phase_staff_notify/migration.sql` (whole file, no RLS block)  
**Confirmed by:** `review-backend-sse` + `review-db-schema`

**What happened:** Migration creates the table but omits `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`. Every other facility-scoped table in the codebase has RLS (16 tables: payslip, salary_rate, kpi_score, facility, etc.). `staff_notification` is the only exception.

**Impact (real, exploitable):**
- Runtime connects as non-owner role `cmc_app` (non-BYPASSRLS)
- `withRls()` sets GUCs (`app.facility_ids`) but NO policy consumes them → dead code
- Any authenticated staff in facility A can read/write notifications of facility B by sending a crafted `facilityId`
- Notification `body` leaks names + KPI/period context cross-facility
- `markRead`/`markAllRead` can flip rows in other facilities

**Fix — new migration** (do NOT edit applied migration, Prisma checksum drift):
```sql
ALTER TABLE "staff_notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_notification_isolation ON "staff_notification"
  USING (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY(app_facility_ids()))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (app_principal_kind() = 'staff' AND facility_id = ANY(app_facility_ids()))
  );
```

**Command:** `pnpm --filter @cmc/db migrate:dev -- --name rls_staff_notification`

---

## 2. HIGH — Fix before or shortly after ship

### H1 · Emit-before-commit: ghost notifications on DB rollback

**File:** `apps/api/src/lib/emit-staff-notif.ts:42-54`  
**Agent:** `review-backend-sse`

SSE fan-out fires **inside** the transaction, before COMMIT. If the outer transaction rolls back (e.g., enrollment fails validation after emit), clients receive a toast notification for a row that doesn't exist. Fix: move `staffNotificationBus.emit(...)` to after the `withRls(...)` promise resolves. Also fix the docstring which incorrectly claims "after all rows are committed."

---

### H2 · SSE never re-validates auth after token expiry

**File:** `apps/api/src/index.ts:192-218`  
**Agent:** `review-backend-sse`

Session resolved once at connect, then streams indefinitely. Forced logout, deactivation, or token expiry does NOT close an existing SSE stream. Violates "revocation is immediate" guarantee. Fix: re-run `resolveSession` in the heartbeat loop (every N seconds); close stream if session invalid.

---

### H3 · `Promise.all` over shared Prisma interactive tx is a footgun

**Files:** `apps/api/src/lib/emit-staff-notif.ts:25`, `apps/api/src/routers/payroll.ts:528,562`  
**Agent:** `review-db-schema`

Prisma interactive tx uses a single connection. Concurrent queries on that connection (`Promise.all`) can throw "Transaction already closed" under load. Replace with sequential `for...await` for all writes sharing a tx.

---

### H4 · Multi-role staff: sales block silently overrides training KPI + manual variablePay

**File:** `apps/api/src/routers/payroll.ts:361,373`  
**Agent:** `review-payroll-logic`

`roles.includes(Role.sale)` promotes any multi-role staff to the sales KPI band. A teacher-who-also-sells (or manager with residual `sale` role):
1. Gets graded on sales KPI band, not training band  
2. Has HR-entered `variablePay` silently overwritten by commission auto-feed

**Fix options (need product decision):**
- Use `primaryRole` as the authoritative block selector
- Surface in the response that auto-feed overrode manual input
- Only auto-feed commission when `input.variablePay` is not provided

**Impact:** Incorrect net pay / wrong KPI grade for multi-role staff. Real comp calculation bug.

---

### H5 · Active section not URL-synced — F5 resets to default

**Files:** `apps/admin/src/App.tsx:704`, `apps/teaching/src/App.tsx:980`, `apps/lms/src/student-shell.tsx:60`, `apps/lms/src/parent-shell.tsx:32`  
**Agent:** `review-ui-shell`

All 4 shells store active section in `useState` with hardcoded initial. F5 → user loses context, no deep-link support, back/forward broken.

**Fix:** Init from + sync to `location.hash`; validate against known section keys.

---

### H6 · 3 shells missing mobile navbar collapse/burger

**Files:** `apps/admin/src/shell.tsx:121`, `apps/lms/src/student-shell.tsx:72`, `apps/lms/src/parent-shell.tsx:42`  
**Agent:** `review-ui-shell`

Declare `navbar={{ breakpoint: 'sm' }}` but no `collapsed` prop and no burger button → mobile users see no nav below breakpoint. Teaching shell (`shell.tsx:145`) handles this correctly — port its pattern to the other 3.

---

## 3. MEDIUM — Backlog before next sprint

| ID | Finding | File | Agent |
|----|---------|------|-------|
| M1 | `payslipBulkPay` zero test coverage — mixed finalized/paid, cross-facility, 100-cap | `apps/api/test/payroll-myslips-bulk.int.test.ts` | payroll-logic |
| M2 | Teaching payroll gate: `setActiveSection` unguarded → blank panel on H5 hash-restore for unprivileged | `apps/teaching/src/App.tsx:980-1012` | ui-shell |
| M3 | `payslipBulkPay` Zod max error not localized — raw English message vs rest of file Vietnamese | `apps/api/src/routers/payroll.ts:541` | payroll-logic |
| M4 | `compensationParamsSchema` may not validate KPI weight-sum=1 per block — policy misconfiguration causes hard throw at `kpiEvalApprove` | `packages/domain-payroll/` | payroll-logic |
| M5 | Logout has no busy-guard — double-click fires `logout.mutate()` twice + post-unmount setState warning | `packages/ui/src/login-gate.tsx:51`, `lms-login-gate.tsx:64` | ui-shell |
| M6 | Admin bell badge ships hidden (`display:'none'` + literal `0`) — SSE bus exists, just unwired | `apps/admin/src/shell.tsx:167-183` | ui-shell |
| M7 | Missing index for primary list query: `(recipientId, facilityId, createdAt DESC)` | `packages/db/prisma/schema.prisma` | db-schema |
| M8 | `data Json` field on StaffNotification has no shape contract — different callers write different keys | `apps/api/src/lib/emit-staff-notif.ts:33` | db-schema |
| M9 | `setMaxListeners(0)` disables EventEmitter leak detector — silent leak under abnormal disconnects | `apps/api/src/staff-notification.ts:19` | backend-sse |

---

## 4. LOW

| ID | Finding | Agent |
|----|---------|-------|
| L1 | Teaching Avatar has `cursor:pointer` but no role/aria-label — not a button | ui-shell |
| L2 | No `aria-current="page"` on active NavLink | ui-shell |
| L3 | Hardcoded `color:'#fff'` in teaching logo — should use CMC token | ui-shell |
| L4 | `me.displayName?.charAt(0)??'U'` over-defensive — displayName is non-nullable | ui-shell |
| L5 | `staffNotif.list` missing pagination: offset/limit edge cases untested | db-schema |
| L6 | FK `ON DELETE RESTRICT` on recipient_id blocks AppUser hard-delete (low risk given soft-deactivate pattern) | db-schema |

---

## 5. Product decisions needed (block on H4 + H1 scoping)

| # | Question | Drives |
|---|----------|--------|
| D1 | Multi-role block: should `primaryRole` determine KPI band, not `roles.includes`? | H4 severity |
| D2 | Is cross-recipient (same-facility) notification visibility acceptable, or RLS should also scope to `recipient_id`? | RLS policy shape |
| D3 | Should split-commission (secondary `soldById`) be supported, or single attribution accepted? | payroll roadmap |
| D4 | Is active section persistence on F5 a v1 requirement? | H5 priority |
| D5 | Is mobile a supported target for admin/LMS (staff-desktop-only)? | H6 priority |

---

## 6. Test Coverage Gaps — `review-e2e-coverage`

> Verified by grep: `payslipBulkPay`, `staffNotif`, `emitStaffNotif`, `markAllRead`, `/sse/staff`, `block==='sales'` branch → **ZERO references in any test file.** Domain-payroll unit tests + 32-file integration suite are solid; the prod-ready pass added untested code only.

### CRITICAL coverage gaps

| # | Gap | File | New test needed |
|---|-----|------|-----------------|
| TC1 | `staffNotif` router — recipient/facility isolation **unproven** (staff A reading B's notifs) | `staff-notif.ts:12-22` | `apps/api/test/staff-notif.int.test.ts` |
| TC2 | `payslipBulkPay` by-ID — **completely untested**; `failed` bucket (cross-facility, non-finalized) is security branch | `payroll.ts:540-579` | `apps/api/test/payroll-bulk-pay-byid.int.test.ts` |
| TC3 | Commission auto-feed `payslipCompute` — all existing tests use teacher; `block==='sales'` branch **never runs** | `payroll.ts:368-399` | `apps/api/test/payslip-commission-autofeed.int.test.ts` |
| TC4 | No authz FORBIDDEN test for `payslipBulkPay`/payroll mutations — KPI has these, payroll has none | `payroll.ts:540` | same `payroll-bulk-pay-byid.int.test.ts` |

### HIGH

- `emitStaffNotif` DB-persist ↔ SSE-push correlation untested — empty no-op + one push per row
- `kpiEvalSubmit` → manager fan-out untested — **only** production caller of `emitStaffNotif`
- `markAllRead`/`markRead` idempotency unverified (second call should be count:0 no-op)
- `/sse/staff` endpoint: no integration test for 401 gate + recipient filter

### MEDIUM

- `staffNotif.list` hardcoded `take:50`, no pagination params — product gap or accepted?
- E2E: no cross-section nav, no logout (admin/teaching), no notification-bell test
- LMS E2E defaults to parent; student login only runs if `TEST_LMS_MODE=student` — CI coverage gap
- Create-course E2E: happy path only — missing duplicate-code rejection + error-toast

### LOW

- `E2E${Date.now().slice(-6)}` course code can collide across parallel runs — use `uniq()` like int tests
- `commission-for-sale-e2e` uses `new Date()` period — month-boundary race; fixed `2099-04` safer

### Recommended test file creation order

```
1. apps/api/test/staff-notif.int.test.ts        (TC1, HIGH fan-out, HIGH idempotency)
2. apps/api/test/payroll-bulk-pay-byid.int.test.ts (TC2, TC4)
3. apps/api/test/payslip-commission-autofeed.int.test.ts (TC3)
4. apps/api/test/emit-staff-notif.int.test.ts   (HIGH persist↔push)
5. /sse/staff: decide integration-test vs unit-test auth/filter in isolation
6. E2E: logout + cross-section + bell + LMS both modes
```

---

## 7. Fix priority order (ship-gate)

```
BLOCKER (must fix):
  1. C1  — New migration: RLS on staff_notification
  2. H1  — Move SSE emit outside transaction
  3. H3  — Replace Promise.all with sequential for...await in tx context

Pre-ship (high value, fast):
  4. H4  — Product decision on multi-role block → implement fix
  5. H2  — SSE session re-validation in heartbeat

Post-ship sprint 1:
  6. H5  — Hash-sync active section
  7. H6  — Mobile burger on 3 shells
  8. M1  — Integration tests for payslipBulkPay
  9. M2  — Teaching payroll gate guard
  10. M6 — Wire admin bell to SSE unreadCount
```

---

## 8. Verified OK (no action needed)

- `payslipBulkPay` facility isolation — RLS on payslip + `accessibleFacilityIds` double-guard ✓
- `payslipBulkPay` partial-write safety — single `updateMany` inside tx ✓
- Double-compute guard — `@@unique([userId,periodKey])` + draft-only check ✓
- Commission double-count — recomputed from receipts each run, not accumulated ✓
- KPI emit spam — fires in `kpiEvalSubmit` (staff action), NOT in compute cron ✓
- PIT at salary=0 — floors at 0, no divide-by-zero ✓
- SSE logout teardown — `useNotificationStream` closes EventSource on unmount ✓
- AppShell nesting — each app has exactly 1 AppShell root, no double-topbar ✓
- `useSession()` before Provider — impossible, shells are gate children ✓
- `principal.kind` undefined in LMS — never undefined (JWT-carried, auth/lms.ts:45,64) ✓
- `markAllRead`/`markRead` idempotency — `readAt: null` predicate, no race ✓
