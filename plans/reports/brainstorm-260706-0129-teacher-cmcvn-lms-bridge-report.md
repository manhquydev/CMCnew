# Brainstorm: teacher.cmcvn.edu.vn as LMS operations bridge

Date: 2026-07-06. Branch: develop. Lane: high-risk. Type: new initiative.

## Scout summary

- Stack: TypeScript monorepo, Hono+tRPC API, Prisma/Postgres+RLS, React/Vite/Mantine frontends.
- Current apps: `apps/admin` = unified staff ERP/teaching shell; `apps/lms` = parent/student portal; `apps/teaching` retired by design.
- Existing core flows already present: staff RBAC, class creation, class code format, curriculum unit mapping, attendance, homework/exercise submission+grading, session evidence photos/comments, parent/student LMS login.
- Production topology: `main` deploys `erp.cmcvn.edu.vn` + `hoc.cmcvn.edu.vn`; `develop` deploys `deverp.cmcvn.edu.vn` + `devlms.cmcvn.edu.vn`; nginx has no explicit `teacher.cmcvn.edu.vn` vhost.
- Server read-only check: `teacher.cmcvn.edu.vn` currently returns the ERP/admin HTML via default TLS vhost, but this is accidental, not documented or smoke-tested.
- Existing 2026-07-05 live audit verifies GV upload photo/comment -> PH sees it, HS homework flow exists, and Brevo parent email works on prod per operator confirmation.

## Problem-first diagnosis

The proposed solution "build teacher.cmcvn.edu.vn" is a signal that ERP is too broad for daily LMS operations. The real problem is not domain count. The real problem is that teachers and directors need a narrow, reliable operational path for class/day/homework/parent visibility while ERP remains unfinished.

If we build a separate system, we risk duplicating auth, staff, class, student, parent, homework, and attendance data. That directly violates the project charter: one codebase, one database, no sync layer.

## Underlying problem

Teachers and directors need a temporary operational surface that exposes only the LMS-critical workflows, reusing existing ERP/API data and permissions, so classes can run now without creating a second source of truth.

## Concrete requirements captured

Expected output:
- A real `teacher.cmcvn.edu.vn` staff surface for `giao_vien`, `giam_doc_kinh_doanh`, and `giam_doc_dao_tao`.
- It reuses existing API/database/auth; no duplicate LMS/ERP backend.
- Director can create staff in ERP/admin as today, and staff with `giao_vien` can access teacher surface.
- Director can upload exercises per curriculum unit/lesson.
- Director can create class using current class model and accepted auto code format.
- Director can create parent+student in one form, including parent email for notification.
- Director can add student to class.
- Teacher can access assigned classes, mark attendance, write comments, upload class photos, and grade homework submissions.
- Parent/student LMS proof remains intact: parent sees teacher interactions; student can do homework.
- Deploy completed on real server, not local-only.

Acceptance:
- Focused API integration tests cover changed staff/parent/student/class/exercise paths.
- UI/e2e smoke covers director setup, teacher teaching day, parent read, student homework.
- Production/dev domain smoke includes `teacher.cmcvn.edu.vn`.

Scope boundary:
- Do not create a new database, sync layer, or parallel auth.
- Do not resurrect `apps/teaching` as an independent product unless the alias approach is proven insufficient.
- Do not change existing class code decision 0036.
- Do not weaken RLS or role gates.

Non-negotiable constraints:
- Single Postgres database and RLS facility isolation.
- Heavy domain rules stay in domain packages or existing services, not ad hoc route/UI patches.
- `main` deploy only through PR/Jenkins; no direct code/commit to `main`.
- New prod domain must be formal in nginx/Jenkins smoke/docs, not relying on default-vhost accident.

Touchpoints:
- Frontend: `apps/admin/src/App.tsx`, `shell.tsx`, `nav-permissions.ts`, class/guardian/student/exercise/evidence panels.
- Backend: `apps/api/src/routers/user.ts`, `guardian.ts`, `student.ts`, `class-batch.ts`, `exercise.ts`, `submission.ts`, `attendance.ts`, `session-evidence.ts`.
- Auth: `packages/auth/src/permissions.ts`.
- DB: likely no schema needed for domain alias; possible schema/decision if parent+student one-form needs new invariants.
- Deploy: `docker/nginx-prod.conf`, `docker/docker-compose*.tls.yml` only if extra app/service is created, `Jenkinsfile`, env `CORS_ORIGINS`/origins, docs.

