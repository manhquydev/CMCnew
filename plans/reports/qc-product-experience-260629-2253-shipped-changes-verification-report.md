---
title: "QC: Product-Experience Verification of Shipped Changes"
date: 2026-06-29
lane: normal
status: completed
intake: 29
method: 3 parallel UI-driving tester agents (real product use, not code tests) on the live dev app
---

# QC: Product-Experience Verification of Shipped Changes

## Method

Three QA testers drove the live admin app (`http://localhost:5173`, super_admin) via browser automation — using the product like real users, observing the screen, not running unit tests. Scopes were split to avoid overlap. Each was instructed to report BLOCKED rather than fabricate. All three completed.

## Verdict: 4/5 across the board — shipped changes work

| Area (tester) | Result | Evidence highlights |
|---|---|---|
| Staff record page + inline edit + activity log (QC-A) | PASS | Row→record (no Xem/Sửa split); Chỉnh sửa→Lưu/Hủy; phone+role edits persist; **activity log reads "Super Admin đã cập nhật — Vai trò: … timestamp"** (who/what/when); empty-role save blocked; facility edit persists. |
| CRM kanban + view framework (QC-B) | PASS (5/5 steps) | Kanban default; view toggle remembered (localStorage); card→detail/Chatter; create→O1; lost-reason flow with correct red "Mất" badge. |
| Cross-cutting regression + schedule/student (QC-C) | PASS w/ concerns | All nav sections load; schedule↔class-detail coherent; student↔Chatter loads; **0 failed network requests** (25 tRPC calls all 200). |

## Findings (prioritized)

### Fixed this round (on shipped surfaces)
- Activity log logged no-op lines (`Vai trò chính: X → X`) → now filtered out in `<ActivityLog>`.
- Empty/invalid-role save was silently disabled → added inline validation message ("Phải có ít nhất một vai trò." / "Chọn vai trò chính để lưu.").
- Back button had no `aria-label` → added.
- Kanban cards not keyboard-accessible → added `role=button` + `tabIndex` + Enter/Space handler.
- Kanban column count included lost/closed opps → badge now counts OPEN opps only.

### Pre-existing, NOT this work (major) — recommend a dedicated fix
- **Rewards page (`#rewards`) ships developer "Backend gap" text to end users** and the approval flow requires hand-typing order UUIDs (no `rewards.pendingList`). Incomplete feature + internal leak. Should be finished or hidden.

### Systemic / framework backlog (fits F5 sweep)
- **Unpaginated long lists:** Users (269), Courses (100+), HR (146) render all rows (Students/Classes are paginated — inconsistent; perf risk).
- **Untranslated enums:** class/session status (planned/running), user role codes shown raw in Users/HR tables. Needs a shared enum→Vietnamese label map.
- Invalid hash route silently falls back to `#org` (minor).

### Needs a manual sanity check (likely harness artifact)
- Both QC-A and QC-B observed SPA route-drift / Users table not painting during MCP-driven snapshots, attributed to the shared/automated browser; valid in-app nav always worked and no failed requests were seen. Worth one manual confirm that "Cơ sở & Users" reliably renders for a real user.

## Dev-DB data changed by testers (disclosure)
- `quanly@cmc.local`: phone "" → `0909123456`; roles `[quan_ly]` → `[quan_ly, cskh]`.
- Facility `CS2`: address "" → "123 Đường QC Test".
- New opportunity "QC Test 61181" (phone +84900000000), marked lost.
All on the dev/demo DB; revert if undesired (re-seed clears it).

## Unresolved Questions
1. Rewards: finish (`rewards.pendingList` + approval UI) or hide until built?
2. Pagination + enum-i18n: fold into the F5 system-wide sweep, or do as a focused fix sooner?
3. Revert the QC test data, or leave (dev/demo)?
