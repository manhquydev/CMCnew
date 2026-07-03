# Master findings — 6-persona blind QA sweep (2026-07-03)

Source: 6 blind-persona agents (Sale, Giáo viên, GĐ Kinh doanh, GĐ Đào tạo, Học sinh, Phụ huynh)
run live against prod (erp.cmcvn.edu.vn, hoc.cmcvn.edu.vn), plus direct orchestrator
verification/re-testing. Cross-referenced against `docs/design-system.md`.

## CORRECTION (post-report re-verification, same day)

**3 of the original findings were FALSE POSITIVES, caused by the persona agents sharing/reusing
stale browser session state (not isolated per-persona) rather than a real product bug.**
Re-tested each with a fresh, fully-isolated browser context (`chrome-devtools` `isolatedContext`)
and real login:

- ~~Finding #1 (role-aware landing page "Blocker")~~ — **FALSE POSITIVE.** Re-tested Giáo viên
  (→ `/schedule`), GĐ Kinh doanh (→ `/biz-director-cockpit`), GĐ Đào tạo
  (→ `/edu-director-cockpit`) with clean sessions — all landed correctly.
  `defaultSection()` in `App.tsx` is correct.
- ~~Finding #2 (attendance FORBIDDEN "Blocker")~~ — **FALSE POSITIVE.** Re-tested "Điểm danh tất
  cả có mặt" with a clean GĐĐT session — succeeded ("Thành công / Đã điểm danh tất cả học sinh có
  mặt"). (Note: one individual radio-button click hit a tool-level interaction timeout during
  re-test — worth a follow-up check, but not the FORBIDDEN error originally reported.)
- ~~Finding #3 ("Chuyển lớp"/"Buổi học bù" undiscoverable)~~ — **FALSE POSITIVE.** Both buttons
  (`"Chuyển lớp"` in the Ghi danh tab, `"+ Tạo buổi học bù"` in the Buổi học tab) are present and
  render correctly with a clean session — PR #22's features work as built.

**Lesson for future persona-QA rounds**: always give each persona agent a genuinely isolated
browser context/profile, and explicitly instruct agents to start from a logged-out state — do
not assume a "fresh tab" is a fresh session. The remaining findings below were NOT re-verified
individually but are lower-risk (UI text/copy issues, not action-blocking) — treat with normal
confidence, but a sighted spot-check before treating any single one as launch-blocking is still
warranted.

## Executive summary — systemic patterns first (revised)
2. **Raw backend internals (UUIDs, snake_case enums, HTTP error codes) leak into user-facing
   text in at least 4 places**: CRM opportunity activity log (`ownerId`, `stage: O1_LEAD`),
   Users/Roles table (`sale`, `giao_vien` instead of labels), class/enrollment status badges
   ("planned"/"active" untranslated), and a raw **"FORBIDDEN"** toast on a failed attendance-mark
   action. `docs/design-system.md` has no documented convention for enum→label mapping — this is
   a systemic gap, not an isolated bug per occurrence.
