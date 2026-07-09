# Audit — Attendance / Grading / Evidence latent bugs

Report-only. No source modified. Scope: `apps/api/src/routers/attendance.ts`,
`apps/api/src/lib/attendance-window.ts`, `apps/api/src/routers/session-evidence.ts`,
`apps/admin/src/teacher-schedule-session-detail.tsx`, `apps/api/src/lib/teaching-authz.ts`
(+ read for context: `apps/api/src/lib/exercise-open.ts`, `apps/api/src/services/photo-store.ts`,
`apps/api/src/index.ts` photo route, `apps/lms/src/session-evidence-tab.tsx`, `schema.prisma`).

Date: 2026-07-09. Branch: develop.

---

## F1 — HIGH — Teacher internal note leaked to parent/student LMS

**File:** `apps/api/src/routers/session-evidence.ts:275-301` (`listForPrincipal`),
`:311-337` (`detailForPrincipal`).

Both LMS (parent/student) queries fetch the evidence with a **top-level Prisma `include`
and no `select`**:

```ts
const rows = await tx.sessionEvidence.findMany({
  where: { status: 'published', ... },
  include: { photos: {...}, comments: {...}, classSession: {...} },
});
return rows;
```

With `include` (not `select`) at the top level, Prisma returns **every scalar column of
`SessionEvidence`**, including `internalNote` (`schema.prisma:432`, `@map("internal_note")`).
`internalNote` is the teacher's private "Ghi chú nội bộ" field (admin Tab 4, `teacher-schedule-session-detail.tsx:645-651`), explicitly separate from the public `summary`. It is meant to never reach the LMS.

**Failure / repro:**
1. Teacher writes an internal note ("HS hay mất tập trung, gia đình đang ly hôn…"), then publishes.
2. Parent opens the LMS session-evidence view → `sessionEvidence.listForPrincipal` /
   `detailForPrincipal` runs.
3. The JSON response over the wire contains `internalNote`. `apps/lms/src/session-evidence-tab.tsx`
   does not render it, but it is fully present in the network payload (DevTools / any API client).

**Why it matters:** privacy breach — internal teacher/administrative notes about a child (and
potentially other children) are exposed to the family. This is an audit/privacy hard-gate concern.

**Fix direction:** replace the top-level `include` with an explicit `select` that omits
`internalNote` (and `createdById`/`facilityId` etc. as needed) in both principal queries.

---

## F2 — HIGH — Any draft save silently un-publishes evidence; UI then shows it as still published

**File:** `apps/api/src/routers/session-evidence.ts:167-173` (`upsertDraft` update branch) +
`apps/admin/src/teacher-schedule-session-detail.tsx:200-228, 468-470, 516-543`.

`upsertDraft`'s `update` unconditionally forces:

```ts
update: { summary, internalNote, status: 'draft', publishedAt: null, publishedById: null }
```

So **editing a draft always reverts a `published` evidence back to `draft`** and nulls
`publishedAt`. The admin UI does **not** block editing after publish for the evidence fields:
- Summary textarea `disabled={!draftLoaded || !enabled}` (line 469) — not gated on published.
- Photo add/remove gated only on `enabled` (session not cancelled), lines 516-543.

**Failure / repro:**
1. Teacher publishes evidence → `setEvidencePublished(true)`; LMS shows it (query filters
   `status: 'published'`).
2. Teacher re-opens the session, tweaks the summary or reorders/removes a photo → debounced
   `upsertDraft` fires → server sets `status='draft'`, `publishedAt=null`.
3. `listForPrincipal`/`detailForPrincipal` filter on `status='published'` → **the evidence
   vanishes from the parent's LMS** with no notice.
4. The admin never calls `setEvidencePublished(false)` after `upsertDraft`, so Tab 4 still shows
   "✓ Đã đăng" and hides the re-publish button (`!evidencePublished` is false, line 661). The
   teacher believes it is still live and has no UI path to re-publish.

**Why it matters:** published parent-facing content silently disappears; teacher UI lies about
state; requires a hard reload + noticing the badge to recover. Data-visibility regression.

**Fix direction:** either (a) block `upsertDraft` when `status='published'` (require an explicit
"unpublish to edit"), or (b) preserve published status on edit, or (c) at minimum return the new
status from `upsertDraft` and sync `evidencePublished` client-side. Decide product intent first.

---

## F3 — HIGH — Orphaned, invisible student comment permanently blocks every draft save

