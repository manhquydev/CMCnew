# Design

## Domain Model

MVP keeps existing domain ownership:

- Staff users stay in `AppUser`.
- Students, parents, guardians, enrollments, exercises, submissions, attendance, and session evidence stay in existing tables.
- Parent/student one-form defaults to a draft/provisioning handoff that preserves receipt/provisioning ownership. The supported intake surface is the new-student receipt form: parent phone, parent name, parent email, student name, optional student DOB, and optional class are captured together, then real provisioning happens at approval.
- Direct active student creation is an expanded option requiring a new accepted decision and provenance.

## Application Flow

1. Staff opens `teacher.cmcvn.edu.vn`.
2. Nginx routes the host to the existing admin SPA and API. Production uses the prod API/DB;
   `devteacher.cmcvn.edu.vn` routes to the `cmcnew-dev` admin/API stack and synthetic dev DB.
3. Runtime host detection switches the shared bundle into Teacher Console mode on `teacher.cmcvn.edu.vn`
   and `devteacher.cmcvn.edu.vn`: login title/copy, browser title, topbar brand, default landing,
   sidebar groups, and teacher/director labels are no longer ERP-branded.
   The teacher surface must not expose the full finance/CRM/HR/payroll/work-shift ERP modules.
   Parent+student intake is a dedicated `family-intake` surface that reuses the existing
   `finance.receiptCreate` contract without rendering the full finance panel.
4. Staff login is host-aware: SSO/password flow returns to the initiating staff host with host-only cookies.
5. Directors use existing class/exercise/family flows, plus only the missing intake handoff if needed.
6. Teachers use existing class day UI; API adds ownership guards where current behavior is only UI-warning based.
7. Parent/student LMS remains at `hoc.cmcvn.edu.vn`.

## Interface Contract

Expected changed contracts:

- Staff SSO return origin/path allowlist.
- Optional director intake draft/provisioning endpoint.
- Teacher mutation guards for attendance, session evidence, and grading.
- Nginx/Jenkins smoke for `teacher.cmcvn.edu.vn`.

## Data Model

MVP should avoid schema changes. Schema changes are allowed only if user accepts direct active-student intake, in which case provenance must be first-class and queryable.

## UI / Platform Impact

The staff app must show a host-aware Teacher Console on teacher domain; seeing the generic ERP shell there is a regression. Relabeling a full ERP module, such as showing the full finance panel as "intake", is also a regression. Host detection is not an authorization boundary. Existing server permissions/RLS remain authoritative.

## Observability

- Harness trace for plan/validation/deploy evidence.
- Audit rows should use actor IDs, target IDs, facility IDs, and masked contact values.
- Deployment smoke must record teacher-domain health/login checks.

## Alternatives Considered

1. New `apps/teacher`: rejected for MVP because it duplicates auth/API/deploy surface and conflicts with the retired teaching app direction.
2. Teacher vhost to existing admin: accepted MVP path.
3. `devteacher.cmcvn.edu.vn`: accepted after the production-safety audit; it is a dev-only
   Teacher Console host over `cmcnew-dev`, not a prod alias.
