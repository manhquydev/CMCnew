# Feature Comparison: Notification & Chatter Module
## Source: odoo/odoo (addons/mail)
## Local Project: CMCnew (packages/audit)

## Head-to-Head
| Aspect | Source (Odoo addons/mail) | Local (CMCnew packages/audit & SSE) | Recommendation |
| --- | --- | --- | --- |
| **Architectural Paradigm** | Active Record-based abstract mixins (`mail.thread`, `mail.activity.mixin`) hooking implicitly into CRUD methods. | Service-driven architecture utilizing explicit utility functions (`diffChanges`, `logEvent`) executed inside Prisma transaction blocks. | Maintain CMC's explicit TS utility pattern. It keeps transaction boundaries clear, provides full type safety, and avoids the magic side-effects of implicit hooks. |
| **Audit Field Tracking** | Stores individual field differences in a dedicated relation table (`mail.tracking.value`) linked to `mail.message`. | Stores tracked changes directly as an inline JSON array (`changes` field of type `Json` containing `[{ field, old, new }]`) on the `RecordEvent` table. | Retain JSON-in-record storage. It avoids costly database joins and maps cleanly to TypeScript's statically typed schemas. |
| **Followers & Subscriptions** | Granular subscriber mapping (`mail.followers`) linking records to partner contacts, grouped by notification subtypes. | Simple presence join table (`RecordFollower`) linking `(entityType, entityId, userId)` without subtype subscription details. | Retain the simple presence model for now; introduce basic boolean filters (e.g. `notifyOnCommentsOnly`) only when requested. |
| **Real-time Push System** | Broadcast bus (`bus.bus`) using long-polling or Websockets to stream messages to channels. | Server-Sent Events (SSE) via `/sse/notifications` and `/sse/staff` powered by a memory-based Node `EventEmitter`. | The SSE architecture is clean and robust. However, migrate the backend from in-memory `EventEmitter` to Redis Pub/Sub to support multi-instance scaling. |
| **Activities & Tasks** | Active scheduling engine (`mail.activity`) representing planned tasks, integrated into the UI chatter feed. | No current support. The `RecordEvent` timeline contains historical audit logs and user notes only. | Model scheduled tasks (like follow-up calls or student reviews) in a separate `RecordActivity` table rather than mixing them into historical logs. |
| **Security & Isolation** | Scoped via Odoo's dynamic record rules (`ir.rule`) evaluated at the ORM layer during query assembly. | Multi-tenant isolation enforced at the database level using PostgreSQL Row Level Security (RLS) policies scoped by `facilityId`. | Maintain RLS-enforced isolation. Ensure SSE listener authentication filters verify principal/staff rights against the DB-level RLS state. |

---

## Data Models Comparison

### Odoo Data Models (`addons/mail`)
*   **`mail.thread`**: Abstract mixin inherited by models that require Chatter. Adds `message_ids` and `message_follower_ids`.
*   **`mail.message`**: The central record for communications (emails, notifications, chatter notes). Polymorphically points to targets using `res_id` and `model`.
*   **`mail.followers`**: Relates a document (`res_model`, `res_id`) to a contact (`res_partner`). Tracks subscribed subtypes (`mail.message.subtype`).
*   **`mail.tracking.value`**: Stores old and new values for tracked fields (e.g. `old_value_char`, `new_value_integer`), linked to a specific `mail.message`.
*   **`mail.notification`**: Recipient-specific tracking model monitoring delivery status (read, unread, failed) for individual partners.
*   **`mail.activity`**: Stores planned actions (calls, meetings, tasks) linked to records.

### CMCnew Data Models (`packages/audit` & `packages/db`)
*   **`RecordEvent`**: Represents a single historical timeline entry. Polymorphic relationships are modeled loosely using `entityType` (string) and `entityId` (string).
    *   `id`: `Uuid` primary key.
    *   `facilityId`: `Int` foreign key for RLS isolation.
    *   `type`: `RecordEventType` enum (`created`, `updated`, `status_changed`, `archived`, `restored`, `note`).
    *   `changes`: `Json` field containing an array of `ChangeEntry` (`[{ field, old, new }]`).
    *   `body`: `String` containing user notes or status comments.
    *   `actorId`: `Uuid` of the staff/user who performed the action.
