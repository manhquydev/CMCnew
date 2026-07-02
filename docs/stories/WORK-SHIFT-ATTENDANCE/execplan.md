# Work Shift Attendance Exec Plan

## Status

Implemented hardening on 2026-07-01 after multi-agent audit.

## Steps

1. Audit product completeness, admin UX, backend authorization, RLS, seed, and test evidence.
2. Fix unreachable Admin routes for facility network and shift config.
3. Add manager approval UI for outside-IP manual punches.
4. Scope registration list/get and punch history by owner/direct manager/HR/super admin.
5. Scope manual punch approval to direct manager or super admin.
6. Validate registration date range, entry date bounds, and template group/facility membership.
7. Supersede all overlapping approved registrations on new approval.
8. Add regression integration coverage and update permission snapshot.
9. Run focused and suite-level verification.

## Risks

- Employment profiles with missing `managerId` cannot be approved by ordinary managers.
- Browser E2E is still needed to prove the full UI click path.
- Current API integration count is 69 files / 347 tests, not the previously reported 70/70 files / 389 tests.

## Rollback

Revert this story's touched attendance/shift files and permission snapshot, then rerun API/admin typecheck and permission parity.
