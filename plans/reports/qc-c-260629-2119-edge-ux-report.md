# QC-C — Edge-case / UX Skeptic Report: Connected Session Detail + Schedule Navigation

- Date: 2026-06-29 ~21:30
- Target: http://localhost:5173 (CMC admin, Vietnamese UI), seed data
- Login: super_admin (admin@cmc.local, password redacted) — session was already active
- Method: real Chrome via chrome-devtools MCP, behaving as an impatient user trying to break things
- Scope: #schedule (Lịch dạy) list → Session Detail, attendance, navigation edge cases; #attendance (Điểm danh) empty state

## Summary

The connected Session Detail and schedule navigation are mostly solid for the happy path: empty-week shows a clean Vietnamese message, the in-app "Quay lại lịch" back button works, reload keeps you logged in and resets cleanly, and section-switching does not leave stale detail. Two real defects stand out for a user: (1) the attendance "Có phép" (excused) flag does NOT reset when a student is switched from Vắng back to Có mặt, producing the contradictory state "Present + Excused absence"; and (2) typing into the date-range fields is unstable — values get re-interpreted (day/month swapped) and a malformed entry surfaces a raw Zod JSON error string directly to the end user. Browser BACK from a detail skips the list and jumps to the previous section, which will confuse users. Raw English enum text (planned / active) leaks into the Vietnamese UI. Console logs 7 styling errors and 3 a11y "missing id/name" issues on every render.

## Checklist (PASS / FAIL)

