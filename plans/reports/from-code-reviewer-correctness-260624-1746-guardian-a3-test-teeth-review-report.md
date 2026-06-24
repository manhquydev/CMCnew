# Code-Reviewer — Correctness & Mutation-Sense Review
## Guardian Principal Isolation (A3) — `guardian-principal-isolation.int.test.ts`

**Date:** 2026-06-24 | **Reviewer:** code-reviewer (Sonnet 4.6)
**Plan:** `plans/260624-1746-guardian-link-verify/plan.md`
**Verdict:** SAFE-TO-CLOSE with one MAJOR caveat documented (test covers RLS, not resolver regression).

---

## 1. Scope

- **Primary file:** `apps/api/test/guardian-principal-isolation.int.test.ts`
- **Supporting resolver:** `packages/auth/src/lms.ts` (parentSession / loginParent)
- **Helpers:** `apps/api/test/helpers.ts`
- **Routers verified:** `guardian.ts`, `assessment.ts`, `rewards.ts`, `level-progress.ts`, `parent-meeting.ts`, `submission.ts`
- **RLS migrations read:** `20260623100000_principal_aware_rls`, `20260623140553_s2_grading_models`, `20260623154632_s3_level_progress`, `20260624025523_phase5_parent_meeting`

---

## 2. Critical Issues

None found.

---

## 3. Major Issues

### M1 — G1/G5 test `resolveParentSession` instead of the real `parentSession` / `loginParent` [MAJOR]

**Evidence.** `parentSession` is an unexported module-internal async function inside `packages/auth/src/lms.ts`. The test defines `resolveParentSession` (lines 43–61) which mirrors the exact same DB query (`tx.parentAccount.findUniqueOrThrow` with `include: { guardians: { include: { student } } }`). The two implementations are structurally identical today.

**Risk.** If someone modifies `parentSession` — adds an `isActive` check (already present in the real one, absent in the test mirror), adds a filter clause on `GuardianRelation`, or changes the `include` shape — the test's `resolveParentSession` will still pass because it reads the DB directly without going through the real code path. The regression is invisible.

**Concrete gap:** The real `parentSession` (lms.ts line 42) filters `if (!acc || !acc.isActive) return null`. The test's mirror uses `findUniqueOrThrow` without any `isActive` check. A parent account with `isActive = false` would return `null` from the real function but return a valid session from `resolveParentSession`. G1 and G5 would not catch that discrepancy.

**Tester's justification:** `parentSession` is not exported and therefore cannot be called directly. This is stated in the tester report.

**Assessment of the justification:** Partially valid for `parentSession` specifically; however `loginParent` IS exported (`export async function loginParent(...)` at lms.ts line 80) and calls `parentSession` internally. The test already seeds `passwordHash` (`hashPassword('Test1234!')`) and stores both `email` and `phone` on the accounts, so `loginParent` could be called end-to-end, with the session extracted from its return value, to fully test the real resolution path for G1/G5.

**Recommended fix:** For G1 and G5 tests that assert session content, additionally call `loginParent(email, 'Test1234!')` and assert on the returned `session.studentIds`. This tests the real public entrypoint. The existing `resolveParentSession` helper can remain for G2/G3/G4 where session content is used as a fixture input rather than the assertion target — but G1/G5 should validate through the real path.

**Impact if left as-is:** Mutation in `parentSession` (filter changes, isActive, relation type gate) will not be caught. The test proves RLS isolation but not resolver correctness for the session-building path.

---

## 4. Minor Issues

### m1 — G3-myMeetings: zero teeth, zero data seeded for meetings [MINOR]

**Evidence.** The G3-myMeetings test (lines 280–290) asserts `result.toHaveLength(0)` for `parentMeeting.myMeetings`. The beforeAll for G3 seeds finalGrade, qualitativeAssessment, starTransaction, and levelProgress rows for S3 — but does NOT seed any `parentMeeting` rows or `enrollment` rows for S3.

**The tester's reasoning (report §Ghi chú):** "if RLS were absent, P would see all meetings." This is true in principle but only if there exist `parentMeeting` rows at all. With zero meeting rows in the DB, the result is [] regardless of RLS.

