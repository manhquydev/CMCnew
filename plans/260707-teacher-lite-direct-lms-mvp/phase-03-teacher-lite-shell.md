# Phase 3: Teacher Lite Shell

Status: in-progress

## Goal

Replace teacher-domain bridge with a simple Teacher Lite interface.

## Requirements

- `teacher.cmcvn.edu.vn` opens Teacher Lite by default.
- No full ERP navigation.
- Director and teacher landing differ by role.
- Full ERP stays at `erp.cmcvn.edu.vn`.
- Reuse existing staff auth.
- Existing admin bridge copy/markers must be replaced on teacher domain.
- Jenkins/nginx smoke must assert Teacher Lite-specific text/marker.

## UI Shape

- Left nav:
  - Today
  - Classes
  - Students
  - Materials
  - Submissions
- Director-only actions visible only to director roles.
- Teacher sees assigned work only.

## Tests

- Teacher domain renders Lite shell.
- ERP domain unaffected.
- Unauthorized nav/actions hidden and server-denied.
- `devteacher.cmcvn.edu.vn` remains a dev stack smoke target when available.

## Implementation Result

- Added `apps/admin/src/teacher-lite-intake-panel.tsx`.
- Changed teacher surface copy to `CMC Teacher Lite`.
- Changed `family-intake` nav gate to `teacherLite.createFamilyStudentAndEnroll`.
- Changed teacher-domain `family-intake` route to direct Teacher Lite LMS setup.
- Updated Jenkins teacher smoke markers.
- Updated teacher surface E2E expectations.

## Proof So Far

- `pnpm --filter @cmc/admin typecheck`: passed.
- `pnpm --filter @cmc/admin exec vitest run src/__tests__/nav-teacher-consolidation.test.ts src/__tests__/nav-consistency.test.ts src/__tests__/nav-director-kd-cockpit-consolidation.test.ts src/__tests__/nav-director-dt-cockpit-consolidation.test.ts`: passed.
- `pnpm --filter @cmc/admin lint`: passed with unrelated existing warning in `course-exercise-manager.tsx`.
- `pnpm --filter @cmc/admin build`: passed with existing Vite chunk-size warning.

## Remaining Proof Before Marking Complete

- Run browser smoke with dev server and screenshots.
- Run E2E teacher surface spec against a live app + DB.
- Finish UI labels for Today / Materials / Submissions if product wants those exact module names instead of existing Schedule / Classes / Grading screens.
