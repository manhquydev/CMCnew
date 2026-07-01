# QA Agent D — State & Side-effect Audit: Work Shift/Attendance + Session Evidence

Scope: packages/db/prisma/schema.prisma (new models), apps/api/src/routers/{check-in-out,shift-registration,shift-config,facility-ip,session-evidence}.ts, apps/api/src/services/photo-store.ts, apps/api/src/index.ts. Tested live against local sandbox DB (localhost:5433) + dev API (localhost:4000) with real seeded/created accounts. All raw evidence (requests, DB rows, log rows) below.

## Environment notes (read first)

- Local sandbox DB (`cmcnew-postgres-dev`, :5433) was empty of `app_user`/`employment_profile` rows at test start. `pnpm db:seed` reported "already exists — skipped" for staff accounts even though a direct `psql` `SELECT` returned 0 rows — root cause: all these tables have Postgres RLS policies keyed on `set_config('app.is_super_admin'/'app.facility_ids', ...)` (transaction-local GUCs set by `withRls()`); a raw psql session without those GUCs sees 0 rows. Not a bug — just requires `SELECT set_config(...)` before ad-hoc SQL. Documented here so the other 3 parallel agents don't waste time on the same false lead.
- `employment_profile` had **zero rows** for any seeded staff account (no seed script populates it — grepped `packages/db/src` for `EmploymentProfile`, no hits). Every `checkInOut.*` and `shiftRegistration.*` endpoint calls `employmentProfile.findUniqueOrThrow` first, so with the shipped seed data alone, **no staff member can punch in or register a shift** — the feature is untestable via UI until HR data-entry backfills `EmploymentProfile` for every staff user. I inserted two rows manually (`giaovien@cmc.local`, `headteacher@cmc.local`, facility 1) to unblock testing — this is sandbox-only, not a schema/code fix.
- The dev API on :4000 died mid-investigation (connection refused) — likely bounced by another parallel agent. Restarted it myself via `pnpm --filter @cmc/api start` with `STAFF_PASSWORD_LOGIN=true` (required — password login is fail-closed to `super_admin` only otherwise, per `apps/api/src/routers/auth.ts:30-36`). Flag an ownership/coordination risk to the user: 4 agents sharing one mutable dev DB + one dev server concurrently means state (like this) can shift under any agent mid-test.

---

## Critical

### C1. Two overlapping `ShiftRegistration`s can both reach `approved` — no DB constraint, TOCTOU in `approve()`

`packages/db/prisma/schema.prisma:1537-1569` — `ShiftRegistration` has no unique/exclusion constraint on `(userId, fromDate, toDate)` or overlap. The only defense is app-level, and it has two independent gaps:

1. `create()` (`apps/api/src/routers/shift-registration.ts:181-187`) only blocks a new registration if one exists with `status:'submitted'` — draft duplicates for the identical range are allowed outright.
2. `approve()` (lines 369-393) does `updateMany({status:'approved', ...} → cancelled)` to supersede *prior approved* regs, then updates itself — classic read-then-write race; if two submitted regs for the same range are approved concurrently, both `updateMany` calls run before either `update` commits, so **both land in `approved`**.

Reproduction (real API calls against seeded `giaovien@cmc.local`, facility 1):

```
POST shiftRegistration.create {fromDate:2026-07-06, toDate:2026-07-12} ×2 (fired in parallel)
 → SR draft e33efa06... created @ 03:19:35.009
 → SR draft cef41958... created @ 03:19:35.015   (6ms apart, both succeed)
updateEntry + submit on both → SR-2026-0014 (e33efa06) and SR-2026-0015 (cef41958), both status=submitted, both fromDate=toDate=2026-07-06..12
POST shiftRegistration.approve {id:e33efa06} and {id:cef41958} fired in parallel (as super_admin, both permission+manager checks pass)
```

Result — both requests returned `200` with `status:"approved"`:
```
SR-2026-0014: approvedAt 2026-07-01T03:21:47.914Z, status "approved"
SR-2026-0015: approvedAt 2026-07-01T03:21:47.916Z, status "approved"   (2ms apart)
```
Neither superseded the other (`supersededById: null` on both).

Downstream corruption confirmed via `shiftRegistration.registeredInMonth` (used for payroll/reporting "registered days" count) — query has no filter excluding duplicate/superseded regs:
```
GET registeredInMonth {userId, yearMonth:"2026-07"} → {"days":2}
```
Ground truth: the employee registered **one** day (2026-07-06) with **one** shift. The count is doubled because two approved registrations both contribute a `ShiftRegistrationEntry` row for the same date, and `registeredInMonth`'s `where` clause (`shift-registration.ts:156-163`) only filters by `registration.status:'approved'`, not de-duplicated by date/entry.

Impact: HIGH — this feeds payroll-adjacent "registered shift days" reporting. Given the compensation policy language elsewhere in this codebase ties pay to registered/worked days, a double-approved registration silently inflates that count.

