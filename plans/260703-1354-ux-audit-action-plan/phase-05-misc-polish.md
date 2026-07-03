# Phase 5 — Misc UI/copy polish (grab-bag)

**Findings resolved:** #14, #16, #17, #21, #23, #24, #30, #31, #33
**~~#15~~ DROPPED — already fixed on `main`** (PR #26, `ec6d1c4`): `apps/admin/src/class-workspace.tsx`
already has `STATUS_LABEL`/`SESSION_STATUS_LABEL` maps (lines 52-61) wired into every status badge —
verified live post fast-forward. No raw `planned`/`active` enum leak remains.
**#27, #28 MOVED to Phase 4** — both live in `schedule-panel.tsx`, which Phase 4 owns outright (not
conditional — confirmed by reading the file). Do not implement them here.
**Effort:** 2h (was 3h; #15 dropped, #27/#28 moved to Phase 4) · **Lane:** normal

Small, independent, file-scattered fixes. Each is self-contained; group here to avoid a wall of micro-phases.

## Context links

- `plans/reports/ui-ux-designer-260703-persona-qa-master-findings-report.md` (findings #14, #16, #17, #21, #23, #24, #30, #31, #33 — #15 resolved separately, #27/#28 in Phase 4)
- `docs/design-system.md` — VN-only copy, status badge + icon pairing, Anti-Patterns

## Items (verify exact file/line per item before editing — grep the string)

| # | Symptom | Likely location / action |
|---|---------|--------------------------|
| #14 | English calendar widget in VN app | Mantine `DatePicker`/`DateTimePicker`/`Calendar` missing VN locale. Set dayjs `vi` locale globally (once, at app root `main.tsx`/provider) so all pickers localize — DRY, one fix covers all. Confirm `@mantine/dates` `DatesProvider` locale="vi". |
| #16 | Untranslated "publish" in student empty-state | Grep `publish` in `apps/lms/src` / student empty-state; replace with VN copy ("xuất bản"/context-appropriate). |
| #17 | Test-booking dialog allows silent 00:00 save with no time picked | `opportunity-detail.tsx` "Đặt lịch test" modal (`testAt` state, `DateTimePicker`, line 676-693): button already `disabled={!testAt}` — verify the picker doesn't default to 00:00 today. If it can submit a date with no time, require an explicit time (validate `testAt` has a time component or use a required time field). |
| #21 | Browser tab title always "Cổng nhân sự" | Static `<title>`. Add per-route `document.title` update (small `useEffect` in shell keyed on active nav, or per-panel). Reflect current page. |
| #23 | Bilingual dropdown labels "Đào tạo (training)" | Grep the `(training)`/bilingual option labels; drop the English parenthetical — VN only. |
| #24 | Sidebar vs page-title mismatch: "Cơ sở & Users" vs "…& Người dùng" | Pick one wording ("Cơ sở & Người dùng" — VN, per nav-naming memory). Fix in `shell.tsx` nav label + the page `<Title>` (`App.tsx`) so both match. |
| #30 | Session cards show class name twice | Grep session card render (`schedule-detail.tsx` / session card component); remove the duplicate class-name line. |
| #31 | Leaderboard podium truncates own name unnecessarily | `apps/lms` leaderboard/podium component: relax `lineClamp`/width truncation for the current-user entry. |
| #33 | Backend-sounding "khung chương trình chưa gắn" in student schedule | Grep the string in `apps/lms`; reword to parent-facing VN copy ("Lịch học chưa sẵn sàng" or similar). |

## Implementation steps

1. Grep each finding's literal string / component to confirm the exact file:line (do not trust the table blindly — enumerate hits).
2. Apply the minimal local edit. For #14, prefer a **single shared fix** (global dayjs/Dates locale) over per-call-site patches (DRY).
3. Keep all copy Vietnamese-only; pair status color with icon+label per design-system.

## Validation / tests

- [ ] All date pickers render Vietnamese month/day names (#14).
- [ ] No English words leak in touched copy: `publish` (#16), `(training)` (#23), backend phrasing (#33) gone.
- [ ] Test-booking cannot save without an explicit time (#17).
- [ ] Browser tab title changes per page (#21).
- [ ] "Cơ sở & Người dùng" identical in sidebar and page title (#24).
- [ ] No duplicate class name on session cards (#30); own name not truncated on podium (#31).
- [ ] `pnpm -w typecheck` + `pnpm -w lint` clean.

## Risks & rollback

- No file overlap with any other phase (Phase 4 owns `schedule-panel.tsx` outright, per `plan.md` Dependencies).
- Each item is an isolated revert. #14's global locale change is the only cross-cutting edit — verify it doesn't break existing date parsing/formatting (formatting is display-only; low risk).
- Low blast radius overall; no shared-state or contract changes.
