# 06 Academic Scheduling

Status: DONE

## Scope Reviewed

- `packages/domain-academic/**`
- `apps/api/src/routers/class-batch.ts`
- `schedule.ts`, `attendance.ts`, `parent-meeting.ts`, `student.ts`, `course.ts`, `room.ts`
- parent meeting services
- student provisioning service
- relevant tests/specs

## Findings

### High: Attendance can be recorded for mismatched session/enrollment

Evidence:

- `apps/api/src/routers/attendance.ts:19`
- `apps/api/src/routers/attendance.ts:55`
- schema has separate FKs only: `packages/db/prisma/schema.prisma:328`

Impact: attendance for student enrollment A can be attached to session B in same facility.

### High: Class reopen restores unrelated manually-cancelled future rows

Evidence:

- sessions restored blindly: `apps/api/src/routers/class-batch.ts:231`
- parent meetings restored blindly: `apps/api/src/routers/class-batch.ts:33`
- cancellation lacks provenance marker: `apps/api/src/routers/class-batch.ts:153`

Impact: reopening a class can revive staff-cancelled sessions/meetings.

### High: UTC `today` boundary can cancel/restore wrong ICT local-day rows

Evidence:

- UTC date string use: `apps/api/src/routers/class-batch.ts:121`, `:152`, `:228`

Impact: before 07:00 Asia/Saigon, cutoff can include yesterday local rows.

### Medium: Schedule slot/session facility integrity under-validated

Evidence:

- `schedule.addSlot` writes client-supplied ids: `apps/api/src/routers/schedule.ts:23`
- `ScheduleSlot` room/teacher no relation constraint: `packages/db/prisma/schema.prisma:261`
- class session room FK by id only: `packages/db/prisma/schema.prisma:281`

Impact: class in facility A can be bound to room/teacher from facility B.

### Medium: Term lock only blocks final-grade recompute

Evidence:

- check only in `computeFinalGrade`: `apps/api/src/routers/assessment.ts:185`
- grade routes lack lock check: `apps/api/src/routers/grade.ts:37`
- qualitative lacks lock check: `apps/api/src/routers/assessment.ts:119`

## Verification Gaps

- No attendance tuple mismatch negative test.
- No manually-cancelled future row reopen test.
- No ICT boundary test.
- No schedule room/teacher/facility mismatch test.
- No term-lock source mutation tests.

## Positive Controls

- Schedule generation detects room/teacher overlaps.
- Session generation is idempotent.
- Parent meeting reminder excludes TBD and stamps `remindedAt` transactionally.
- Parent meeting cadence uses deterministic dates and DB uniqueness.
- Student provisioning rollback classifier is narrow.

## Unresolved Questions

- Should term lock freeze all source academic mutations?
- Should manually cancelled future rows survive class reopen?

