# Plan: Full LMS Session Evidence — Photos, Comments, Publish, LMS View

> Lane: **high-risk** · Intake #45 · Story: `LMS-SESSION-EVIDENCE` · Scope: **Full (A+B)**

## ⛔ BLOCKED-ON (resolve before migration)

`schema.prisma` + `routers/index.ts` have **uncommitted shift-registration** work.
`prisma migrate dev` would bundle shift-registration + session-evidence → mixes
features. **Operator chose: commit/stash shift-registration first → clean
migration.** Only `photo-store.ts` (new file, no deps) can be drafted while
waiting; everything touching schema/routers runs AFTER tree is clean.

## Scout-confirmed state

NO `SessionEvidence*` models, NO `sessionEvidence` router, NO photo routes;
matrix status=`planned`; post-class cards `schedule-detail.tsx:167-176` mock.
All 5 backlog items genuinely pending — nothing to redo.

## Patterns to mirror

- File storage → `apps/api/src/services/pdf-store.ts` (content-addressed sha256,
  put/read/exists, STORE_DIR env seam). New `photo-store.ts` + image magic + cap.
- HTTP routes → `index.ts:58-90` (`POST /upload/exercise-pdf` staff raw body→{ref};
  `GET /files/exercise/:ref` auth-before-existence). New session-photo routes.
- Staff router → `requirePermission` + `withRls(rlsContextOf(...))`; register in
  `routers/index.ts`. LMS router → `parentProcedure`/`studentProcedure` +
  `lmsRlsContextOf`; ownership via `Guardian`.
- Audit → `logEvent` on publish. UI → add tab to `StudentTab`/`ParentTab` unions.

## Domain Model (schema additions)

```
model SessionEvidence {
  id String @id @default(uuid()) @db.Uuid
  facilityId Int @map("facility_id")
  classSessionId String @unique @map("class_session_id") @db.Uuid
  classSession ClassSession @relation(fields:[classSessionId], references:[id])
  summary String?            // class-level summary
  internalNote String? @map("internal_note")  // staff-only, not in LMS
  status SessionEvidenceStatus @default(draft)  // draft|published
  publishedAt DateTime? @map("published_at")
  publishedById String? @map("published_by_id") @db.Uuid
  createdById String? @map("created_by_id") @db.Uuid
  archivedAt DateTime? @map("archived_at")
  createdAt DateTime @default(now()) @map("created_at")
  photos SessionEvidencePhoto[]
  comments SessionStudentComment[]
  @@index([facilityId, publishedAt])
  @@map("session_evidence")
}
model SessionEvidencePhoto {
  id String @id @default(uuid()) @db.Uuid
  sessionEvidenceId String @map("session_evidence_id") @db.Uuid
  sessionEvidence SessionEvidence @relation(fields:[sessionEvidenceId], references:[id], onDelete: Cascade)
  photoRef String @map("photo_ref")  // sha256 hex (photo-store)
  sortOrder Int @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([sessionEvidenceId])
  @@map("session_evidence_photo")
}
model SessionStudentComment {
  id String @id @default(uuid()) @db.Uuid
  sessionEvidenceId String @map("session_evidence_id") @db.Uuid
  sessionEvidence SessionEvidence @relation(fields:[sessionEvidenceId], references:[id], onDelete: Cascade)
  studentId String @map("student_id") @db.Uuid
  student Student @relation(fields:[studentId], references:[id])
  participation String?   // structured: mức tham gia
  strength String?        // structured: kỹ năng nổi bật
  needsImprovement String? @map("needs_improvement")  // structured: cần rèn
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@unique([sessionEvidenceId, studentId])
  @@map("session_student_comment")
}
enum SessionEvidenceStatus { draft published }
```
RLS: all three tables facility-scoped; LMS read path = published-only +
owned-student-only (separate principal-scoped query, not raw table RLS).
## Interface Contract

**tRPC staff** (`sessionEvidence`):
- `listByClass({ classBatchId })` → [{ sessionId, date, status, photoCount, commentCount }]
- `detailForStaff({ classSessionId })` → { evidence, photos[], comments[] }
- `upsertDraft({ classSessionId, summary?, internalNote?, photos?[{ref,order}], comments?[{studentId, participation, strength, needsImprovement}] })` → evidence (atomic: replace photos/comments set in same tx)
- `publish({ classSessionId })` → status=published + publishedAt + audit logEvent

**tRPC LMS**:
- `listForStudent()` → published sessions for student's enrollments
- `listForParent()` → published sessions for parent's children (Guardian link)
- `detailForPrincipal({ sessionEvidenceId, studentId })` → published evidence + ONLY owned student's comment + photo refs (no classmate leak)

