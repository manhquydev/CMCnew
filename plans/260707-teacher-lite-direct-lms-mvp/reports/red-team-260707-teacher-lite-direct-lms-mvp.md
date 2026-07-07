# Red Team: Teacher Lite Direct LMS MVP

Date: 2026-07-07
Mode: ck:code-review + ck:scenario lens
Status: DONE_WITH_CONCERNS

## Scope

Reviewed plan, story docs, governing decisions, and current code around:

- `packages/auth/src/lms.ts`
- `apps/api/src/routers/lms-auth.ts`
- `apps/api/src/routers/student.ts`
- `apps/api/src/routers/guardian.ts`
- `apps/api/src/routers/enrollment.ts`
- `apps/api/src/routers/class-batch.ts`
- `apps/api/src/routers/exercise.ts`
- `apps/api/src/lib/exercise-open.ts`
- `packages/auth/src/permissions.ts`
- Prisma schema/RLS for parent/student/guardian/enrollment.

## Findings

| ID | Severity | Finding | Required Plan Change |
| --- | --- | --- | --- |
| RT-01 | Critical | Direct setup cannot be client-side composition of existing routers. `student.create` is super-admin break-glass; `classBatch.create` is DT-only; `enrollment.enroll` is KD/sale-only. | Add one server transaction façade `teacherLite.createFamilyStudentAndEnroll`. |
| RT-02 | Critical | Student code has no non-receipt allocator. Current normal path derives `HS-YYYY-NNNN` from receipt code. Direct MVP will collide or require unsafe manual input unless it adds a code strategy. | Add `StudentCodeCounter` or a transaction-safe direct `HS-YYYY-NNNN` allocator before direct provisioning. |
| RT-03 | Critical | Parent phone/email unique conflicts can abort a Postgres transaction if handled after a failed insert. | Use normalized lookup first, deterministic conflict checks, or `ON CONFLICT`/savepoint pattern. No catch-and-continue after failed statement in same tx. |
| RT-04 | Critical | Phone+password family login must never mint parent session. Current decision 0033 enforces ticket then student session only. | Direct provisioning must only set `ParentAccount.passwordHash`; no parent cookie/session from phone path. |
| RT-05 | High | Bypassing finance removes receipt provenance. `Student.createdByReceiptId` and `Enrollment.createdByReceiptId` stay null, affecting rollback/report assumptions. | Add audit marker `teacher_lite_direct`; add optional source field only if reports need queryable filter. |
| RT-06 | High | Both directors need Lite setup authority, but existing module permissions are intentionally split. | Add `teacherLite` permission namespace instead of broadening finance/enrollment/class permissions. |
| RT-07 | High | Existing `guardian.parentCreate` stores raw phone, while LMS login needs normalized bare `84xxx`. | Teacher Lite must normalize parent phone with `normalizeLoginPhone`; reject malformed phone if student login is required. |
| RT-08 | High | Parent email OTP requires lower-cased unique email. Duplicate email on another parent must not hijack account. | Return deterministic `CONFLICT`; only reuse parent when phone/email identify the same account. |
| RT-09 | High | Enrollment uniqueness is `classBatchId + studentId`. Double-submit can throw P2002 if not guarded in same transaction. | Friendly duplicate guard plus P2002 mapping in the façade. |
| RT-10 | High | Teacher class-day writes already have server-side guards in some paths, but Lite UI must not rely on existing warning-only UI. | Reuse guarded API paths or add façade checks: teacher may mutate only assigned `ClassSession.teacherId`. |
| RT-11 | Medium | `teacher.cmcvn.edu.vn` currently served by admin SPA and Jenkins smokes for "CMC Teacher" / `family-intake`. | Deploy plan must update markers/smokes to assert Teacher Lite, not old bridge copy. |
| RT-12 | Medium | Email outbox scrubs `lms_account_ready` body after terminal state; proof must not expect body content after send. | Tests assert queued row/template/data before drain or sent aggregate without plaintext secret. |

## Scenario Matrix

| # | Dimension | Scenario | Severity | Expected Behavior |
| --- | --- | --- | --- | --- |
| 1 | User Types | `giam_doc_kinh_doanh` creates class + student + enrollment | High | Allowed by `teacherLite`, no finance grant needed. |
| 2 | User Types | `giam_doc_dao_tao` creates class + student + enrollment | High | Allowed by `teacherLite`, no receipt approval needed. |
| 3 | Authorization | `giao_vien` calls direct create endpoint | Critical | `FORBIDDEN`. |
| 4 | Authorization | Director from facility A enrolls into facility B class | Critical | RLS/app guard denies; no partial rows. |
| 5 | Input Extremes | Parent phone malformed | High | Reject if student phone login is required; do not create unusable family login. |
| 6 | Input Extremes | Parent email uppercase/space padded | Medium | Normalize lowercase/trim before unique lookup. |
| 7 | Timing | Two directors submit same parent phone at same time | Critical | One parent account, deterministic child/guardian outcome, no aborted tx. |
| 8 | Timing | Double-click direct create with same student/class | High | One enrollment or clean `CONFLICT`, no duplicate student. |
| 9 | Data Integrity | Same email on different phone | High | Conflict, no account hijack or merge. |
| 10 | Data Integrity | Same phone existing parent, new sibling | High | Reuse parent, add child, profile picker shows both. |
| 11 | State Transitions | Cancel class after sessions created | High | Future sessions cancelled; past evidence/attendance retained. |
| 12 | State Transitions | Cancel one session with uploaded homework | High | Session no longer opens homework as normal; audit reason recorded. |
| 13 | Integration | Brevo unavailable | Medium | Outbox queues/reschedules; direct create still commits if enqueue succeeds. |
| 14 | LMS | Student logs in via phone/default password after direct create | Critical | Ticket/profile flow, student cookie only. |
| 15 | LMS | Parent logs in via email OTP after direct create | Critical | Parent session can see own child only. |
| 16 | Business Logic | Direct-created student later gets receipt | Medium | Future finance path must dedupe/reuse; no duplicate student by same phone/family. |

## Validation Verdict

Plan is feasible after changes below:

- Add a transaction façade and do not compose existing routers from UI.
- Add student-code allocator.
- Add `teacherLite` permission namespace.
- Add explicit conflict/normalization policy.
- Update deploy smoke from old teacher bridge to Lite surface.

## Unresolved Questions

- None for MVP.

