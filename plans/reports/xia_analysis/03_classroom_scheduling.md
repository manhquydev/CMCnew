# Feature Comparison: Classroom and Scheduling Module
## Source: openeducat/openeducat_erp (op_classroom, op_batch, op_timetable)
## Local Project: CMCnew (packages/domain-academic, schema.prisma)

## Head-to-Head

| Aspect | Source (OpenEduCat) | Local (CMCnew) | Recommendation |
| --- | --- | --- | --- |
| **Data Model** | Standard relational database tables with strict foreign key relations (`op.classroom`, `op.batch`, `op.timetable`). | Relational tables (`Room`, `ClassBatch`, `ScheduleSlot`, `ClassSession`) but missing foreign key relations for rooms/teachers. | Add proper foreign key relations in Prisma for referential integrity. |
| **Time Representation** | Timezone-aware standard Datetime fields or Float time representation. | Split: `sessionDate` (Date) + wall-clock string `startTime`/`endTime` (`HH:mm` in ICT). | Maintain split representation (it avoids timezone shift bugs), but optimize SQL querying. |
| **Conflict Checks** | Python-level `@api.constrains` on save. Queries database for overlaps of faculty, classrooms, batches, or capacity. | Domain-level `detectConflicts`. Converts HH:mm to minutes of day for in-memory overlap calculations. | Add batch overlap checks and room capacity checks to CMC's domain logic. |
| **Integrity & Safety** | Strict referential integrity (DBMS-enforced FKs). ORM validation rolls back database transactions. | Lacks DBMS-enforced FKs for `roomId`/`teacherId`. API runs checks in-memory inside read-committed txn. | Enforce constraints through DBMS referential integrity and transaction-level isolation. |
| **Scalability** | Standard DB queries utilizing indexes. Checked records are filtered, keeping memory footprint small. | Scales poorly. Queries **all** non-cancelled sessions of the **entire facility** into memory to run conflict checks. | **Critical:** Add date range filtering to existing session queries in the API router. |

---

## Detailed Comparison & Code Analysis

### 1. Data Models & Database Schemas

#### OpenEduCat (Odoo) Schema
OpenEduCat models use active relationships defined in Python and translated into PostgreSQL foreign key constraints:
*   `op.classroom`: Defines physical room details, including code, name, and capacity.
*   `op.batch`: Links students to a course, defining `start_date` and `end_date`.
*   `op.timetable` / `op.session`: Represents concrete scheduling occurrences with relations to `op.classroom` (classroom_id), `op.faculty` (faculty_id), and `op.batch` (batch_id).
*   **Referential Integrity:** Enforced by PostgreSQL `FOREIGN KEY` constraints (e.g., `ON DELETE RESTRICT` or `ON DELETE SET NULL` for classroom/faculty deletions).

#### CMCnew (`schema.prisma`) Schema
CMCnew uses Prisma schemas but lacks explicit relations for several key schedule attributes:
*   `Room`: Represents physical classrooms.
*   `ClassBatch`: Groups students and defines duration (`startDate`, `endDate`).
*   `ScheduleSlot` & `ClassSession`: Represent templates and concrete sessions.
*   **Referential Integrity Issue:** In both `ScheduleSlot` and `ClassSession`, `roomId` and `teacherId` are stored as raw nullable UUID strings (`String?`) without Prisma relations (`Room?` or `AppUser?`). This allows dangling references if a room or teacher is deleted or archived.
    ```prisma
    // packages/db/prisma/schema.prisma
    model ClassSession {
      id           String        @id @default(uuid()) @db.Uuid
      facilityId   Int           @map("facility_id")
      classBatchId String        @map("class_batch_id") @db.Uuid
      batch        ClassBatch    @relation(fields: [classBatchId], references: [id], onDelete: Cascade)
      sessionDate  DateTime      @map("session_date") @db.Date
      startTime    String        @map("start_time")
      endTime      String        @map("end_time")
      roomId       String?       @map("room_id") @db.Uuid // No Prisma relation to Room model
      teacherId    String?       @map("teacher_id") @db.Uuid // No Prisma relation to AppUser model
      ...
    }
    ```

### 2. Business Rules & Scheduling Overlaps

#### OpenEduCat Validation
OpenEduCat uses standard Odoo database checks at the application level via `@api.constrains` before commits:
*   **Overlapping logic:** Employs datetime arithmetic in PostgreSQL:
    `(StartA < EndB) and (EndA > StartB)`
