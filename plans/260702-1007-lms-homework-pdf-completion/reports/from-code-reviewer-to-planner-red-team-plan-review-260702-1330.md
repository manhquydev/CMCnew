# Red-team review — LMS homework draw-on-PDF completion plan

Reviewed against the ACTUAL current working tree (post Plan-1 seam-fixes, uncommitted), not the plan's assumed baseline. All findings below are verified by reading the live files/migrations cited.

## Verdict: FIX-FIRST

The plan's core authorization/redaction assumptions (exercise.upsert roles, submission RLS, exercise no-RLS) are verified CORRECT against the current tree — no RETHINK needed on scope or approach. But Phase 1 has a real, unaddressed concurrency/error-handling gap introduced by Plan-1's new write guard, Phase 4 has a factually wrong API-signature claim that will mislead implementation, and Phase 2/5/6 carry stale "does X exist?" uncertainty that the tree already answers — these must be corrected before implementation starts, not discovered mid-phase.

---

## CRITICAL

### C1 — Phase 1 doesn't handle the new `assertExerciseOpenForStudent` FORBIDDEN path in autosave
`apps/api/src/routers/submission.ts:119-146` (`save`) now calls `assertExerciseOpenForStudent` (`apps/api/src/lib/exercise-open.ts:57-93`) on **every** save, not just create. This guard requires: exercise published AND a non-cancelled `classSession` for the unit, with the student **actively enrolled** (`status: 'active', archivedAt: null`), whose end time has passed.

Once "opened" this normally stays true (time only moves forward) — but it is not monotonic in practice: a staff member can retroactively cancel the session (`status → 'cancelled'`) or the student's enrollment can be archived/deactivated while a homework modal is open. Under Phase 1's design, an in-progress autosave loop (debounced every 1.5-2s per phase-01 Requirements) will start throwing **`FORBIDDEN`**, not `CONFLICT`, mid-edit.

Phase 1's "Client on CONFLICT" handling (phase-01 §Requirements, §Todo) only describes a reload-prompt flow for `CONFLICT`. There is no FORBIDDEN case in the conflict UX design, the Risk Assessment section, or the P7 test matrix. As written, a student's local strokes will either surface a raw unhandled error toast or (worse) silently fail every autosave tick with no user-visible warning, risking real data loss for exactly the population (kids 3-11) this feature targets.

**Fix**: Phase 1 must explicitly branch autosave error handling on error code: `CONFLICT` → reload prompt; `FORBIDDEN` (from the open-gate, not the "unpublished" case which already existed) → stop autosaving, freeze the local draft, and surface a distinct "bài tập đã đóng" message so no more failed writes loop silently. Add an integration test in P7 for save-after-session-cancelled → FORBIDDEN, not just save-after-unpublish.

### C2 — Phase 4's `readPdf` return-shape claim is wrong; will corrupt the "keep interface identical" instruction
Phase 4 states: *"`readPdf(ref) → {buffer, contentType}` ... signatures stay identical"* (phase-04 §Overview, §Key Insights).

Actual current signature (`apps/api/src/services/pdf-store.ts:48-54`):
```ts
export async function readPdf(ref: string): Promise<Buffer>
```
It returns a bare `Buffer`. `contentType` is hardcoded inline at the call site (`apps/api/src/index.ts:151`: `c.header('Content-Type', 'application/pdf')`) — it is **not** part of `readPdf`'s return value. The `{buffer, contentType}` shape the plan describes is actually `readSessionPhoto`'s signature (`apps/api/src/index.ts:120`), a different store the plan explicitly marks out-of-scope. The plan conflated the two stores' interfaces.

If an implementer follows the plan literally ("keep the signature identical, it returns `{buffer, contentType}`"), they will either (a) invent a contentType field that never existed and break the "read-only, unchanged" contract on `index.ts`, or (b) get confused when their S3 driver returns a bare Buffer as today and "fix" it to match the plan's wrong description, unnecessarily touching the read-only `index.ts` file the phase explicitly forbids modifying.

**Fix**: Correct phase-04's Key Insights to: `readPdf(ref): Promise<Buffer>`, content-type is fixed `application/pdf` at the call site and out of scope for the driver swap.

---

## MAJOR

### M1 — Phase 2's "does PdfAnnotator have a read-only mode?" uncertainty is already resolved in the tree — plan risks reinventing it
`packages/ui/src/pdf-annotator.tsx:100-111` already exports:
```ts
export function PdfAnnotator({ pdfRef, value, onChange, editable = true, readOnlyLayers = [] }: {
  editable?: boolean;
  readOnlyLayers?: { items: AnnotationItem[]; opacity?: number }[];
  ...
```
`editable={false}` already disables the toolbar and pointer-capture overlay (lines 229, 284). `readOnlyLayers` already supports multiple stacked read-only layers with independent opacity, and `student-view.tsx:241-247` already consumes exactly this shape (`readOnlyLayers={teacherLayer ? [{items: teacherLayer.items, opacity: 1}] : []}`).

