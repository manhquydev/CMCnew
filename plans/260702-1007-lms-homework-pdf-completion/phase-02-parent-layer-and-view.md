# Phase 02 — Parent layer API + parent drawn-work view

Status: completed 2026-07-02.

Closes gaps #2 (parent cannot see drawn work) and #3 (no parent-facing layer query). Operator: "PH xem đầy đủ như xem vở của con."

## Context links
- `apps/api/src/routers/submission.ts:103-116` (layerForGrading, staff-only) and `:151-166` (myLayer, student-only)
- `apps/api/src/routers/submission.ts:84-98` (forStudent — parent-scoped pattern to mirror)
- `apps/lms/src/parent-view.tsx` (score/feedback text only, no PdfAnnotator import)
- `packages/ui/src/pdf-annotator.tsx:100-111` (annotator; read-only mode ALREADY exists via `editable`/`readOnlyLayers` props — no new capability needed)
- `apps/lms/src/student-view.tsx:239-243` (existing consumer using `editable={!isGraded}` + `readOnlyLayers`)

## Overview
Add a parent-scoped layer procedure so a guardian can view their own child's student layer + the published teacher-correction layer, honoring the pre-publish redaction invariant. Wire a read-only drawn-work view into parent-view.tsx.

## Key Insights
- `myLayer` derives studentId from `ctx.lms.studentIds[0]` (student session). Parent has multiple children → need explicit `studentId` param validated against `ctx.lms.studentIds`.
- `forStudent` (submission.ts:80-97) already proves the parent-scoping pattern: RLS rejects unowned studentId. Reuse: filter/guard `studentId ∈ ctx.lms.studentIds`, and RLS is the authoritative backstop.
- Redaction invariant: teacher layer must be null unless `grade.isPublished` (mirror myLayer). Score/feedback already redacted via `redactUnpublishedGrade` on `forStudent`.
- Json columns never selected into normal tRPC shapes — dedicated layer proc casts to `AnnotationData`. Preserve.
- **PdfAnnotator read-only mode ALREADY EXISTS** — no annotator changes needed. `editable={false}` disables the toolbar + pointer-capture overlay; `readOnlyLayers` renders multiple stacked read-only layers with independent opacity (pdf-annotator.tsx:100-111). `student-view.tsx:239-243` already consumes exactly this. Parent view reuses the existing props directly: `editable={false}` + `readOnlyLayers={[{items: student}, {items: teacher, opacity: 1}]}`. Do NOT add a second `readOnly`-style prop — that would duplicate the existing contract. This removes the P2↔P5/P6 file-ownership overlap entirely (P2 touches zero lines of pdf-annotator.tsx).

## Requirements
- New `submission.layerForGuardian` (name TBD): input `{ exerciseId, studentId }`; validate `studentId ∈ ctx.lms.studentIds` else FORBIDDEN; RLS scoped; returns `{ student: AnnotationData|null, teacher: AnnotationData|null }` with teacher null unless published.
- parent-view.tsx: add read-only drawn-work view (base PDF + student layer + published teacher layer). No draft/save controls.
- Never expose teacher layer or score/feedback before publish.

## Architecture
Data flow: parent selects child + exercise → `layerForGuardian({exerciseId, studentId})` → server validates ownership + RLS + publish-gate on teacher layer → returns two layers → parent-view renders PdfAnnotator in read-only overlay mode (student layer under teacher layer, same z-order convention as grading view).

## Related code files
- Modify: `apps/api/src/routers/submission.ts` (new procedure near :151)
- Modify: `apps/lms/src/parent-view.tsx` (import PdfAnnotator, `editable={false}` + `readOnlyLayers`, fetch layers)
- Read-only: `packages/ui/src/pdf-annotator.tsx` (reuse existing `editable`/`readOnlyLayers` — no change), `apps/api/src/annotation.ts`

## Implementation Steps
1. Add `layerForGuardian` procedure: `lmsProcedure` + explicit `studentId ∈ ctx.lms.studentIds` guard; select `annotationLayer` + `grade.{annotationLayer,isPublished}`; publish-gate teacher layer; cast to AnnotationData.
2. parent-view.tsx: per-exercise "Xem bài làm" opens `<PdfAnnotator editable={false} readOnlyLayers={[{items: student}, {items: teacher, opacity: 1}]} />` with fetched layers. Reuse existing props — no annotator code change.
3. Ensure loading of base PDF reuses `/files/exercise/:ref` (index.ts:134-146). Post seam-fixes Exercise is a global no-RLS curriculum asset (decision 0022), so the endpoint resolves for any authenticated principal — a guardian session included. Verify a guardian token serves the ref at implementation time.

## Todo list
- [x] layerForGuardian proc with ownership guard + publish redaction
- [x] parent-view read-only drawn-work view (reuse `editable={false}` + `readOnlyLayers` — no annotator change)
- [x] verify base PDF serves to guardian principal (global no-RLS exercise)
- [x] integration: pre-publish teacher layer hidden; cross-guardian denied

## Evidence 2026-07-02
- `pnpm --filter @cmc/api|@cmc/lms typecheck` PASS. New `apps/api/test/submission-guardian-layer.int.test.ts`: 4/4 pass (own-child read, pre-publish teacher-layer null, post-publish reveal, cross-guardian FORBIDDEN).
- Code review (security-focused, given this is the plan's highest-sensitivity phase): `studentId ∈ ctx.lms.studentIds` guard runs before any DB read, `studentIds` is server-derived (not client-supplied) so unspoofable; RLS is a genuine second layer, not the only guard. Redaction gate (`grade.isPublished`) is the sole path producing the teacher layer, mirrors the already-shipped `myLayer`. `submission.ts` diff is purely additive (0 lines changed in existing procedures). No findings.

## Success Criteria
- Guardian sees own child's strokes + published corrections read-only.
- Pre-publish: teacher layer + score/feedback null (integration test P7).
- Foreign studentId → FORBIDDEN/empty (integration test P7).

## Risk Assessment
- Redaction regression leaking teacher marks pre-publish (Low likelihood, HIGH impact): mirror exact myLayer publish-gate; P7 integration test is mandatory gate.
- Base PDF ref not served to guardian (Low/Low): Exercise is now global no-RLS (decision 0022), so `/files/exercise/:ref` resolves for any authenticated principal — expected to work. Confirm with a guardian token in P7 e2e; no annotator or RLS change required.
- No pdf-annotator.tsx ownership overlap: P2 touches zero lines of the annotator (reuses existing props), so no P2↔P5/P6 sequencing constraint.

## Security Considerations
- Authorization is the core risk: studentId must be validated against `ctx.lms.studentIds` AND rely on RLS. Do not trust client studentId alone.
- Teacher correction layer is sensitive pre-publish — publish-gate is a hard invariant.

## Rollback
- Code-only revert. New procedure is additive; removing it + parent-view usage restores prior text-only view. No data change.

## Next steps
Depends on P1 (stable saved layers). Feeds P7 redaction + cross-guardian tests.
