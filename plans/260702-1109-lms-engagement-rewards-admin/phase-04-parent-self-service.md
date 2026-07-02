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

- New model `GuardianLinkRequest { id, requestedByAccountId(uuid), studentPhone?, studentCode?, matchedStudentId?(uuid,resolved at review), facilityId?(from matched student), status(pending|approved|rejected), reviewedById?, reviewedAt?, reason?, createdAt }`. RLS: parent reads/creates only own rows (scoped by `requestedByAccountId = accountId`); staff reads facility-scoped queue. Add RLS policy in migration (mirror existing LMS-owned tables).
- Parent endpoints (`parentProcedure`, self-scoped to `ctx.lms.accountId` — NO permission registry):
  - `guardian.profileUpdate` — `{ displayName?, email?, phone?, emailNotifications? }`, updates only own `ParentAccount` (id = accountId); email normalized lower/trim; unique-conflict → friendly BAD_REQUEST.
  - `guardian.requestLink` — `{ studentPhone? , studentCode? }` (refine: at least one) → create `pending` GuardianLinkRequest; never touches Guardian. `linkRequestListMine` — own requests + status.
- Staff endpoints (`requirePermission('guardian', ...)`, add `linkRequestList`/`linkRequestReview` → directors):
  - `linkRequestList` — pending queue (facility-scoped) with matched-student candidate lookup (by phone/code).
  - `linkRequestReview` — `{ id, decision, relation?, reason? }`; approve → resolve student, create `Guardian` (reuse upsert logic from `link` `:77`), set request `approved`; reject → `rejected`+reason. Audited both paths.

## Data flow

parent edits profile → `profileUpdate` scoped to accountId → own row only. parent submits phone/code → `requestLink` → pending row (no Guardian). staff opens queue → `linkRequestList` → approve → Guardian created + request closed → parent's owned-students set grows on next session resolve. reject → closed, no link.

## Files

- MODIFY `packages/db/prisma/schema.prisma` — add `GuardianLinkRequest` model + `GuardianLinkRequestStatus` enum + RLS policy in migration; `pnpm --filter @cmc/db prisma migrate dev`.
- MODIFY `packages/auth/src/permissions.ts:155` — add `linkRequestList`, `linkRequestReview` → `['giam_doc_kinh_doanh','giam_doc_dao_tao']`.
- MODIFY `apps/api/src/routers/guardian.ts` — 3 parent procedures + 2 staff procedures.
- MODIFY `apps/admin/src/guardians-panel.tsx` — link-request review queue (approve/reject with relation picker).
- MODIFY `apps/lms/src/parent-view.tsx` (`ParentTab` + new profile/link tab) & `apps/lms/src/parent-shell.tsx` (`PARENT_NAV`, `ALL_PARENT_TABS`) — profile edit form + request-link form. **Serialize after Plan 2.**

## Tests / validation

- Integration (RLS mandatory): parent A `profileUpdate` cannot touch parent B's row (RLS/id mismatch). `requestLink` creates pending only — assert zero Guardian rows created by parent path (anti-takeover). Staff `linkRequestReview` approve → exactly one Guardian; reject → none. Parent `linkRequestListMine` returns only own requests.
- Integration: `profileUpdate` email collision → BAD_REQUEST, not 500.
- Manual: parent edits profile; submits link by phone + by student-code; staff sees queue, approves, parent gains child.

## Risks & rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Parent self-links directly (account takeover) | L×**H** | No parent-facing Guardian write; only request rows; dedicated anti-takeover integration test asserts 0 Guardian from parent path |
| Missing RLS policy on new table → cross-parent read | M×**H** | Add RLS policy in same migration; RLS integration test both directions before merge |
| phone/code matches multiple students | M×M | `linkRequestList` returns candidates; staff picks explicit student at review; never auto-resolve ambiguous |
| email unique conflict throws raw 500 | M×L | Catch Prisma P2002 → friendly BAD_REQUEST |
| Plan 2 reshapes parent-view tabs | M×M | Serialize after Plan 2; re-grep `ParentTab`/`PARENT_NAV` at impl |

- Rollback: revert router/permissions/UI edits; drop `GuardianLinkRequest` table via down-migration (no Guardian rows depend on it — requests are advisory). Approved links already created remain valid (intended).
