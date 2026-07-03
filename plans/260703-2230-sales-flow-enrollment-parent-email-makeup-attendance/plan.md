---
title: "Sales-flow enrollment binding + parent email collection + makeup-session attendance visibility"
description: "3 real gaps found by live timeline QA (test-260703-2216 report), scoped and confirmed by user, not yet implemented."
status: pending
priority: P2
branch: TBD
lane: normal
tags: [crm, finance, attendance, enrollment, lms]
created: "2026-07-03"
sourceReports:
  - plans/reports/test-260703-2216-live-ui-timeline-qa-cmc-operational-flow-report.md
---

## Overview

3 independent, real gaps found via agent-driven live UI timeline QA against the local dev stack
(full findings: `plans/reports/test-260703-2216-live-ui-timeline-qa-cmc-operational-flow-report.md`).
Every finding was DB-verified, not assumed from UI text. User confirmed scope for each on
2026-07-03 via AskUserQuestion — decisions below are final, not defaults.

**Not in scope this round** (explicitly deferred by user or found to be a non-issue):
- Curriculum-course vs priced-course "split" — corrected understanding: NOT a bug. Curriculum
  courses drive LMS homework content per class session; priced courses are the sales SKU. Separate
  by design.
- Real passwords for seeded staff accounts (`giaovien@cmc.local` etc.) — deferred, not blocking.
- Stale e2e specs (`admin-crm-opportunity.spec.ts`, `admin-commission-chain.spec.ts` assert wrong
  button text) — not scoped into this plan, flag separately if picked up.
- Minor cosmetic items (unlocalized status dropdown, stuck modal overlay on `/finance`, wrong page
  title on attendance report, CSS-in-JS console warning) — not scoped into this plan.

## Scope

### A. Class-binding in the receipt-create flow

`receiptApprove` (`apps/api/src/routers/finance.ts`) already creates an `Enrollment` when
`receipt.classBatchId` is set — but no UI anywhere sets it. `receiptCreate`'s `classBatchId` input
is optional and the "Tạo phiếu thu từ cơ hội" dialog only has "Khóa học\*"/"Đóng trước"/"Voucher".

**Change**: add a class-selection field to the receipt-create dialog (likely filtered to
`ClassBatch`es matching the selected priced course's program, or facility-scoped — needs a quick
look at `ClassBatch`/`Course` relation to decide the right filter). On submit, `classBatchId` flows
through to `receiptCreate`, so `receiptApprove`'s existing enrollment logic fires automatically —
removes the need for the separate manual "Ghi danh" step for the normal sales path.

### B. Parent email collection at receipt-approve time

Currently: Sale's "Tạo cơ hội" form collects only "Tên liên hệ"/"Số điện thoại" — no email field
anywhere in the O1→O5 chain. `receiptApprove`'s auto-provisioned `ParentAccount.email` ends up NULL,
making LMS parent access (email-OTP, `apps/api/src/routers/lms-auth.ts`) permanently unreachable.

**Change** (user-confirmed): collect parent email at receipt-approve time (Step 3, Giám đốc Kinh
doanh's approval action), NOT at Sale's initial opportunity form. Need to find/add an email field to
the approve action's UI (likely `finance-panel.tsx` or wherever "Duyệt" is triggered from) and wire
it into `receiptApprove`'s `ParentAccount.create` call.

### C. Makeup-session attendance visibility

Makeup sessions (`ClassSession.isMakeup = true`) are correctly persisted (confirmed via direct DB
query) but invisible on 2 of 3 attendance-taking surfaces:
- Class-detail "Điểm danh" tab's "Chọn buổi học" picker — only lists the 4 regular weekly sessions.
- Standalone `/attendance` page ("Buổi học hôm nay") — shows nothing even when a makeup session
  exists for today.

Only "Lịch dạy" → click session → embedded "Điểm danh" panel correctly surfaces makeup sessions.

**Change** (user-confirmed, fix now — real operational impact): find and fix the query/filter in
both surfaces so `isMakeup=true` sessions appear consistently with "Lịch dạy"'s behavior. Needs
locating the actual query source for each surface first — not yet scouted.

## Acceptance Criteria

- [ ] Receipt-create dialog has a working class-selection field; selecting one + approving the
      receipt produces an `Enrollment` row automatically (DB-verified), no manual "Ghi danh" needed.
- [ ] Receipt-approve action (director side) collects parent email; approving with an email produces
      a `ParentAccount` with that email set (DB-verified), enabling email-OTP LMS login.
- [ ] A makeup session for today appears and is markable on BOTH the class-detail "Điểm danh" tab
      picker AND the standalone `/attendance` page — not just "Lịch dạy".
- [ ] No regression to the 3 already-working flows this plan doesn't touch (commission chain O1→O5,
      curriculum/session-evidence publish, student LMS round-trip) — re-verify via a quick repeat of
      the relevant timeline steps from the source QA report after implementation.
- [ ] `pnpm -w typecheck` clean; relevant existing tests still pass.
- [ ] Mandatory `code-reviewer` subagent review before commit (per harness).
- [ ] `gitnexus_detect_changes` confirms scope matches (finance/CRM receipt flow, attendance
      queries, LMS auth provisioning — no unrelated files).

## Dependencies

- Independent of the P1-P7 UI rebuild (already shipped, PR #27) and the dev/prod CI/CD split
  (still soaking) — this plan touches business-logic/data flow, not the UI design system or deploy
  pipeline.
- Sub-parts A, B, C are independently implementable and testable — no ordering dependency between
  them, though A and B both touch the receipt-approve flow in `finance.ts` and may be easier to
  land as one coordinated change to that file rather than two separate passes.

## Next Steps

Not yet scoped into phases or red-teamed — this plan.md captures the confirmed WHAT and WHY from
live QA; a proper `/ck:plan` pass (scout the exact touchpoints in `finance.ts`/`attendance.ts`/
frontend panels, phase breakdown, red-team) is the next step before implementation starts.
