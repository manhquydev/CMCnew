# Brainstorm: dev/prod reference data parity for Teacher

Date: 2026-07-06

## Question

Dev does not look close enough to prod for Teacher flows. Example: "Khung chương trình" is missing when creating a course/class in dev. Need verify if more seed/deploy gaps exist.

## Evidence

- Code: `packages/db/src/seed.ts` default/full seed creates demo/staff/student data and one priced demo course `UCREA-CB`, but does not call `seedCurriculum`.
- Code: `packages/db/src/seed-curriculum.ts` defines `seedCurriculum`; GitNexus context shows callers are the CLI file itself and tests, not `seed.ts`.
- Docs: `docs/operate-and-test-guide.md` says curriculum must be loaded with `pnpm --filter @cmc/db seed:curriculum`, before `seed:demo`.
- CI: `scripts/ci-integration-tests.sh` currently runs only `pnpm --filter @cmc/db seed`, so CI smoke can miss missing curriculum seed unless focused tests call it themselves.
- Live infra: prod and dev have separate Postgres containers:
  - `cmcnew-prod-postgres-1`
  - `cmcnew-dev-dev-postgres-1`

## Live DB Snapshot

Prod:

| table | count |
|---|---:|
| app_user | 4 |
| class_batch | 4 |
| course | 9 |
| course_price | 3 |
| curriculum_unit | 60 |
| parent_account | 5 |
| student | 5 |

Dev:

| table | count |
|---|---:|
| app_user | 12 |
| class_batch | 0 |
| course | 2 |
| course_price | 2 |
| curriculum_unit | 0 |
| parent_account | 1 |
| student | 2 |

Prod course framework:

- `UCREA-L1/L2/L3`: 12 units each.
- `BRIGHT_IG-J/T/C/W/Q/U`: 4 units each.
- Total: 9 courses, 60 units.

Dev courses:

- `UCREA-CB`: 0 units.
- `CRS_10512_5483`: 0 units.

## Assessment

The user's suspicion is real: dev is missing the canonical curriculum reference data. It is not just a UI mismatch.

This is not evidence that dev and prod share the same DB. They are separated. The problem is dev is not seeded with the same global/reference data needed by the Teacher/class workflow.

Do not copy all prod data into dev. Prod has operational data and likely PII/finance/student records. The right target is parity for safe reference/master data:

- `course`
- `curriculum_unit`
- selected `course_price` if the UI requires priced courses
- facilities/rooms/shift templates when needed by scheduling smoke
- grading templates/badges only if the flow depends on them

## Options

### A. Reference-data seed parity, recommended

Make a canonical idempotent seed path for dev/local/CI that runs:

1. `seed`
2. `seed:curriculum`
3. `seed:demo` where demo operational fixtures are useful
4. `seed:lms` only for LMS verification personas/classes, not for prod

Then add a smoke/drift check that fails if dev has no framework courses or no curriculum units.

Pros: deterministic, safe, no prod PII leak, catches the exact failure.
Cons: less realistic than prod operational history.

### B. Sanitized prod snapshot into dev

Nightly clone prod into dev after anonymizing parents/students/finance/contact fields.

Pros: realistic data shape.
Cons: high privacy risk, more ops complexity, can hide seed defects.

### C. One-off run `seed:curriculum` on dev

Fast emergency repair.

Pros: fixes the observed "Khung chương trình" gap quickly.
Cons: drift will return unless CI/deploy keeps checking it.

## Recommendation

Do C immediately only as a repair, then implement A as the durable fix.

Minimum acceptance:

- Dev DB has 9 framework courses and 60 curriculum units.
- `devteacher.cmcvn.edu.vn` class-create/course list sees `UCREA-L1/L2/L3` and `BRIGHT_IG-J/T/C/W/Q/U`.
- Jenkins develop smoke checks `devteacher` returns the develop commit and validates reference seed readiness.
- CI integration seed should include `seed:curriculum` before tests that depend on class/curriculum behavior.

## Unresolved Questions

- Should dev include `seed:lms` every deploy, or only in explicit verification runs?
- Should dev maintain demo `class_batch` rows, or should class creation be tested from empty operational data each time?
