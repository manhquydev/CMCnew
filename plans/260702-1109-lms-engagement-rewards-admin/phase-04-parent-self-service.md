# Phase 04 — Parent self-service (profile + staff-approved child link)

## Context

- Parent identity: `ParentAccount` (`schema.prisma:550`) — `email?/phone?` unique, `displayName`, `emailNotifications`, `isActive`. Guardian link = `Guardian(parentAccountId, studentId, relation)` (`:583`), facility inherited from student.
- Linking today is STAFF-ONLY: `guardian.link`/`parentCreate`/`unlink` all `['giam_doc_kinh_doanh','giam_doc_dao_tao']` (`permissions.ts:155`, router `apps/api/src/routers/guardian.ts:66`). No parent-facing endpoint exists (grep: 0 profileUpdate/linkRequest).
- LMS parent session: `parentProcedure` narrows `ctx.lms.kind==='parent'` (`trpc.ts:86`); `ctx.lms.accountId` = ParentAccount id (`packages/auth/src/lms.ts:7,46`). `lmsRlsContextOf` scopes RLS to owned students.
- Parent UI: `ParentTab` union (`apps/lms/src/parent-view.tsx:29`), `PARENT_NAV` (`apps/lms/src/parent-shell.tsx:22`), `ALL_PARENT_TABS` guard (`parent-shell.tsx:41`).
- **Depends on Plan 2** (`260702-1007`): P2 owns `parent-view.tsx`/`parent-shell.tsx` — serialize this phase after Plan 2 merges (file overlap).

## Anti-takeover design (core constraint)

Parent CANNOT create a `Guardian` row directly. Self-link is a **request** that staff approves. This blocks account-takeover: knowing a phone/student-code only queues a request, never grants access.

## Requirements

- New model `GuardianLinkRequest { id, requestedByAccountId(uuid), studentPhone?, studentCode?, matchedStudentId?(uuid), facilityId?, status(pending|approved|rejected), reviewedById?, reviewedAt?, reason?, createdAt }`.
- **facilityId resolved at REQUEST time, not review time** (fixes M1 — a "facility-scoped" list cannot scope a row whose `facilityId` is null). In `requestLink`, best-effort resolve candidate student under SYSTEM_CTX: exact `studentCode` preferred, else `studentPhone` → guardian/student phone match. If exactly one student matches, set `matchedStudentId` + `facilityId` immediately; if zero or ambiguous (>1), leave both null.
- RLS policy (`GuardianLinkRequest`): parent reads/creates only own rows (`requestedByAccountId = accountId`); staff `SELECT` scoped by `facility_id ∈ session facilities` for resolved rows. **Unresolved rows (`facilityId` null)** are visible to ALL directors (a director-global pending bucket) — this leaks only the parent's own self-submitted phone/code string, NOT a matched student's cross-facility PII (no student is resolved), so it is not the cross-parent-read hard gate. **RLS-pattern choice (vs `[[project_identity-tables-global-rls]]`):** `ParentAccount`/`StudentAccount` are flat global no-facility-scope identity tables; this table deliberately does NOT inherit that gap — because the matched student's facility IS resolvable at request time, we scope on it. This plan improves on the identity-table pattern locally; it does not attempt to retrofit RLS onto `ParentAccount`/`StudentAccount` (out of scope).
- Parent endpoints (`parentProcedure`, self-scoped to `ctx.lms.accountId` — NO permission registry):
  - `guardian.profileUpdate` — `{ displayName?, email?, phone?, emailNotifications? }`, updates only own `ParentAccount` (id = accountId); email normalized lower/trim; unique-conflict → friendly BAD_REQUEST.
  - `guardian.requestLink` — `{ studentPhone? , studentCode? }` (refine: at least one) → best-effort resolve facilityId/matchedStudentId (above) → create `pending` GuardianLinkRequest; never touches Guardian. **Rate-limited** (fixes M2): `throttle('linkreq:acct:' + ctx.lms.accountId, LIMIT)` and `throttle('linkreq:ip:' + ctx.ip, LIMIT)`, mirroring the OTP pattern (`apps/api/src/routers/lms-auth.ts:56-57`, primitive `apps/api/src/rate-limit.ts:93`) — bounds staff-queue spam from an authenticated parent (no distinct-pair uniqueness on the model; low-cost insert). Always returns generic "request submitted" (no match/no-match oracle).
  - `linkRequestListMine` — own requests + status.
