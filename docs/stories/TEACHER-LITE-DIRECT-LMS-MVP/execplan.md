# Exec Plan

## Goal

Ship an urgent Teacher Lite MVP on `teacher.cmcvn.edu.vn` that lets directors and teachers run LMS-linked classroom operations without the ERP/finance workflow.

## Scope

In scope:

- Replace teacher-domain surface with Teacher Lite UI.
- Both directors can create class/student/parent/enrollment directly.
- Direct provisioning bypasses receipt, finance, CRM, O5.
- Parent LMS email/OTP preserved.
- Student phone + default password preserved.
- Learning material upload by lesson/session.
- Teacher attendance/comments/photos/grading/stars/publish.
- Class/session cancellation.
- Integration and E2E proof for critical flows.

Out of scope:

- Separate database.
- Separate LMS.
- Payment/receipt/finance parity.
- CRM lifecycle.
- Full admin ERP redesign.
- Mobile native app.

## Risk Classification

Risk flags:

- Auth.
- Authorization.
- Data model / identity creation path.
- Audit/security.
- External provider email.
- Public contracts.
- Existing behavior.
- Multi-domain.
- Weak proof until tests are added.

Hard gates:

- Auth/authz behavior.
- Parent/student data creation.
- External email.
- Public LMS behavior.

## Work Phases

1. Decision and Harness contracts.
2. API direct provisioning façade.
3. Teacher Lite shell on teacher domain.
4. Director setup screens.
5. Teacher class-day screens.
6. LMS proof and email proof.
7. Deploy wiring and smoke.

## Stop Conditions

Pause for human confirmation if:

- Direct provisioning needs destructive migration.
- Parent email/phone conflict policy is ambiguous.
- Tests require weakening RLS or authz.
- Teacher Lite needs finance/CRM behavior after all.
- Build requires replacing existing LMS login rules.

