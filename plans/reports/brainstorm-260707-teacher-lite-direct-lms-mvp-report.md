# Brainstorm: Teacher Lite Direct LMS MVP

Date: 2026-07-07
Status: agreed direction
Mode: urgent MVP, high-risk

## Problem

Current teacher surface still inherits too much ERP shape. Operation needs a small internal system on `teacher.cmcvn.edu.vn` for urgent classroom work:

- Directors create classes and students fast.
- Teachers run class-day workflow fast.
- Students and parents keep using LMS.
- Finance/receipt/CRM logic is bypassed for this MVP.

Pain: staff need fewer screens and fewer handoffs. Existing ERP workflow is safer but too slow for current launch.

## Requirements

- `teacher.cmcvn.edu.vn` becomes the new Teacher Lite system, replacing current teacher bridge UI.
- Managers: both `giam_doc_kinh_doanh` and `giam_doc_dao_tao`.
- Teachers: `giao_vien`.
- Direct create parent/student/enrollment without receipt, finance approval, CRM opportunity, or O5 logic.
- Parent login remains email OTP.
- Student login remains parent phone plus default password `Cmc2026@`.
- Student sees homework files in LMS and submits work.
- Teacher grades submission, returns score/stars/feedback.
- Parent sees published evidence, attendance, comments, grades, and stars.
- Director can cancel session or cancel class.
- If not cancelled, classes/sessions operate normally.

## Evaluated Approaches

### A. Replace teacher domain with Teacher Lite app, shared API/DB

Pros:

- Clean UI, not ERP-wide.
- Keeps one database and one LMS.
- Fastest safe route.
- Avoids sync.

Cons:

- Needs new direct provisioning decision.
- Needs focused API façade and tests.

### B. Keep existing admin app and hide more navigation

Pros:

- Least code.
- Already deployed.

Cons:

- Still feels like ERP.
- More chance of staff landing in wrong module.
- Does not match user's "đập teacher hiện tại" request.

### C. Separate backend/database for urgent system

Pros:

- Maximum isolation.

Cons:

- Creates duplicate students/classes/submissions.
- Requires sync with LMS.
- High operational risk, not MVP.

## Decision

Use Approach A.

Build a Teacher Lite surface for `teacher.cmcvn.edu.vn`, backed by existing `apps/api`, existing Postgres, existing RLS/auth/email/LMS contracts.

Do not fork LMS, database, auth, or email. Do bypass finance/receipt/CRM for direct MVP student creation.

## Product Shape

### Director Lite

- Create class.
- Cancel class.
- Cancel session.
- Create parent + student directly.
- Add student to class.
- Send LMS email to parent.
- Upload lesson/session learning material.
- View class readiness.

### Teacher Lite

- Today's classes.
- Attendance roster.
- Student comments.
- Class photo upload.
- Submission list.
- Grade + stars + feedback.
- Publish to LMS.

### LMS

- Parent: email OTP.
- Student: parent phone + `Cmc2026@`, profile picker when needed.
- Student submits homework.
- Parent sees published classroom output.

## Implementation Considerations

- Add accepted decision: direct lite provisioning may bypass receipt/finance.
- Keep decision `0033` login invariant.
- Create a dedicated Teacher Lite API façade so UI does not call many ERP routers directly.
- Direct provisioning must be atomic:
  - `ParentAccount`
  - `Student`
  - `Guardian`
  - `StudentAccount`
  - optional `Enrollment`
- Parent phone normalization must reuse the LMS login phone rule.
- Parent email conflict must return deterministic error, not raw 500.
- Teacher mutation authority remains server-side: assigned class/session only.
- Directors get broad Lite setup authority, not full finance authority.

## Risks

- Direct provisioning bypasses finance provenance. Accepted for MVP only.
- Existing reports that assume receipt-created students may need future cleanup.
- Email OTP and student default-password flows have different security levels; must not mint parent session from phone/password.
- Duplicate parent phone means children share one family login, consistent with existing decision.

## Validation Criteria

- Director KD and DT can directly create parent/student and enroll into a class.
- Teacher cannot create students/classes.
- Teacher can mutate only assigned sessions/classes.
- Parent email OTP works for direct-created parent.
- Student phone/default-password login works for direct-created student.
- LMS shows homework only when open by session/class rules.
- Parent sees only published evidence/grades for own child.
- Cross-facility access denied.
- Cancelled class/session no longer appears as normal actionable work.

## Next Steps

1. Record decision `0039`.
2. Create high-risk story `TEACHER-LITE-DIRECT-LMS-MVP`.
3. Create implementation plan.
4. Build in phases with narrow tests first.

## Unresolved Questions

- None for MVP direction.