- Staff endpoints (`requirePermission('guardian', ...)`, add `linkRequestList`/`linkRequestReview` → directors):
  - `linkRequestList` — pending queue: facility-scoped resolved rows (via `facilityId` RLS) + director-global unresolved rows; with matched-student candidate lookup (by phone/code) for rows still ambiguous.
  - `linkRequestReview` — `{ id, decision, relation?, reason? }`; approve → resolve student, create `Guardian` (reuse upsert logic from `link` `:77`), set request `approved`; reject → `rejected`+reason. Audited both paths.

## Data flow

parent edits profile → `profileUpdate` scoped to accountId → own row only. parent submits phone/code → `requestLink` throttled(acct+ip) → best-effort resolve student → set facilityId/matchedStudentId if unambiguous → pending row (no Guardian). staff opens queue → `linkRequestList` (facility-scoped resolved + global unresolved) → approve → Guardian created + request closed → parent's owned-students set grows on next session resolve. reject → closed, no link.

## Files

- MODIFY `packages/db/prisma/schema.prisma` — add `GuardianLinkRequest` model + `GuardianLinkRequestStatus` enum + RLS policy in migration; `pnpm --filter @cmc/db prisma migrate dev`.
- MODIFY `packages/auth/src/permissions.ts:155` — add `linkRequestList`, `linkRequestReview` → `['giam_doc_kinh_doanh','giam_doc_dao_tao']`.
- MODIFY `apps/api/src/routers/guardian.ts` — 3 parent procedures + 2 staff procedures; import `throttle` from `apps/api/src/rate-limit.ts` for `requestLink`; SYSTEM_CTX read for request-time candidate resolution.
- MODIFY `apps/admin/src/guardians-panel.tsx` — link-request review queue (approve/reject with relation picker).
- MODIFY `apps/lms/src/parent-view.tsx` (`ParentTab` + new profile/link tab) & `apps/lms/src/parent-shell.tsx` (`PARENT_NAV`, `ALL_PARENT_TABS`) — profile edit form + request-link form. **Serialize after Plan 2.**

## Tests / validation

- Integration (RLS mandatory): parent A `profileUpdate` cannot touch parent B's row (RLS/id mismatch). `requestLink` creates pending only — assert zero Guardian rows created by parent path (anti-takeover). Staff `linkRequestReview` approve → exactly one Guardian; reject → none. Parent `linkRequestListMine` returns only own requests.
- Integration: `profileUpdate` email collision → BAD_REQUEST, not 500.
- Integration (M1): `requestLink` with a unique `studentCode` → row has `facilityId` set at creation; director of that facility sees it via facility RLS; ambiguous phone (2 matches) → `facilityId` null, appears in the director-global unresolved bucket only.
- Integration (M2): `requestLink` called past LIMIT (same accountId or IP) → TOO_MANY_REQUESTS; under limit → pending row.
- Manual: parent edits profile; submits link by phone + by student-code; staff sees queue, approves, parent gains child.

## Risks & rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Parent self-links directly (account takeover) | L×**H** | No parent-facing Guardian write; only request rows; dedicated anti-takeover integration test asserts 0 Guardian from parent path |
| Missing RLS policy on new table → cross-parent read | M×**H** | facilityId resolved at request time → facility-scoped RLS on resolved rows; unresolved rows leak only parent's own submitted string (no matched-student PII); RLS integration test both directions before merge |
| Staff queue spam from authenticated parent | M×M | `throttle()` on `requestLink` per accountId + per IP (mirror OTP pattern); generic response |
| phone/code matches multiple students | M×M | Ambiguous → facilityId null, director-global unresolved bucket; `linkRequestList` returns candidates; staff picks explicit student at review; never auto-resolve ambiguous |
| email unique conflict throws raw 500 | M×L | Catch Prisma P2002 → friendly BAD_REQUEST |
| Plan 2 reshapes parent-view tabs | M×M | Serialize after Plan 2; re-grep `ParentTab`/`PARENT_NAV` at impl |

- Rollback: revert router/permissions/UI edits; drop `GuardianLinkRequest` table via down-migration (no Guardian rows depend on it — requests are advisory). Approved links already created remain valid (intended).
