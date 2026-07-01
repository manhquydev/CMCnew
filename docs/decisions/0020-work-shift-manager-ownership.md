# Work Shift Manager Ownership

Date: 2026-07-01

## Status

Accepted

## Context

Work-shift registration and punch attendance touch staff timekeeping, leave, penalties, and facility-scoped network trust. Audit found the initial surface let same-facility staff or broad manager roles see or approve records beyond their reporting line.

## Decision

Shift registration and manual punch approval are owned by the employee, the employee's direct manager, HR, or super admin.

Facility managers (`quan_ly`) may configure facility WiFi/IP ranges from Admin UI/API for their assigned facility. This keeps company WiFi policy operational in product UI instead of requiring code changes.

## Alternatives Considered

1. Keep all same-facility staff visible to each other.
2. Limit WiFi/IP configuration to `super_admin` only.

## Consequences

Positive:

- Direct manager approval now has a clear data ownership boundary.
- Outside-IP punches can be reviewed in product UI.
- Facility WiFi/IP ranges can be updated by operations without code edits.

Tradeoffs:

- If business wants only central admins to edit network ranges, hide the `facilityNetwork.create/delete` UI and permissions from `quan_ly`.
- Employment profile manager assignment becomes critical operational data.

## Follow-Up

- Decide whether directors should also configure facility WiFi/IP ranges.
- Add browser E2E for manager approval queue and network settings when CI/browser lane is available.