*   **`RecordFollower`**: A join table mapping followers.
    *   `entityType`: `String`.
    *   `entityId`: `String`.
    *   `userId`: `Uuid`.
    *   `createdAt`: `DateTime`.
    *   Composite primary key: `@@id([entityType, entityId, userId])`.

---

## Business Rules Comparison

### 1. Timeline Log Generation
*   **Odoo's Approach**: Automatically triggers during `write()` operations. The ORM compares the new values of fields marked with `tracking=True` to their previous state, generating a tracking log inside a `mail.message` without developer intervention.
*   **CMCnew's Approach**: Calculated explicitly in mutations using the `diffChanges` function. Developers define tracked fields and call `logEvent` manually inside a Prisma transaction:
    ```typescript
    const changes = diffChanges(beforeState, afterState, ['status', 'assignedUserId']);
    if (changes.length > 0) {
      await logEvent(tx, { entityType, entityId, type: 'updated', changes, actorId });
    }
    ```

### 2. Follower Notification Dispatch
*   **Odoo's Approach**: When a message is posted to a record, Odoo checks the record's `mail.followers` list. For each follower, the system evaluates their subscribed `mail.message.subtype` values. If matching, a `mail.notification` record is generated and dispatched to the recipient's chosen communication channel (in-app Odoo Bus or outgoing email).
*   **CMCnew's Approach**: `RecordFollower` mapping is currently a placeholder for subsequent notification features. Logging a `RecordEvent` does not automatically query followers or queue events for them. Instead, real-time push routing is statically filtered inside the API's SSE endpoints.

### 3. Real-time Push & Connection Scoping
*   **Odoo's Approach**: Clients register to channels using long-polling. The frontend Owl framework uses `bus_service` to listen to messages sent by the `bus.bus` model backend.
*   **CMCnew's Approach**: Leverages native browser `EventSource` listening to two targeted endpoints:
    *   **LMS Channel (`/sse/notifications`)**: Authenticated by the LMS cookie. Retrieves child IDs mapped to the parent's session (`studentIds`). Filters and pushes notifications where `evt.studentId` is owned by the parent. Re-validates the session list every 25 seconds to refresh the access list if children are reassigned.
    *   **Staff Channel (`/sse/staff`)**: Authenticated via Bearer JWT or cookie. Filters and pushes events where `evt.recipientId` matches the staff's `userId`.

---

## Recommendations

1.  **Maintain Explicit, Service-driven Auditing**: Retain the explicit `diffChanges` and `logEvent` pattern rather than relying on automatic Prisma middleware hook intercepts. This ensures that timeline generation remains predictable, easy to unit test, and isolated within service boundaries.
2.  **Decouple Real-time State from memory via Redis Pub/Sub**: The current memory-based `EventEmitter` for SSE routes fails in clustered or load-balanced environments. Swap out `EventEmitter` in `events.ts` and `staff-notification.ts` for a Redis Pub/Sub client or Postgres `LISTEN/NOTIFY` system to ensure notifications propagate across all API container instances.
3.  **Bridge Followers to SSE Notification Dispatch**: Establish a background job or handler that resolves followers using `getFollowers(tx, entityType, entityId)` when a `RecordEvent` is logged. Translate that event to a `StaffNotifEvent` and dispatch it automatically to followers via the `/sse/staff` SSE stream.
4.  **Introduce a Dedicated RecordActivity Model**: To support task management, build a clean `RecordActivity` table containing fields for `assignedUserId`, `dueDate`, `summary`, and `status` (`planned`, `completed`, `canceled`). When an activity is completed, log a `RecordEvent` with `type: 'note'` to record it in the timeline, mirroring Odoo's chatter integration.

---

## Unresolved Questions
1.  Do we need to store user read/unread status for each `RecordEvent` (similar to Odoo's `mail.notification` model) to power a persistent notification inbox count for staff?
2.  Should followers have access to filter configurations (e.g. only subscribe to status changes, not to inline notes)?
3.  If a parent or student session is invalidated due to forced logout, how quickly will the `/sse/notifications` route disconnect the client, given that the session re-validation occurs on a 25-second heartbeat?
