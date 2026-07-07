# Overview

## Current Behavior

`teacher.cmcvn.edu.vn` currently routes into the staff/admin bundle with teacher-domain branding and focused navigation. Parent/student setup still preserves the receipt/provisioning handoff. Existing LMS works for parent/student access.

## Target Behavior

`teacher.cmcvn.edu.vn` becomes a dedicated Teacher Lite surface for urgent internal work:

- Directors create classes, students, parent accounts, enrollments, learning materials, and cancellations.
- Teachers run daily class work: attendance, comments, photos, grading, stars, publish.
- LMS remains the parent/student surface.
- Direct Lite provisioning bypasses receipt, finance, CRM, and O5 logic.

## Affected Users

- `giam_doc_kinh_doanh`
- `giam_doc_dao_tao`
- `giao_vien`
- Parent
- Student

## Affected Product Docs

- `docs/project-charter.md`
- `docs/codebase-summary.md`
- `docs/decisions/0033-student-login-phone-identity.md`
- `docs/decisions/0038-session-level-exercises.md`
- `docs/decisions/0039-teacher-lite-direct-lms-mvp.md`

## Non-Goals

- No new LMS.
- No separate database.
- No finance/receipt/CRM parity in Teacher Lite.
- No online payment.
- No broad ERP shell on teacher domain.

