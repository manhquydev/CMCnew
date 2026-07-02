# Curriculum Unit Global Table Without RLS

Date: 2026-07-02

## Status

Accepted

## Context

The curriculum framework (UCREA L1–L3, Bright I.G J/T/C/W/Q/U) is hard-coded reference
data: one `CurriculumUnit` row per lesson/review, grouped into one `Course` per program level.
It carries only academic content (theme, book/play-kit, thinking goal, assessment label) — no
student, facility, or financial data. Every classroom in every facility teaches the same
framework, so the data is intentionally global rather than facility-scoped.

The existing `course` table is the precedent: it is global, has no `facility_id`, and is **not**
under row-level security (RLS). It is readable app-wide because the tenancy migration grants
`SELECT/INSERT/UPDATE/DELETE` on all tables to `cmc_app` plus `ALTER DEFAULT PRIVILEGES` for
future tables, and the RLS-enable loop explicitly excludes `course`.

## Decision

`curriculum_unit` is a global table with **no `facility_id` and no RLS policy**, mirroring
`course`. It is readable by any authenticated principal (staff via `protectedProcedure`, and
students/parents via the LMS `sessionsForStudent` join) through the schema default privileges
granted to `cmc_app` — not through an RLS policy.

Because there is no RLS backstop on this table, **any future write path to `curriculum.*` MUST
be gated at the application layer** by an explicit permission (e.g. a `curriculum` resource owned
by `giam_doc_dao_tao`), exactly as the app-user management surface does. This round ships
seed + read only, so no write permission exists yet.

## Alternatives Considered

1. Facility-scope `curriculum_unit` with RLS — rejected: the framework is identical across
   facilities, so per-facility copies would duplicate reference data and drift.
2. Enable RLS with a "readable by all" policy — rejected: adds a policy with no tenant
   dimension to enforce; inconsistent with the `course` precedent and pure overhead.

## Consequences

Positive:

- One canonical framework, seeded idempotently from CSV; no per-facility duplication.
- Reads are simple and cheap (no RLS predicate) and reuse the `course` GRANT model.
- LMS students/parents can read curriculum content without a tenancy carve-out (no PII exposed).

Negative / risk:

- No database-level backstop on writes. Mitigated by the invariant above: mutations must be
  app-layer permission-gated. Captured in `schema.prisma` (model comment) and Phase 1 notes.

## Verification

- Additive migration `20260701230000_curriculum_unit` contains no `ENABLE ROW LEVEL SECURITY`
  for `curriculum_unit`.
- `apps/api/test/curriculum-read.int.test.ts`: any staff role reads; unauthenticated is rejected.
- `apps/api/test/lms-sessions-for-student.int.test.ts`: LMS principal reads curriculum content
  only for owned students; a non-owned student's sessions are never returned.
