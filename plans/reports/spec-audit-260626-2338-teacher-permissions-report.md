# Teacher Permissions Audit — giao_vien / head_teacher RBAC

Date: 2026-06-26 23:40 · Mode: read-only spec audit · Scope: class lifecycle, scheduling, enrollment, grading, attendance, level-up, certificates

## TL;DR

The user's worry ("a teacher can create classes") is **not borne out by the code**. Both layers already restrict class/batch/schedule/course/room creation to `quan_ly` (+ super_admin), never `giao_vien`:

- **Backend:** `classBatch.create` is `requireRole(quan_ly)` — a `giao_vien` call returns `FORBIDDEN` (`apps/api/src/routers/class-batch.ts:60`).
- **UI:** the "+ Tạo lớp" button only renders when `canManageClass = me.isSuperAdmin || me.roles.includes('quan_ly')` (`apps/teaching/src/App.tsx:870,984`).

The screenshot `teaching-class-detail.png` is a **super_admin / manager session**, not a teacher: the top-right avatar is "S" and the `KINH DOANH` / `CRM` groups are visible, which only render for super/sale/quan_ly/cskh/ke_toan (`apps/teaching/src/shell.tsx:138-144,238-244`). A pure `giao_vien` would see neither "+ Tạo lớp" nor those groups.

**Root cause of the confusion is architectural, not a permission bug:** the app folder is named `teaching`, but it is in fact a **single shared staff workspace** for every back-office role (giao_vien, head_teacher, quan_ly, sale, cskh, ke_toan, hr). Modules are shown/hidden purely by client-side role flags. When you log in as super/quan_ly you see the full surface, which *looks* like "the teaching app lets teachers do everything."

No RBAC violation found in the audited surface. Two policy questions for the user are listed at the end (head_teacher scheduling rights; app naming/segmentation).

---

## 1. Current teacher capabilities (backend evidence)

`requireRole(...)` lets super_admin always pass, else requires one of the listed roles (`apps/api/src/trpc.ts:54-62`). Reads use `protectedProcedure` and are further narrowed by Postgres RLS to the user's facility.

| Capability | Procedure | Required roles (file:line) | giao_vien? | head_teacher? |
| --- | --- | --- | --- | --- |
| Create class/batch | `classBatch.create` | quan_ly — `class-batch.ts:60` | ❌ no | ❌ no |
| Change class status | `classBatch.setStatus` | quan_ly — `class-batch.ts:101` | ❌ | ❌ |
| Cancel class | `classBatch.cancel` | quan_ly — `class-batch.ts:139` | ❌ | ❌ |
| Reopen class | `classBatch.reopen` | quan_ly — `class-batch.ts:198` | ❌ | ❌ |
| Add weekly schedule slot | `schedule.addSlot` | quan_ly — `schedule.ts:23` | ❌ | ❌ |
| Generate sessions from slots | `schedule.generateSessions` | quan_ly — `schedule.ts:113` | ❌ | ❌ |
| View own teaching agenda | `schedule.mySessions` | protected; giao_vien forced to own `teacherId`, managers can view all/filter — `schedule.ts:66-82` | ✅ own only | ✅ all |
| Create course (catalog) | `course.create` | quan_ly — `course.ts:17` | ❌ | ❌ |
| Create / edit room | `room.create` / `update` / `archive` | quan_ly — `room.ts:14,37,61` | ❌ | ❌ |
| Create student | `student.create` | quan_ly, sale — `student.ts:17` | ❌ | ❌ |
| Enroll student into batch | `enrollment.enroll` | quan_ly, sale — `enrollment.ts:51` | ❌ | ❌ |
| Complete enrollment | `enrollment.complete` | quan_ly — `enrollment.ts:132` | ❌ | ❌ |
| Mark attendance | `attendance.mark` | giao_vien, quan_ly — `attendance.ts:17` | ✅ yes | ❌ (not listed) |
| Create homework/exercise | `exercise.create` | giao_vien, quan_ly — `exercise.ts:33` | ✅ | ❌ |
| Publish exercise | `exercise.publish` | giao_vien, quan_ly — `exercise.ts:74` | ✅ | ❌ |
| Grade submission | `grade.grade` | giao_vien, quan_ly — `grade.ts:25` | ✅ | ❌ |
| Publish grade | `grade.publish` | giao_vien, quan_ly — `grade.ts:77` | ✅ | ❌ |
| Qualitative assessment (học bạ) | `assessment.upsertQualitative` | giao_vien, head_teacher, quan_ly — `assessment.ts:98` | ✅ | ✅ |
| Compute final grade | `assessment.computeFinalGrade` | giao_vien, head_teacher, quan_ly — `assessment.ts:144` | ✅ | ✅ |
| Create academic term | `assessment.termCreate` / `termUpdate` | head_teacher, quan_ly — `assessment.ts:49,75` | ❌ | ✅ |
| Propose level-up | `levelProgress.propose` | giao_vien, head_teacher, quan_ly — `level-progress.ts:14` | ✅ | ✅ |
| List pending level-ups | `levelProgress.listPending` | head_teacher, quan_ly — `level-progress.ts:52` | ❌ | ✅ |
| **Approve/reject level-up** | `levelProgress.decide` | **head_teacher only** — `level-progress.ts:72` | ❌ | ✅ |
| Issue certificate | `certificate.issue` | head_teacher, quan_ly — `certificate.ts:7,22` | ❌ | ✅ |
| List certificates | `certificate.list` | head_teacher, quan_ly, giao_vien — `certificate.ts:10` | ✅ (read) | ✅ |

