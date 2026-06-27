# Flow Verify — Teaching / Attendance / Grading (2026-06-27)

API: http://localhost:4000 · Postgres dev @5433 (seeded) · super_admin admin@cmc.local · student TEST-001
Method: tRPC-over-curl (raw JSON). Source not modified.

## Result table

| Step | Action (proc) | Result | Response (key fields) |
| --- | --- | --- | --- |
| 1 | `auth.login` super_admin | PASS | roles=[super_admin], facilityIds=[1] |
| 1 | `course.create` (UCREA) | PASS | id 30f2cfc6…, code FLOW-1782523717 |
| 1 | `classBatch.create` (fac 1) | PASS | id 485367a2…, code B-2026-0001, status planned |
| 1 | `schedule.addSlot` (Mon 18:00-19:30) | PASS | slot 4bbd836d… |
| 1 | `schedule.generateSessions` run 1 | PASS | `{created:4, skipped:0}` |
| 1 | `schedule.generateSessions` run 2 (idempotent) | PASS | `{created:0, skipped:4}` — no crash |
| 1 | conflict detection (2 batches, same teacherId+time) | PASS | gen B2 `{created:5}`; gen B3 → **409 CONFLICT** "Trùng lịch (5): teacher@2026-08-03,…" |
| 2 | `enrollment.enroll` TEST-001 | PASS | enrollment 95a1c02a…, overCapacity=false, enrolledCount=1 |
| 3 | `attendance.mark` (present) | PASS | attendance ffa77c85… status=present |
| 3 | `attendance.mark` re-run (late) | PASS | same id (upsert idempotent), status=late |
| 4 | `exercise.create` (homework, max10, star5) | PASS | exercise 48ca0885… |
| 4 | `exercise.publish` | PASS | status=published |
| 4 | `lmsAuth.loginStudent` TEST-001 | PASS | principal kind=student |
| 4 | `submission.save` (draft) | PASS | submission bfe18045… status=draft |
| 4 | `submission.submit` | PASS | status=submitted |
| 4 | `grade.grade` (8/10) | PASS | grade 3767650e…, isPublished=false |
| 4 | `grade.publish` | PASS | isPublished=true, **starsEarned=5**, badgesAwarded=0 |
| 5 | `assessment.upsertQualitative` (qScore=9) | PASS | qa 497a086f… |
| 5 | `computeFinalGrade` UCREA | PASS | **finalScore=9** (qualitative-only) |
| 5 | `computeFinalGrade` BRIGHT_IG | PASS | **finalScore=8.83** (0.6 qual + 0.4 quant) |
| 5 | `computeFinalGrade` BLACK_HOLE | PASS | **finalScore=8.7** (0.3 qual + 0.7 quant) |
| 5 | `termCreate` + `computeFinalGrade` before lock | PASS | returns finalScore=null/complete=false (07-2026 window excludes the 06-27 grade + no qual for that key — correct) |
| 5 | `termLock` then `computeFinalGrade` | PASS | **403 FORBIDDEN** "Kỳ \"2026-LOCK\" đã bị khóa…" |

## Grade-blend verification (math checks out)

Inputs for student TEST-001 (all-time, periodKey 2026-FLOW): qualitativeScore=9; homeworkAvg=8 (grade 8/10); testScore=null; attendanceRate=1.0 (late counts as attended).
Quant formula {homework:0.5, test:0.3, attendance:0.2} renormalized over present parts (test absent): (0.5·8 + 0.2·10)/0.7 = **8.571**.

- UCREA = qualitative only → 9.00 ✓ (matches 9)
- BRIGHT_IG = 0.6·9 + 0.4·8.571 = 8.829 ≈ **8.83** ✓
- BLACK_HOLE = 0.3·9 + 0.7·8.571 = 8.70 ✓

Per-program weights confirmed against `packages/domain-grading/src/grading.ts` programWeights().

## Server-log errors

`grep -iE 'error|unhandled|500|prisma|stack' /tmp/cmc-api-dev.log` → **no matches**. Full log = 5 startup lines only:
```
✓ CMCnew API on http://localhost:4000
```
The 409 (conflict) and 403 (term lock) are intentional tRPC error responses returned to the client, not server-side crashes/500s.

## Findings

1. No bugs found. Every step in the teaching → attendance → exercise → grading → final-grade flow works end-to-end.
2. Idempotency holds: `generateSessions` re-run returns `created:0` (no reduce-on-empty crash); `attendance.mark` re-run upserts same row.
3. Conflict detection fires correctly on teacher overlap (CONFLICT, not 500).
4. Friendly guards verified by code path: enroll dup → CONFLICT, submit-without-draft → NOT_FOUND, re-submit → CONFLICT (not raw P2002/P2025 500s).
5. Per-program grade blending matches the charter (UCREA qual-only; BRIGHT_IG 60/40; BLACK_HOLE 30/70) to 2-dp.
6. Term lock blocks FinalGrade writes (403 FORBIDDEN); pre-lock computation respects the term date window (06-27 grade excluded from a 07-2026 term → incomplete, expected).

## Unresolved questions

- None blocking. Note: a locked-term compute before lock yields `complete:false` because the grade's `gradedAt` (2026-06-27) sits outside the test term window (2026-07); this is correct date-windowed behavior, not a defect.
