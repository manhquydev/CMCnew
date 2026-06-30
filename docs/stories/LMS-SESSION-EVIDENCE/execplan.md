# LMS Session Evidence Exec Plan

## Goal

Make the teaching workflow timetable-centered: class setup creates the first schedule slot, staff opens a concrete lesson from the timetable, and the session detail becomes the "Session 360" surface for attendance and post-class work.

Full LMS session evidence remains the next phase: persisted photos, template comments, and parent/student read path.

## Scope

In scope:

- API/UI vertical slice for class creation with optional first weekly lesson slot.
- Schedule detail UI for time-derived Session 360 workflow.
- Mock post-class cards for homework publish, template comments, whole-class photo upload, and parent publish.
- Integration proof for atomic class + initial schedule slot creation.

Out of scope:

- Persisted session evidence DB models.
- Parent/student LMS read path.
- Push notification.
- External image provider.
- Approval workflow for teacher comments; user decision is no approval because comments are form/template based.

## Risk Classification

Risk flags:

- Authorization.
- Data model.
- Audit/security.
- Public contracts.
- Existing behavior.
- Weak proof.
- Multi-domain.

Hard gates:

- Authorization.
- Audit/security.
- Public contract change.

## Completed Vertical Slice

1. Reviewed user pivot from `/grading` to timetable-centered Session 360.
2. Added `classBatch.create.initialSlot`.
3. Added class creation fields for first weekly lesson day/start/end/room/teacher.
4. Added Session 360 workflow cards in schedule detail.
5. Added `class-create-initial-slot` integration coverage.
6. Updated Harness story evidence and trace.

## Remaining Phases

1. Add persisted `SessionEvidence`, `SessionEvidencePhoto`, and `SessionStudentComment` models.
2. Add authorized staff router and private photo upload/read routes.
3. Replace post-class mock cards with real commands.
4. Add LMS parent/student session view.
5. Add publish-gate and ownership integration tests.
6. Add E2E publish-to-LMS proof.

## Stop Conditions

Pause for human confirmation if:

- Photo visibility must be per-photo instead of per-session.
- Upload requires a real object storage provider now.
- Existing grading public contract would need breaking changes.
