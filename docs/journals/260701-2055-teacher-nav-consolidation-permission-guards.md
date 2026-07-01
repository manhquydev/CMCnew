# Teacher Nav Consolidation + Per-Tab Permission Checks

**Date**: 2026-07-01 20:09  
**Severity**: Medium  
**Component**: Admin App, Nav & RBAC  
**Status**: Resolved (code review fix applied)

## What Happened

Implemented teacher nav consolidation per `plans/260701-1910-teacher-nav-lich360-consolidation`: collapsed 9 sidebar nav items into 3 aggregate screens for `giao_vien`-only accounts. These 3 screens (`Lịch giảng dạy`, `Quản lý học sinh`, `Lương & chấm công`) are tabbed interfaces bundling formerly standalone sections (classes/courses/assessment, my-payslips/check-in).

A **code review flagged a medium-severity gap**: two new aggregate panels (`student-management-panel.tsx` and `payroll-checkin-panel.tsx`) lacked per-tab permission checks. If a user's permissions changed (e.g., assessment permission revoked), the tab would still be visible but the content would fail or show stale data.

## The Brutal Truth

This stung. The feature looked clean — nav collapsing worked, tabs rendered, panels displayed content. The code review caught the gap late, meaning we'd shipped code violating the principle: **"permission visibility must exactly mirror underlying action permissions."** Teachers with restricted assessment access would see an assessment tab that shouldn't exist in their view. Not a security breach, but a UX violation that creates confusion and makes debugging a nightmare.

## Technical Details

**Missing Permission Checks (Initial State)**:
- `student-management-panel.tsx`: Rendered assessment tab unconditionally; should gate on `can(me.roles, me.isSuperAdmin, 'assessment', 'termList')`
- `payroll-checkin-panel.tsx`: Rendered check-in tab without checking `can(me.roles, me.isSuperAdmin, 'checkInOut', 'punch')`

**The Correct Pattern** (now in place):
```typescript
// student-management-panel.tsx
const canAssessment = can(me.roles, me.isSuperAdmin, 'assessment', 'termList');
// Render tab only if canAssessment is true

// payroll-checkin-panel.tsx
const canCheckin = can(me.roles, me.isSuperAdmin, 'checkInOut', 'punch');
// Render tab only if canCheckin is true
```

**Root Cause**: Mechanical refactor (move components, wrap in tabs) without enforcing permission checks follow. When extracting panels, we didn't mirror the exact permission gates NAV_GATES used for standalone sections.

## What We Tried

1. Initial panel extraction — tabs render, no `can()` checks added
2. Code review flagged permission visibility mismatch (multi-agent scan)
3. Applied fix immediately: mirrored NAV_GATES permissions in each panel's `canXxx` computed values
4. Added regression test suite (`nav-teacher-consolidation.test.ts`) deriving expected tab visibility from live NAV_GATES/PERMISSIONS registry — future permission changes automatically validate tab visibility

## Root Cause Analysis

Consolidation plan was solid, but **implementation checklist lacked a mandatory step: "Verify each new tab's visibility guard mirrors original nav item's permission gate."** We followed component extraction patterns correctly but skipped permission-contract verification essential when bundling multiple permission-gated features into a single UI container.

This is a **refactoring-specific blind spot**: when moving code previously protected by higher-level gates into a new container, you must explicitly replicate those gates at the new level. Inner panels have their own permission checks (for data fetching), but the tab itself is a new surface needing its own guard.

## Lessons Learned

1. **Permission visibility is part of feature contract.** When refactoring permission-gated components into new containers, add permission checks to the container, not just inner components.

2. **Regression tests should derive expectations from registry, not hardcoded role lists.** The test now calls `can()` dynamically for each tab, so permission changes in `permissions.ts` automatically cascade into test assertions.

3. **Add to code-review checklist: "Did visibility match the underlying permission gate?"** Make this citable for permission-touching changes.

4. **Tab visibility is UI boundary requiring permission guards.** Tabs are visible surfaces, not internal routing — they set user expectations. Hidden tabs signal feature doesn't apply.

## Next Steps

- ✅ Permission checks added to both panels
- ✅ Regression test suite with dynamic permission derivation
- ✅ E2E smoke tests pass
- **Pending**: Full teacher workflow E2E against prod-like stack (after Jenkins stabilization)
- **Future**: Update code-review checklist for permission-gated container pattern

## Files Modified

- `apps/admin/src/student-management-panel.tsx` — added `canAssessment` check
- `apps/admin/src/payroll-checkin-panel.tsx` — added `canCheckin` check
- `apps/admin/src/__tests__/nav-teacher-consolidation.test.ts` — regression suite
- `apps/e2e/tests/teacher-nav-consolidation.spec.ts` — E2E smoke test
