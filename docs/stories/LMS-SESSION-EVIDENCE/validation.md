# LMS Session Evidence Validation

## Proof Strategy

For the completed vertical slice, prove class setup and schedule workflow do not regress existing teaching/LMS flows.

For the full LMS evidence phase, prove the publish gate, ownership isolation, and existing `/grading` non-regression.

## Vertical Slice Proof

- Class creation can create the first weekly schedule slot atomically.
- Invalid initial slot time range is rejected before creating a class.
- Admin schedule detail renders Session 360 workflow states without replacing the existing attendance component.
- Existing API integration suite remains green.

## Full Evidence Proof Strategy

Prove the publish gate, ownership isolation, and existing `/grading` non-regression.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | Image ref parser/validator if extracted. |
| Integration | Staff can save/publish; parent sees own child's published session; parent cannot see draft; parent cannot see classmate comment; cross-facility blocked. |
| E2E | Admin creates/publishes session evidence; LMS displays it for PH. |
| Platform | Image route returns private cache and rejects unauthorized callers. |
| Performance | Class roster comment load uses one query, not per-student calls. |
| Logs/Audit | Publish writes audit event. |

## Fixtures

- One facility.
- One class with two active enrollments.
- Two parent accounts, each linked to one student.
- One class session.

## Commands

```text
pnpm --filter @cmc/api typecheck
pnpm --filter @cmc/admin typecheck
pnpm --filter @cmc/api test:integration -- class-create-initial-slot
pnpm --filter @cmc/admin lint
pnpm --filter @cmc/admin build
pnpm --filter @cmc/api lint
```

## Acceptance Evidence

Full evidence implementation on 2026-06-30:

- Added `SessionEvidence`, `SessionEvidencePhoto`, `SessionStudentComment`, and `SessionEvidenceStatus` schema/migration with staff/LMS RLS.
- Added `sessionEvidence` tRPC router: `commentTemplate`, `listByClass`, `detailForStaff`, `upsertDraft`, `publish`, `listForPrincipal`, `detailForPrincipal`.
- Added staff-only `POST /upload/session-photo` and authorized `GET /files/session-photo/:ref`.
- Admin Session 360 now uses real evidence editor: upload photos, structured template comments, save draft, publish LMS.
- LMS student and parent shells now include `Buổi học`; parent view filters by selected child.
- `pnpm --filter @cmc/db generate` passed.
- `pnpm --filter @cmc/db migrate` passed after recovering a pre-existing failed local `20260630140000_work_shift_rls` attempt.
- `pnpm --filter @cmc/api typecheck` passed.
- `pnpm --filter @cmc/admin typecheck` passed.
- `pnpm --filter @cmc/lms typecheck` passed.
- `pnpm --filter @cmc/db typecheck` passed.
- `pnpm --filter @cmc/ui typecheck` passed.
- `pnpm --filter @cmc/api exec vitest run test/session-photo-store.test.ts` passed: 4 tests.
- `pnpm --filter @cmc/api exec vitest run --config vitest.integration.config.ts test/session-evidence-publish-to-lms.int.test.ts` passed: 2 tests.
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` passed: 25 tests.
- Integration proof covers staff publish, draft hidden from LMS, own-child comments only, cross-student detail blocked, and cross-facility staff write blocked.

Browser E2E proof added on 2026-06-30:

- Added `apps/e2e/tests/session-evidence-publish.spec.ts`.
- Test seeds isolated course/class/session/student/parent fixture.
- Admin browser publishes real uploaded image + structured comment through Session 360 UI.
- Student browser logs in with generated LMS account and sees `Buổi học` summary/comment.
- Parent browser uses an authenticated parent LMS session and sees the same `Buổi học` summary/comment for the child.
- `pnpm --filter @cmc/e2e exec playwright test tests/session-evidence-publish.spec.ts` passed: 1 test.
- Follow-up typechecks passed: `@cmc/admin`, `@cmc/lms`, `@cmc/ui`.

Partial vertical slice implemented on 2026-06-30:

- `pnpm --filter @cmc/api typecheck` passed.
- `pnpm --filter @cmc/admin typecheck` passed.
- `pnpm --filter @cmc/api test:integration -- class-create-initial-slot` passed after `pnpm db:up`.
- `pnpm --filter @cmc/admin lint` passed.
- `pnpm --filter @cmc/admin build` passed with existing Vite large chunk warning.
- `pnpm --filter @cmc/api lint` passed with existing warning in `apps/api/src/lib/emit-staff-notif.ts`.

Verification rerun on 2026-06-30:

- Harness story verify passed.
- API integration suite passed: 66 files, 335 tests.
- `class-create-initial-slot.int.test.ts` passed.
- GitNexus detect changes risk: MEDIUM, no HIGH/CRITICAL.

Review fix on 2026-06-30 (facility-scoping guard):

- Added `assertSlotRefsInFacility` backend guard to `classBatch.create.initialSlot` + `schedule.addSlot` (closes the UI-only facility-scoping gap; schedule_slot has no DB FK yet).
- `pnpm --filter @cmc/api typecheck` passed.
- `pnpm --filter @cmc/api test:integration` passed: 67 files, 340 tests (was 66/335; +1 file `schedule-add-slot.int.test.ts`, +5 tests). 0 regressions.
- New tests: cross-facility room rejected, foreign teacher rejected, backward-compat (create without initialSlot), addSlot happy path, addSlot cross-facility room rejected.
- code-reviewer subagent: APPROVED (transaction-safe, contract preserved, DRY, all acceptance criteria met).
- DB FK on schedule_slot deferred (schema.prisma mid-flight with uncommitted shift-registration feature).


Upload seam progress on 2026-06-30:

- Added `photo-store.ts` for local content-addressed session photos with JPEG/PNG/WebP magic-byte validation, 8MB cap, sha256 refs, and ref path traversal guard.
- Added staff-only `POST /upload/session-photo` and shared `uploadSessionPhoto` client helper.
- `pnpm --filter @cmc/api exec vitest run test/session-photo-store.test.ts` passed: 4 tests.
- `pnpm --filter @cmc/api typecheck`, `pnpm --filter @cmc/admin typecheck`, and `pnpm --filter @cmc/ui typecheck` passed.
- `GET /files/session-photo/:ref` completed after published evidence ownership could authorize before file existence.
