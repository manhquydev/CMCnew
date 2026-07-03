---
title: "Live UI timeline QA — real CMC operational flow (Sale → GV → Directors → PH/HS)"
type: test
date: 2026-07-03
---

# Live UI timeline QA — ground truth for next planning round

## Method

Agent-driven, sequential (no step-skipping), against the **local dev stack** (isolated Postgres
port 5433, zero risk to live prod) — chosen specifically to avoid slow CI/CD round-trips per
user's own request. Logged in via real browser automation (Playwright MCP), drove the actual
admin (`localhost:5173`) and LMS (`localhost:5175`) UIs, cross-verified every claimed outcome
against direct DB queries — no result in this report is assumed or inferred from UI text alone.

Environment: `docker-compose.dev.yml` (dev Postgres 5433 + Redis 6380), seeded via `seedFull` +
`seed:curriculum` (curriculum_units_seed.csv — confirmed present, git-tracked, not lost). Dev app
servers (api:4000, admin:5173, lms:5175) started manually for this session.

## Full timeline — what actually happened, step by step

| # | Persona | Action | Result | Evidence |
|---|---------|--------|--------|----------|
| 0 | GĐ Đào tạo/Admin | 1-click tạo lớp `B-2026-0001`, chọn khung `UCREA-L1` (khóa cứng), điền GV/giờ | ✅ | Class created; curriculum catalog correctly locked/non-editable, matches shipped `260701-2246-curriculum-framework-oneclick-class` plan exactly |
| 0b | — | Sinh buổi học (generate sessions) | ✅ | "Đã tạo 4 buổi (bỏ qua 0)" — **manual step, not automatic on class creation** |
| 1 | Sale | Tạo cơ hội (O1) qua CRM | ✅ | Opportunity created — **dialog title now "Tạo cơ hội", was "Tạo cơ hội (O1)"** |
| 2 | Sale | Tạo phiếu thu nháp từ cơ hội | ⚠️ retry needed | First attempt with `UCREA-L1` failed: "Khóa học chưa có giá hiệu lực" — curriculum catalog and priced-sales catalog are **disconnected data**. Succeeded with fixture course `CRS_10512_5483` |
| 3 | GĐ Kinh doanh | Duyệt phiếu thu | ✅ | "Đã duyệt phiếu" |
| 4 | (system) | Receipt approve provisions student + LMS login | ⚠️ partial | Student `HS-2026-1423` created; **zero Enrollment created** (DB-confirmed `class_batch_id IS NULL`) — no UI field exists anywhere to bind a receipt to a class |
| 4b | Admin | Ghi danh (manual enrollment) via class detail tab | ✅ | DB-confirmed: `HS-2026-1423 → B-2026-0001, status=active` |
| 5 | Giáo viên (via super_admin bypass*) | Điểm danh (mark attendance present) | ✅ | DB-confirmed: `attendance.status='present'`, tied to 07/09/2026 session. Good UX guardrail: warns "buổi học chưa diễn ra" for future sessions |
| 6 | Giáo viên | Publish ảnh & nhận xét LMS | ✅ (after real business-rule discovery) | Required a **past** session — future sessions correctly gate publish. Required ≥1 photo (real validation). Required student remarks via **template dropdowns** (Điểm mạnh/Cần rèn), not free text. Final: "Đã publish ảnh và nhận xét lên LMS" |
| 7 | Giáo viên/Admin | Đặt lịch họp PH | ❌ N/A | **No manual "create meeting" UI exists anywhere** (checked both the session-detail embedded panel and the dedicated `/meetings` page) — parent meetings are system-generated on a recurring cadence; staff only confirm/manage existing ones. Our new class has none yet since the cadence job hasn't run for it. This is real business behavior, not a bug |
| 8 | GĐ Đào tạo | Xem báo cáo điểm danh | ✅ | This session's own P6 work — facility-wide trend + per-class drilldown. Live data cross-check: `B-2026-0001` shows exactly "1 Có mặt / 100.0%", matching Step 5 |
| 9 | GĐ Kinh doanh | Xem CRM director dashboard | ❌ architecturally blocked | `App.tsx:97` — `if (me.isSuperAdmin) return 'overview'` — super_admin is **hard-routed away** from the Executive Cockpit regardless of role; only accounts whose sole role is `giam_doc_kinh_doanh` reach it. Blocked by the same credential gap as below |
| 10 | Phụ huynh | LMS đăng nhập bằng email OTP | ❌ structurally blocked | Auto-provisioned `ParentAccount.email` is **NULL** — Sale's opportunity form only collects name+phone, no email field anywhere in the chain. Email-OTP login is impossible for any student provisioned this way |
| 11 | Học sinh | LMS xem điểm danh + buổi học | ✅ | Full round-trip confirmed: attendance ("Có mặt") and published evidence (exact summary text + template selections) both render correctly on student LMS |