*   **Execution:** Runs search queries on write/create. If overlapping records exist for the same faculty or classroom, it raises a `ValidationError` which automatically aborts and rolls back the transaction.

#### CMCnew Validation
CMCnew moves conflict checks entirely to the TypeScript **domain layer**:
*   **Overlapping logic:** Because date and times are split (Date + HH:mm string), standard datetime operations cannot easily be done in raw Prisma queries. It converts `HH:mm` strings to minutes of the day:
    ```typescript
    // packages/domain-academic/src/time.ts
    export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
      return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
    }
    ```
*   **Validation Gap:**
    1.  `detectConflicts` checks for `room` and `teacher` conflicts.
    2.  It does **not** check if the *student batch* itself is scheduled for overlapping classes (e.g. Batch A in Room 1 at 09:00, and Batch A in Room 2 at 10:00). While the database enforces `@@unique([classBatchId, sessionDate, startTime])`, it does not block partial time overlaps.
    3.  It does **not** check if the batch size exceeds room capacity.

---

## Concurrency & Performance Analysis

### 1. The Scalability Hazard
In CMC's API router `apps/api/src/routers/schedule.ts`, when running `generateSessions`:
```typescript
const facilitySessions = await tx.classSession.findMany({
  where: { facilityId: batch.facilityId, status: { not: 'cancelled' } },
  select: { sessionDate: true, startTime: true, endTime: true, roomId: true, teacherId: true },
});
```
*   **Problem:** This query pulls **every single historical session** in the entire facility (excluding cancelled ones) into the API server's memory.
*   **Impact:** If a facility runs for several years, it can accumulate 50,000+ sessions. Loading all of these to perform an in-memory check for a single new batch will consume significant memory, spike CPU usage during overlap calculations, and eventually crash the node process.

### 2. Concurrency Race Conditions
Both OpenEduCat and CMC run validation checks inside transactions, but they query database states without row-level locks. Under standard isolation levels (`READ COMMITTED`), concurrent bookings of the same room or teacher can both bypass the check and insert overlapping sessions simultaneously, leading to silent double-booking.

---

## Recommendations

### 1. Fix the Scalability Hazard (High Priority)
Add a date boundary filter to the existing sessions query in `generateSessions` to only load sessions that overlap with the target scheduling range:
```typescript
// apps/api/src/routers/schedule.ts
const facilitySessions = await tx.classSession.findMany({
  where: {
    facilityId: batch.facilityId,
    status: { not: 'cancelled' },
    sessionDate: {
      gte: new Date(input.startDate),
      lte: new Date(input.endDate),
    },
  },
  select: { sessionDate: true, startTime: true, endTime: true, roomId: true, teacherId: true },
});
```

### 2. Establish Schema Relations
Modify `schema.prisma` to link `ClassSession` and `ScheduleSlot` to `Room` and `AppUser`. This enforces relational integrity:
```prisma
model ClassSession {
  // ...
  roomId    String?  @map("room_id") @db.Uuid
  room      Room?    @relation(fields: [roomId], references: [id], onDelete: Restrict)
  teacherId String?  @map("teacher_id") @db.Uuid
  teacher   AppUser? @relation(fields: [teacherId], references: [id], onDelete: Restrict)
}
```

### 3. Implement Batch Overlap Constraint
Update `detectConflicts` in `packages/domain-academic/src/schedule.ts` to flag overlaps for the same batch:
```typescript
if (c.classBatchId && e.classBatchId && c.classBatchId === e.classBatchId) {
  conflicts.push({ kind: 'batch', date: c.sessionDate, candidate: c, against: e });
}
```
*(Make sure to update the `Conflict` model kind to support `'room' | 'teacher' | 'batch'`)*

### 4. Prevent Concurrency Conflicts
Use PostgreSQL advisory locks or explicit row locking (`SELECT FOR UPDATE`) during session generation to serialize bookings on the same room or teacher, preventing double-bookings.

---

## Unresolved Questions

1.  **Capacity Constraint Strategy:** Should room capacity mismatch (e.g., student count > room capacity) trigger a hard conflict block, or should it be generated as a warning/soft-conflict?
2.  **Archived/Inactive Entities:** Should `detectConflicts` ignore assignments for archived rooms and inactive teachers, or should they be treated as hard blocks?
3.  **Historical Cleanups:** Should historical session logs over a certain age (e.g., older than 3 years) be archived or skipped during active scheduling checks to maintain performance?
