# Attendance/Evidence 4-bug-fix implementation report

Plan: 260709-1514-teacher-lite-bugfixes-and-audit
Branch: develop. TDD for backend logic (int tests updated/added before final server code review pass).

## Status: DONE

## Files changed (owned)
- `apps/api/src/routers/session-evidence.ts` (+87/-? — A1 select-allowlist, B1 drop-not-reject, C1 preserve-publish-on-edit)
- `apps/api/src/routers/attendance.ts` (+28 — Q3 window bypass for super_admin/director, F8 note-clear-on-change)
- `apps/admin/src/teacher-schedule-session-detail.tsx` (+27 — Q3 UI mirror, B1 client-side comment pruning on attendance change)
- `apps/api/test/session-evidence-publish-to-lms.int.test.ts` (+36 — A1 no-internalNote assertions, new C1 test)
- `apps/api/test/session-comment-present-gate.int.test.ts` (rewritten b/c cases — drop not reject, new mixed-save assertion)
- `apps/api/test/attendance-window-gate.int.test.ts` (+35 — 3 new Q3 tests: director bypass, super_admin bypass, giao_vien still gated)
- `apps/api/src/lib/attendance-window.ts` — NOT touched (bypass implemented at call sites in attendance.ts, not inside the shared window helper; kept the helper's single responsibility — "what is the window" — separate from "who is exempt from it")

## Bugs fixed

### A1 (HIGH privacy) — internalNote leak to LMS
`listForPrincipal`/`detailForPrincipal` used top-level Prisma `include` → returned every
SessionEvidence scalar including `internalNote`. Replaced with an explicit `PRINCIPAL_EVIDENCE_SELECT`
allowlist (id, summary, status, publishedAt, photos{id,photoRef,sortOrder}, classSession{...}) —
`internalNote`/`createdById`/`publishedById`/`facilityId`/`archivedAt` are never selected. Comments
sub-select also explicit (participation/strength/needsImprovement/teacherNote/studentId/student —
no `internalNote` equivalent exists on comments, N/A there). Test asserts
`expect(visible).not.toHaveProperty('internalNote')` on both endpoints after seeding a draft WITH
an internalNote and publishing it.

### B1 (HIGH regression) — orphaned comment bricking every save
Server previously threw `BAD_REQUEST` for the ENTIRE `upsertDraft` if any comment targeted a
non-present/late student. Changed to filter (`validComments = input.comments.filter(c =>
attended.has(c.studentId))`) — invalid comments are silently dropped, not rejected; the rest of
the draft (summary/photos/other comments) always saves. Client mirror: `markSingle` now prunes
`draft.comments[studentId]` immediately when a student is flipped away from present/late, and
schedules a save of the pruned draft — so an orphaned comment never lingers invisibly.
Existing gate test rewritten (b)/(c) to assert drop-not-reject + a new mixed-save test
(present + absent comment in one call → succeeds, only present's comment persisted).

### C1 (HIGH regression) — draft edit silently un-publishes
`upsertDraft`'s `update` branch unconditionally set `status:'draft', publishedAt:null,
publishedById:null`. Removed those three fields from the update payload entirely (Prisma treats
omitted fields as "leave unchanged") — editing an already-published evidence (typo fix, swap a
photo, tweak a comment) no longer downgrades it. Publish/unpublish stays an explicit action via
the separate `publish` mutation (no unpublish mutation exists — out of scope, not requested).
New int test: publish → upsertDraft(edit) → still `status:'published'`, `publishedAt` still set,
still visible via `listForPrincipal` with the edited summary. This also fixes the admin UI's
"Đã đăng" badge lying — since status is never force-reset server-side, `evidencePublished` client
state (set only from the initial load and the explicit `publish` call) is now always accurate;
no separate client sync was needed.

### Q3 (director/super_admin attendance-window bypass, user-approved)
Added `bypassesAttendanceWindow(session)` in `attendance.ts`: `session.isSuperAdmin ||
session.roles` includes `giam_doc_dao_tao` or `giam_doc_kinh_doanh`. Wrapped both
`assertAttendanceWindowOpen` call sites (`mark`, `markAll`) in `if (!bypassesAttendanceWindow(...))`.
`giao_vien` stays fully gated. Audit (`logEvent`) fires unconditionally regardless of bypass — no
change there. Admin UI mirror: `teacher-schedule-session-detail.tsx` computes the same
`bypassesWindow` from `useSession()` and ORs it into `attendanceOpen`, so the "Có mặt tất cả" /
per-row buttons aren't disabled for a director/super_admin outside the window (server remains
enforcing source of truth). 3 new int tests: director marks outside window → succeeds;
super_admin marks outside window → succeeds; giao_vien outside window → still rejected
(reusing the existing `sessionYesterdayId` fixture, window already closed by test (c)).

**Caveat found during implementation (not fixed — outside file ownership):** `attendance.mark`/
`markAll`'s `requirePermission('attendance','mark'|'markAll')` registry entry in
`packages/auth/src/permissions.ts` only lists `['giao_vien','giam_doc_dao_tao']` —
`giam_doc_kinh_doanh` is NOT currently authorized to call `mark`/`markAll` at all (gets
`FORBIDDEN` at the permission layer before ever reaching the window check). The bypass logic I
added correctly includes `giam_doc_kinh_doanh` in `bypassesAttendanceWindow` per the task's
explicit instruction, so it's ready the moment permission is granted, but as shipped a KD
director still cannot call `mark`/`markAll` at all (pre-existing gap, unrelated to this fix,
`permissions.ts` not in my file ownership). Flagging for a follow-up decision: should
`giam_doc_kinh_doanh` be added to `attendance.mark`/`markAll` permissions?

### F8 (LOW, fixed — trivial) — stale note on status change without override
`mark`'s update branch and `markAll`'s per-enrollment note both passed the raw optional `note`
(→ `undefined` → Prisma "leave unchanged"). Changed both to `note ?? null` so re-marking without
a note explicitly clears any previously stored mismatched note (matches the `create` branch's
existing behavior). No dedicated test added (explicitly marked low-effort-only in the task; the
existing window-gate/comment-gate suites don't assert note contents, and adding a 4th fixture
suite for a LOW cosmetic issue was judged out of proportion — flagging as a documented gap rather
than silently skipping).

## Findings NOT fixed (out of scope per task list)
- F5 (`attendance.listBySession` no teaching-authz scoping) — not in the 4 assigned bugs, not touched.
- F6 (client window uses local browser tz) — not assigned; Q3's UI mirror above touches the same
  function but only adds the bypass OR, doesn't change the tz behavior.
- F7 (`sessionStartUtc` throws plain `Error` not `TRPCError`) — not assigned; would require
  editing `attendance-window.ts`'s error path, deliberately left alone since not requested and
  the file's only owned change (Q3) was scoped to the call sites in `attendance.ts`.

## Test results

Dev DB (`cmcnew-postgres-dev`, port 5433) had no seeded active `app_user`, which made ALL int
tests silently no-op (`dbReachable=false`, swallowed by try/catch) — ran `pnpm db:seed` first to
fix this (pre-existing environment gap, not caused by my changes; flagging in case CI hits the
same on a fresh dev DB).

```
✓ test/session-evidence-publish-to-lms.int.test.ts (5 tests)
  ✓ publishes photos and official comments to only the owning LMS principal (incl. A1 no-internalNote assert)
  ✓ C1: editing an already-published evidence preserves its published status
  ✓ blocks staff outside the session facility before writing evidence
  ✓ rejects draft/save and publish from a teacher who is not assigned to the session
  ✓ rejects publish until summary, at least one photo, and at least one comment are all present
✓ test/attendance-window-gate.int.test.ts (7 tests)
  ✓ (a) allowed inside window — mark and markAll both succeed
  ✓ (b) rejected before open — mark and markAll both reject with the gate message
  ✓ (c) rejected after close — session dated yesterday (ICT)
  ✓ regression: a cancelled session is still rejected regardless of window
  ✓ Q3: a director (giam_doc_dao_tao) bypasses the window gate and can mark outside it
  ✓ Q3: super_admin bypasses the window gate and can mark outside it
  ✓ Q3: giao_vien (non-director) is still rejected outside the window
✓ test/session-comment-present-gate.int.test.ts (3 tests)
  ✓ (a) accepts comments for present and late students
  ✓ (b) drops (not rejects) a comment for an absent student, keeping the rest of the save
  ✓ (c) drops (not rejects) a comment for an unmarked student

Test Files  3 passed (3)
     Tests  15 passed (15)
```

Typecheck:
```
pnpm --filter @cmc/api typecheck   → clean, 0 errors
pnpm --filter @cmc/admin typecheck → clean, 0 errors
```

## Findings judged NOT real bugs / no action taken
None from the assigned 4 — all confirmed real via the audit report and reproduced/fixed with tests.

## Unresolved questions
1. `giam_doc_kinh_doanh` isn't in `attendance.mark`/`markAll`'s `requirePermission` role list in
   `packages/auth/src/permissions.ts` (owned by a different scope) — so the Q3 bypass I added is
   correct but currently inert for that role until permissions.ts also grants it access. Confirm
   whether that's an intentional separate follow-up or should be bundled now.
2. No explicit "unpublish" action exists (C1 preserves published status by never downgrading on
   edit, per the task's chosen fix direction "preserve-published"). If product later wants a
   manual unpublish button, that's a new endpoint, not implied by this fix.