**Reading of the matrix:** `giao_vien` is confined to the *teaching* verbs — attendance, exercises, grading, qualitative assessment, and *proposing* level-ups. Every class-lifecycle / scheduling / enrollment / catalog write is `quan_ly`. The level-up approval gate is correctly split (teacher proposes → head_teacher decides), matching the documented academic workflow.

Note: backend role gates are **flat** (membership test), not hierarchical — e.g. `head_teacher` is *not* implicitly a `giao_vien`, so `head_teacher` is not on `attendance.mark` / `grade.grade`. Whether that is intended is a question for the user (see §4).

## 2. UI evidence — who reaches "+ Tạo lớp" and scheduling

- **App:** `apps/teaching/src` (the only app exposing class scheduling). The class workspace + scheduling form live in `App.tsx`; navigation/role gating in `shell.tsx`.
- **"+ Tạo lớp":** `CreateClassModal` (`App.tsx:62-139`) calls `trpc.classBatch.create`. It is rendered only at `App.tsx:984` under `facilityId && canManageClass`, where `canManageClass = me.isSuperAdmin || me.roles.includes('quan_ly')` (`App.tsx:870`). → hidden from `giao_vien` and `head_teacher`.
- **Scheduling (Khung lịch / Sinh buổi học, visible in the screenshot):** these call `schedule.addSlot` / `schedule.generateSessions`, both `quan_ly`-only on the backend. The screenshot only shows them because the session is super/manager.
- **Shell role flags** (`shell.tsx:238-244`): `canCrm` = sale/quan_ly/cskh; `canFinance` = ke_toan/quan_ly; `canCskh` = cskh/quan_ly; `canPayroll` = hr/ke_toan; `canManageClass` = quan_ly/sale (controls the "Ghi danh" nav item); `canLevelApproval` = head_teacher/quan_ly. A pure `giao_vien` therefore sees only HÔM NAY + Lớp học (read) + Nhật ký lớp + GIẢNG DẠY (Chấm bài / Học bạ). No CRM, no Finance, no "+ Tạo lớp".
- **Screenshot account:** avatar "S" + visible CRM/KINH DOANH ⇒ super_admin (or a multi-role manager). Seeds confirm no teacher carries `quan_ly`: `giaovien@cmc.local = [giao_vien]` (`seed.ts:55`); the LMS demo teacher = `[giao_vien, head_teacher]` (`seed-lms.ts:23`). Neither can create classes.

**Minor inconsistency (not a security hole):** the name `canManageClass` means *different role sets* in the two files — `quan_ly/sale` in `shell.tsx:243` (nav) vs `quan_ly`-only in `App.tsx:870` (the create/enroll UI). Same identifier, divergent meaning; worth unifying to avoid future drift.

## 3. What teachers should do — reference model (OpenEduCat / xia docs)

The xia analysis docs (`plans/reports/xia_analysis/01,03,04`) compare **data models and grading logic**, not Odoo security groups, so they do **not** give an explicit RBAC table for "who creates batches." What they do establish, and what aligns with CMC's current code:

- **Course/Batch are administrative objects.** In OpenEduCat, `op.course` / `op.batch` are SIS configuration created by the registrar/administrator, while `op.faculty` is the teaching actor linked onto sessions (`03_classroom_scheduling.md:21-26`, `01_academic_course.md:33-43`). CMC mirrors this: `Course` is a global catalog, `ClassBatch` is facility-scoped admin data — created by `quan_ly`, taught by a `teacherId` assigned onto `ScheduleSlot`/`ClassSession`.
- **Faculty = teach + assess, not provision.** OpenEduCat faculty operate on attendance, exams/marksheets, assignments/gradebook, and timetable *views* (`04_grading_assessment.md:46-64`). CMC's `giao_vien` rights map exactly: attendance, exercises, grading, qualitative assessment, own-agenda view.
- **Promotion is a two-step approval.** `01_academic_course.md:16,57-66`: "GV proposes, Head Teacher reviews/approves." Code matches precisely — `levelProgress.propose` (teacher) → `levelProgress.decide` (head_teacher only, `level-progress.ts:72`).

