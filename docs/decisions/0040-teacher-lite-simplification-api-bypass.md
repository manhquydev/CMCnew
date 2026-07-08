# Teacher Lite Simplification + API Bypass Principle

Date: 2026-07-08

## Status

Accepted

## Context

Decision `0039` made `teacher.cmcvn.edu.vn` a Teacher Lite surface on the shared
backend. In operation the surface was still too ERP-shaped: director accounts saw
KPI/finance/shift/CRM sections and cockpit approval items that dead-ended on the
teacher surface; several director operations (edit students, manage the teacher
roster, soft-delete records) were blocked by ERP workflow gates designed for the
full admin app.

The product owner clarified the Teacher Lite intent: a genuinely simple internal
system whose primary job is the LMS flow for parents and students, with three
roles — teacher (attendance, comments, class photos, grading with score+feedback,
no stars), director (create class, provision students + email parents into LMS,
enroll, upload lesson materials, cancel class/session, manage the teacher roster),
and student/parent (LMS do/submit homework; parent reporting). Explicit ask:
simplify the internal workflow, drop the heavy ERP rules on this surface, and let
teacher-lite APIs bypass the original ERP design barriers.

This supplements — does not supersede — `0039`. Shared DB/auth/RLS/LMS are kept;
no separate database or LMS is created.

## Decision

1. **Nav simplification.** Teacher Lite exposes only teaching, class/student/parent
   management, a lean teacher-roster manager, and LMS-related sections. KPI,
   check-in/timekeeping, shift, finance, CRM, CSKH, rewards, revenue, reconcile,
   compensation, payroll, org, facility-network, shift-config are not shown on the
   teacher surface (they remain on the ERP surface via "Mở ERP đầy đủ"). Director
   cockpit approval inbox hides KPI items on the teacher surface.

2. **API bypass principle.** Teacher Lite may use dedicated `teacherLite.*`
   procedures (and targeted widening of existing gates) that bypass ERP *workflow*
   barriers (receipt/finance/CRM/lifecycle handoffs). Bypass removes workflow
   friction ONLY. It MUST preserve: tenancy/RLS (facilityId resolved from the
   record, never trusted from client), role-escalation protection, and audit
   (`logEvent`). Example endpoints: `teacherLite.studentArchive`,
   future `teacherLite.staff*` limited to creating/editing `giao_vien` only.

3. **Authorization changes (recorded).**
   - `student.update` gains `giam_doc_dao_tao` (Education Director can edit students).
   - `guardian.parentUpdate` added for both directors; `guardian.parentCreate` now
     writes an audit event.
   - `teacherLite.studentArchive` added for both directors (soft-archive only).

4. **Grading returns score + feedback only** (no star rating).

5. **Audit is read-surfaced.** `class_session` is whitelisted for the audit
   timeline so attendance/grade/cancel events are viewable ("ai điểm danh lúc nào")
   on the session-detail "Lịch sử" tab.

## Alternatives Considered

1. Rebuild a separate app/database for Teacher Lite, syncing to LMS.
   - Rejected: contradicts `0039`, forks core entities, discards working code,
     re-implements auth/RLS/provisioning. The product owner confirmed keeping `0039`.
2. Keep every ERP gate and only hide nav.
   - Rejected: leaves directors unable to perform simple teacher-lite management
     (edit/archive students, manage roster) without the full ERP workflow.

## Consequences

Positive: simpler, focused internal surface; directors perform lite management
directly; audit history visible; no data fork.

Tradeoffs: two permission surfaces (ERP gate vs teacherLite bypass gate) to keep
consistent; bypass endpoints must be individually reviewed to confirm they keep
RLS + audit + anti-escalation. `parentArchive` deferred pending a decision on the
student-login-via-parent-phone interaction (`0033`).

## Follow-Up

- Complete Phase 4b parentArchive after confirming the `0033` login interaction.
- Phase 5 staff-mgmt-lite must constrain director staff creation to `giao_vien`.
- Session-level lesson material upload tracked separately by `0038` / plan
  `260706-1752`.
- Plan: `plans/260708-0910-teacher-lite-simplify-completion/`.
