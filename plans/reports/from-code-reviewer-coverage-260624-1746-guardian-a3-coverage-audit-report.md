# Coverage Audit — Guardian A3 Isolation (from-code-reviewer)

**Date:** 2026-06-24  
**Reviewer:** code-reviewer (Sonnet 4.6)  
**Scope:** `apps/api/test/guardian-principal-isolation.int.test.ts`, plan `260624-1746-guardian-link-verify`, tester report, router surface, `apps/lms/src/parent-view.tsx`, `packages/ui/src/`  
**Question:** Does the G1–G6 test matrix cover EVERY parent-reachable data surface for invariant A3, or are there gaps?

---

## 1. Complete Parent-Reachable Surface Map

The following table is built from `parent-view.tsx`, `packages/ui/src/{badge-shelf,leaderboard,notification-center}.tsx`, and the routers the UI calls. A parent principal uses `lmsProcedure` (via `lmsRlsContextOf`) or the SSE endpoint.

| # | tRPC procedure / endpoint | Router | Source in parent UI | G3 isolation test exists? |
|---|---|---|---|---|
| P1 | `assessment.gradebook` | `assessment.ts` | `ChildDashboard` | YES — `[G3-gradebook]` |
| P2 | `submission.forStudent` | `submission.ts` | `ChildDashboard` | YES — `[G3-submission]` |
| P3 | `rewards.balance` | `rewards.ts` | `ChildDashboard` | YES — `[G3-balance]` |
| P4 | `levelProgress.forStudent` | `level-progress.ts` | `LevelHistoryCard` | YES — `[G3-levelProgress]` |
| P5 | `parentMeeting.myMeetings` | `parent-meeting.ts` | `UpcomingMeetingsCard` | YES — `[G3-myMeetings]` |
| P6 | `badge.myBadges` | `badge.ts` | `BadgeShelf` (via `@cmc/ui`) | **NO — MISSING** |
| P7 | `leaderboard.forStudent` | `leaderboard.ts` | `Leaderboard` (via `@cmc/ui`) | **NO — MISSING** |
| P8 | `notification.list` | `notification.ts` | `NotificationCenter` (via `@cmc/ui`) | **NO — MISSING** |
| P9 | `notification.unreadCount` | `notification.ts` | `NotificationCenter` (via `@cmc/ui`) | **NO — MISSING** |
| P10 | `notification.markAllRead` (mutation) | `notification.ts` | `NotificationCenter` (via `@cmc/ui`) | **NO — MISSING** |
| P11 | `/sse/notifications` (HTTP GET, EventSource) | `apps/api/src/index.ts:164` | `useNotificationStream` (via `@cmc/ui`) | **NO — MISSING** |
| P12 | `exercise.listForPrincipal` | `exercise.ts` | **NOT in parent-view.tsx** (student-only) | n/a (not a parent surface) |

Surfaces P6–P11 are **not covered by any G3 assertion**.

---

## 2. Analysis of Each Gap

### P6 — `badge.myBadges` (MAJOR)

**Router gate:** `lmsProcedure` → `withRls(lmsRlsContextOf(ctx.lms), ...)` → `studentBadge.findMany({ where: { studentId: input.studentId } })`.  
**Mechanism:** same RLS `student_badge_isolation` policy (student_id ∈ app.student_ids). The design is correct.  
**Gap:** No test seeds a badge for S3 (the foreign child) then asserts that P calling `badge.myBadges({ studentId: s3Id })` returns an empty array. The existing G3 suite seeds data for every other table but skips `StudentBadge`.  
**Risk:** If the `student_badge_isolation` RLS policy is accidentally dropped or incorrectly written (e.g., uses facility instead of student_id), this goes undetected. The other G3 cases would still pass because they test different tables.

### P7 — `leaderboard.forStudent` (MAJOR)

**Router gate:** Uses a two-step design — ownership check under `lmsRlsContextOf` (enrollment lookup), then computes the board under `SYSTEM_RLS` (super-admin, no filters). The ownership check at step 1 gates access: if S3 is not owned by P, `myClasses` is empty and the procedure returns `[]`.  
**Gap:** The test never verifies this. The leaderboard router is architecturally correct (and uses a thoughtful two-step pattern), but the G3 suite has no assertion that `leaderboard.forStudent({ studentId: s3Id })` returns `[]` when P calls it. With no enrollment seeded for S3 the call would trivially return `[]`, but that is a vacuous test — the meaningful "teeth" case would require enrolling S3 in a class and seeding star data, then asserting P still cannot see S3's board entries.  
**Additional concern:** The SYSTEM_RLS escalation is a privilege escalation for computation purposes. The code is correct (ownership is verified first), but the pattern has no regression test. A refactor that moves the SYSTEM_RLS block before the ownership check would silently break isolation.

### P8–P10 — `notification.list`, `notification.unreadCount`, `notification.markAllRead` (MAJOR)

**Router gate:** `lmsProcedure` → `withRls(lmsRlsContextOf(ctx.lms), ...)` with explicit `where: { recipientId: { in: ctx.lms.studentIds } }`. This is a dual-layer filter: both RLS policy and an explicit IN-clause.  
**Gap:** No G3 test seeds a `Notification` row for S3 and then asserts that P's `notification.list` returns nothing, or that `notification.unreadCount` returns 0. The explicit `ctx.lms.studentIds` filter in the router makes a server-side bypass less likely, but the RLS policy itself is untested for this table.

### P11 — `/sse/notifications` SSE endpoint (MINOR)