| # | Charter item | Result | Notes |
|---|---|---|---|
| 1 | Empty week → clean "Không có buổi học…" | PASS | Future range shows "Không có buổi học nào trong khoảng thời gian đã chọn." No error/blank. |
| 2 | Empty roster in Session Detail | NOT REACHABLE | Only B-DEMO-001 has sessions, and it has 2 enrollments. No empty-roster session reachable read-only with current seed. (Attendance section empty-today state tested instead — see #7 / Major-2.) |
| 3a | Browser BACK from detail | FAIL (UX) | BACK does not close the detail; it jumps to the previously-visited SECTION (#students). Lands cleanly, no crash, still logged in — but surprising. |
| 3b | Reload mid-detail (F5) | PASS | Stays logged in, no crash, resets to schedule LIST. In-memory attendance edits discarded (expected). |
| 4 | Section switch clears detail | PASS | Lịch dạy → Học sinh → back to Lịch dạy returns to the LIST, not stale detail. |
| 5 | Attendance mark / Có phép gating / toggle | PARTIAL FAIL | Gating works (Có phép enabled once a status is chosen). BUT switching Vắng→Có mặt leaves "Có phép" still CHECKED and enabled → contradictory state. |
| 6 | Labels / i18n | FAIL | Raw enums "planned" (session status) and "active" (roster status) shown in a Vietnamese UI. Students section by contrast localizes lifecycle ("Đã nhận" / "Đang học"). |
| 7 | Console + network | PARTIAL | Network all 200 in normal flow. Console: 7 "Unsupported style property" React errors + 3 a11y "form field needs id/name" issues. A raw Zod error is rendered to the UI on a malformed date (see Major-1). |

## Ranked Issues

### BLOCKER
None. No crash, no data loss, no auth break observed.

### MAJOR

**Major-1 — Contradictory attendance state: "Có mặt" + "Có phép" both set.**
- Repro: open Session Detail for 28/06 B-DEMO-001 → mark student 2 (Trần Thị Bình) "Vắng" → tick "Có phép" → switch student 2 back to "Có mặt". The "Có phép" checkbox stays CHECKED and enabled.
- What a user feels: "Wait — present AND on excused absence? Which is it?" A teacher submitting this records a present student flagged as excused-absent. Garbage data into attendance/payroll/retention downstream.
- Fix direction: when status changes away from an absence-type, clear (and ideally re-disable) "Có phép". Decide product rule: is "Có phép" valid only for Vắng (and maybe Muộn), or for any status? Currently it is enabled for "Có mặt" too, which is itself questionable.
- Screenshot: `qc-c-attendance-toggled.png`

**Major-2 — Raw Zod validation JSON leaked to the user on a malformed date.**
- Repro: in the date-range field, an invalid/concatenated value (e.g. masked input producing `04/07/202607/09/2026`) made the schedule render: `Lỗi tải lịch: [ { "code": "invalid_string", "validation": "date", "message": "Invalid date", "path": [ "to" ] } ]`.
- What a user feels: a wall of developer JSON where a friendly "Ngày không hợp lệ" should be. Looks broken/unprofessional.
- Fix direction: catch the schedule query error and show a localized message; never render the raw Zod issue array.
- Screenshot: `qc-c-raw-zod-error.png`

**Major-3 — Date-range inputs re-interpret typed values (day/month swap) and have no inverted-range guard.**
- Repro: typing `01/09/2026` into "Từ ngày" got stored, then re-rendered as `09/01/2026`; typing `07/09/2026` into "Đến ngày" re-rendered as `09/07/2026`. Also, leaving from > to (01/09 vs 04/07) gave no warning — just an empty list.
- What a user feels: "I typed September and it shows January." Loses trust in the filter; may think there are no classes when the range is just wrong. The calendar picker works correctly, so a user who only clicks dates is fine — but anyone who types is bitten.
- Fix direction: parse with explicit dd/MM/yyyy, reject/normalize ambiguous input, and warn when from > to.
- Screenshots: `qc-c-raw-zod-error.png`, `qc-c-empty-week.png`

### MINOR

**Minor-1 — Raw English enums in Vietnamese UI.** Session status "planned" (schedule list + detail badge) and roster status "active" appear untranslated. Should be "Đã lên lịch" / "Đang học" (matches the localized lifecycle labels already used in Học sinh). Screenshots: `qc-c-schedule-baseline.png`, `qc-c-session-detail.png`.

**Minor-2 — Browser BACK from detail is unintuitive.** The session detail is in-memory (URL stays `#schedule`), so browser BACK skips the list and lands on the previous section. A user instinctively pressing BACK to "close" the detail ends up somewhere else. The in-app "Quay lại lịch" button works correctly and is the intended path. Consider pushing a history entry for the detail so BACK closes it.

**Minor-3 — "Điểm danh" with no session today: dead disabled dropdown, no empty-state text.** Landing on #attendance defaults to today (29/06, no sessions) and shows only a disabled select labeled "Buổi học hôm nay (29/06/2026)" with no "Không có buổi học hôm nay" guidance. A user sees a greyed-out control and no explanation. Screenshot: `qc-c-attendance-no-session-today.png`.

**Minor-4 — Two date pickers can be open at once.** Clicking into "Từ ngày" while the "Đến ngày" calendar is still open shows both calendars stacked — visual clutter, easy to click the wrong month.

**Minor-5 — Console noise on every render.** 7× `Unsupported style property … &[data-variant="filled"]…` (Mantine selector strings passed as React inline-style props) and 3× a11y `A form field element should have an id or name attribute`. Not user-visible but indicates a styling-prop bug and unlabeled inputs (the date/search fields).

## Screenshots (in plans/reports/)
- `qc-c-schedule-baseline.png` — schedule list with raw "planned" enum
- `qc-c-empty-week.png` — empty-week clean state (charter 1 PASS)
- `qc-c-raw-zod-error.png` — raw Zod JSON error leaked to UI (Major-2)
- `qc-c-session-detail.png` — Session Detail (roster, attendance, raw "active")
- `qc-c-attendance-toggled.png` — contradictory "Có mặt" + "Có phép" (Major-1)
- `qc-c-after-reload.png` — clean reset after reload (charter 3b PASS)
- `qc-c-attendance-no-session-today.png` — Điểm danh disabled dropdown, no empty text (Minor-3)

## Unresolved questions
1. Product rule for "Có phép": valid only for Vắng (and Muộn), or any status? Current UI enables it for "Có mặt" — intended?
2. Should attendance edits persist in a client store across in-app navigation (observed) but reset on reload (observed)? Confirm this is the intended draft model, and that nothing persists until "Gửi".
3. Empty-roster Session Detail state could not be exercised with current seed (all sessions belong to a class with 2 enrollments). Worth a dedicated empty-class session in seed to validate the "Chưa có học viên…" path.
4. Is the in-memory (no-history) detail view intentional, or should the detail be a routable URL so browser BACK closes it?

Status: DONE_WITH_CONCERNS
Summary: All 7 charter items exercised; 3 Major + 5 Minor UX issues found. Top concerns: contradictory Present+Excused attendance state and a raw Zod error string shown to users on malformed dates.
