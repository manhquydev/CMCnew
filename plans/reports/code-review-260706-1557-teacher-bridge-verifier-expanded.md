# Code Review: Teacher Bridge Verifier Expanded

## Scope

Reviewed latest verifier/test/doc changes:

- `apps/api/test/teacher-bridge-staff-setup.int.test.ts`
- `apps/api/test/lms-full-lifecycle-e2e.int.test.ts`
- `apps/api/test/student-provisioning-approve.int.test.ts`
- `scripts/verify-teacher-cmcvn-lms-bridge.ps1`
- Teacher bridge validation/plan/journal/watzup docs

## Findings

No blocking findings.

## Checks

- `teacher-bridge-staff-setup.int.test.ts` now matches the current `user.create` contract:
  staff created by directors are SSO-only, so the test verifies role/facility/API usability instead
  of password login.
- `lms-full-lifecycle-e2e.int.test.ts` now uses a real `giao_vien` actor assigned to the ended
  class session before grade/publish. This exercises the server-side teaching ownership guard.
- `student-provisioning-approve.int.test.ts` now proves parent email persists into
  `ParentAccount`, which is the required notification anchor for the one-form intake flow.
- The verifier still runs in a throwaway Postgres container and restores process env in `finally`.

## Verification

- Focused staff setup: 1 file, 2 tests passed.
- Focused lifecycle/provisioning: 2 files, 8 tests passed.
- Full direct verifier: passed in 80.4s after staff setup was added.
- Harness story verify: `TEACHER-CMCVN-LMS-BRIDGE` pass.

## Residual Risk

- Real Microsoft browser/MFA callback remains operator-assisted. Automated proof covers redirect
  URI, host-only SSO transaction cookie, CORS, cert, and rendered host identity.

## Unresolved Questions

None for the automated teacher bridge verifier scope.
