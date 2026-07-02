# Delegated shift approver + afterSale sale-grant

Date: 2026-07-02

## Status

Accepted

## Context

Shift registration approve/reject is limited to the two directors only
(`permissions.ts:260-261`). An assigned `managerId` (set during onboarding) cannot approve
their own staff's packets — all approval falls back to director role-resolve
(`shift-registration.ts:17-58`). This bottlenecks the directors and defeats the delegated
management design. The anti-self-approve guard (`shift-registration.ts:91`) already exists
but is unused because no non-director has the approve permission.

Separately, the `afterSale.*` permissions (`permissions.ts:28-34`) exclude `sale`, so all
post-sale customer-service cases route to the business director. The `cskh` role is
currently unassigned to anyone (brainstorm §2).

## Decision

1. **Assigned `managerId` may approve/reject that staff's shift packet** via
   `assertAssignedApprover` (`shift-registration.ts:86-101`). The existing anti-self-approve
   guard is retained. `permissions.ts:259-261` `shiftRegistration.approve`/`reject` +=
   `'staff'` (serialized edit #2, after P3).

2. **BOTH directors approve ANY packet** via an explicit director-role bypass ADDED to
   `assertAssignedApprover` (M1). The code was inconsistent — the guard only checked
   assigned-manager, not director roles. Directors are also added to
   `shiftRegistrationPendingItems` + dashboard inbox filter so they see all packets.

3. **`managerId` validation in `profileUpsert` (M8):** `managerId ≠ userId` (self-reference
   → self-block makes packets approvable only by nextManagerId/super_admin); target must be
   ACTIVE co-facility staff (cross-facility/inactive/nonexistent UUID rejected); reject
   A↔B mutual-manager pair (approval-authority loop / collusion). `resolveManager` only
   walks 2 levels so no infinite loop, but the mutual pair is rejected explicitly.

4. **afterSale.{list,create,transition,assign} += `'sale'`** (facility-scoped by existing
   RLS/handler). `setStudentLifecycle` stays director-only. `user.listAssignableForAfterSale`
   (`permissions.ts:241`) += `'sale'` (M7) — the assign dropdown calls it; without this
   grant sale's assign flow throws FORBIDDEN in the UI.

5. **Shift notif fix:** add `nextManagerId` as a notif recipient; `managerId` null →
   warning/fallback (currently notif only goes to managerId, `shift-registration.ts:328-336`).

## Alternatives Considered

1. Directors-only approval. Rejected: bottleneck; defeats delegated management; leads are
   unable to act on their own staff.
2. Full manager-tree approval (any ancestor). Rejected: KISS — `resolveManager` only walks
   2 levels; the A↔B mutual pair is the only cycle risk and is rejected explicitly.
3. Grant `afterSale.*` to a new `cskh` hire instead of sale. Rejected: `cskh` is
   unassigned; sale already handles the customer relationship post-enrollment.

## Consequences

Positive:

- Delegated leads can approve their own staff's shift packets.
- Directors retain full approval access (explicit bypass, not lost).
- Sale handles afterSale cases within own facility, reducing director load.
- `managerId` is validated — no self-reference, cross-facility, or mutual-cycle abuse.

Tradeoffs:

- Opening approve/reject to `staff` broadens the attack surface — mitigated by
  `assertAssignedApprover` (assigned-only) + director bypass (role-scoped) + matrix tests.
- `afterSale` grant to sale could over-reach cross-facility — mitigated by facility-scoped
  RLS/handler + cross-facility denial test.

## Follow-Up

- Integration tests: delegated staff approve own-assigned only; self-approve denied;
  non-assigned director ALLOWED (M1); director sees packet in inbox; notif reaches
  nextManagerId.
- Parity snapshot regen in P6 captures 4 modules: `finance.receiptCreate`+sale,
  `shiftRegistration.approve`+`reject`+staff, `afterSale.*`+sale,
  `user.listAssignableForAfterSale`+sale.
- N5: verify `shift-reg-list-panel` renders the approve action for a non-director assigned
  manager (leads discover packets there, not in `dashboard.myApprovals` which stays
  directors-only).
