# Data Integrity / Migrations — Latent Bug Audit

Report-only. Scope: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/*`,
seed scripts, content-addressed pdf-store. DEV DB inspected read-only (superuser `cmc`,
RLS-bypassing). No code or DB modified.

Date: 2026-07-09 · Branch: develop

Severity legend: HIGH = data loss / crash / migration hazard · MEDIUM = blocks a legit
workflow or wrong result · LOW = annoyance / defense-in-depth gap.

---

## F1 — Schema↔DB drift: `exercise.curriculum_unit_id` (MEDIUM-HIGH)

**Where:** `schema.prisma:675` vs DB column `exercise.curriculum_unit_id`.

Schema declares the field nullable with an optional relation:
```prisma
curriculumUnitId String?          @map("curriculum_unit_id") @db.Uuid
curriculumUnit   CurriculumUnit?  @relation(..., onDelete: Restrict)
```
But the live DB column is **NOT NULL** — set by migration
`20260702093200_exercise_unit_constraints` (`ALTER COLUMN "curriculum_unit_id" SET NOT NULL`)
and never reverted by the later `20260706175200_session_level_exercises`.

**Evidence (DEV DB):**
```
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_name='exercise' AND column_name='curriculum_unit_id';
--> curriculum_unit_id | NO
```

**Why it matters:**
1. Prisma Client types `curriculumUnitId` as optional/nullable, so TS callers may pass
   `null`/`undefined`; the DB then rejects the insert → runtime 500 that the type system
   said was fine.
2. The next `prisma migrate dev` / `prisma db push` will see the schema as source of truth
   and emit an unwanted `DROP NOT NULL` migration (silently loosening the constraint), or
   `migrate status`/`diff` will report drift and block a clean deploy. This is the same
   drift class the repo already had to firefight once (`20260701220000_sync_db_push_drift`).
3. An optional relation (`CurriculumUnit?`) sitting on a NOT NULL FK column is internally
   inconsistent.

**Fix direction (not applied):** make the schema match reality — `curriculumUnitId String`
+ `curriculumUnit CurriculumUnit @relation(...)` — then regenerate client; no DB change needed.

---

## F2 — Enrollment re-enroll dead-end: unique omits status/archive (MEDIUM)

**Where:** `schema.prisma:396` `@@unique([classBatchId, studentId])`; guard at
`apps/api/src/routers/enrollment.ts:66-72`.

The enrollment unique key is `(classBatchId, studentId)` with **no** `status` or `archivedAt`
component. When a student leaves a class the row is kept, not deleted:
- receipt cancel → `finance.ts:1357` `updateMany ... data:{ status:'withdrawn' }` (archivedAt stays null)
- transfer → `enrollment.ts:194` `status:'transferred'` (archivedAt stays null)

`enroll` pre-checks duplicates with `findFirst({ where:{ classBatchId, studentId, archivedAt:null }})`.
Because withdrawn/transferred rows still have `archivedAt = null`, the check finds the dead
row and throws:
```
CONFLICT "Học sinh đã được ghi danh vào lớp này"
```
…even though the student is NOT actively enrolled.

**Scenario:** HS pays → enrolled in B-2026-0001 → receipt cancelled → enrollment=withdrawn.
Parent re-pays / changes mind → staff tries to re-enroll into the **same** batch → blocked
forever with a misleading "already enrolled" message. Only workaround is a different batch.

**Evidence:** `enrollment` has no archive endpoint (grep: no `archivedAt` writes in
`enrollment.ts`); DEV DB `SELECT count(*) FROM enrollment WHERE archived_at IS NOT NULL` = 0,
confirming rows are never soft-archived — so the guard degenerates to "any prior row blocks."

**Note on the latent 500:** if any future path ever sets `enrollment.archivedAt`, the guard
(`archivedAt:null`) would miss that row but the DB unique (which ignores archivedAt) would
still catch it → raw P2002 → 500. So the mis-scoped unique is a standing hazard even beyond
the current wrong-CONFLICT behavior.

**Fix direction:** scope the guard to `status NOT IN (withdrawn,transferred)` (not archivedAt),
and either make the unique partial (`WHERE status='active'`) or accept the guard as the sole
gate. Message should distinguish "đang học" vs "đã rời lớp".

---

## F3 — Exercise unique on nullable lesson allows silent duplicates (LOW-MEDIUM)

**Where:** `schema.prisma:691` `@@unique([curriculumLessonId, type])`; column nullable.

Postgres treats NULLs as distinct in a unique index, so any number of exercises with
`(curriculum_lesson_id = NULL, type = homework)` are permitted — the exact footgun the
`star_transaction` migration called out and fixed with a partial unique. Here the intended
invariant "one homework exercise per lesson" silently fails for unit-only exercises.

**Currently latent, not active:** the only writer, `exercise.ts:177-207`, always resolves a
concrete `lesson.id` before the upsert (falls back to `curriculumLesson.findFirst` by unit),
and DEV DB shows `lesson_null = 0` and zero `(lesson,type)` duplicates. The gap bites only if
a new code path ever inserts a lesson-less exercise.

**Fix direction:** back the invariant with a partial unique index
(`WHERE curriculum_lesson_id IS NOT NULL`) or make the column NOT NULL (every exercise already
has a lesson).

---

## F4 — Soft-delete code-reuse collisions on facility catalogs (LOW)

**Where (all omit `archivedAt` from the unique):**
- `Room @@unique([facilityId, code])` (`schema.prisma:322`)
- `Voucher @@unique([facilityId, code])` (`:1095`)
- `Badge @@unique([facilityId, code])` (`:889`)
- `GradingTemplate @@unique([facilityId, program, level])` (`:960`)
- `CoursePrice @@unique([facilityId, courseId, effectiveFrom])` (`:1058`)
- `DiscountTier @@unique([facilityId, years])` (`:1074`)

After archiving a row, creating a replacement with the same key raises the DB unique (P2002).
`room.create` (`room.ts`) does `tx.room.create({ data: input })` with **no** friendly
pre-check, so even an active-code clash returns a raw P2002 → 500 rather than a clean CONFLICT.
Counter-keyed tables (ClassBatch/Receipt/Student `[facilityId, code]`) are immune because their
codes are monotonic and never reused.

**Why low:** admin-only annoyance + occasional ugly 500; no corruption. Fix by pre-checking or
making the uniques partial on `archivedAt IS NULL`.

---

## F5 — `StarTransaction` `manual` type lacks DB-level idempotency (LOW)

**Where:** `schema.prisma:765` + migration `20260626120000_data_integrity_constraints`.

The partial unique `star_transaction_type_reference_unique_notnull ... WHERE reference IS NOT NULL`
protects the automatic types (all supply a non-null reference) but leaves `manual` txns with a
null reference free to duplicate. Documented in the model comment; `manual` is currently unused
and the tRPC layer requires a reference. Confirmed index present in DEV DB. Latent only.

---

## Verified NON-issues (checked, no defect — listed to prevent re-flagging)

- **Curriculum `sessions` vs mapped lessons:** consistent. 240 `curriculum_lesson` rows =
  `SUM(GREATEST(sessions,1))` across seeded units. The apparent "241 / UCREA-CB=1" in a naive
  aggregate is a `GREATEST(NULL,1)` artifact of the LEFT JOIN on the lesson-less fixture course,
  not real data. Seed (`Math.max(sessions,1)`, seed-curriculum.ts:220) and migration
  (`GREATEST(sessions,1)`, 20260706175200) agree.
- **pdf-store integrity:** `putPdf` validates `%PDF-` magic + 20 MB cap, dedups by sha256;
  `refToFile`/`refToKey` reject non-hex refs (path-traversal safe). All 21 exercises have
  non-null `base_pdf_ref`; DEV DB shows 0 null refs. `pdfExists` guards the open path.
- **Course code vs program/level:** all 10 courses match `${program}-${levelCode}`
  (`seed-curriculum.ts:160`); `UCREA-CB` is an intentional level-less E2E price fixture.
- **StudentAccount with unusable loginCode:** 0 rows where the linked student is
  archived/withdrawn/transferred; `StudentAccount` cascades on student delete.
- **`chk_parent_has_identifier`** present and correct (`email IS NOT NULL OR phone IS NOT NULL`).
- **`receipt_student_id_fkey` onDelete=SetNull** and **manager_id** drift already captured by
  `20260701220000_sync_db_push_drift` (post-apply diff empty per its header).

---

## Unresolved questions

1. F1: is the intent that every exercise MUST have a unit (DB NOT NULL, fix schema) or may be
   unit-less (revert DB to nullable)? The relation being `Restrict`-optional suggests the former.
2. F2: should a withdrawn/transferred student be re-enrollable into the *same* batch (product
   decision)? If yes, the unique + guard need re-scoping; if no, at least fix the message.

Status: DONE
Counts — HIGH: 0 · MEDIUM-HIGH: 1 (F1) · MEDIUM: 1 (F2) · LOW-MEDIUM: 1 (F3) · LOW: 2 (F4,F5)
