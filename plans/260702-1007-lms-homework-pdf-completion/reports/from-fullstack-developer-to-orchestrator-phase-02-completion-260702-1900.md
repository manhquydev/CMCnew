# Phase 02 completion report — parent layer API + parent drawn-work view

## Files changed
- `apps/api/src/routers/submission.ts` — added `layerForGuardian` procedure (lmsProcedure, ~19 lines) right before `save`. No existing procedure touched.
- `apps/lms/src/parent-view.tsx` — added `DrawnWorkModal` component (read-only PdfAnnotator consumer), `Exercise` type alias, exercise fetch in `ChildDashboard.load()`, and a "Xem bài làm" button + modal wiring in the gradebook tab. No changes to `packages/ui/src/pdf-annotator.tsx`.
- `apps/api/test/submission-guardian-layer.int.test.ts` — new integration test (4 cases).

## Design notes
- `layerForGuardian` takes explicit `{ exerciseId, studentId }` (parent sessions can own multiple children, unlike `myLayer`'s `studentIds[0]`). Guards `studentId ∈ ctx.lms.studentIds` before even touching the DB, then scopes the read via `withRls(lmsRlsContextOf(ctx.lms))` — same double-guard pattern as `forStudent`.
- Teacher layer redaction mirrors `myLayer` exactly: `sub?.grade?.isPublished ? layer : null`.
- Parent-view fetches `exercise.listForPrincipal` (unchanged, pre-existing, scoped to `ctx.lms.studentIds` broadly) to resolve `basePdfRef`/title for the "Xem bài làm" button — avoided touching `forStudent`'s select shape, keeping file ownership boundaries clean. The `exercisesById` map only gates whether the button renders; `layerForGuardian`'s own ownership guard is the actual security boundary, so a stale/broad exercise list here has no security consequence.
- Reused `PdfAnnotator`'s existing `editable={false}` + `readOnlyLayers` props exactly as `student-view.tsx` does for a graded exercise — zero lines touched in `pdf-annotator.tsx`.

## Test command + result
```
cd apps/api && pnpm vitest run test/submission-guardian-layer.int.test.ts
```
Result: 4/4 passed.
- (a) guardian sees own child's student-layer strokes — PASS
- (b) pre-publish: teacher layer null despite an existing grade annotation layer — PASS
- (c) post-publish: teacher layer appears — PASS
- (d) `studentId` not among guardian's own children → FORBIDDEN — PASS

## Typecheck
```
pnpm --filter @cmc/api typecheck   → clean
pnpm --filter @cmc/lms typecheck   → clean
```

## Redaction invariant confirmation
Explicitly tested with real seeded data: a `Grade` row with a non-null `annotationLayer` exists from `beforeAll`, `isPublished: false`. Test (b) asserts `result.teacher` is `null` even though the DB row has real teacher marks — proves the redaction gate isn't a no-op (no grade = trivially null). Test (c) then flips `isPublished: true` and re-asserts the same layer now appears, confirming the gate is exactly the `isPublished` flag, not something else. Test (d) confirms a foreign guardian requesting another family's `studentId` gets `FORBIDDEN` from the explicit input guard (never falls through to RLS-empty-result, since the app-level check throws first).

Status: DONE
Summary: `submission.layerForGuardian` added with ownership guard + publish-gated redaction; parent-view wired to the existing PdfAnnotator read-only props; 4/4 new integration tests pass; both packages typecheck clean.
Concerns/Blockers: none.
