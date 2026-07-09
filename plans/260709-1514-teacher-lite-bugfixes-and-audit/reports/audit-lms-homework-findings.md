# LMS Homework Domain — Latent-Bug Audit (report-only)

Date: 2026-07-09
Branch: develop
Scope: `apps/api/src/routers/exercise.ts`, `submission.ts`, `apps/api/src/routers/grade.ts`,
`apps/api/src/lib/exercise-open.ts`, `apps/api/src/services/pdf-store.ts`,
`apps/api/src/index.ts` (PDF upload/serve), `apps/lms/src/student-view.tsx`,
`packages/auth/src/lms.ts`, RLS in `migrations/20260623100000_principal_aware_rls`,
`apps/api/src/routers/assessment.ts`.

No source files were modified. Findings ordered most-severe first.

---

## F1 — HIGH — `submission.save` has no status guard: submitted (and graded) submissions stay mutable

**File:** `apps/api/src/routers/submission.ts:141-215` (`save`); reachable UI path in
`apps/lms/src/student-view.tsx:341-356` (autosave), `71-76` (`workStatus`), `152` (`isGraded`).

**Defect:** `save` authorizes with `assertExerciseOpenForStudent` (which only checks
published + active enrollment + session ended) and then does an optimistic-version
`updateMany` whose `where` is `{ exerciseId, studentId, version, archivedAt: null }` —
**there is no `status` predicate.** A submission in status `submitted` or `graded` can be
overwritten (answerText + annotationLayer) as long as the caller knows the current `version`.

The UI only blocks editing when `isGraded` (`status === 'graded'`). A `submitted`
submission is NOT `isGraded`, so the modal stays editable and the 1.8s autosave effect keeps
firing (`student-view.tsx:341-356`), silently mutating the row after the child pressed "Nộp bài".
`submit` freezes `submittedAt` (`submission.ts:255-258`) but does not lock content.

**Failure scenario / repro:**
1. Student saves a draft, then `submit` → status `submitted`, `submittedAt` set.
2. Student keeps typing / drawing in the still-open modal → autosave calls `save` → content
   changes, `submittedAt` unchanged.
3. Teacher opens the submission to grade and sees a version different from the "submitted"
   snapshot; they grade a moving target.