\* Could not test true RBAC-boundary enforcement for `giaovien@cmc.local`, `quanly@cmc.local`,
`bgd@cmc.local`, `headteacher@cmc.local` — these seeded accounts predate the current `.env`
default password and their real passwords are unknown (repeated login attempts avoided to prevent
lockout). Used the codebase's own established convention (super_admin bypasses all role checks,
per `admin-commission-chain.spec.ts`'s own comment) instead.

## Real findings — grouped by severity

### Blocking / structural (need product decisions, not just bug fixes)

1. **No UI path exists to bind a sales receipt to a specific class.** The entire Sale→Receipt→Provision
   chain has no `classBatchId` field anywhere. `receiptApprove` (`finance.ts`) DOES support it
   (creates Enrollment `if (receipt.classBatchId)`), but nothing in the UI ever sets it. Manual
   "Ghi danh" after the fact is the only path — meaning **every student provisioned via the sales
   flow today lands with zero class enrollment** unless a separate manual step is remembered.
2. **Curriculum-catalog courses and priced-sales courses are disconnected.** No course in the
   current seed/schema has both a `CurriculumUnit` framework AND a `CoursePrice` — meaning a
   receipt can never actually be created against the "khóa học đã chốt" course a class was built
   from. Sale sells against a DIFFERENT, generic-priced course than what the class was created for.
3. **Parent accounts provisioned via the sales flow have no email**, making LMS parent access
   (email-OTP) unreachable. If parent LMS access matters for phone-sourced leads, email needs to
   be collected somewhere in the chain (at opportunity creation, or as a required field before
   receipt-approve).
4. **Makeup sessions (`is_makeup=true`) are invisible to both attendance-taking UI surfaces**
   (class-detail "Điểm danh" tab picker, and the standalone `/attendance` "today" page) despite
   being correctly persisted in the DB. They ARE reachable via "Lịch dạy" → click session, which
   is likely the real teacher's actual daily entry point, so impact may be lower than it first
   appeared — but the gap is real and confirmed, not assumed.

### Should-fix (real but non-blocking)

5. Existing e2e specs `admin-crm-opportunity.spec.ts` and `admin-commission-chain.spec.ts` are
   **stale** — they assert button text "Tạo cơ hội (O1)" but the live UI now shows "Tạo cơ hội"
   (likely from the recent nav-restructuring work). These specs would fail if run today.
6. Class status-change dropdown shows raw enum values (`open`/`running`/`closed`) instead of the
   Vietnamese labels used everywhere else in the same page (`Đang mở`/`Đang học`/`Đã đóng`).
7. Stray modal-overlay backdrop stuck on `/finance` after the approve-confirmation dialog closed —
   blocked all further clicks until a full page reload.
8. `/attendance-report` page's browser title is stuck at "CMC ERP | Cổng nhân sự" instead of
   reflecting the actual page.

### Minor / cosmetic

9. Two recurring console warnings on every page load: `Unsupported style property... &[data-active]`
   — a CSS-in-JS property-naming mismatch (harmless but noisy).

## What worked cleanly, confirmed end-to-end with real data

- 1-click class creation + curriculum locking (this session's P2/`260701-2246` plan) — exactly matches spec.
- Attendance marking + facility-wide attendance report (P6, this session) — full round-trip verified live.
- Session-evidence publish workflow (photo requirement, template-based remarks, time-gating) — a
  genuinely well-designed feature once its real requirements were discovered.
- Student LMS: attendance history + published session evidence both render correctly, matching
  exactly what was entered on the admin side.
- Commission-chain money flow (O1→draft receipt→director approve→auto-O5-win) — confirmed still
  works end-to-end via the real UI, independent of the enrollment gap noted above.

## Unresolved questions for the next planning round

1. Should the sales flow (opportunity → receipt) gain a class-binding field, or should manual
   "Ghi danh" remain the intended post-provisioning step? If the latter, should there be a
   reminder/checklist so staff don't forget it?
2. Should curriculum-linked courses (e.g. `UCREA-L1`) get real `CoursePrice` rows, or is the
   generic-fixture-course-for-billing / curriculum-course-for-scheduling split intentional?
3. Is parent email required at some other point in the real operational flow (not exercised in
   this test), or is phone-only genuinely how CMC sells today — in which case parent LMS access
   for these leads needs a different login mechanism, or email needs collecting later?
4. Real passwords for the seeded non-super_admin staff accounts (`giaovien@cmc.local`, etc.) are
   unknown — worth a documented reset process for future test sessions so RBAC-boundary testing
   isn't permanently blocked.
5. Makeup-session attendance-UI visibility gap: worth a dedicated fix, or is "Lịch dạy" considered
   the sole correct entry point (making the other two surfaces' gap moot in practice)?