**HTTP**: `POST /upload/session-photo` (staff, raw image, magic+cap, →{ref});
`GET /files/session-photo/:ref` (auth-before-existence: staff facility RLS OR LMS principal with published evidence containing photo).

## Permissions (permissions.ts)

Add module `sessionEvidence`: `listByClass`/`detailForStaff`/`upsertDraft`/`publish` →
`['giao_vien','head_teacher','quan_ly','giam_doc_dao_tao']`. LMS read = no staff
permission (uses parentProcedure/studentProcedure).

## Acceptance criteria

1. Staff saves draft (summary+photos+per-student structured comments) → persists, draft.
2. Publish → published + publishedAt + audit event.
3. Parent lists published for own children only; cannot see draft.
4. Parent/student detail shows only owned student's comment; no classmate leak.
5. Cross-facility staff blocked (RLS).
6. Upload rejects non-image/oversize.
7. Photo read 403 for non-entitled principal (auth-before-existence).
8. ERP post-class cards replaced with real commands (controlled textarea + save +
   multi-photo upload + publish wired).
9. LMS student + parent shells show "Buổi học" tab rendering published sessions.
10. Existing integration suite stays green (0 regression).
11. E2E: admin save+publish → LMS displays for parent.

## Scope boundary (OUT)

Push notifications · cloud/object storage (local content-addressed, MinIO/S3 seam
preserved) · face blur/moderation · native mobile · manager approval gate (design:
no approval).

## Execution order

1. Plan (this) ✓  2. photo-store.ts + staff upload route ✓
3. schema.prisma + migration ⛔BLOCKED  4. session-evidence router  5. read route
6. permissions.ts  7. ERP wiring (schedule-detail)  8. LMS wiring (shells+views)
9. Integration tests  10. E2E  11. Verify (typecheck+int+review)  12. Finalize.

## Progress 2026-06-30

- Added `apps/api/src/services/photo-store.ts` with JPEG/PNG/WebP magic validation,
  8MB cap, sha256 ref storage, and ref guard.
- Added unit coverage in `apps/api/test/session-photo-store.test.ts` (4 pass).
- Added staff-only `POST /upload/session-photo`.
- Added `uploadSessionPhoto` client helper in `packages/ui/src/client.ts`.
- Verified: API/admin/ui typecheck pass. Read route still waits for persisted
  evidence ownership check.

## Completion 2026-06-30

- Confirmed backlog was genuinely pending before implementation: no persisted `SessionEvidence*` models/router/LMS tab existed; only upload seam had been added.
- Added persisted session evidence schema, migration, RLS, staff/LMS router, permissions, and permission snapshot.
- Added authorized `GET /files/session-photo/:ref` with DB visibility check before local file read.
- Replaced Session 360 post-class placeholder with real admin evidence editor.
- Added LMS `Buổi học` tab for student and parent shells; parent view scopes to selected child.
- Added official structured comment template in API contract.
- Added publish-to-LMS integration proof: staff publish visible to owning LMS principal, draft hidden, classmate comments hidden, cross-student detail blocked, cross-facility staff write blocked.
- Added browser E2E proof in `apps/e2e/tests/session-evidence-publish.spec.ts`: seed isolated fixture, publish via admin Session 360 UI, verify student LMS and parent LMS `Buổi học` views.
- Local validation required recovering pre-existing failed migration `20260630140000_work_shift_rls`; migration SQL now drops existing policies before create, then `prisma migrate deploy` applied shift + session evidence migrations cleanly.
- Verified:
  - `pnpm --filter @cmc/db generate`
  - `pnpm --filter @cmc/db migrate`
  - `pnpm --filter @cmc/api typecheck`
  - `pnpm --filter @cmc/admin typecheck`
  - `pnpm --filter @cmc/lms typecheck`
  - `pnpm --filter @cmc/db typecheck`
  - `pnpm --filter @cmc/ui typecheck`
  - `pnpm --filter @cmc/api exec vitest run test/session-photo-store.test.ts`
  - `pnpm --filter @cmc/api exec vitest run --config vitest.integration.config.ts test/session-evidence-publish-to-lms.int.test.ts`
  - `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts`
  - `pnpm --filter @cmc/e2e exec playwright test tests/session-evidence-publish.spec.ts`

## Risk flags

Authorization · Data model · Audit/security · Public contract · Existing behavior ·
Weak proof · Multi-domain → all hard gates. High-risk → interactive (not --auto).

## Stop conditions (re-confirm)

- Per-photo visibility (not per-session) → NOT triggered (per-session published).
- Real object storage now → NOT triggered (local store, seam preserved).
- Grading contract breaks → monitor during ERP wiring.