### 3b. Open question the docs do NOT answer
The docs do not state, in CMC's own model, **whether `head_teacher` (academic admin) should be able to create/schedule batches** or whether that stays purely `quan_ly` (operations). OpenEduCat would typically grant a registrar/academic-admin group batch+timetable creation. Today CMC gives it to `quan_ly` only. This is a **policy decision for the user**, not something to infer from the docs — do not change without confirmation.

## 4. Recommended teacher RBAC matrix

This is the target. It **matches the current implementation** for the teacher row, so it is presented as the confirmation-of-intent baseline rather than a change list.

| Capability | giao_vien | head_teacher | quan_ly | Current code conforms? |
| --- | --- | --- | --- | --- |
| Create / cancel / reopen class (batch) | ❌ | ❓ policy | ✅ | ✅ (quan_ly only) |
| Add schedule slot / generate sessions | ❌ | ❓ policy | ✅ | ✅ (quan_ly only) |
| Assign teacher to a slot/session | ❌ | ❓ policy | ✅ | ✅ (via addSlot, quan_ly) |
| Create course / room | ❌ | ❌ | ✅ | ✅ |
| Create student / enroll | ❌ | ❌ | ✅ (+sale) | ✅ |
| View own teaching schedule | ✅ own | ✅ all | ✅ all | ✅ |
| Mark attendance | ✅ | ❓ should HT? | ✅ | ✅ |
| Create/publish exercise, grade, publish grade | ✅ | ❓ should HT? | ✅ | ✅ |
| Qualitative assessment / compute final grade | ✅ | ✅ | ✅ | ✅ |
| Create academic term | ❌ | ✅ | ✅ | ✅ |
| Propose level-up | ✅ | ✅ | ✅ | ✅ |
| Approve/reject level-up | ❌ | ✅ | ❓ (HT only today) | ✅ (head_teacher only) |
| Issue certificate | ❌ | ✅ | ✅ | ✅ |

## VIOLATIONS FOUND

**None in the API authorization layer.** No procedure grants `giao_vien` the ability to create classes, batches, schedules, courses, rooms, students, or enrollments. The screenshot does not demonstrate a teacher with class-creation rights — it is a super/manager session in a shared staff app.

Lower-severity items (clarity / hardening, not authorization breaks):

1. **App naming implies teacher omnipotence.** `apps/teaching` is a unified staff workspace gated only by client-side flags. It reads as "the teacher app can do X" when it is really "the staff shell shows X to whatever role you logged in as." Consider renaming (e.g. "Staff" / "Workspace") or splitting surfaces so teacher logins visibly cannot reach manager modules. (Backend already enforces correctly, so this is UX/trust, not security.)
2. **`canManageClass` identifier collision** — `quan_ly/sale` (`shell.tsx:243`) vs `quan_ly`-only (`App.tsx:870`). Unify to prevent future drift.
3. **Defense-in-depth is sound but client-only for visibility.** All hard gates are server-side (`requireRole` + RLS); the UI flags are convenience-only. No action required, noted for completeness.

## Unresolved questions for the user

1. **Should `head_teacher` (academic admin) be able to create/schedule classes (batches, slots, generate sessions), or is class provisioning intentionally `quan_ly`-only?** The reference docs don't decide this; OpenEduCat would usually give a registrar/academic group that right.
2. **Role hierarchy:** backend gates are flat — `head_teacher` is *not* implicitly a `giao_vien`, so a head_teacher cannot `attendance.mark` / `grade.grade` / create exercises. Intended, or should head_teacher inherit teacher verbs?
3. **App segmentation:** keep one shared staff shell with role-gated modules, or split into distinct teacher vs manager apps so a teacher login cannot even see manager controls?
4. **`quan_ly` and level-up:** approval is `head_teacher`-only today; should `quan_ly`/super also be able to approve when no head_teacher is staffed at a facility?

---

Status: DONE
Summary: No RBAC violation found — `giao_vien` cannot create classes at either the API (`classBatch.create` = quan_ly, `class-batch.ts:60`) or UI (`+ Tạo lớp` gated to quan_ly/super, `App.tsx:870,984`) layer; the screenshot is a super_admin/manager session inside a shared staff workspace. Remaining items are naming/clarity and two policy questions (head_teacher scheduling rights, role hierarchy).
