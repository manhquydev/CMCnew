# Deferred Debt

Date: 2026-07-02

This file records backend-ready or identified gaps intentionally left out of the LMS/ERP seam fixes.

## Backend-Ready UI Gaps

- Badge administration: backend exists for badge/star mechanics; admin CRUD/review UI remains deferred.
- Shift registration withdraw/cancel: shift registration flow supports submit/approve paths; employee withdraw UX remains deferred.
- Room update/archive: room creation/listing is wired; edit/archive UI remains deferred.
- Facility network update/archive: network list/create exists; full management UX remains deferred.
- Payroll domain read filtering: P5 keeps director read/list surfaces facility-wide; only writes are domain-scoped.

## Cleanup Follow-Up

- Replace the centralized shallow tRPC boundary in `apps/admin/src/shallow-trpc.ts` with direct typed calls after router output types are simplified enough to avoid TS2589.
- Add focused integration coverage for payroll director domain write guards beyond permission snapshots.
- Verify production LMS bundle behavior around `/showcase` during the next build/deploy review.

## Unresolved Questions

- Should director read surfaces eventually hide non-domain staff, or is facility-wide executive visibility intentional long term?
