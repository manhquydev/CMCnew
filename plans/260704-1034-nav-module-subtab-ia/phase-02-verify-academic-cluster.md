# Phase 2 — Verify academic cluster (Giảng dạy, Lớp học, Học sinh)

Status: pending
Blocked by: Phase 1.
Owns (files): `nav-modules.ts` (subtab list refinement for these 3 modules only), the
relevant nav-test assertions. No panel/business-logic changes.

## Purpose

Live-verify the first 3 modules across every role that sees them, and fix module-level edge
cases surfaced (single-subtab suppression, teacher-only aggregates, hidden `certificate`).

## Scope (modules)

1. `giang-day` — subtabs schedule / attendance / attendance-report / grading / assessment.
2. `lop-hoc` — classes / courses / student-mgmt / meetings / levelup / certificate(hidden).
3. `hoc-sinh` — students / guardians.

## Verification matrix (live, per role)

| Role | Expect (module → visible subtabs) |
|---|---|
| `giao_vien`-only | `giang-day`→[`schedule`, `attendance-report`] (2 subtabs — `attendance.report=[giao_vien,giam_doc_dao_tao]` is NOT `!isTeacherOnly`-gated, `shell.tsx:633`; bar SHOWN); `lop-hoc`→[`student-mgmt` only] (single → bar suppressed, rail shows module label, screen title in-page); `hoc-sinh`→hidden (no student.update/guardian gate). Default landing = schedule → giang-day active. |
| `giam_doc_dao_tao` | `giang-day`→full academic set per gates; `lop-hoc`→classes/courses/meetings/levelup; `hoc-sinh`→guardians (guardian.parentList) but NOT students unless student.update. |
| `giam_doc_kinh_doanh` | `hoc-sinh`→students (student.update via sale? verify) — assert exact per `nav-consistency`. |
| `sale` / `ctv_mkt` | `hoc-sinh`→students (student.update = [sale, giam_doc_kinh_doanh], `nav-permissions.ts:77`). |
| multi-role giao_vien+GĐĐT | NOT collapsed — full subtab sets. |

## Steps

1. Log in as each role above (seed accounts); confirm each module's subtab set == the
   `visible` leaves from `buildNavGroups` (parity with pre-change flat nav).
2. Confirm `certificate` never appears (visible:false, `shell.tsx:651`).
3. Confirm clicking each subtab renders the correct panel (switch unchanged) and the
   `goToClass`/schedule `selectedSession` flows still work (schedule→class workspace deep nav).
4. Confirm student/staff/class search deep-links land in this cluster's modules correctly.

## Tests / validation

- `nav-teacher-consolidation.test.ts` green for the collapsed set
  (`COLLAPSED_SECTIONS`, `:35-37`).
- Typecheck clean; `gitnexus_detect_changes` scope; `code-reviewer` pass.

## Risks / rollback

- Risk: teacher-only single-subtab modules feel empty. Mitigation: §5.4 suppression verified
  live. Rollback: revert this cluster's `nav-modules.ts` subtab tweaks (Phase 1 mechanism
  stays).