## Alternatives

### A. New standalone `apps/teacher`

Pros:
- Clean route/domain separation.
- Can simplify UI aggressively.

Cons:
- Duplicates staff shell, tRPC client, auth handling, build/deploy service, smoke tests.
- Reopens the retired `apps/teaching` direction.
- More CI/deploy memory on a 2 vCPU VPS.

Verdict: not recommended for temporary launch. Too much surface for little business gain.

### B. Recommended: explicit teacher domain alias to `apps/admin` with role-focused landing

Pros:
- Reuses existing API, auth, permissions, panels, tests, and deployment pipeline.
- Small infra delta: formal nginx vhost + smoke + origin allowlist.
- Aligns with current architecture: staff app is unified, nav is role-gated.
- Lets work focus on actual workflow gaps, not shell duplication.

Cons:
- URL says `teacher`, but app remains the admin/staff bundle.
- Need careful default landing so teacher/director do not feel dropped into generic ERP.
- If future teacher UX diverges heavily, a separate app may be justified later.

Verdict: recommended first implementation.

### C. Reverse proxy route split under existing ERP domain only

Pros:
- No new DNS/vhost/origin work.
- Lowest infrastructure change.

Cons:
- Fails the user request for `teacher.cmcvn.edu.vn`.
- Does not solve operational framing for teachers/directors.

Verdict: useful fallback only if DNS/Cloudflare cannot be changed now.

## Recommended design

Use `teacher.cmcvn.edu.vn` as an explicit production vhost pointing to the existing admin SPA and API. Inside the staff app, detect host or route context only for first landing/branding/navigation focus; keep permissions sourced from `@cmc/auth/permissions`.

Implementation should be phased by workflow risk, not by UI layer:

1. Domain + shell: formal teacher vhost, smoke, default landing by role, docs.
2. Staff onboarding hardening: director/super_admin create staff with required employment profile fields already chosen in the 2026-07-05 audit.
3. Director setup flow: parent+student one-form + class enrollment; keep `receiptApprove`/financial provisioning invariant unless a new decision explicitly changes it.
4. Lesson assets: director exercise upload/create per curriculum unit; publish state and PH/HS visibility verified.
5. Teacher day: assigned class list, attendance, comments/photos, homework grading.
6. Parent/student proof: PH sees teacher interactions; HS does homework; e2e and prod smoke.
7. Docs/journal/watzup after validation.

## Risks

- Biggest product risk: user asks directors to create parent+student directly, but current architecture intentionally creates normal students at finance receipt approval. If we bypass that without decision, we break decision 0033's anti-orphan invariant.
- Biggest infra risk: `teacher.cmcvn.edu.vn` currently works by default-vhost accident. Formal vhost must be added before calling it supported.
- Biggest UX risk: admin bundle remains dense. Role-based landing must reduce cognitive load without forked permissions.
- Biggest validation risk: existing live audit proved many pieces, but not the exact requested `teacher.cmcvn.edu.vn` surface.

## Success metrics

- `https://teacher.cmcvn.edu.vn/api/health` returns ok through explicit vhost.
- `https://teacher.cmcvn.edu.vn/` loads staff app with correct staff session behavior and no CORS/cookie regression.
- `giao_vien` login lands on teaching-critical screen and cannot see finance/CRM/director-only panels.
- Both director roles can run their agreed setup steps without super_admin.
- Parent email exists before notification, and PH/HS portal reflects teacher actions.

## Next step recommendation

Proceed to `/ck:plan --deep --tdd` using this report as input, because this initiative touches authorization, public contracts, existing behavior, product docs, and production deployment.

Do not start `/ck:cook` until the plan has red-team + validate pass and the student provisioning rule is explicitly resolved.

## Unresolved questions

- Should director-created parent+student one-form create `Student` immediately, or should it create a receipt/provisioning draft that preserves the current finance seam?
- Should `teacher.cmcvn.edu.vn` be prod only, or also add `devteacher.cmcvn.edu.vn` for develop smoke?
- Should teacher domain show different branding/title only, or should it hide non-LMS modules even from director roles while they are on that host?