3. ~~Two brand-new features (PR #22) undiscoverable~~ — **RETRACTED, see CORRECTION above.**
   Re-verified: both "Chuyển lớp" and "+ Tạo buổi học bù" render correctly with a clean session.
4. ~~Attendance-marking "FORBIDDEN" regression~~ — **RETRACTED, see CORRECTION above.**
   Re-verified: bulk-mark succeeds with a clean session.
5. **Consolidated/compound nav labels hide functionality**: the teacher-only nav collapse
   (`260701-1910-teacher-nav-lich360-consolidation`) nests "Chấm công" (check-in) as a secondary
   tab inside "Lương & chấm công" — functional, but a first-day teacher would not guess to click
   a salary-labeled item to find check-in.
6. **A real broken route**: parent "Tiến trình" (Progress) nav item always misroutes to
   Notifications — reproduced 3× including direct URL navigation. No progress view exists for
   parents at all.
7. **A real product gap**: no parent-meeting schedule surfaces anywhere in the parent LMS UI,
   despite backend support existing for class-wide meetings with automated reminders.

## Full findings (severity-ranked, deduped)

| # | Finding | Severity | Tag | Bucket | Source(s) |
|---|---|---|---|---|---|
| 1 | ~~No role-aware post-login landing page~~ | ~~Blocker~~ | — | **RETRACTED — false positive, re-verified working** | — |
| 2 | ~~Attendance-mark FORBIDDEN~~ | ~~Blocker~~ | — | **RETRACTED — false positive, re-verified working** | — |
| 3 | ~~"Chuyển lớp"/"Buổi học bù" undiscoverable~~ | ~~Major~~ | — | **RETRACTED — false positive, re-verified working** | — |
| 4 | Raw DB internals (UUIDs, enums) leak in CRM activity log | Major | Technical | Code fix | Sale |
| 5 | Raw backend role enums shown in Users/Roles table instead of labels | Major | Technical | Code fix | GĐKD |
| 6 | Stage stepper highlights wrong "current" stage on opportunity detail | Major | UI | Code fix | Sale |
| 7 | "Nhân sự & Lương" nav item visible but always denies GĐKD — dead-end nav | Major | UX | Code fix | GĐKD |
| 8 | Attendance markable for unassigned/future-dated sessions, no warning | Major | Business logic | Code fix | Giáo viên |
| 9 | "Lịch dạy" default range is "this week" — doesn't show next-week+ sessions without manually widening the date range | Minor (downgraded from Major — re-verified as default-range UX, not a data bug: QA sessions are 06-20/07, page defaulted to 28/06-04/07) | UX | Code fix (better default range, or clearer "no sessions in THIS range" copy) | GĐĐT |
| 10 | Parent "Tiến trình" nav always misroutes to Notifications | Major | Technical | Code fix | Phụ huynh |
| 11 | No parent-meeting schedule surfaces in parent LMS UI | Major | UX | Redesign decision | Phụ huynh |
| 12 | Checkin nested under "Lương & chấm công" — not discoverable as its own item | Minor→Major (naming) | UX | Redesign decision | Giáo viên + orchestrator |
| 13 | Internal stage codes (O1-O5) in user-facing button/modal copy | Minor | UX | Code fix | Sale |
| 14 | English calendar widget inside Vietnamese app | Minor | UI | Code fix | Sale |
| 15 | Class/enrollment status badges show raw English enums ("planned") | Minor | UI | Code fix | GĐĐT |
| 16 | Untranslated English word "publish" in student empty-state | Minor | Technical | Code fix | Học sinh |
| 17 | "Đặt test" dialog allows silent midnight (00:00) save with no time picked | Minor | UX | Code fix | Sale |
| 18 | Contact list stale after creating opportunity (no refresh) | Minor | UX | Code fix | Sale |
| 19 | No profile/settings page reachable from user avatar (3 personas hit this independently) | Minor | UX | Redesign decision | Sale, Giáo viên, Học sinh |
| 20 | "PT:" abbreviation never spelled out on CRM cards | Minor | UX | Code fix | Sale |
| 21 | Browser tab title wrong on multiple pages ("Cổng nhân sự" everywhere) | Minor | Technical | Code fix | GĐKD |
| 22 | Date input format inconsistent (DD/MM/YYYY vs raw YYYY-MM-DD) across app | Minor | UI | Redesign decision (design-system gap) | GĐKD |
| 23 | Dev-style bilingual dropdown labels ("Đào tạo (training)") | Minor | UI | Code fix | GĐKD |
| 24 | Sidebar/page-title naming mismatch ("Cơ sở & Users" vs "...& Người dùng") | Minor | UI | Code fix | GĐKD |
| 25 | CRM page layout puts data-entry form above pipeline overview (wrong priority for director) | Minor | UX | Redesign decision | GĐKD |
| 26 | No aggregated/team-level CRM metrics for directors | Minor | UX | Redesign decision | GĐKD |
| 27 | "Lịch dạy" empty state gives no next-step guidance | Minor | UX | Code fix | Giáo viên |
| 28 | "Cơ sở" field flashes empty/required before auto-populating | Minor | UI | Code fix | Giáo viên |
| 29 | "Báo cáo điểm danh" is a roll-call tool, not an actual trend/summary report | Minor | UX | Redesign decision | GĐĐT |
| 30 | Session cards show class name twice (duplicate field binding) | Minor | UI | Code fix | Học sinh |
| 31 | Leaderboard podium truncates own name unnecessarily | Minor | UI | Code fix | Học sinh |
| 32 | Attendance buried under "Buổi học (ảnh & nhận xét)" label, not findable as "attendance" | Minor | UX | Redesign decision | Phụ huynh, Học sinh (implicit) |
| 33 | Backend-sounding phrasing in student schedule ("khung chương trình chưa gắn") | Minor | UX | Code fix | Học sinh |

## Positive findings (worth preserving as patterns)

- Check-in status message correctly shows plain Vietnamese, no raw IP (confirms this session's
  earlier fix held) — Giáo viên.
- Executive "Cockpit điều hành" dashboard is well-designed, clear empty states, good for GĐKD's
  actual role — GĐKD.
- Homework empty-state's illustrated "beanstalk with cloud tiers" metaphor is reassuring and
  well-designed — recommend extending this pattern to other rough empty states — Học sinh.
- "Đánh giá KPI" workflow-legend banner explaining status lifecycle — good onboarding pattern to
  reuse elsewhere — GĐĐT.
- Revenue report's inline "why this number" methodology note — good transparency pattern — GĐKD.

## Bucket A — needs a code fix (concrete, actionable now)

Findings #1 (role landing page), #4, #5, #6, #7, #8, #10, #13-18, #20, #21, #23, #24, #27, #28,
#30, #31, #33. Straightforward: swap raw values for labels, fix routing, add validation, fix
stale-cache refresh.

Findings #2, #3, #9 need a **debug pass first** (root cause not yet isolated) before a fix can be
scoped — do not treat as simple find-and-replace fixes.

## Bucket B — needs a design-system/UX redesign decision (feeds deferred Phase D)

Findings #11 (parent-meeting surfacing), #12 (checkin discoverability/naming), #19 (no profile
page — systemic, 3 personas), #22 (date format standard — belongs in `docs/design-system.md` as
a new documented rule), #25, #26, #29, #32. These need a product/design decision before
implementation, not just a patch.

## Unresolved Questions

1. Finding #2 (attendance FORBIDDEN in browser, succeeds via API) — is this a stale session
   token in the browser test environment specifically, or does it reproduce on a real teacher
   account too? Needs a controlled repro (fresh login, immediate action, check network tab for
   the actual request payload/headers sent by the browser vs curl).
2. Finding #3 (Chuyển lớp/Buổi học bù undiscoverable) — is the button genuinely not rendering
   (a real bug in this session's own PR #22 code), or did the blind persona simply not find it
   (a discoverability-only issue)? Needs a sighted re-check of the exact DOM state on the
   EnrollTab/SessionsTab for this account.
3. Finding #9 (Lịch dạy shows no sessions) — confirm whether this is a default date-range UX
   issue (page defaults to "this week", QA sessions are next week+) rather than a true data bug.
