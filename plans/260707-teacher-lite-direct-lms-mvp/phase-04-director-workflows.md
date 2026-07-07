# Phase 4: Director Workflows

## Goal

Build director operations in Teacher Lite.

## Workflows

- Create class.
- Cancel class.
- Cancel session.
- Create parent/student.
- Add student to class.
- Send parent LMS email.
- Upload learning material by lesson/session.
- See deterministic conflict errors for duplicate parent email/phone/student enrollment.

## Acceptance

- Director can complete class setup without finance/receipt.
- Learning materials open in LMS using existing session-level rules.
- Cancelled sessions/classes are visibly inactive.
- Both directors can do the same Lite setup path, without gaining full finance/CRM authority.

## Tests

- API integration for each mutation.
- UI happy path for direct setup.
- Negative role/facility tests.

## Implementation Proof

- Added `teacherLite.createClass`, `teacherLite.cancelClass`, and `teacherLite.cancelSession`.
- Kept legacy `classBatch.*` and `schedule.*` permissions unchanged.
- Added `teacher-lite-class-workflows.ts` service facade for class creation, initial weekly session generation, class cancel cascade, and single-session cancel.
- Added Teacher Lite class control panel on the teacher domain intake surface.
- Learning material upload remains the existing `exercise.upsert` path in Courses / lesson exercises, already allowed for both directors.

## Validation

- `pnpm --filter @cmc/api typecheck`: passed.
- `pnpm --filter @cmc/admin typecheck`: passed.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`: passed.
- `pnpm --filter @cmc/api exec vitest run test/teacher-lite-direct-provisioning.int.test.ts`: passed with DB soft-skip in local environment.
- `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts src/__tests__/nav-consistency.test.ts src/__tests__/nav-director-kd-cockpit-consolidation.test.ts src/__tests__/nav-director-dt-cockpit-consolidation.test.ts`: passed.
- `pnpm --filter @cmc/api lint`: passed with 2 unrelated existing warnings.
- `pnpm --filter @cmc/admin lint`: passed with 1 unrelated existing warning.
- `pnpm --filter @cmc/admin build`: passed with Vite chunk-size warning.
- `gitnexus_detect_changes(scope=all)`: medium; expected shell/dashboard/nav metadata impact. New Teacher Lite files are not indexed until the next analyze.

## Remaining

- Browser E2E against a running app.
- DB-backed integration proof on a reachable Postgres instance.
