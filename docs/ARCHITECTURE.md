# Architecture

> **Note:** The generic template below predates the actual implementation. For the
> live architecture, see [codebase-summary.md](codebase-summary.md). This document
> preserves the original layering template for reference and adds module-specific
> architecture for new subsystems below.

## Work Shift Registration & Attendance

A four-module subsystem for scheduling and tracking staff work time.

### Modules

| Module | Router | Purpose |
|--------|--------|---------|
| ShiftConfig | `shift-config.ts` | Shift group catalog (KINH_DOANH / GIAO_VIEN) with templates. Two default groups: KD has SINGLE selection with 3x 8h shifts; GV has MULTIPLE selection with 3x 4h shifts. |
| ShiftRegistration | `shift-registration.ts` | Timesheet requests. Workflow: Draft -> Submitted -> Approved. Supports work/leave types. Manager chain resolved from EmploymentProfile.managerId or auto-resolved by role. Supersede chain replaces older approved registrations. |
| CheckInOut | `check-in-out.ts` | Punch-based attendance. Earliest punch = check-in, latest = check-out. Penalty: 500d/min late, 1000d/min early leave. IP validated against FacilityNetwork CIDR rules. |
| FacilityNetwork | `facility-ip.ts` | IP whitelist per facility (supports CIDR ranges) for check-in validation. |

### Schema

6 new models in `packages/db/prisma/schema.prisma`: `ShiftGroup`, `ShiftTemplate`, `ShiftRegistration`, `ShiftRegistrationEntry`, `TimePunch`, `FacilityNetwork`, plus `ShiftCodeCounter` (atomic sequence for SR-YYYY-NNNN codes).

### Data flow

```text
Staff submits ShiftRegistration (Draft)
  -> auto-resolve shift group + manager chain
  -> submit -> Submitted
  -> manager approves -> Approved (supersedes old registration)
  -> daily punch (TimePunch) validated against FacilityNetwork
  -> penalty computed at end-of-day (late min * 500 + early min * 1000)
```

### Key invariants

- ShiftRegistration supersede: approving a new registration auto-cancels the previous one for the same user/date range.
- SINGLE / MULTIPLE selection mode enforced per shift group (KD staff picks one shift per day, GV can pick multiple).
- IP validation is a soft gate: punches outside whitelist are recorded but flagged.

## Discovery Before Shape

Before proposing implementation shape, identify:

- Product surfaces: browser, mobile, desktop, CLI, API, worker, or service.
- Runtime stack: language, framework, database, queues, providers, and hosting.
- Core domains: the product concepts that deserve stable names and contracts.
- Boundary inputs: user input, API requests, webhooks, jobs, files, credentials,
  provider payloads, and environment configuration.
- Validation ladder: the smallest checks that can prove the selected stack.

Record stack choices in `docs/decisions/` when they meaningfully constrain
future work.

## Default Layering

```text
domain
  <- application
      <- infrastructure
          <- interface
              <- app surfaces
```

## Candidate Structure

```text
app/
  domain/
    entities/
    value-objects/
    repositories/
    services/

  application/
    commands/
    queries/
    handlers/

  infrastructure/
    database/
    logging/
    notifications/

  interface/
    controllers/
    dto/
    presenters/
    routes/
    middlewares/

surfaces/
  browser/
  mobile/
  desktop/
  cli/
```

This is a thinking template, not a scaffold. Create real folders only when a
story enters implementation and the selected stack needs them.

## Dependency Rule

Inner layers must not depend on outer layers.

| Layer | May depend on | Must not depend on |
| --- | --- | --- |
| domain | nothing project-external except tiny pure utilities | framework, database, UI, provider, process/env |
| application | domain | framework, UI, provider, database concrete clients |
| infrastructure | domain, application | interface controllers or UI |
| interface | all backend layers | UI state or platform shell assumptions |
| app surfaces | API contracts and app-facing clients | domain internals directly |

## Parse-First Boundary Rule

Unknown data must be parsed at boundaries before it enters inner code.

Boundaries include:

- HTTP request bodies, params, and query strings.
- Session payloads and identity claims.
- Environment variables.
- Database rows returned from external clients.
- Platform shell payloads.
- Deep links, tokens, and signed URLs.
- Provider webhooks, events, and async payloads.

Target flow:

```text
unknown input
  -> parser
  -> typed DTO or command
  -> application use case
  -> domain object/value object
```

Inner layers should work with meaningful product types such as `UserId`,
`AccountId`, `WorkspaceId`, `Role`, `DateRange`, or domain-specific IDs,
rather than repeatedly validating raw strings.

## Command/Query Boundary

If the product has both reads and writes, keep command/query separation clear at
the code level even when the storage layer is simple:

- Commands mutate state and own audit side effects.
- Queries read state and format for consumers.
- Shared domain rules live in domain/application, not controllers.

## Observability Contract

The future server should emit one canonical JSON log line per request with:

- timestamp
- level
- request_id
- user_id when known
- action
- duration_ms
- status_code
- message

Audit logs are product records. Application logs are operational records. Do not
use one as a substitute for the other.
