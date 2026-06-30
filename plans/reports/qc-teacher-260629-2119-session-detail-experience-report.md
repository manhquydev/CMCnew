# QC Teacher Report — Connected Session Detail Experience

- Date: 2026-06-29 21:30 (+07)
- Tester role: QC1 (teacher / giáo viên mindset, real-UI observation)
- Target: http://localhost:5173 (CMC Admin staff app, develop branch)
- API: http://localhost:4000/trpc
- Auth used: super_admin `admin@cmc.local` (FALLBACK — see below; password redacted)

## Summary

I could NOT reach the feature under test. Testing the connected Session Detail
flow is **BLOCKED** by two independent issues:

1. **No data to drive the feature.** The dev database has **0 class batches, 0
   class sessions, 0 schedule slots, 0 enrollments**. The schedule (`Lịch dạy`)
   is therefore legitimately empty for every date range and facility — there is
   no lesson row to click, so Session Detail, the roster, attendance, "Mở lớp
   học", and the activity log can never render. The seed (`packages/db/src/seed.ts`)
   creates staff/users but no academic data.
2. **Cannot log in as a real teacher.** The seeded teacher `giaovien@cmc.local`
   rejects password login with HTTP 403: *"Nhân viên đăng nhập bằng tài khoản CMC
   EDU (SSO)"* — staff are SSO-only. Only the super_admin seed accepts a password.
   So even with data, I could not observe the flow as an actual `giao_vien`. The
   super_admin path was used as a fallback; it loads the schedule as a manager
   (sees all facility sessions) but still shows nothing because no sessions exist.

A secondary, real product concern surfaced: the staff **session/auth is unstable**
— after the initial dashboard load, subsequent tRPC queries and any page reload
return `401 UNAUTHORIZED` (schedule, classes, courses, rooms, staffNotif). See
Issue B1.

## Checklist (PASS / FAIL / BLOCKED)

| # | Item | Result | What I saw |
|---|------|--------|------------|
| 1 | Log in as teacher `giaovien@cmc.local` | FAIL | 403 "đăng nhập bằng tài khoản CMC EDU (SSO)". Staff = SSO-only; password path rejected. Fell back to super_admin. |
| 2 | Open Schedule (Lịch dạy / #schedule) | PASS | Section loads with Cơ sở + date range filters and "Tuần này". |
| 3 | See lesson/session rows in schedule | BLOCKED | "Không có buổi học nào trong khoảng thời gian đã chọn." for every range. DB has 0 sessions. |
| 4 | Click a session row → Session Detail opens | BLOCKED | No rows to click. |
| 5 | Header (date/time/status/room) | BLOCKED | Unreachable. |
| 6 | Class card + "Mở lớp học" button | BLOCKED | Unreachable. |
| 7 | Roster "Học viên trong buổi" | BLOCKED | Unreachable (0 enrollments). |
| 8 | Attendance "Điểm danh" + persistence | BLOCKED | Unreachable; could not exercise the write. |
| 9 | Activity log at bottom | BLOCKED | Unreachable. |
| 10 | Student row → Student Detail → back returns to Session Detail | BLOCKED | Unreachable. |
| 11 | "Mở lớp học" → Class Workspace | BLOCKED | Unreachable (also 0 class batches; Lớp học shows "Lớp học (0)"). |

## Ranked Experience Issues

### Blocker

- **B0 — Feature has no seed data (cannot be demoed/tested).** *What a user feels:*
  a teacher opens "Lịch dạy", widens the dates, switches facility, and the screen
  is empty every time — they conclude the app is broken or has no classes. There
  is no onboarding hint ("no classes have been created yet") distinguishing
  "empty because new" from "empty because filtered". Verified: `class_batch=0,
  class_session=0, schedule_slot=0, enrollment=0`.
- **B1 — Staff session drops to 401 after first load / on reload.** *What a user
  feels:* they log in, the dashboard shows, then clicking into Lịch dạy or Lớp học
  throws red "UNAUTHORIZED" panels ("Không tải được danh sách lớp: UNAUTHORIZED",
  "Lỗi tải lịch: UNAUTHORIZED"), and a page refresh logs everything out silently.
  Observed sequence: dashboard 200 → first `schedule.mySessions` 200 (empty) →
  repeat `schedule.mySessions` 401 → after reload `staffNotif.unreadCount` 401.
  This looks like an in-memory token that is not persisted to a durable cookie,
  or a short/again-rejected session. May be a dev-env artifact, but to a user it
  reads as random logouts. Needs confirmation on the running stack.

### Major

- **M1 — Teacher accounts can only authenticate via CMC EDU SSO.** *What a user
  feels:* a giáo viên with just `giaovien@cmc.local` + password cannot get in;
  the only feedback is a one-line error. This is by-design (staff = SSO), but it
  means the teacher experience is untestable without a working SSO/IdP, and any
  QA pass of teacher-facing flows depends on that external dependency being up.

### Minor

- **m1 — Cross-facility schedule denial surfaces as raw "UNAUTHORIZED".** Selecting
  `CS2 — CMC Cơ sở 2` as a HQ-scoped super_admin shows "Lỗi tải lịch: UNAUTHORIZED"
  rather than a friendly "bạn không có quyền xem cơ sở này". Correct security
  behavior, poor message. (Note: tangled with B1, so severity is uncertain.)
- **m2 — Date-range picker is fiddly.** The "Đến ngày" calendar popup intercepts
  typed input and reverts the field to its prior value unless dismissed carefully;
  widening the range took several attempts.
- **m3 — Console noise.** A repeated React style warning
  (`Unsupported style property &[data-variant=...]` from a vendored chunk) and a
  404 on `/favicon.ico`. Cosmetic.

## Click-count to a student (from schedule)

Could not measure — the path dead-ends at step 3 (no session rows). Intended path
per spec is schedule row → Session Detail → student row → Student Detail (3 clicks),
but this is unverified.

## Screenshots

- `plans/reports/qc-shots/01-schedule-empty.png` — Lịch dạy, empty for the week.
- `plans/reports/qc-shots/02-classes-empty-unauthorized.png` — Lớp học (0) /
  "Chưa có lớp"; earlier load of this page also showed UNAUTHORIZED alert panels.

## Evidence (network)

- `schedule.mySessions` facility=1 → 200 OK but empty (super_admin = manager, sees
  all facility sessions; none exist).
- `schedule.mySessions` facility=1 (repeat) → 401 Unauthorized.
- `schedule.mySessions` facility=2 → 401 Unauthorized (cross-facility).
- `staffNotif.unreadCount` after reload → 401 Unauthorized.
- `auth.login` `giaovien@cmc.local` → 403 FORBIDDEN "đăng nhập bằng tài khoản CMC EDU (SSO)".
- DB: `class_batch=0, class_session=0, schedule_slot=0, enrollment=0`.

## Unresolved Questions

1. Is the connected Session Detail expected to be testable on this dev stack at
   all, or does QA need a separate seed that creates class batches → slots →
   generated sessions → enrollments first? (If so, that seed/fixture is the
   prerequisite for any teacher-experience pass.)
2. Is the 401-after-first-load (B1) a real session bug on the running app, or an
   artifact of the in-memory auth token not surviving reload in this build? It
   reproduced consistently here and should be confirmed before sign-off.
3. How should QA authenticate as a real `giao_vien` given staff are SSO-only — is
   there a dev SSO bypass, an impersonation tool, or a non-SSO test teacher?
