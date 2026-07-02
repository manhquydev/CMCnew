# Review: admin-commission-chain.spec.ts + admin-monthly-report-drilldown.spec.ts

Date: 2026-07-02
Reviewer: code-reviewer

## admin-commission-chain.spec.ts — RE-RUN RESULT

**Confirmed still passing live:**
```
pnpm --filter @cmc/e2e test tests/admin-commission-chain.spec.ts
✓ 1 [chromium] › sale draft-receipt from opportunity → director approve → opportunity auto-wins to O5 (4.0s)
1 passed (10.2s)
```

## Findings (ranked)

### 1. [Medium] Weak/no-op assertion — O5 stage button is always visible regardless of actual stage
`apps/e2e/tests/admin-commission-chain.spec.ts:63`
```ts
await expect(page.getByRole('button', { name: 'O5 · Nhập học' })).toBeVisible();
```
`StageBar` in `apps/admin/src/opportunity-detail.tsx:114-138` unconditionally renders all 5
`STAGES` buttons on every render — `active`/`done`/disabled state changes button styling, not
presence. This assertion would pass even for a freshly-created O1 opportunity that never
advanced. It proves nothing beyond "the page rendered the CRM pipeline widget" and does not back
the code comment's claim ("the O5 stage button is active").

The genuine proof of the auto-advance is the preceding line:
```ts
await expect(page.getByText('Thành công')).toBeVisible({ timeout: 10_000 });
```
`crm-shared.ts:64` derives `"Thành công"` strictly from `stage === 'O5_ENROLLED' && closedAt` —
this is the real WON-invariant check from decision 0024 and is correctly proving server state
(fetched fresh via `page.goto(oppUrl)`, not stale client cache).

**Fix:** either delete the redundant O5-button assertion, or replace it with a check on the
active-variant attributes (`variant="filled"`, `color="cmcRed"`, `disabled`) so it actually
differentiates "current stage is O5" from "O5 button merely exists in the pipeline bar."

### 2. [Medium] admin-commission-chain.spec.ts has zero teardown — permanently pollutes shared dev DB
No `afterAll`/`afterEach` anywhere in the file. Every run of this spec permanently leaves in the
dev DB: one CRM contact/opportunity (now stage O5_ENROLLED, `closedAt` set, status "Thành công"),
one approved commission receipt, and (per decision 0024) a "won" attribution row feeding
commission/KPI aggregates. Unlike the companion spec in this same delivery
(`admin-monthly-report-drilldown.spec.ts`, which has a complete `afterAll` deleting every row it
creates — timePunch/shiftRegistration/shiftTemplate/employmentProfile/appUser), this spec has no
cleanup path at all.

This is not a *new* pattern — `admin-receipt-provision.spec.ts` (pre-existing, unmodified) has the
identical no-teardown gap, so this spec is following existing (weak) repo precedent rather than
introducing a novel regression. Still worth flagging per the review brief: repeated CI/dev runs
will accumulate stray "won" opportunities and approved receipts in CRM lists, dashboards, and
commission/KPI numbers with no way to distinguish E2E noise from real data.

### 3. [Low] `.first()` on the "Duyệt" button is a shared-dev-DB ordering assumption
`admin-commission-chain.spec.ts:57`: `page.getByRole('button', { name: 'Duyệt' }).first()`.
`finance-panel.tsx:644-648` renders a "Duyệt" button for every receipt with `status === 'draft'`,
across ALL receipts the panel loads (not scoped to the one this test just created) — there is no
client-side sort override, so ordering depends on the API's default order. Combined with finding
#2 (no cleanup — this spec never approves-and-forgets, but a mid-run failure between "create
draft" and "approve" would leave an orphaned draft), a stray leftover draft from a previous failed
run could sort ahead of the new one and cause `.first()` to approve the wrong receipt — making the
next run's "Thành công"/O5 assertions pass or fail against an unrelated opportunity. Confirmed
passing in a clean single run; not proven robust against accumulated state from #2.