Phase 2's Key Insights / Implementation Steps ("Check if a readOnly prop already exists; if not, add one... this is a UI contract touch — coordinate with P5/P6") and its Risk Assessment ("pdf-annotator.tsx ownership overlap with P5/P6 (Med/Med): sequence P2 annotator edit BEFORE P5 starts... assign single owner to serialize") are solving a problem that doesn't exist. Parent view needs **zero** pdf-annotator.tsx changes — `editable={false}` + `readOnlyLayers=[{items: student}, {items: teacher, opacity:1}]` is directly usable today.

**Impact**: Following the plan as written risks an AI-assisted implementer adding a *second*, differently-named "readOnly" prop or a parallel dual-layer abstraction next to the existing `editable`/`readOnlyLayers` pair — a duplicate-interface / parallel-reimplementation smell this project's rules explicitly warn against. It also invents an unnecessary P2-before-P5 sequencing constraint.

**Fix**: Rewrite phase-02 §Key Insights / §Implementation Steps to state the props already exist; P2's only pdf-annotator.tsx touch (if any) is zero-line — remove the "additive prop" work item and the P2/P5 sequencing risk entirely.

### M2 — Phase 5/P6 annotator changes have a real consumer regression risk (grading.tsx) that no phase or the P7 test matrix names
`apps/admin/src/grading.tsx:166-171` also renders `<PdfAnnotator ... readOnlyLayers={studentLayer ? [{items: studentLayer.items, opacity: 0.6}] : []} />` (teacher grading view, editable defaults true — teacher draws corrections). P5 (eraser/pen-width/pinch-zoom) and P6 (lazy/virtualized render) both modify `packages/ui/src/pdf-annotator.tsx` directly — the same shared component grading.tsx depends on. Neither phase file nor P7's test matrix lists a grading-view regression check (teacher draw-over-student-layer still works after eraser/zoom/lazy-render changes land). This is a cross-consumer blast-radius the plan is silent on.

**Fix**: Add "grading.tsx teacher-correction flow still works (draw, undo, save) after P5/P6" to P7's manual/E2E matrix, and note grading.tsx as a Read/regression-risk consumer in P5 and P6's Context links.

### M3 — Phase-01's per-autosave DB query cost from the new open-gate is understated
`assertExerciseOpenForStudent` (`exercise-open.ts:57-93`) runs an `exercise.findUniqueOrThrow` plus a `classSession.findMany` (joined through `batch.enrollments`) on every call. Phase 1 wires this into every debounced autosave tick (every ~1.5-2s while a child is actively drawing). Phase-01's Risk Assessment only names generic "autosave storm / server load," with mitigation "debounce + skip if no diff" — it does not call out that each surviving autosave now pays for a session/enrollment lookup that didn't exist before Plan-1, on top of the upsert. Not classic N+1 (no loop), but a real added per-save query cost worth sizing before shipping to a tablet-heavy, spotty-network classroom use case.

**Fix**: Note the added query in Phase 1's risk section; consider caching "is this exercise open for this student" for the lifetime of the modal session instead of re-querying it on every autosave write (the open state cannot regress within a single browsing session in the common case — only staff-side cancellation flips it, which is rare and fine to catch on the next save/submit).

---

## MINOR

### N1 — Line-number drift across all phase-01/02 context links (expected staleness, still worth flagging as confirmed)
Actual current line numbers vs. plan citations:
- `submission.ts` `save` mutation: actual **119-146**, plan cites `117-151` (phase-01).
- `submission.ts` `layerForGrading`: actual **103-116**, plan cites `99-115` (phase-02).
- `submission.ts` `myLayer`: actual **151-166**, plan cites `156-171` (phase-02).
- `submission.ts` `forStudent`: actual **84-98**, plan cites `80-97` (phase-02).
- `student-view.tsx` `saveDraft`: actual **145**, plan cites `145` — correct, no drift.

All within the plan's own "re-grep at implementation time" hedge; none change behavior, but confirmed here so the implementer doesn't need to re-verify.

### N2 — `submissionSelect` already includes `version: true`
Phase 1 Key Insight says *"`submissionSelect` does NOT currently include `version` — must add it — verify the const at implementation time."* Current tree (`submission.ts:22-32`) already has `version: true` in `submissionSelect`. The phase already hedges with "verify at implementation time," so this is self-correcting, but flagging it saves a wasted step: **the select-list part of Todo item 1 is already done**; only the update-path version-guard logic (Todo item 2) and exposing version through `myLayer` (Todo item 4) remain real work.