Fix directions (pick one, don't guess business intent — flag to user):
- Add a partial unique index / exclusion constraint on `shift_registration (user_id, from_date, to_date) WHERE status IN ('submitted','approved')`, or
- Move the "one active submitted/approved reg per overlapping range" check inside a `SELECT ... FOR UPDATE` / serializable transaction in both `create()` and `approve()`, and
- De-dupe `registeredInMonth` by `DISTINCT date` per user rather than raw `count()`.

### C2. `TimePunch` has no debounce — a double-click/duplicate network retry silently becomes "checked in AND checked out" in milliseconds

`packages/db/prisma/schema.prisma:1591` — by design "mỗi lần bấm nút = 1 punch" (comment), earliest punch of the day = check-in, latest = check-out (`checkInOut.ts:151-153`). There is **no minimum-interval / idempotency-key guard** anywhere in `punch()` (`check-in-out.ts:79-134`) — every call unconditionally inserts a new `TimePunch` row.

Reproduction — two `checkInOut.punch` calls fired in parallel for `giaovien@cmc.local`:
```
punch #1 → id 28504b3e..., timestamp 2026-07-01T03:18:25.490Z
punch #2 → id 4f667070..., timestamp 2026-07-01T03:18:25.509Z   (19ms apart, both succeed, no error)
```
`checkInOut.todayStatus` right after:
```
{"status":"completed","checkIn":{"time":"...25.490Z"},"checkOut":{"time":"...25.509Z"}, "penalty":{...}}
```
The system now believes the employee completed a full shift in 19 milliseconds. Client-side there is a `busy`/`loading` guard on the button (`apps/admin/src/checkin-panel.tsx:21,56-64`, Mantine `loading` prop disables it), which stops a same-tab double-click, but nothing stops: a second browser tab, a mobile retry after a flaky network response, or any direct API caller. If the employee had an approved shift that day, this same bug would compute `earlyLeaveMinutes` off the accidental "check-out" and apply a real payroll penalty (`penalty = lateMin*500 + earlyMin*1000`, `check-in-out.ts:166-168`) for a shift the employee never actually left early from.

Fix direction: reject (or coalesce) a punch within N seconds (e.g. 60s) of the user's last punch — either at the DB layer (partial unique index on `(user_id, date_trunc('minute', timestamp))` is too coarse; better a serialized check in the mutation) or at minimum return the prior punch instead of creating a new one.

### C3. `SessionEvidencePhoto.photoRef` accepted without verifying the file exists on disk — orphan DB row, broken image after publish

`sessionEvidence.upsertDraft` input schema (`session-evidence.ts:20-23`) only regex-validates the ref shape (`^[a-f0-9]{64}$`); it never calls `sessionPhotoExists()` (exported from `photo-store.ts:61-68`) before writing the `SessionEvidencePhoto` row. Reproduction:

```
POST sessionEvidence.upsertDraft {classSessionId, photos:[{ref:"deadbeef...deadbeef" (64 hex, never uploaded)}], comments:[...]}
→ 200 OK, photo row created: id 03e3dc45..., photoRef "deadbeef...deadbeef"
$ ls apps/api/.data/session-photos | grep deadbeef  → (no match) — CONFIRMED no backing file
```
This ref would pass the `publish()` guard (`evidence.photos.length === 0` check only counts rows, not on-disk existence), get published to LMS, and a parent/student viewing it would hit `GET /files/session-photo/:ref` → `readSessionPhoto` throws `PhotoStoreError('photo not found')` → the route catches it and returns plain-text `404` (`index.ts:118-119`) — a broken image with no graceful fallback in a student/parent-facing view.

Fix direction: `upsertDraft` should call `sessionPhotoExists(ref)` for every new photo ref and reject with `BAD_REQUEST` if missing, inside the same transaction ordering used for photo replace.

## Not a bug (verified, evidence attached)

### N1. Photo upload rejects before any disk write — no orphan-file-on-failure path
`putSessionPhoto()` (`photo-store.ts:48-59`) calls `assertValidSessionPhoto(buf)` (throws on empty/oversized/bad-magic-bytes) **before** `mkdir`/`writeFile`; `index.ts:76-89` additionally short-circuits on `body.byteLength > MAX_SESSION_PHOTO_BYTES` before even calling the store fn. Tested both failure paths live:
```
9MB zero-filled body (limit 8MB) → HTTP 413 "file too large"
plain-text body (no image magic bytes) → HTTP 400 "not a supported image"
$ ls apps/api/.data/session-photos → only the 2 legitimately-uploaded refs present, no orphan from either failed upload
```
Content-addressing (sha256 of buffer) also means even a successful re-upload of the same bytes is naturally idempotent (`access()` check before `writeFile`, `photo-store.ts:53-56`) — no duplicate-write race for identical content.

### N2. `sessionEvidence.publish` — no duplicate LMS-facing row, but silent audit-log noise on re-publish
`SessionEvidence.classSessionId` is `@unique` (schema.prisma:370) and there is no separate "LMS publish" table — the LMS reads directly from this same row filtered by `status:'published'`. So calling `publish` twice cannot create a duplicate/second copy visible to a parent. Verified via 2 sequential `publish` calls on the same session:
```
call 1 → publishedAt 2026-07-01T03:24:59.255Z
call 2 → publishedAt 2026-07-01T03:25:00.470Z   (still 200 OK, same evidence id)
```
`record_event` audit rows for this entity (queried directly):
```
updated          | Lưu nháp bằng chứng buổi học        | 03:24:46.497
status_changed   | Publish ... | old:draft→new:published | 03:24:59.263
status_changed   | Publish ... | old:published→new:published | 03:25:00.479   ← nonsensical no-op transition logged
```
Low-severity: `publish()` has no guard against re-publishing an already-published record, so `publishedAt` silently advances on every call (could reorder a parent's "recent evidence" feed with no new content) and the audit trail records a misleading `published→published` transition. Recommend a guard: if `status === 'published'` already, either no-op without re-logging, or explicitly reject.

### N3. `facility_network` double-registration is DB-constrained correctly
`@@unique([facilityId, ipAddress])` exists at the DB level (schema.prisma:1622) — a race on `facilityNetwork.create` for the same `(facilityId, ipAddress)` would hit Postgres unique-violation (P2002), not silently duplicate. (Not load-tested concurrently since the constraint is unconditional at the DB layer; code-reviewed only.) Minor: the P2002 isn't caught into a friendly `TRPCError`, so a concurrent duplicate-add surfaces as a raw 500 rather than a clean "already exists" message — cosmetic, not a data-integrity issue.

## Low

### L1. Raw Prisma errors leak as 500s instead of friendly TRPCErrors
`checkInOut.punch` (`employmentProfile.findUniqueOrThrow`), `facilityNetwork.delete`/create (P2002 on unique violation) and others don't wrap not-found/conflict Prisma errors into `TRPCError`. Given `employment_profile` is provably empty for all seed accounts (see Environment notes), every staff member hitting "Chấm công" today gets an unhandled 500, not a clear "chưa có hồ sơ nhân sự" message. Low severity because it's a UX/observability gap, not data corruption, but worth fixing alongside seed-data backfill.

## Audit trail (task item 5) — confirmed present and adequate for mutations

Every mutation in the audited routers (`punch`, `approveManual`, `shiftRegistration.{create,submit,approve,reject,withdraw}`, `sessionEvidence.{upsertDraft,publish}`, `facilityNetwork.{create,delete}`) calls `logEvent(tx, {facilityId, entityType, entityId, type, body, actorId, changes?})` inside the same transaction as the write (confirmed via `record_event` query above showing `actor_id`, `created_at`, and a human-readable `body` for every action). `apps/api/src/index.ts` / `routers/index.ts` diffs (`git diff HEAD`) are purely additive (new route registrations for session-photo upload/serve) — no change to a global request-logging layer, so read-only queries remain unlogged, which is consistent with the rest of the codebase's convention (mutations only). No gap found here beyond the C1/C2/C3 items above (which are data-integrity gaps, not logging gaps — the actions that caused them WERE logged correctly, they just shouldn't have been allowed to happen twice).

## Unresolved questions

1. Is `registeredInMonth`'s double-count (C1) actually consumed by a payroll calculation today, or is it purely informational in the current UI? Affects whether C1 is "will silently overpay" vs "will show a wrong number on a screen." Recommend checking `packages/db` payslip/compensation code for a caller.
2. Was `employment_profile` intentionally left unseeded (feature shipped ahead of an HR data-entry step), or is this an oversight that should block this feature going to any shared/staging environment? Recommend confirming with whoever owns the HR onboarding flow before merge.
3. Should `punch()` get a server-side minimum interval (C2), or is a client-only debounce considered acceptable given the punch UI is the only sanctioned entry point? If mobile apps or kiosks call this directly, server-side protection is necessary.

Status: DONE_WITH_CONCERNS
Summary: Confirmed 3 critical/high data-integrity bugs with live repro (overlapping approved shift registrations double-counting registered days; punch has no debounce so a double-click completes a shift in milliseconds; session-evidence photo refs aren't verified to exist on disk before being published). Photo-upload atomicity and republish-idempotency were verified NOT broken (evidence included). Audit logging is present and adequate for all mutations tested.
Concerns: environment currently has 2 duplicate approved ShiftRegistrations + 2 test SessionEvidence drafts (1 published) left in the sandbox DB from this test run (ids in report above) — safe to leave (sandbox) but flagging so other 3 parallel agents don't mistake them for pre-existing seed data. `employment_profile` was empty at test start; I manually inserted 2 rows to unblock testing — real seed script still doesn't populate this table.
