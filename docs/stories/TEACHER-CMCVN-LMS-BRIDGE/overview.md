# Overview

## Current Behavior

`apps/admin` is the unified staff ERP/teaching codebase. `apps/teaching` is retired. Production serves ERP staff operations at `erp.cmcvn.edu.vn`, a host-aware Teacher Console at `teacher.cmcvn.edu.vn`, and LMS at `hoc.cmcvn.edu.vn`. `teacher.cmcvn.edu.vn` is now an explicit supported vhost with host-aware SSO start and host-aware Teacher Console branding/nav/landing; only the real interactive Microsoft callback/MFA proof remains pending.

Teacher, class, attendance, evidence, grading, exercise, parent, and student LMS flows already exist in the shared API/app stack. The bridge work fixed teacher-host domain setup and teacher mutation ownership gaps. Director intake follows the receipt/provisioning handoff: the teacher surface exposes a dedicated `family-intake` form for parent/student launch fields, both directors can create the draft artifact, and money approval/full finance operations remain outside the teacher surface.

## Target Behavior

`teacher.cmcvn.edu.vn` is a supported Teacher Console over the existing admin/API/LMS stack. It gives teachers and directors a focused LMS operations entry point without a new database, auth stack, or sync layer.
It is intentionally narrower than ERP: full finance, CRM, HR, payroll, revenue, reconcile, and work-shift operations stay in `erp.cmcvn.edu.vn`.

## Affected Users

- `giao_vien`
- `giam_doc_kinh_doanh`
- `giam_doc_dao_tao`
- `parent`
- `student`
- `super_admin` for support/deploy verification

## Affected Product Docs

- `README.md`
- `docs/dev-prod-cicd-runbook.md`
- `docs/prod-deploy-security-runbook.md`
- `docs/guides/e2e-walkthrough/README.md`
- `docs/DECISION_INDEX.md` only if a new accepted decision is created.

## Non-Goals

- Do not create `apps/teacher` for MVP; use a host-aware Teacher Console inside the existing admin bundle first.
- Do not resurrect `apps/teaching`.
- Do not create a second student provisioning system.
- Do not broaden cookies to `.cmcvn.edu.vn`.
- Do not treat worksheet PDF refs as secret unless decision 0022 is superseded.
