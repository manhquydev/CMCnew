# QC-B — Manager / Cross-Entity Test Report

- **Date:** 2026-06-29 21:19
- **Tester:** QC-B (manager / cross-entity mindset)
- **Target:** http://localhost:5173 (CMC admin app, Vietnamese UI)
- **Login:** super_admin (admin@cmc.local / `<redacted>`) — already authenticated; SU avatar in header.
- **Facility:** HQ — CMC Trụ sở chính · **Class:** B-DEMO-001 (UCREA Sáng tạo — lớp demo, running)
- **Sessions this week:** 28/06, 30/06, 02/07 — all 18:00–19:30, Phòng P101, status `planned`
- **Students enrolled:** HS-0001 Nguyễn Văn An, HS-0002 Trần Thị Bình

## Summary

The schedule → class → student modules now feel genuinely connected. The headline fix is **VERIFIED PASS**: from the schedule Session Detail, clicking **"Mở lớp học"** lands directly on the B-DEMO-001 class workspace (detail pane populated, tabs ready) on the first click — no more dropping the user on an empty "Chọn một lớp" class list. The class-title link on the schedule card behaves identically. Every cross-entity hop (schedule → session → student detail → back → workspace → enroll → student detail) lands on the correct record, and every back button returns to the exact prior context without stranding. Network is all-200, console is clean apart from three cosmetic a11y form-field warnings.

## Checklist (PASS / FAIL)

| # | Check | Result |
|---|-------|--------|
| 1 | Login → #schedule (HQ, Tuần này) shows B-DEMO-001 with 3 sessions | PASS |
| 2 | Session Detail → **"Mở lớp học"** opens B-DEMO-001 workspace DIRECTLY (not empty list) — **THE FIX** | **PASS** |
| 3 | Schedule class-card title link opens class workspace directly | PASS |
| 4 | Class workspace → "Ghi danh" tab → click student name → Student Detail opens; back returns to workspace | PASS |
| 5 | Cross-entity chain (schedule → session → student detail → back → "Mở lớp học"/Xem học viên → enroll → student detail) lands correctly every hop; back never strands | PASS |
| 6 | Multi-session: Mon 28/06 vs Wed 30/06 each show own date/roster/independent attendance state | PASS |
| 7 | Network: no 401/403 on permitted actions | PASS (24/24 → 200) |
| 8 | Console: no JS errors | PASS (only 3 a11y form-field info warnings) |

## The "Mở lớp học" fix — verdict

**PASS.** Two reproductions:

- **From Session Detail button** (Mon 28/06): clicked "Mở lớp học" → URL became `#classes` and the right-hand detail pane immediately rendered the **B-DEMO-001** workspace header (running, status selector, tabs Lịch / Buổi học / Ghi danh / Điểm danh / Họp PH / Nhật ký) listing the class's 3 sessions. Not the empty "Chọn một lớp" pane.
- **From schedule class-card title link**: same direct open to the populated B-DEMO-001 workspace.

Both opened the correct class on first click. The previously-reported dead-end (landing on the class LIST with an empty detail pane) is resolved.

## Cross-entity navigation observations (manager view)

- **schedule → session → "Xem học viên"** opens Student Detail (HS-0001, full tabs: Thông tin HS / Phụ huynh / Ghi danh (1) / Cơ hội / Thanh toán / Điểm / Lịch sử) **in-place within the #schedule route** — the manager never loses the schedule context. Back ("Quay lại danh sách") returns to the *same* session (30/06), not a generic list.
- **class workspace → Ghi danh → student name** opens the same Student Detail; back ("Quay lại danh sách") returns to the class workspace with the Ghi danh tab still selected and roster intact.
- **Multi-session independence confirmed:** the 28/06 session showed An's attendance radio pre-set to "Có mặt", while the 30/06 session showed no radio pre-selected — each session carries its own attendance/roster state. Both rosters correctly list HS-0001 and HS-0002.

## Ranked issues — "what a user feels"

1. **(Low / cosmetic) Three a11y warnings** — "A form field element should have an id or name attribute." A manager won't notice, but screen-reader users and form autofill may. Worth a cheap fix on the affected inputs (search box / status selector).
2. **(Very low / nit) "active" vs roster status wording** — session roster shows student status as `active` (English) while most of the UI is Vietnamese. Minor consistency polish.

No functional defects, no dead-ends, no broken back-navigation, no permission errors found.

## Screenshots

- `qcb-shot-01-schedule.png` — schedule list, HQ / Tuần này, 3 sessions
- `qcb-shot-02-session-detail.png` — Session Detail 28/06 with "Mở lớp học"
- `qcb-shot-03-class-workspace-direct.png` — **the fix**: B-DEMO-001 workspace opened directly
- `qcb-shot-04-enroll-tab.png` — Ghi danh tab, enrolled HS-0001/HS-0002
- `qcb-shot-05-student-detail-from-enroll.png` — Student Detail opened from enroll tab
- `qcb-shot-06-crossentity-student-from-session.png` — Student Detail opened from Session Detail "Xem học viên" (within #schedule)

(All in `D:\project\CMCnew\plans\reports\`)

## Unresolved questions

- The week range "Tuần này" spans 28/06–04/07 with a session on **28/06** (which is a Sunday). Is week-start intended to be Sunday, or should the demo Monday session fall on 29/06? Cosmetic to the fix but worth confirming the seed/week-boundary intent.
- Student status label `active` is rendered in English inside an otherwise-Vietnamese roster — intended or a missed translation?
