# Teacher Lite Direct LMS MVP

Date: 2026-07-07

## Status

Accepted

## Context

The previous `teacher.cmcvn.edu.vn` plan reused the admin shell and preserved the receipt/provisioning handoff. That was safer but too slow and too wide for the urgent internal workflow.

The new business decision is to replace the current teacher-domain surface with a simpler internal system that links to LMS and bypasses finance/receipt/CRM for MVP student setup.

This is high-risk because it touches authorization, student/parent identity, LMS login, parent email, class enrollment, grading, and public user-visible behavior.

## Decision

`teacher.cmcvn.edu.vn` becomes a Teacher Lite internal system.

- Replace the existing teacher bridge UI on the teacher domain.
- Keep the existing API, database, RLS, auth, email outbox, and LMS app.
- Do not create a separate database, sync layer, or separate LMS.
- Allow both `giam_doc_kinh_doanh` and `giam_doc_dao_tao` to perform Lite setup.
- Add direct Lite provisioning that bypasses receipt, finance approval, CRM opportunity, and O5 logic.
- Direct Lite provisioning may create `ParentAccount`, `Student`, `Guardian`, `StudentAccount`, and `Enrollment` atomically.
- Preserve decision `0033`: parent uses email OTP; student uses parent phone plus default password `Cmc2026@` and child profile selection.
- Teachers can perform class-day workflow only for assigned classes/sessions.
- Directors can cancel classes/sessions and upload learning materials by lesson/session.

## Alternatives Considered

1. Keep the existing teacher bridge and hide more admin navigation.
   - Rejected: still too wide and too ERP-shaped for urgent operations.
2. Build a separate backend/database for the urgent system.
   - Rejected: duplicates core entities and creates sync risk with LMS.
3. Replace teacher domain with Lite UI over the existing backend/database.
   - Accepted: simplest route that matches the urgent product need without data forks.

## Consequences

Positive:

- Much simpler internal workflow.
- No duplicate LMS or database.
- Faster MVP delivery.
- Directors can complete setup without finance handoff.

Tradeoffs:

- Direct-created students are not receipt/provisioning-derived.
- Finance and CRM lifecycle are bypassed for this MVP.
- Future reconciliation/reporting may need provenance or filtering.
- Strong tests are required because this changes identity/enrollment creation paths.

## Follow-Up

- Create high-risk story and implementation plan.
- Add provenance or audit marker for Lite-created records if schema/code path needs it.
- Update teacher-domain deployment to serve the Lite surface.
- Add integration tests for direct provisioning, authz, LMS login, and cross-facility denial.