4. Post-grade (API-level, bypassing the UI's `isGraded` disable): a crafted `save` with the
   known `version` still succeeds against a `graded` row — the graded content-of-record can be
   altered after the fact. The `grade` row (score) is separate so the score is not changed, but
   the student annotation layer the teacher overlaid at grade time no longer matches the stored
   submission.

**Why it matters:** "submitted" is not a firm state; grading integrity and the audit trail of
what-was-actually-submitted are undermined. The `submitted → graded` UI lock is presentation-only.

**Fix direction (not applied):** add a status guard to the `save` `updateMany` where-clause
(e.g. `status: 'draft'`), or reject `save` when the current row status is not `draft`, mirroring
the guard already present in `submit` (`submission.ts:252-254`).

---

## F2 — MEDIUM — `grade.maxScore` is never updated on re-grade → unclamped `norm10` inflates homework average

**File:** `apps/api/src/routers/grade.ts:74-95` (upsert); consumed by
`apps/api/src/routers/assessment.ts:17,219,224` (`norm10`, unclamped).

**Defect:** the `grade.upsert` `create` branch stores `maxScore: sub.exercise.maxScore`, but the
`update` branch (`grade.ts:76-83`) does **not** touch `maxScore`. Score is validated against the
*current* `exercise.maxScore` (`grade.ts:68`), while the persisted `grade.maxScore` keeps its
first-write value. `norm10 = (score/max)*10` in `assessment.ts:17` does **not** clamp
(only `computeFinalGrade` clamps the *average* at 10 afterward).

**Failure scenario / repro:**
1. Exercise created with `maxScore = 10`; student graded `score = 8` → `grade.maxScore = 10`
   (norm = 8).
2. Director raises the exercise's `maxScore` to `20` (via `exercise.upsert`).
3. Teacher re-grades the same submission `score = 16` (allowed: `16 ≤ 20`). `grade.update` keeps
   `maxScore = 10`.
4. `computeFinalGrade` computes `norm10(16, 10) = 16` for that homework item → pulls the homework
   average above 10 before the final clamp, distorting `homeworkAvg` / `finalScore`.

**Why it matters:** silent grade-computation inflation whenever a max is raised then a
submission re-graded. Requires a maxScore change, so not everyday, but it is a data-integrity
defect with no guard.

**Fix direction:** set `maxScore: sub.exercise.maxScore` in the `update` branch too (or clamp
`norm10`).

---

## F3 — MEDIUM — `exercise.upsert` is a destructive full-upsert: omitted fields reset to defaults (unpublish / maxScore→10 / starReward→10)

**File:** `apps/api/src/routers/exercise.ts:190-213`.

**Defect:** the `update` branch writes every field unconditionally with `?? default`:
`status: input.status ?? 'draft'`, `maxScore: input.maxScore ?? 10`,
`starReward: input.starReward ?? 10`, `basePdfRef: input.basePdfRef ?? null`,
`description: input.description ?? null`. There is no partial-update semantics, so any caller that
omits a field **clobbers the stored value with the default**, not "leave unchanged".

**Failure scenario / repro:**
- Any `exercise.upsert` that omits `status` re-drafts (unpublishes) a published exercise, which
  removes it from `listForPrincipal` (status `published` filter, `exercise.ts:144`) — the
  homework silently disappears for students.
- Omitting `maxScore` resets it to 10; omitting `basePdfRef` nulls the attached PDF.
- Reachable via the admin form's own inputs: `course-exercise-manager.tsx:217` sends
  `maxScore: typeof maxScore === 'number' ? maxScore : undefined`. If the director clears the
  "Điểm tối đa" NumberInput (state becomes `''`), `undefined` is sent → server resets to 10.

**Mitigation present:** the primary UI (`course-exercise-manager.tsx:196-198,211-220`) preloads
`current` values and re-sends `status`/`maxScore`/`starReward` on every save, so a normal edit is
safe. The defect is latent for the cleared-input case and for any non-UI caller (seeds, scripts,
future endpoints).

**Fix direction:** make omitted fields no-ops on update (only set what was provided), or document
upsert as full-replace and force the client to always send the full set.

---

## F4 — MEDIUM/LOW — `basePdfRef` accepted unvalidated → orphan refs / broken PDFs; no exercise↔store reference integrity

**File:** `apps/api/src/routers/exercise.ts:166` (`basePdfRef: z.string().optional()`);
serve path `apps/api/src/index.ts:163-186`; store `apps/api/src/services/pdf-store.ts:38-42,155-161`.

**Defect:** `basePdfRef` is stored verbatim as any string. It is not constrained to the
64-hex content-address pattern (`REF_PATTERN`, `pdf-store.ts:22`) and is never checked to exist
in the store. Nothing links an exercise row to an actual stored object.

**Failure scenarios:**
- A director types/pastes an arbitrary or wrong ref into "PDF ref hiện tại"
  (`course-exercise-manager.tsx:249`). It is saved; the student modal renders `PdfAnnotator`
  with that ref → `/files/exercise/:ref` passes the RLS-less existence check on the exercise row
  but `pdfExists(ref)` is false → 404 → broken exercise. (A non-hex ref makes `refToFile` throw
  inside `diskExists`, caught → also 404, no crash.)
- **Driver switch orphans everything:** PDFs written under `PDF_STORE_DRIVER=disk` are not in
  S3; flipping to `s3` (`pdf-store.ts:17,147-156`) leaves every DB `basePdfRef` pointing at
  objects that do not exist in the new backend → all exercise PDFs 404. No reconciliation exists.
- The content-addressed store never deletes, so there is no missing-file risk from
  archive/delete; shared (deduped) refs stay served as long as one non-archived exercise
  references them (`index.ts:172-175`) — that part is sound.

**Fix direction:** validate `basePdfRef` against `REF_PATTERN` at the router boundary and/or call
`pdfExists` before persisting; add an ops note that switching `PDF_STORE_DRIVER` requires a blob
migration.

---

## F5 — LOW — `/files/exercise/:ref` serves any exercise PDF (draft / closed / not-yet-open, cross-facility) to any authenticated principal

**File:** `apps/api/src/index.ts:155-186`.

**Defect:** RLS is disabled on the `exercise` table (decision 0022; comment at `index.ts:155-162`),
so the visibility check `tx.exercise.findFirst({ where: { basePdfRef: ref, archivedAt: null } })`
matches for **any** authenticated staff or LMS principal regardless of facility, enrollment,
exercise status, or the unit-open gate. Any logged-in parent/student can fetch any non-archived
exercise's base PDF (including drafts and not-yet-opened worksheets) if they have the ref.

**Assessment:** explicitly accepted with decision 0022 — worksheets carry no PII and `ref` is a
high-entropy sha256 not returned for un-opened exercises (`listForPrincipal` gates the list). Flagged
as informational: the only authz is "is authenticated," which is weaker than the exercise-open
gate applied everywhere else in the domain. No action unless the threat model tightens.

---

## F6 — LOW/INFO — Re-grade after publish silently changes a published score; no re-notification, audit type always `created`

**File:** `apps/api/src/routers/grade.ts:74-104`.

**Defect:** `grade.upsert.update` (`grade.ts:76-83`) does not reset `isPublished`. Re-grading an
already-published submission changes `score`/`feedback` while `isPublished` stays `true`, so the
student/parent immediately sees the new score (redaction in `submission.ts:40-46` only hides
*unpublished* grades) with **no `grade_published` notification** (that only fires in `publish`,
`grade.ts:159-168`). The audit `logEvent` type is hard-coded `'created'` on every grade write
(`grade.ts:97-104`), so a score correction is not distinguishable from an initial grade in the log.

**Assessment:** may be intended (corrections should surface without a re-publish dance), but the
missing re-notification + non-specific audit type is a latent surprise. Note only.

---

## Items checked and found sound (no defect)

- **ICT day-boundary conversion** (`exercise-open.ts:7-27`): `sessionEndUtc` builds
  `Date.UTC(y, m, d, hour - 7, minute)` from a `@db.Date` `sessionDate` (Prisma returns UTC
  midnight) + string `endTime`. Negative hours normalize across the date correctly (e.g.
  05:00 ICT → previous-day 22:00 UTC). Verified correct at both early and late end times; no
  off-by-one. `<=` comparison in `sessionHasEnded` is the intended "open at end instant."
- **Submission version-conflict / first-save race** (`submission.ts:159-205`): create path
  catches the `unique(exerciseId, studentId)` P2002 and maps to `CONFLICT`; update path uses an
  optimistic `version` `updateMany` with a `count === 0` → `CONFLICT`. Race-safe. (Content
  mutability after submit is the separate F1 issue, not a race.)
- **Cross-student isolation** (`migrations/20260623100000_principal_aware_rls/migration.sql:53-109`):
  `submission`/`grade` RLS scope non-staff reads to `student_id = ANY(app_student_ids())`;
  `layerForGuardian` also pre-checks `ctx.lms.studentIds.includes` (`submission.ts:122-127`).
  A foreign `studentId` returns nothing. Sound.
- **`studentIds[0]` in student write paths** (`submission.ts:152,224,242`): guarded by
  `studentProcedure` (`trpc.ts:92-95`), and a `kind:'student'` session always resolves exactly one
  student (`lms.ts:73-91`). Safe. Guardian multi-child paths correctly take an explicit `studentId`.
- **Completed / withdrawn / transferred enrollment access**: `completed` students keep *visibility*
  of past exercises/grades (`exercise-open.ts:99-177`, status `in ['active','completed']`) but
  cannot open NEW work — `assertExerciseOpenForStudent` requires `status: 'active'`
  (`exercise-open.ts:321-327`), so `save`/`submit` return FORBIDDEN. `withdrawn`/`transferred`
  are blocked at session resolution (`BLOCKED_LMS_LIFECYCLE`, `lms.ts:12,60,80`). Consistent.
- **Cancelled-session homework**: every open/notify query filters `status: { not: 'cancelled' }`
  (`exercise-open.ts:47,80,107,149,189,255,317`; makeup attendance too). Cancelled sessions never
  open or notify an exercise. Sound.
- **PDF dedup/store**: content-address + magic-byte + size guard + path-traversal-safe
  `REF_PATTERN` (`pdf-store.ts:29-42,94-97`); dedup skip-write is idempotent; S3 not-found
  normalized to `false`. Sound (the integrity gap is at the *caller* boundary — see F4).

---

## Unresolved questions

1. F1: Is post-submit editing intended ("keep working until graded")? If yes, `submittedAt`
   semantics and the teacher's grading snapshot still need reconciling; if no, add the status lock.
2. F6: Should a re-grade after publish re-notify the student and/or require an explicit re-publish?
3. F4: Is a `PDF_STORE_DRIVER` switch (disk↔s3) an expected ops action? If so a blob-migration
   step is missing from the runbook.

Status: DONE
Counts by severity: HIGH 1 (F1), MEDIUM 2 (F2, F3), MEDIUM/LOW 1 (F4), LOW 2 (F5, F6).