**File:** `apps/api/src/routers/session-evidence.ts:139-148` (comment lock) +
`apps/admin/src/teacher-schedule-session-detail.tsx:54-64` (`commentsToArray`),
`:150-166` (draft load), `:475-483` (render filter).

The server comment lock rejects the **entire** `upsertDraft` if any comment targets a student
not currently `present`/`late`:

```ts
for (const c of input.comments) {
  if (!attended.has(c.studentId)) throw BAD_REQUEST('Nhận xét chỉ áp dụng cho học sinh có mặt/đi muộn…');
}
```

But nothing removes a comment when a student's attendance later changes to `absent`. The admin
client:
- keeps the comment in `draft.comments[studentId]` (attendance changes via `markSingle` never
  touch `draft.comments`),
- sends it every save because `commentsToArray` filters only on "has any field set", not on
  attendance (lines 54-64),
- **renders comment inputs only for present/late students** (`attended` filter, line 476-479),
  so the orphaned comment is invisible and cannot be cleared from the UI,
- reloads the same orphaned comment from the server on every mount (draft-load loop lines 150-158
  iterates all stored comments regardless of attendance).

**Failure / repro:**
1. Mark student S present. Write a comment for S (saved OK).
2. Correct the mark: set S to absent.
3. Edit anything else (summary, another student's comment, a photo). Debounced `upsertDraft` now
   includes S's comment → server throws BAD_REQUEST → **the whole save fails**; summary/photos/all
   other comments cannot be saved.
4. S is not in the present/late list, so the UI shows no input to delete S's comment. Teacher is
   stuck and gets only "Lưu thất bại".

**Why it matters:** a single mis-click correction bricks all further saving of that session's
evidence, with no in-UI recovery. Recovery only by re-marking S present, clearing the comment, and
re-saving — non-obvious.

**Fix direction:** on the client, drop comments for non-attended students before sending (mirror
the render filter), and/or on the server drop (rather than reject) comments for non-attended
students, or scope the rejection to only newly-changed comments.

---

## F4 — MEDIUM — Attendance window also gates directors/super_admin; no path to correct attendance after the ICT day ends

**File:** `apps/api/src/lib/attendance-window.ts:34-56` + `attendance.ts:78, 160`.

`assertAttendanceWindowOpen` is called for **all** callers of `mark`/`markAll` with no role
bypass. The window closes at `17:00 UTC` of `sessionDate` = 24:00 ICT of the session's own ICT
day (`attendance-window.ts:36-41`).

**Failure / repro:** An evening class (e.g. 20:00–22:00 ICT). Teacher forgets to mark, remembers at
00:30 ICT the next day → window closed → cannot mark. A director/super_admin trying to correct the
roster the next morning is **also** blocked (same gate, no override). Attendance feeds
`computeFinalGrade`, so a wrong/empty roster becomes uncorrectable through the normal API.

**Why it matters:** operational dead-end — there is no privileged correction route. For a field
that drives grades, "you missed the midnight cutoff, it's permanently wrong" is risky.

**Note:** the "đến hết ngày" cutoff itself is a stated decision; the defect is that it applies
uniformly with no admin/director escape hatch. Confirm intended before changing (User-Decision rule).

---

## F5 — MEDIUM — `attendance.listBySession` has no permission / teaching-authz scoping

**File:** `apps/api/src/routers/attendance.ts:25-31`.

```ts
listBySession: protectedProcedure
  .input(z.object({ classSessionId: z.string().uuid() }))
  .query(({ ctx, input }) => withRls(rlsContextOf(ctx.session), (tx) =>
    tx.attendance.findMany({ where: { classSessionId: input.classSessionId } })));
```

No `requirePermission`, no `assertTeachingSessionMutationAllowed`, no `teacherId` filter. Any
authenticated same-tenant user (including a `giao_vien`) can read the attendance rows of **any**
session in their facility, including sessions taught by other teachers.

This directly contradicts the deliberate scoping on the sibling `report` endpoint
(`attendance.ts:218-239`), whose comment states teachers must see only sessions they personally
taught ("KHÔNG kế thừa ngầm định phạm vi"). `listBySession` is the easy bypass of that rule.

**Why it matters:** read-only cross-teacher visibility that the code elsewhere explicitly tries to
prevent; inconsistent authorization surface. (Prior memory notes teachers already see facility-wide
student PII as an accepted trade-off, so this may be judged acceptable — but it is inconsistent with
the report endpoint's stated intent and worth an explicit decision.)

---

## F6 — LOW/MEDIUM — Client attendance-window mirror uses local browser time, diverges from server ICT

**File:** `apps/admin/src/teacher-schedule-session-detail.tsx:14-25`.

```ts
const opensAt = dayjs(`${day}T${startTime}`).subtract(15, 'minute'); // parsed in LOCAL tz
const closesAt = dayjs(day).endOf('day');                            // LOCAL end-of-day
```

The server computes the window in fixed ICT via `Date.UTC(...) − 7h` (`attendance-window.ts`).
The client relies on the browser actually being in ICT (comment acknowledges this). If a teacher's
machine is set to another timezone (travel, laptop clock, or any non-ICT locale), the "Có mặt tất
cả" button and per-row buttons enable/disable on the wrong boundary — either offering marking the
server will reject, or disabling marking the server would accept.

**Why it matters:** convenience-only divergence (server still enforces), but produces confusing
"button is enabled yet save fails" / "button greyed out during class" UX for off-ICT clients.

---

## F7 — LOW — Malformed `startTime` throws a plain `Error` (500), not `BAD_REQUEST`

**File:** `apps/api/src/lib/attendance-window.ts:11-17` (`sessionStartUtc`).

On an invalid stored `startTime`, it throws `new Error(...)` (not `TRPCError`), so
`mark`/`markAll` surface a 500 INTERNAL_SERVER_ERROR instead of a clean 4xx. Low likelihood
(times are usually validated on write) but a data-quality issue would hard-500 attendance.

---

## F8 — LOW — `markAll`/`mark` leave a stale `note` when status changes without an override

**File:** `apps/api/src/routers/attendance.ts:98-104, 191`.

In the `update` branch, `note` is passed as `undefined` when there is no override
(`markAll`) or no note (`mark`). Prisma treats `undefined` as "leave unchanged", so a previously
stored note (e.g. "vắng — kẹt xe") persists after the student is flipped to `present` via
"Có mặt tất cả". Minor data hygiene: note no longer matches the status. (The `create` branch
correctly writes null.)

---

## Non-issues verified (documented so they are not re-investigated)

- **Window ICT math for early-morning / late-evening start times** (`attendance-window.ts`): server
  uses absolute-instant `Date.UTC(...)` and `now.getTime()`, so server timezone is irrelevant and
  hour-underflow (e.g. 06:00 ICT → negative UTC hour) normalizes correctly. Window correctly spans
  the session. No boundary bug found server-side.
- **`mark` (enrollment,session) batch cross-check + facility derived server-side** (`attendance.ts:66-89`):
  correct; prevents cross-tenant / cross-class writes.
- **`markAll` enrollment set** (`attendance.ts:165-173`): excludes withdrawn/transferred and blocked
  lifecycle; matches single `mark`. Includes `reserved`/`completed` intentionally (trial + final
  session). Consistent.
- **Publish comment gate** (`session-evidence.ts:139-148, 244-246`): published comments are limited
  to present/late students, so per-student comments do not leak absent-student data (aside from F3's
  side effect). `detailForPrincipal`/`listForPrincipal` further filter `comments` by the requesting
  parent's own `studentId`s — no cross-child comment leak.
- **Photo file route** (`apps/api/src/index.ts:123-138`): LMS access requires the ref to belong to a
  `published`, non-archived `sessionEvidencePhoto` under RLS; refs are sha256 (non-enumerable). Minor
  theoretical note: content-addressed storage means an identical image reused across batches shares
  one ref/file, but visibility is still gated by an existing published link + RLS — not a practical leak.
- **Photo dead-ref handling** (`session-evidence.ts:149-155`): drops non-existent refs instead of
  blocking the save; client re-syncs via `droppedPhotoCount`. Correct.

---

## Unresolved questions

1. F4: is the "no director/super_admin override after the ICT-day cutoff" intended, or should
   privileged roles bypass `assertAttendanceWindowOpen`? (User-decision — do not change silently.)
2. F5: is cross-teacher read of `listBySession` acceptable given teachers already see facility-wide
   PII, or should it match the `report` endpoint's teacher scoping?
3. F2: on editing a published evidence, is the intended behavior auto-unpublish, block-until-unpublish,
   or preserve-published? Needs product intent before a fix.

Status: DONE
Findings by severity: HIGH 3 (F1, F2, F3), MEDIUM 2 (F4, F5), LOW/MEDIUM 1 (F6), LOW 2 (F7, F8). Total 8.
