# Work Shift Attendance Design

## Boundaries

- Prisma models: `ShiftGroup`, `ShiftTemplate`, `ShiftRegistration`, `ShiftRegistrationEntry`, `TimePunch`, `FacilityNetwork`, `ShiftCodeCounter`.
- tRPC routers: `shiftConfig`, `shiftRegistration`, `checkInOut`, `facilityNetwork`.
- Admin panels: `CheckInPanel`, `ShiftRegListPanel`, `ShiftRegDetailPanel`, `FacilityNetworkPanel`, `ShiftConfigPanel`.

## Ownership

- Staff can create/read their own registrations and punches.
- Direct managers can list, read, approve, and reject their assigned staff's submitted registrations.
- Direct managers can see and approve outside-IP manual punches for their assigned staff.
- HR and super admin retain broad operational visibility.
- Same-facility peer staff do not read each other's registrations or punch history.

## Network Trust

`FacilityNetwork` stores facility-scoped IP/CIDR ranges. `checkInOut.punch` resolves current request IP against active facility ranges. Match means `method=wifi` and auto approval; mismatch means `method=manual`, pending manager approval.

## Supersede Rule

Approving a submitted registration cancels older approved registrations for the same user/facility whose date ranges overlap the new approved range. Non-overlapping approved registrations remain active.

## Open Tradeoff

`quan_ly` can create/delete facility network ranges. If policy requires central-only control, restrict to `super_admin` and keep manager UI read-only.
