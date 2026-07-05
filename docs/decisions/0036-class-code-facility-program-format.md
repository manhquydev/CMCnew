# 0036 Class Code Format: Facility-Program-Year-Seq

Date: 2026-07-05

## Status

Accepted

## Context

Class batch codes (`ClassBatch.code`) were generated as `B-{year}-{seq:0000}`,
scoped per `(facilityId, year)`. This static `B-` prefix carries no
information about which of the 3 CMC programs (UCREA, Bright I.G, Black Hole)
the class belongs to, making codes harder to scan for staff working across
programs. See `plans/reports/brainstorm-260704-2347-class-code-facility-program-format-report.md`
for the full scout + decision trail.

The project has not yet gone into production (no real class data exists),
so this change carries no backward-compatibility burden.

## Decision

Class codes now follow `[Facility.code]-[ProgramAbbrev]-[YY]-[seq:0000]`,
e.g. `HQ-UCR-26-0001`.

- Program abbreviation is a fixed 3-value map (not a DB table):
  `UCREA -> UCR`, `BRIGHT_IG -> BIG`, `BLACK_HOLE -> BH`.
- The program comes from the `Program` enum (via `course.program`), not from
  `Course.code` (which is free-text and unstandardized).
- The sequence counter resets every year, keyed by
  `(facilityId, program, year)` — a new dimension vs. the old
  `(facilityId, year)` key. Counters start at 0 for each new combination;
  they do not inherit the old per-facility-year counts.
- `BatchCodeCounter`'s primary key was widened to
  `(facilityId, program, year)`; existing counter rows were cleared (no
  production data to preserve).

## Alternatives Considered

1. Use `Course.code` as the program-code source — rejected: `Course.code` is
   free-text and not standardized across courses.
2. Omit the year from the code — rejected: since the sequence resets yearly,
   two classes from different years would produce visually identical codes,
   risking confusion in receipts/certificates/audit logs long-term.
3. Backfill/rename existing `B-YYYY-NNNN` codes to the new format — rejected
   as unnecessary; the project has no production class data yet.

## Consequences

Positive:

- Class codes are self-descriptive: facility + program + year + sequence,
  readable at a glance across facilities and programs.
- No migration/backfill risk since there was no production data to migrate.

Tradeoffs:

- `BatchCodeCounter`'s advisory lock key now encodes `program` into the
  second lock parameter (`year * 10 + programIndex`) instead of the raw
  year — a deliberate, documented change (see
  `apps/api/src/services/batch-code.ts`), not an accidental behavior change.

## Follow-Up

- If `Course.code` is standardized in a future initiative, revisit whether
  the class-code program segment should switch from the `Program` enum to
  `Course.code` for finer-grained (per-level) identification.