**The RLS policy** (`parent_meeting_isolation`) gates via `enrollment.class_batch_id = parent_meeting.class_batch_id AND enrollment.student_id = ANY(app_student_ids())`. Without any `parentMeeting` rows, the policy never even evaluates — the query returns empty from an empty table scan, not from a policy block.

**Consequence:** If someone removed or disabled `parent_meeting_isolation` entirely, this test would still pass (the table would still have no rows). The assertion has zero mutation-sense for this specific table.

**Recommended fix:** Seed at minimum one `classBatch`, one `parentMeeting` for S3's (imaginary) class, and one `enrollment` linking S3 to that class. Then assert `result` is empty for P while Q can see it. This requires a `classBatch` fixture which is additional setup cost.

**Acceptable mitigation if full fixture is too heavy:** Document explicitly in the test comment that the myMeetings gate is verified structurally by the migration (cite the policy text and the migration file), and add a note that a dedicated myMeetings-isolation test with enrollment seed is a follow-up slice. As written, the comment at line 283 does say "the policy gate is the mechanism under test — verified by the RLS migration" but the assertion is effectively a vacuous empty-array check.

---

### m2 — G3-submission: no submission rows seeded for S3 [MINOR]

**Evidence.** `G3-submission` asserts `result.toHaveLength(0)` for `submission.forStudent({ studentId: s3Id })`. The G3 beforeAll seeds `finalGrade`, `qualitativeAssessment`, `starTransaction`, and `levelProgress` for S3 — but NOT a `submission` row.

**Consequence:** Same as m1 but for submissions. The test cannot fail if `submission_isolation` is removed because the table has no S3 rows to leak.

**Recommended fix:** Seed a `submission` row for S3 in G3's beforeAll/cleanup cycle. This requires a parent `exercise` and `classBatch` fixture. If the exercise/classBatch setup is too heavy for this slice, document and defer with explicit comment.

---

### m3 — G4: only `levelProgress.forStudent` tested for cross-facility and non-child gate [MINOR]

**Evidence.** G4 tests one query (`levelProgress.forStudent`) for both the cross-facility positive case (S2@fac2) and the non-child block (S4@fac1). G3 covers additional query types (gradebook, balance, etc.) for a different-parent scenario, which partially compensates.

**Risk level:** Low. The RLS policies for `final_grade`, `star_transaction`, and `submission` use `student_id = ANY(app_student_ids())` — the same predicate as `level_progress`. If `levelProgress` is correctly gated, the other tables follow by construction (same policy shape). The gap is that a table-specific policy bug (e.g., a different migration applying facility-only for `final_grade`) would not be caught by G4.

**Recommended:** Document as an accepted gap unless a follow-up slice adds cross-facility checks for gradebook/balance too.

---

### m4 — `uniq()` collision window under concurrent test runs [MINOR]

**Evidence.** `uniq(prefix)` uses `process.pid + Math.floor(performance.now())`. With `performance.now()` having millisecond floor granularity, two fixtures created in the same millisecond within the same process have the same suffix. In the current file this is not a problem (all uniq calls happen in a sequential `withRls` block). Under parallel Vitest worker shards it could collide if multiple workers share the same pid (unlikely but not impossible on container re-use).

**Risk:** Low in practice. Note for awareness.

---

### m5 — G5 `extraGuardId` not cleaned in `afterAll` if `link` succeeds but `unlink` test fails [MINOR]

**Evidence.** G5 creates a guardian row (`extraGuardId`) in the second `it` and destroys it in the third `it`. The global `afterAll` deletes all guardians for `parentAId` (`tx.guardian.deleteMany({ where: { parentAccountId: { in: [parentAId, parentBId] } } })`), which covers this row. So if the third G5 test fails mid-run, the global cleanup will still remove the row. No actual leak.

**Verdict for m5:** Non-issue given the global `afterAll`. No action needed.

---

## 5. Positive Observations (material for risk calibration)

- **G3 teeth for four out of five queries are solid.** `finalGrade`, `qualitativeAssessment`, `starTransaction`, and `levelProgress` all have real data seeded for S3. If any of those four RLS policies is removed, the corresponding test fails. The mutation-sense is genuine.

