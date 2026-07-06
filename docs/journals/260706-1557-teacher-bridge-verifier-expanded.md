# Teacher Bridge Verifier Expanded

## Context

The live Teacher Console bug report was not just a UI complaint. It exposed a proof gap:
`/family-intake` could show success while the operator had no visible durable artifact, and the
story verifier did not prove every original teacher-flow requirement.

## What Happened

- Re-audited the original `teacher.cmcvn.edu.vn` objective requirement-by-requirement.
- Kept runtime behavior aligned with accepted decisions:
  - class code format from decision 0036,
  - receipt/provisioning handoff from decision 0037,
  - global curriculum exercise asset model from decision 0022.
- Expanded `scripts/verify-teacher-cmcvn-lms-bridge.ps1` so the story gate now covers:
  staff setup by education director, teacher session scope, class code creation, class slots,
  director exercise upload, intake draft visibility, receipt approval provisioning, teacher-role
  grading, student submission, parent read-only grade/annotation visibility, Playwright LMS flows,
  and live Teacher host smoke.
- Tightened tests:
  - `lms-full-lifecycle-e2e.int.test.ts` now grades/publishes as a real `giao_vien` assigned to
    the class session instead of a default super-admin staff caller.
  - `student-provisioning-approve.int.test.ts` now asserts parent email survives receipt approval
    into `ParentAccount`.
  - `teacher-bridge-staff-setup.int.test.ts` proves GĐĐT can create a teacher staff account in ERP
    scope and GĐKD cannot grant the teacher role.

## Verification

- Focused staff setup test passed: 1 file, 2 tests.
- Focused lifecycle/provisioning rerun passed: 2 files, 8 tests.
- Full direct verifier passed twice:
  - 89.6s before the staff-setup proof.
  - 80.4s after the staff-setup proof was added.
- `harness-cli story verify TEACHER-CMCVN-LMS-BRIDGE` passed after the final verifier update.
- GitNexus `detect_changes(scope=all)` reported medium risk because the whole teacher worktree is
  dirty; the new verifier expansion itself is test/doc scoped.

## Decisions

- Do not create direct active student intake. Preserve receipt draft -> approval -> provisioning.
- Do not treat `user.create` password input as a login credential; staff created by ERP are SSO-only
  by design. The staff setup proof verifies role/facility/API usability, not password login.
- Treat the direct verifier output as authoritative evidence because `story verify` prints only a
  summarized pass line.

## Next

- Keep `scripts/verify-teacher-cmcvn-lms-bridge.ps1` as the release gate for teacher scope claims.
- Commit or stash the current dirty teacher worktree before switching contexts.
