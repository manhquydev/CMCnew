---
title: "Sales-flow enrollment binding + parent email collection"
description: "2 real gaps found by live timeline QA (test-260703-2216 report), scoped and confirmed by user. Sub-part C (makeup-session attendance visibility) retracted after re-verification found no bug."
status: implemented
priority: P2
branch: feat/phase-d-facility-picker-and-stitch-wireframes
lane: normal
tags: [crm, finance, enrollment, lms]
created: "2026-07-03"
sourceReports:
  - plans/reports/test-260703-2216-live-ui-timeline-qa-cmc-operational-flow-report.md
---

## Overview

2 independent, real gaps found via agent-driven live UI timeline QA against the local dev stack
(full findings: `plans/reports/test-260703-2216-live-ui-timeline-qa-cmc-operational-flow-report.md`).
Every finding was DB-verified, not assumed from UI text. User confirmed scope for each on
2026-07-03 via AskUserQuestion — decisions below are final, not defaults.

**Not in scope this round** (explicitly deferred by user, found to be a non-issue, or retracted):
- Curriculum-course vs priced-course "split" — corrected understanding: NOT a bug. Curriculum
  courses drive LMS homework content per class session; priced courses are the sales SKU. Separate
  by design.
- **Makeup-session attendance visibility (originally sub-part C) — RETRACTED.** Re-verified before
  implementation (per harness discipline: never implement an unverified finding) and found NO bug —
  the original report was a false positive from `.innerText()` not capturing Mantine `Select`
  placeholder text, plus stale in-page state on one surface. Backend (`schedule.mySessions`)
  correctly returns `isMakeup: true` sessions; both UI surfaces correctly list them on proper
  inspection. No code change needed.
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

## Scout findings (2026-07-03, before implementation)

Backend for BOTH sub-parts is already 100% ready — the entire gap is frontend-only:

- `receiptCreate`'s zod input (`apps/api/src/routers/finance.ts:477-501`) already has optional
  `classBatchId: z.string().uuid()` AND `parentEmail: z.string().email()` fields, both fully wired
  through to `receiptApprove`'s enrollment (`:617`) and `ParentAccount.create` (`:719-727`) logic.
  Doc comment even says `parentEmail` is "captured at intake; enables OTP login... at approve" —
  meaning the schema was already designed for exactly this. No `receiptCreate` input schema changes
  needed for part A.
- `receiptApprove`'s input is only `{ id: z.string().uuid() }` — needs an added optional
  `parentEmail` field so the director's approve-time UI can supply it (matches user's decision:
  collect at approve, not at opportunity creation).
- Receipt-create dialog lives in `apps/admin/src/opportunity-detail.tsx` (`createOpportunityReceipt`
  fn ~L374, modal ~L710-756). `classBatches` list: `trpc.classBatch.list.query()` (protectedProcedure,
  RLS facility-scoped, includes `course` relation) — same load pattern as the existing `courses` list.
- Approve action lives in `apps/admin/src/finance-panel.tsx` (`approve` fn ~L696, button ~L914-917).
  `Receipt` type already includes `studentId`/`parentEmail`/`parentPhone` (no `select`, `receiptList`
  returns full rows) — enough to decide client-side whether to prompt for email (only relevant when
  `!r.studentId && !r.parentEmail`, i.e. new-student path with no email yet).

## Acceptance Criteria

- [x] Receipt-create dialog ("Tạo phiếu thu từ cơ hội") has a working class-selection field; selecting
      one + approving the receipt produces an `Enrollment` row automatically (DB-verified: `status=active`,
      correctly bound), no manual "Ghi danh" needed for the normal sales path.
- [x] Receipt-approve action (director's "Duyệt" button) collects parent email when relevant
      (new-student path, no email yet); approving with an email produces a `ParentAccount` with that
      email set (DB-verified). Stays optional/skippable via a separate "Bỏ qua, duyệt luôn" button.
- [x] `pnpm -w typecheck` clean (api + admin); ESLint clean on all 3 touched files.
- [x] Mandatory `code-reviewer` subagent review before commit — found 1 real should-fix (see below),
      fixed and re-verified before commit.
- [x] `gitnexus_detect_changes` confirms scope matches (finance.ts, finance-panel.tsx,
      opportunity-detail.tsx — no unrelated files, medium risk expected for a real approve-flow change).
- [ ] Full regression re-run of the source QA report's other timeline steps (commission chain,
      curriculum/session-evidence publish, student LMS) — not re-run this session; the changes here
      don't touch those code paths, but a full re-run is deferred, not silently skipped.

## Implementation Summary (2026-07-03)

Both fixes were smaller than scoped — backend (`receiptCreate`/`receiptApprove`) already had
`classBatchId`/`parentEmail` fields fully wired; only the frontend was missing.

**Real finding during implementation**: `receiptApprove` had a pre-existing guard rejecting
`classBatch.courseId !== receipt.courseId` before creating an `Enrollment`. Given the confirmed
curriculum/priced-course catalog split, this guard could never pass for any correctly-created
class — a genuine architecture fork, not a code bug. Presented to user via `AskUserQuestion`;
decision: remove the guard entirely (curriculum and priced courses are legitimately different
catalogs, so a courseId match was never the right check).

**Real finding from mandatory code-review**: removing that guard, combined with the new
facility-unfiltered `classBatch.list` picker, opened a distinct and previously-harder-to-reach gap
— a multi-facility staff member could enroll a student billed at facility A into a batch at
facility B via an ordinary dropdown. Fixed with a narrower, non-controversial facility-match guard
(`classBatch.facilityId === receipt.facilityId`) plus a client-side facility filter on the picker.
This is the exact same failure class the original comment warned about, just a different axis
(facility, not course) — kept, not removed.

Both fixes live-verified end-to-end via real browser automation + direct DB queries, not just
typechecked: new opportunity → receipt bound to a real class → approved with email → `Enrollment`
row confirmed `active` and correctly bound, `ParentAccount.email` confirmed set.

## Dependencies

- Independent of the P1-P7 UI rebuild (already shipped, PR #27) and the dev/prod CI/CD split
  (still soaking) — this plan touches business-logic/data flow, not the UI design system or deploy
  pipeline.
- Sub-parts A and B are independently implementable/testable, but both touch `finance.ts`'s
  receipt-approve flow and the same two frontend files — land as one coordinated change.

## Next Steps

Scouted (above) — proceeding directly to implementation given both changes are small, additive,
frontend-plus-one-field-backend changes with a pre-existing, well-documented backend contract to
build against. Red-team via mandatory `code-reviewer` subagent review before commit (per harness),
not a separate pre-implementation pass, given the low structural risk.