**Gate:** `index.ts:168-172` — resolves LMS session, builds `ownedIds = new Set(lms.studentIds)`, filters each event by `!ownedIds.has(evt.studentId)`. This is an in-process filter, not RLS. It is correct, but it is a bespoke authorization check outside tRPC — not covered by the RLS-level G3 suite.  
**Gap:** There is no integration test that emits a notification for S3 and asserts that P's SSE stream does NOT receive it. Integration-testing SSE in Vitest is harder (requires an HTTP server and EventSource), but the gap is real. In practice the `ownedIds` set is derived from the same `lms.studentIds` that powers all other checks, so a regression is unlikely — but the check is untested by evidence.  
**Classification downgraded to MINOR** because the filter is a simple Set membership check, not RLS, and the session resolution path is already exercised by G1.

---

## 3. Invariants from the Spec That the Test Omits

The plan's A3 statement (plan.md line 43) says:

> A3 kín: phạm vi PH suy từ `Guardian` ở DB, không từ input client. Xuyên facility chặn. **PH↔PH chặn.**

The plan also mentions (from spec phase-02-assessment-lms.md §2):

> `student-self` chỉ thấy chính mình (student principal).

### 3a — PH↔PH (student-self) invariant not tested (MINOR)

The test covers PH-P reading PH-Q's student (S3) — that is G3. But the spec's `student` principal kind is not tested at all. If a `StudentAccount` login exists, it should only see its own data. The current test file has no `studentProcedure` / student-session cases, and the plan's G1–G6 matrix did not include them. This is out of scope for *this* plan (which is parent-only) but is a known open gap for Phase 5 closure.

### 3b — `guardian.parentList` leaks PH-Q data to non-admin roles (already tested, G6) — confirmed closed.

---

## 4. Assessment of G3-myMeetings Teeth

The tester report notes: "No enrollment seeded for S3 (or P's students), so result is empty for both; the structural gate is the mechanism under test — verified by the RLS migration."

This is a **weak-teeth** concern. The assertion `expect(result).toHaveLength(0)` passes trivially even if the RLS policy were completely absent, because there is no meeting for S3's enrolled classes to leak. The test proves "no exception is thrown," not "RLS blocks foreign data."

To have real teeth, `[G3-myMeetings]` would need: (a) enroll S3 in a class, (b) create a `ParentMeeting` for that class, (c) assert P's `myMeetings()` excludes it. Without that, this case cannot distinguish between "RLS works" and "there is simply no data."

**Classification: MAJOR** — the case as written gives a false sense of security for the meeting surface.

---

## 5. Summary Table

| Finding | Surface | Severity | Description |
|---|---|---|---|
| F1 | `badge.myBadges` (P6) | **MAJOR** | No G3 case seeds a badge for S3 and asserts P cannot read it |
| F2 | `leaderboard.forStudent` (P7) | **MAJOR** | No G3 case with S3 enrolled + star data; SYSTEM_RLS two-step has no regression test |
| F3 | `notification.list/unreadCount/markAllRead` (P8–P10) | **MAJOR** | No G3 case seeds a notification for S3 and asserts P's inbox is empty |
| F4 | `[G3-myMeetings]` weak teeth | **MAJOR** | Assert passes vacuously with no meeting data for S3; gate is untested by evidence |
| F5 | `/sse/notifications` (P11) | MINOR | SSE filter on ownedIds is untested in integration; requires HTTP-level test |
| F6 | Student-self (`student` principal) isolation | MINOR | Out of scope for this plan but A3 spec covers it; no test exists anywhere |

---

## 6. Conclusion

**NOT SAFE-TO-CLOSE as "done-by-evidence" for full A3.**

The G1–G6 matrix covers the five explicitly listed portal queries (P1–P5) and the link/unlink/role-gate mechanics. However, four parent-reachable surfaces visible from `parent-view.tsx` → `@cmc/ui` components are **absent from G3** entirely (badge, leaderboard, notification read + count + markRead). Additionally, the single weakest existing G3 case (`myMeetings`) lacks seeded data to make the assertion meaningful.

### Minimum additional cases required before claiming SAFE-TO-CLOSE

1. **`[G3-badge]`**: Seed `StudentBadge` for S3 → assert `badge.myBadges({ studentId: s3Id })` returns `[]` when called as P.
2. **`[G3-leaderboard]`**: Enroll S3 in a class, seed star transactions → assert `leaderboard.forStudent({ studentId: s3Id })` returns `[]` when called as P.
3. **`[G3-notification-list]`**: Seed a `Notification` for S3 → assert `notification.list` returns `[]` and `notification.unreadCount` returns `0` when called as P.
4. **`[G3-myMeetings]` teeth fix**: Enroll S3 in a class, create a `ParentMeeting` for that class → assert P's `myMeetings()` does not include it.

Cases 1–4 use the same fixture pattern as the existing G3 block and require only additions to the existing `beforeAll` seed + new `it` assertions — no architectural change.

SSE (F5) and student-self (F6) can be tracked as separate slices outside this plan gate.

---

## Unresolved Questions

- Does the `notification_isolation` RLS policy filter on `recipient_id ∈ app.student_ids`? The router applies an explicit IN-clause but the RLS policy itself was not verified in this review (migration file not read). If the policy is absent, the explicit clause in the router is the only guard — acceptable but worth confirming.
- Is there a `student_badge_isolation` RLS policy, or does badge isolation rely solely on the router's `where: { studentId: input.studentId }` filtered under `lmsRlsContextOf`? Either can be correct, but only one layer means a refactor removing the `where` clause would break isolation silently.
