# Work-Shift QA Fixes: Promise.all Silent Failure in Manager Approval Flow

**Date**: 2026-07-01 14:15
**Severity**: Critical (when discovered), now Fixed
**Component**: apps/admin checkin-panel, apps/api work-shift-attendance + session-evidence
**Status**: Resolved (commit 3d6db9d)

## What Happened

Completed the second phase of QA fixes for the work-shift-attendance + session-evidence feature set (checkin/checkout with facility IP allowlist, shift registration, session photo evidence published to LMS). 

Earlier QA pass (same day, morning) had surfaced 3 Critical bugs (shift-registration race condition on overlapping approvals; check-in missing server-side debounce allowing duplicate 19ms punch pairs; session-evidence photoRef not verified on disk) and 1 High (facility-ip CIDR field accepted `0.0.0.0/0`). Those were fixed and verified to 347→354 integration test pass.

This session closed two Medium findings from that pass (permission gate on `/upload/session-photo` endpoint; RLS scoping left as-is per accepted RBAC decision) and expanded test coverage. While writing a manager-approval e2e test, uncovered a genuine bug: `apps/admin/src/checkin-panel.tsx`'s `loadStatus()` used `Promise.all()` to bundle `checkIP`, `todayStatus`, and `pendingManual` in parallel. The `todayStatus` endpoint requires punch-holder or admin role; manager roles (`quan_ly`, `giao_vu`) are not in its permission list. When a manager-only account tried to load the panel, that one endpoint rejected with `FORBIDDEN`, which silently crashed the entire `Promise.all` and left all three values undefined. The pending-punch-approval list (which managers actually need) was invisible through the UI, even though the API endpoint itself works fine when called directly.

## Technical Details

**The Bug**
```typescript
// apps/admin/src/checkin-panel.tsx (before fix)
const [checkIP, todayStatus, pendingManual] = await Promise.all([
  query.facility.checkIP(), 
  query.punch.todayStatus(),  // ← lacks "quan_ly" role check
  query.manualPunchApprovalList()
]);
```

When `query.punch.todayStatus()` threw `FORBIDDEN` for a manager-only user, the entire `Promise.all` rejected. State remained uninitialized. Manager saw a blank/loading punch card instead of the approvals list.

**The Fix**
- Replaced `Promise.all` with `Promise.allSettled` to isolate failures
- Added explicit `canPunch` role check (staff and above can see punch status; managers cannot punch but can approve)
- Conditional render: hide the punch-status card entirely for manager-only viewers (they don't punch, only approve)

```typescript
// apps/admin/src/checkin-panel.tsx (after fix)
const settled = await Promise.allSettled([
  query.facility.checkIP(), 
  query.punch.todayStatus(),
  query.manualPunchApprovalList()
]);
const canPunch = ['staff', 'giao_vu_truong', 'truong_phong'].includes(role);
const checkIP = settled[0].status === 'fulfilled' ? settled[0].value : null;
const todayStatus = canPunch && settled[1].status === 'fulfilled' ? settled[1].value : null;
const pendingManual = settled[2].status === 'fulfilled' ? settled[2].value : [];
```

**Test Coverage Added**
- e2e: manager can load and approve pending punches (`work-shift-manual-punch-approval.spec.ts`)
- e2e: non-staff user cannot upload session photos (`session-photo-upload-permission.spec.ts`)
- unit: `lateMinutes` and `earlyLeaveMinutes` calculation (exported previously-private pure functions for direct testing)
- unit: session-evidence required-field validation

## What We Tried

1. Initial fix: added manager role to `todayStatus` permission list — rejected because managers don't punch, shouldn't see punch history. Wrong surface to fix.
2. Switched to `Promise.allSettled` + role guard + conditional render — correct surface and semantics.
3. Code reviewer flagged unnecessary `as string[]` cast (fixed).
4. Code reviewer requested permission-gate test on `/upload/session-photo` endpoint itself (added as e2e spec).

## Root Cause Analysis

**Why This Happened**

1. **Permission boundary mismatch**: The checkin panel was written assuming all users who visit it have punch permissions. Managers visit to approve punches, not to check their own punch status. The role check lived on the endpoint, not in the UI coordinator.

2. **Promise.all failure semantics**: `Promise.all` throws on any rejection. Useful when you need atomicity; dangerous when you have independent concerns (IP check, my punch history, pending approvals). One permission failure cascaded to silent failure of three unrelated fetches.

3. **Test gap**: No e2e test for manager-only flow before merge. The happy-path e2e tests ran with staff+ accounts, which mask permission rejections.

## Lessons Learned

1. **Promise.all requires atomicity**. If the fetches are independent (IP check is not affected by whether I can see punch history), use `Promise.allSettled`. Let failures be local.

2. **UI role checks must match endpoint role checks**. A component that serves multiple roles should not assume all roles have permission on all sub-endpoints. Either gate at the component level or ensure all sub-endpoints allow the roles you expect. Better: both.

3. **e2e tests should cover all intended roles, not just happy-path roles**. A manager-approval feature is not tested if you never run it as a manager.

4. **Silent failures on permission errors compound quickly**. The API returned `FORBIDDEN` (correct), the UI swallowed it and rendered blank (wrong), and the feature appeared broken. Always surface permission errors or hide the entire affected section gracefully.

## Next Steps

- [x] Fixed Promise.all in checkin-panel
- [x] Added permission gate to `/upload/session-photo`
- [x] Added e2e test coverage for manager approval flow
- [x] All integration tests passing (354/354)
- [x] All e2e specs passing (including 2 new)
- [x] tsc and eslint clean
- [x] Code review passed with minor follow-ups (all applied)
- [x] Commit 3d6db9d on develop — 43 files (work-shift-attendance + session-evidence only), deliberate exclusion of ~65 other uncommitted paths (separate LMS login redesign, brand assets, etc.) per user confirmation
- [ ] Open PR to main when deployment is ready (repo convention: no direct commits to main, develop → PR → main)

## Commit Reference

`3d6db9d` — work-shift-attendance + session-evidence QA fixes: Promise.all race condition, permission gates, test coverage