- **`rewards.balance === 0` assertion is correctly teeth-positive.** The resolver (`rewards.ts` line 56–60) queries `starTransaction.findMany({ where: { studentId } })` and calls `starBalance(txns)`. With S3 seeded at 10 stars and RLS blocking the query, `txns` is an empty array → `starBalance([])` returns 0. If RLS is removed, `txns` contains the 10-star row and `starBalance` returns 10, causing `expect(result).toBe(0)` to fail. The tester's reasoning is correct.

- **FK-safe cleanup order verified.** `afterAll` deletes `guardian → parentAccount → student`. The FK chain is `guardian.parentAccountId → parent_account.id` and `guardian.studentId → student.id`, and `guardian` rows are deleted first. The G3 per-describe `afterAll` deletes `finalGrade`, `qualitativeAssessment`, `starTransaction`, `levelProgress` before the global `afterAll` deletes the student, so no FK violation there either.

- **G6 role-gate is fully exercised** on both giao_vien (FORBIDDEN) and bgd (allowed) for both `parentList` and `link`. The staffCaller override mechanism correctly bypasses super-admin to test specific roles.

- **No business code touched.** The file adds only a test file. `apps/api/src` and `packages/` are untouched.

- **`withRls(SUPER, ...)` GUC validation confirmed.** `withRls` (packages/db/src/index.ts line 39–43) validates studentIds as UUIDs and principalKind defaults to 'staff'. When SUPER (`{ facilityIds: [], isSuperAdmin: true }`) is used for seed ops, `principalKind` defaults to 'staff' and `studentIds` defaults to `[]`. This correctly bypasses all principal-aware policies for fixture setup.

---

## 6. RLS Coverage Summary (teeth assessment)

| G3 case | Data seeded for S3 | RLS policy gate | Teeth if policy removed |
|---|---|---|---|
| G3-gradebook (finalGrades) | YES — 1 finalGrade row | `final_grade_isolation` student_id=ANY(student_ids) | FAIL (row leaks) |
| G3-gradebook (qualitative) | YES — 1 qualitativeAssessment row | `qualitative_assessment_isolation` | FAIL |
| G3-submission | NO — no submission seeded | `submission_isolation` | PASS (vacuous) |
| G3-balance | YES — 10 stars seeded | `star_transaction_isolation` | FAIL (returns 10 not 0) |
| G3-levelProgress | YES — 1 levelProgress row | `level_progress_isolation` | FAIL |
| G3-myMeetings | NO — no meeting/enrollment seeded | `parent_meeting_isolation` | PASS (vacuous) |

---

## 7. Resolver Gap Summary (M1 detail)

| Session method | Tested via | Covers real code path? |
|---|---|---|
| `parentSession` (private) | `resolveParentSession` mirror | NO — divergence risk if `parentSession` changes |
| `loginParent` (public, calls `parentSession`) | NOT tested | No |
| `lmsCaller` RLS context | `lmsRlsContextOf` → `withRls` GUC | YES — full stack |

---

## 8. Verdict

**SAFE-TO-CLOSE** for the stated goal of proving A3 RLS isolation is kín for the four seeded query types.

**NOT safe-to-close** as a complete mutation-guard for:
1. The `parentSession` resolver itself (M1 — the test proves DB layer, not resolver code path)
2. `submission_isolation` removal (m2 — vacuous assertion)
3. `parent_meeting_isolation` removal (m1 — vacuous assertion)

**Recommended next steps before marking T15 fully done-by-evidence:**

1. **Immediately actionable (low cost):** Add `loginParent`-based assertion to G1 to cover the real resolver path. This is a 5-line addition.
2. **Follow-up slice:** Seed a submission row for S3 in G3 and assert empty. Requires minimal extra fixture.
3. **Deferred (acceptable):** The myMeetings isolation test with full enrollment+classBatch fixture can be a separate slice, but the test comment should be updated to explicitly state the assertion is vacuous without enrollment data.

---

## Unresolved Questions

1. Does the test suite run in Vitest with a single worker or with sharding? If sharded, the `uniq()` collision risk (m4) deserves a second look at the pid+timestamp approach.
2. Is there a plan to export `parentSession` (or a testable wrapper) from `@cmc/auth` so resolver-level regression can be caught without duplicating the query?
