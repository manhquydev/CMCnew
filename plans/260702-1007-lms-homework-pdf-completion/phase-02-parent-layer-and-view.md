# Phase 02 — Parent layer API + parent drawn-work view

Closes gaps #2 (parent cannot see drawn work) and #3 (no parent-facing layer query). Operator: "PH xem đầy đủ như xem vở của con."

## Context links
- `apps/api/src/routers/submission.ts:99-115` (layerForGrading, staff-only) and `:156-171` (myLayer, student-only)
- `apps/api/src/routers/submission.ts:80-97` (forStudent — parent-scoped pattern to mirror)
- `apps/lms/src/parent-view.tsx` (score/feedback text only, no PdfAnnotator import)
- `packages/ui/src/pdf-annotator.tsx` (annotator; needs read-only mode)

## Overview
Add a parent-scoped layer procedure so a guardian can view their own child's student layer + the published teacher-correction layer, honoring the pre-publish redaction invariant. Wire a read-only drawn-work view into parent-view.tsx.

## Key Insights
- `myLayer` derives studentId from `ctx.lms.studentIds[0]` (student session). Parent has multiple children → need explicit `studentId` param validated against `ctx.lms.studentIds`.
- `forStudent` (submission.ts:80-97) already proves the parent-scoping pattern: RLS rejects unowned studentId. Reuse: filter/guard `studentId ∈ ctx.lms.studentIds`, and RLS is the authoritative backstop.
- Redaction invariant: teacher layer must be null unless `grade.isPublished` (mirror myLayer:167-168). Score/feedback already redacted via `redactUnpublishedGrade` on `forStudent`.
- Json columns never selected into normal tRPC shapes — dedicated layer proc casts to `AnnotationData` (submission.ts:111-113,166-168). Preserve.
- PdfAnnotator must support a read-only mode (no drawing) rendering two stacked layers. Check if a `readOnly` prop already exists; if not, add one (this is a UI contract touch — coordinate with P5/P6 which also own pdf-annotator.tsx). To avoid file-ownership collision, keep P2's annotator change to a minimal additive `readOnly`/`layers` prop; P5/P6 own interaction internals.

## Requirements
- New `submission.layerForGuardian` (name TBD): input `{ exerciseId, studentId }`; validate `studentId ∈ ctx.lms.studentIds` else FORBIDDEN; RLS scoped; returns `{ student: AnnotationData|null, teacher: AnnotationData|null }` with teacher null unless published.
- parent-view.tsx: add read-only drawn-work view (base PDF + student layer + published teacher layer). No draft/save controls.
- Never expose teacher layer or score/feedback before publish.

## Architecture
Data flow: parent selects child + exercise → `layerForGuardian({exerciseId, studentId})` → server validates ownership + RLS + publish-gate on teacher layer → returns two layers → parent-view renders PdfAnnotator in read-only overlay mode (student layer under teacher layer, same z-order convention as grading view).

## Related code files
- Modify: `apps/api/src/routers/submission.ts` (new procedure near :156)
- Modify: `apps/lms/src/parent-view.tsx` (import PdfAnnotator read-only, fetch layers)
- Modify (minimal, additive prop only): `packages/ui/src/pdf-annotator.tsx` — if no read-only mode exists
- Read-only: `apps/api/src/annotation.ts`

## Implementation Steps
1. Add `layerForGuardian` procedure: `lmsProcedure` + explicit `studentId ∈ ctx.lms.studentIds` guard; select `annotationLayer` + `grade.{annotationLayer,isPublished}`; publish-gate teacher layer; cast to AnnotationData.
2. Confirm/add `readOnly` (and dual-layer) support in PdfAnnotator (additive, non-breaking).
3. parent-view.tsx: per-exercise "Xem bài làm" opens read-only annotator with fetched layers; disable all editing affordances.
4. Ensure loading of base PDF reuses `/files/exercise/:ref` (parent RLS already allows via exercise enrollment, index.ts:134-146).

## Todo list
- [ ] layerForGuardian proc with ownership guard + publish redaction
- [ ] PdfAnnotator readOnly/dual-layer prop (additive)
- [ ] parent-view read-only drawn-work view
- [ ] verify base PDF serves to parent principal
- [ ] integration: pre-publish teacher layer hidden; cross-guardian denied

## Success Criteria
- Guardian sees own child's strokes + published corrections read-only.
- Pre-publish: teacher layer + score/feedback null (integration test P7).
- Foreign studentId → FORBIDDEN/empty (integration test P7).

## Risk Assessment
- Redaction regression leaking teacher marks pre-publish (Low likelihood, HIGH impact): mirror exact myLayer publish-gate; P7 integration test is mandatory gate.
- pdf-annotator.tsx ownership overlap with P5/P6 (Med/Med): sequence P2 annotator edit BEFORE P5 starts, or keep P2 change to a tiny isolated prop block; P5/P6 rebase on it. Assign single owner to serialize.
- Parent RLS does not permit base PDF ref (Low/Med): verify exercise RLS covers guardian-enrolled classes post-seam-fixes (Exercise went global — confirm `/files/exercise/:ref` visibility query still returns for parent). UNRESOLVED — see plan questions.

## Security Considerations
- Authorization is the core risk: studentId must be validated against `ctx.lms.studentIds` AND rely on RLS. Do not trust client studentId alone.
- Teacher correction layer is sensitive pre-publish — publish-gate is a hard invariant.

## Rollback
- Code-only revert. New procedure is additive; removing it + parent-view usage restores prior text-only view. No data change.

## Next steps
Depends on P1 (stable saved layers). Feeds P7 redaction + cross-guardian tests.
