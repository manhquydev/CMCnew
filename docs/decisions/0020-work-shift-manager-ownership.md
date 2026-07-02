# Work Shift Manager Ownership

Date: 2026-07-01

## Status

Accepted

## Context

Work-shift registration and punch attendance touch staff timekeeping, leave, penalties, and facility-scoped network trust. Audit found the initial surface let same-facility staff or broad manager roles see or approve records beyond their reporting line.

## Decision

Shift registration and manual punch approval are owned by the employee, the employee's direct manager (via `EmploymentProfile.managerId`), HR, or super admin.

Facility WiFi/IP network ranges are configured by super_admin or IT operations. This keeps company network policy centralized and secure instead of delegating to facility managers.

## Alternatives Considered

1. Keep all same-facility staff visible to each other.
2. Limit WiFi/IP configuration to `super_admin` only.

## Consequences

Positive:

- Direct manager approval now has a clear data ownership boundary.
- Outside-IP punches can be reviewed in product UI.
- Facility WiFi/IP ranges can be updated by operations without code edits.

Tradeoffs:

- Centralizing network config requires ops team involvement for any WiFi/CIDR changes. Future: consider a facility-scoped manager approval workflow if needed.
- Employment profile manager assignment becomes critical operational data — must be kept accurate for approval chain to work.

## Follow-Up

- Decide whether directors should also configure facility WiFi/IP ranges.
- Add browser E2E for manager approval queue and network settings when CI/browser lane is available.
