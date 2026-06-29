# QC-A — Session Detail teacher-task lens (real Chrome)

Date: 2026-06-29 21:50 | Tester: QC-A | Target: http://localhost:5173 (CMC admin staff app)
Auth: super_admin (admin@cmc.local) password-login, password redacted throughout.
Facility: HQ — CMC Trụ sở chính. Class: B-DEMO-001. Week: 28/06–04/07/2026.

## Summary

The teacher daily path is connected and works end-to-end. Login → schedule list → session
detail → student detail → back → mark attendance → open class workspace all succeed, and
attendance persists to the dev DB (verified by `POST attendance.mark` 200 AND the radio
staying checked after leaving and re-entering the session). The session JWT is stable in
real Chrome — NO 401/403 on any permitted action across ~18 tRPC calls. The prior
"401 after first call" was confirmed a Playwright artifact, not a product defect.

Two real product issues found: (1) "Mở lớp học" deep-link lands on the class LIST with an
empty detail pane ("Chọn một lớp…") instead of opening the B-DEMO-001 workspace — one extra
click needed. (2) A flood of recurring React "Unsupported style property" console errors
(data-attribute selectors passed as JS style props). One environmental noise item: a transient
Vite/Babel build-error overlay ("Duplicate declaration ActivityLog" in staff-profile.tsx)
appeared once — caused by a concurrent in-progress edit to an unrelated file, cleared on reload,
and NOT a defect of the schedule/session feature.

## Checklist

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1 | Login as super_admin | Lands on Tổng quan, banner "SU" | PASS |
| 2 | Go to Lịch dạy (#schedule), facility HQ, Tuần này | B-DEMO-001 + 3 sessions this week | PASS |
| 3 | Session rows | 28/06, 30/06, 02/07 · 18:00–19:30 · P101 · planned | PASS |
| 4 | Click session row | Session Detail: header date/time/status, class card "Mở lớp học", roster, attendance, activity log | PASS |
| 5 | Roster "Học viên trong buổi" | HS-0001 Nguyễn Văn An + HS-0002 Trần Thị Bình, "Xem học viên" | PASS |
| 6 | Click student → Student Detail | Opens HS-0001 with tabs (Thông tin/Phụ huynh/Ghi danh/Cơ hội/Thanh toán/Điểm/Lịch sử) | PASS |
| 7 | Back arrow → return to SAME session detail | Returns to 28/06 session detail | PASS (label says "Quay lại danh sách" — minor mismatch) |
| 8 | Mark An "Có mặt" | Radio checks, persists, no error | PASS (attendance.mark 200; checked after re-entry) |
| 9 | "Có phép" gating | Enabled only after a status is marked | PASS (An's checkbox enabled; Bình's stays disabled) |
| 10 | Click "Mở lớp học" → Class Workspace at B-DEMO-001 | Workspace opens at B-DEMO-001 | PARTIAL FAIL — lands on class LIST, detail pane empty; needs 1 extra click |
| 11 | Console clean | No errors | FAIL — recurring "Unsupported style property" errors |
| 12 | Network — no 401/403 on permitted actions | All 2xx | PASS (all 200, incl. attendance.mark) |

## Click count: schedule → student detail

3 clicks: (1) sidebar/nav to Lịch dạy [used #schedule hash], (2) session row, (3) "Xem học viên".
From the schedule list a teacher reaches a student in 2 clicks (session row → Xem học viên).
Intuitive and short.

## Ranked issues

### Blocker
- None in the session-detail/teacher feature itself.
- NOTE (environmental, not a feature defect): a Vite/Babel HMR overlay "Duplicate declaration
  ActivityLog" (apps/admin/src/staff-profile.tsx:211) appeared once. The file is in the
  uncommitted modified set and was being edited live by another teammate; grep found no such
  declaration moments later and a reload cleared it. If staff-profile.tsx is left in a broken
  state at commit time it WOULD become a blocker (build fails), so the concurrent editor must
  land a compiling version. Screenshot: qc-a-shot-01-schedule-with-vite-error.png.

### Major
- "Mở lớp học" does not open the class workspace. It navigates to #classes and shows the class
  list with "Chọn một lớp để xem chi tiết." B-DEMO-001 is first/highlighted but the detail pane
  is empty; the teacher must click the row again to actually open the workspace. What a user
  feels: "I clicked Open class and it dumped me in a list of 55 classes — did it work? Which one
  was mine?" The class context from the session is dropped on the deep-link.
  Screenshots: qc-a-shot-06-class-workspace.png (empty pane), qc-a-shot-07-class-workspace-opened.png (after extra click).

### Minor
- Recurring console errors: React "Unsupported style property … &[data-variant=\"filled\"]…
  Did you mean &[dataVariant=\"filled\"]". Data-attribute selector keys are being passed in JS
  style objects (Mantine/emotion style props used incorrectly), so hover/active/selected/striped
  state styles likely never apply. Cosmetic at runtime but pollutes the console and signals dead
  styling. ~14 occurrences across navigations.
- Status labels not localized: session/class status renders raw enum "planned"/"running"
  (English, lowercase) while the rest of the UI is Vietnamese. A teacher reads "planned" where
  they'd expect "Đã lên lịch".
- Back-button label mismatch: from Student Detail the button reads "Quay lại danh sách"
  (back to list) but behavior correctly returns to the Session Detail. Label should say
  "Quay lại buổi học" to match.
- Activity log does not reflect attendance: after marking An present, "Nhật ký & ghi chú" still
  shows "Chưa có hoạt động." A teacher might expect "Điểm danh: An — Có mặt" to log there.
  (May be by design — note vs. audit timeline — but feels incomplete.)
- Dev-state fragility: an HMR reload (from the concurrent edit) reset the view from Session
  Detail back to the schedule list mid-flow, losing in-page state. Not a product bug per se, but
  the in-memory-only view state means any reload drops the teacher's place.

## Screenshots
- D:\project\CMCnew\plans\reports\qc-a-shot-01-schedule-with-vite-error.png (transient build overlay)
- D:\project\CMCnew\plans\reports\qc-a-shot-02-schedule-list.png
- D:\project\CMCnew\plans\reports\qc-a-shot-03-session-detail.png
- D:\project\CMCnew\plans\reports\qc-a-shot-04-student-detail.png
- D:\project\CMCnew\plans\reports\qc-a-shot-05-attendance-marked.png
- D:\project\CMCnew\plans\reports\qc-a-shot-06-class-workspace.png (empty detail pane)
- D:\project\CMCnew\plans\reports\qc-a-shot-07-class-workspace-opened.png

## Unresolved questions
1. Is "Mở lớp học" supposed to open the workspace directly (deep-link into class detail) or
   just route to the class list? Current behavior = list only.
2. Should marking attendance write an entry to the session activity log / audit timeline, or is
   that log scoped to manual notes only?
3. Are raw status values ("planned"/"running") intended to ship un-localized?