### 4. [Confirmed OK] admin-monthly-report-drilldown.spec.ts fixture matches the proven int-test values exactly
Byte-for-byte comparison against `apps/api/test/attendance-payroll-deduction.int.test.ts`:
- Shift: `startTime: '22:00'`, `endTime: '23:00'` — identical in both.
- Punches: `${PERIOD}-05T15:15:00Z` / `${PERIOD}-05T15:40:00Z` (UTC) = 22:15/22:40 ICT against a
  22:00-23:00 shift — identical pattern (int test uses `2099-01-05`, new spec uses `2099-03-05`;
  different far-future periods, no collision risk).
- Expected values: `lateMinutes: 15`, `earlyMinutes: 20`, `penaltyAmount: 27_500` — spec asserts
  `15p` / `20p` / `27.500đ` in the UI, matching the int test's proven server-side math.

### 5. [Confirmed OK] Assertion genuinely targets the M5 fix, not a weaker proxy
`apps/api/src/routers/check-in-out.ts:266` — `monthlyReport` is gated by
`requirePermission('checkInOut', 'monthlyReport')`, resolved against the role allowlist
`['giam_doc_kinh_doanh', 'giam_doc_dao_tao', 'hr', 'ke_toan']` (line 283) — a pure role check, with
**no** call to `canViewStaffPunch` (which is only used in the separate `history` endpoint at line
251, gated by manager/self/hr). The test's director is deliberately not the employee's manager
(`otherManager` holds `managerId`), so a pass genuinely proves the intended bypass, not an
accidental manager-match.

Drill-down ("Xem") is confirmed to be a **pure client-side state toggle**
(`attendance-monthly-report-panel.tsx:103`, `setSelected(row)`) reading `selected.days` already
present in the single `monthlyReport` response — no second network call, no `history`/
`canViewStaffPunch` involvement. The spec's own comment claiming this is accurate.

### 6. [Confirmed OK] Session-injection pattern and route/tab-gating match established precedent
- `mintStaffSession` + `cmc.session` cookie (name/domain/path/sameSite/httpOnly/secure) is
  byte-identical to the established, already-passing `work-shift-manual-punch-approval.spec.ts`.
- `App.tsx:808` `<Route path="/:section" .../>` — confirmed generic, accepts `payroll-checkin` by
  URL regardless of nav visibility.
- `payroll-checkin-panel.tsx:14,22`: `canMonthlyReport = can(me.roles, me.isSuperAdmin,
  'checkInOut', 'monthlyReport')` gates the "Báo cáo công" tab; director's role
  (`giam_doc_kinh_doanh`) is in the permission allowlist (finding #5), and `facilityId =
  me.facilityIds[0]` resolves to `1` from the fixture's `facilities: { create: [{ facilityId: 1
  }] }` — matches `FACILITY_ID` used throughout the spec.
- Statically, this spec would pass once the pre-existing ESM/CJS `import.meta` blocker (confirmed
  by the implementer to also break the already-committed `work-shift-manual-punch-approval.spec.ts`
  identically) is fixed. Not verified live per the stated, pre-existing, out-of-scope blocker —
  correctly not force-worked-around in this review.

### 7. [Confirmed OK] admin-monthly-report-drilldown.spec.ts teardown is complete
`afterAll` (lines 152-164) deletes `timePunch`, `shiftRegistration`, `shiftTemplate`,
`employmentProfile`, and `appUser` rows scoped to the fixture's generated IDs. The only entity not
deleted is the shared `shiftGroup` (code `KINH_DOANH`), which is `upsert`-based and intentionally
shared/durable across specs (same pattern as `attendance-payroll-deduction.int.test.ts` and
`work-shift-manual-punch-approval.spec.ts`) — not a leak. Unique `Date.now()`+random suffixing on
all created emails/codes avoids collision with parallel runs.

## Unresolved Questions

- None for the reviewed files. The ESM/CJS blocker for flow #3 is confirmed pre-existing and
  correctly out of scope for this review per the task brief.

## Recommended Actions (priority order)

1. Fix or remove the no-op O5-button assertion in `admin-commission-chain.spec.ts:63` (finding #1).
2. Add `afterAll` teardown to `admin-commission-chain.spec.ts` to delete the created contact/
   opportunity/receipt (finding #2) — also reduces the `.first()` fragility risk (finding #3).
3. No action required for `admin-monthly-report-drilldown.spec.ts` static correctness; it remains
   blocked on the separately-tracked ESM/CJS infra fix before it can be run live.
