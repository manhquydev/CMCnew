# Design

## Domain Model

Reuse existing core entities:

- `AppUser` for staff.
- `ParentAccount` for parent email OTP and family identity.
- `Student`.
- `Guardian`.
- `StudentAccount` for student LMS session anchor.
- `ClassBatch`.
- `ClassSession`.
- `Enrollment`.
- `CurriculumLesson`.
- `Exercise`.
- `Submission`.
- `Grade` / grading records.
- session evidence/photo/comment records.

New product concept: Teacher Lite workflow. It is an interface/API façade, not a separate domain store.

Direct-created students need their own code allocation because the old normal path derives
`studentCode` from receipt code. MVP uses a transaction-safe direct student-code allocator
(`HS-YYYY-NNNN`, facility-scoped). The LMS fallback `StudentAccount.loginCode` remains
`${facility.code}-${student.studentCode}`.

## Application Flow

### Director Direct Setup

1. Director opens `teacher.cmcvn.edu.vn`.
2. Director creates or selects class.
3. Director creates parent + student directly.
4. API transaction creates/reuses parent by normalized phone/email rule, creates student, guardian link, student account, optional enrollment.
5. API queues parent LMS email via existing external email route.
6. Parent uses email OTP; student uses parent phone + `Cmc2026@`.

### Director Learning Material

1. Director selects class/course/session.
2. Director uploads exercise/material for `CurriculumLesson`.
3. LMS visibility follows existing session-level exercise open rules.

### Teacher Class Day

1. Teacher opens "today".
2. API lists assigned sessions/classes.
3. Teacher marks attendance, writes comments, uploads photos.
4. Teacher grades submissions and assigns score/stars/feedback.
5. Teacher publishes to LMS.

## Interface Contract

Add a focused API surface, likely `teacherLite` router:

- `teacherLite.dashboard`
- `teacherLite.createClass`
- `teacherLite.cancelClass`
- `teacherLite.cancelSession`
- `teacherLite.createFamilyStudent`
- `teacherLite.enrollStudent`
- `teacherLite.sendParentLmsEmail`
- `teacherLite.uploadLessonMaterial`
- `teacherLite.today`
- `teacherLite.markAttendance`
- `teacherLite.saveSessionEvidence`
- `teacherLite.publishSessionEvidence`
- `teacherLite.listSubmissions`
- `teacherLite.gradeSubmission`
- `teacherLite.publishGrade`

These procedures may delegate to existing services/helpers, but should expose simple DTOs for Teacher Lite UI.

`teacherLite.createFamilyStudentAndEnroll` is required. The UI must not compose
`student.create`, `guardian.parentCreate`, and `enrollment.enroll` directly because their current
permissions and transaction boundaries do not match the Lite workflow.

## Data Model

Schema change is now expected for direct student-code allocation unless implementation proves an
existing safe allocator can be reused without receipt semantics.

Audit marker `teacher_lite_direct` is required. If reporting needs queryable provenance, add the
smallest source field/table needed. Do not overload `createdByReceiptId`.

No duplicate LMS tables. No sync tables.

## UI / Platform Impact

Replace current teacher-domain UI with Teacher Lite:

- Dedicated app/shell or route bundle.
- Dense operational layout.
- No full ERP navigation.
- Mobile-friendly enough for classroom tablet/laptop use.
- `teacher.cmcvn.edu.vn` serves Lite UI.
- Existing `erp.cmcvn.edu.vn` remains full staff ERP.

## Observability

- Audit direct family/student creation with actor, facility, parent/student IDs, masked contact values.
- Audit class/session cancellation.
- Queue email outbox rows with external Brevo routing.
- Harness story and trace record proof.

## Alternatives Considered

1. Hide more admin nav in existing shell. Rejected: still too wide.
2. New backend/database. Rejected: duplicate data and sync risk.
3. Teacher Lite over existing core. Accepted.