### N3 — Phase 5's "UNRESOLVED — see plan questions" about pen-width persistence is stale text
`apps/api/src/annotation.ts:22` already has `width: z.number().min(0.1).max(40)` on ink items. Plan.md's "Planner open questions — RESOLVED" §3 already correctly states this is resolved and needs no schema change. Phase-05.md itself still contains leftover "UNRESOLVED — see plan questions" language in its own Key Insights/Risk Assessment that contradicts plan.md's resolution — harmless (implementer will find the true answer either way) but should be cleaned up for coherence.

### N4 — `/files/exercise/:ref` code comment is now misleading (not a plan defect, but Phase 4 will inherit it)
`apps/api/src/index.ts:129-133` comment still says *"staff see their facility's exercises, a parent/student only exercises in a class their owned student is enrolled in"* — this predates decision 0022 (`docs/decisions/0022-exercise-global-curriculum-asset-no-rls.md`), which explicitly states the serving semantics loosened to "any authenticated principal" once Exercise RLS was disabled. Phase 4 marks this file "Read-only... must remain unchanged" so it won't fix the comment, but an implementer reading the stale comment while working the MinIO driver swap may mis-model the actual authorization the endpoint provides. Worth a one-line comment fix as a drive-by, not gating.

---

## Verified correct (no drift found — do not re-litigate)

- `exercise.upsert` permission tuple = `['giam_doc_kinh_doanh', 'giam_doc_dao_tao']` — confirmed in `packages/auth/src/permissions.ts:70` and `apps/api/test/fixtures/permission-snapshot.json:29`. Matches plan.md dependency note and phase-03's assumption exactly.
- `submission.listByExercise` / `layerForGrading` = `['giao_vien', 'giam_doc_dao_tao']` — teachers keep read+grade, confirmed in `permissions.ts:226-229`. Matches "teachers do NOT author exercises" premise underlying phase-03's risk note.
- `Exercise` RLS is genuinely disabled: `packages/db/prisma/migrations/20260702093300_exercise_global_no_rls/migration.sql` drops `exercise_isolation` policy, disables RLS, and drops `facility_id`/`class_batch_id`/`due_at` columns. `dueAt` is fully gone from the DB and from `student-view.tsx`/`parent-view.tsx` (grepped, zero hits).
- `Submission` RLS is intact and admits guardian reads of owned children: `submission_isolation` policy (`20260623100000_principal_aware_rls/migration.sql:53-65`) uses `app_principal_kind() <> 'staff' AND student_id = ANY(app_student_ids())`, which covers guardian principals with multiple studentIds (`packages/auth/src/lms.ts:49`). Phase 2's plan to mirror `forStudent`'s pattern for `layerForGuardian` is sound.
- No existing MinIO/S3 service in any compose file (`docker/docker-compose.{dev,prod,prod.tls,jenkins}.yml`) — Phase 4 is greenfield infra, no conflicting service to reconcile.
- No `pdf-annotator.tsx` schema/width mismatch — `annotation.ts` caps (`MAX_ITEMS=500`, `MAX_INK_POINTS=2000`, `width: 0.1-40`) are stable and already used by the client.

---

## Unresolved questions (for planner, not answerable from repo alone)

1. Should the FORBIDDEN-from-session-cancellation autosave case (C1) actually surface a hard stop, or should the client retry against a "read current open-state" query before declaring the draft frozen? This is a UX/product call, not something the tree can answer.
2. Phase 4's "compose service resource fit on the VPS" risk is still open — no infra sizing data in the repo to verify against; requires an operator answer, not a code check.
3. Confirm with the operator whether the grading.tsx regression check I'm adding to P7 (M2) should be automated (Playwright) or remains manual-checklist — plan currently has both an int-test and e2e track; not clear which bucket a "teacher draws correction after P5/P6" check belongs in.

---

Status: DONE
Summary: Verdict FIX-FIRST. 2 CRITICAL (autosave FORBIDDEN-path gap from Plan-1's new open-gate; Phase 4's readPdf signature claim is factually wrong), 3 MAJOR (Phase 2 solving an already-solved readOnly-prop problem; grading.tsx regression risk missing from P5/P6/P7; per-autosave query cost from the open-gate understated), 4 MINOR (line-number drift, already-added version field, stale UNRESOLVED text in phase-05, misleading code comment). Core authz/RLS/permission assumptions in the plan verified correct against the live tree.
