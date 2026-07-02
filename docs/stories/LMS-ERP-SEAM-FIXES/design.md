# ERP/LMS Seam Fixes Design

## Boundaries

- Database: `Exercise`, `Submission`, `CurriculumUnit`, `GradingTemplate`, GradingThreshold removal, RLS migration state.
- API: exercise, submission, payroll, lmsAuth routers plus authz helpers.
- Admin UI: curriculum/course area, schedule detail, grading, payroll/compensation, class workspace, typed panel clients.
- LMS UI: climb/student exercise surfaces and `/showcase` route gate.

## Exercise Ownership

`Exercise` is a global curriculum asset like `course` and `curriculum_unit`. It stores academic content only. It has no facility scope and no RLS. Writes are restricted to `giam_doc_dao_tao`, `giam_doc_kinh_doanh`, and super admin through the API.

## Exercise Visibility

LMS visibility is query-time: principal-owned students -> active enrollments -> class sessions with the exercise unit -> first non-cancelled session end in Asia/Saigon <= now. Submission writes reuse the same opened-unit rule and derive `facilityId` from student enrollment, not the exercise row.

## Payroll Ownership

Payroll module-level permissions admit the two directors. Per-staff write mutations then apply domain scoping:

- target has `giao_vien`: training director may write.
- target has no `giao_vien`: business director may write.
- super admin bypasses.
- directors cannot write their own profile/rate.

Read lists stay director-any for executive transparency.

## Cleanup

Dead/manual exercise publish affordances are removed. Parent password login is removed in favor of OTP. `/showcase` is development-only. Typed tRPC clients replace local escape-cast seams.
