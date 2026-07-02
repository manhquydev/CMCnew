# QA Agent A — Static & Security Scan: Work Shift & Attendance / Session Evidence

Scope: apps/api/src/routers/{check-in-out,facility-ip,shift-config,shift-registration,session-evidence}.ts,
apps/api/src/services/photo-store.ts, packages/auth/src/permissions.ts, packages/db/prisma/schema.prisma,
apps/admin/src/{checkin-panel,facility-network-panel,shift-config-panel,shift-reg-detail-panel,shift-reg-list-panel,session-evidence-panel}.tsx,
App.tsx, nav-permissions.ts.

## Verification commands run

- `pnpm --filter @cmc/api exec tsc --noEmit` → exit 0, no errors.
- `pnpm --filter @cmc/admin exec tsc --noEmit` → exit 0, no errors.
- `pnpm exec eslint <backend files>` → 0 errors, 1 warning (`no-explicit-any` in shift-registration.ts:19).
- `pnpm exec eslint <frontend files>` → 0 errors, 21 warnings (all `no-explicit-any`, checkin-panel.tsx and shift-reg-detail-panel.tsx).
- `pnpm --filter @cmc/api exec vitest run test/permission-parity.test.ts` → 25/25 passed.
- `pnpm audit --prod` skipped: no new dependency was added for this feature (checked `git diff apps/api/package.json` — only a duplicate `test:integration` script alias was added, no new packages). Upload path uses only Node builtins (`node:crypto`, `node:fs`).

## Critical

None found.

## High

### H1 — `facilityNetwork.create` accepts unvalidated CIDR strings, including ranges that disable IP enforcement facility-wide
**File:** `apps/api/src/routers/facility-ip.ts:19-24` (input schema `ipAddress: z.string().min(1)`)
**Evidence:** `ipMatchesCidr` in `check-in-out.ts:10-17` was executed against `0.0.0.0/0`:
```
$ node -e "... ipMatchesCidr('8.8.8.8','0.0.0.0/0') ..."
0.0.0.0/0 matches 8.8.8.8: true
```
No format/CIDR validation exists anywhere in the create mutation — any string passes `z.string().min(1)`, including `0.0.0.0/0`, malformed octets (e.g. `999.999.999.999/24`), or plain garbage. Malformed input degrades silently (`Number('garbage')` → `NaN`, `NaN >>> 0` → `0`), which does not throw, so wrong entries fail closed/open unpredictably instead of erroring at creation.

**Failure scenario:** `facilityNetwork.create` is gated to `super_admin`/`quan_ly` (verified in `permissions.ts:280-284`), so this is not an anonymous-attacker vector — but a single misconfigured or malicious insider entry (e.g. a manager fat-fingering `0.0.0.0/0` or copy-pasting a public IP range with `/0`) silently defeats the entire IP-verification feature for that facility. In `check-in-out.ts:90-119`, `ipAllowed` gates whether a punch is auto-accepted (`method: 'ip'`) or routed to a manager-approval queue (`method: 'manual'`, notifies manager). With an overly-broad range, every remote punch is misclassified as verified-on-premises and the manual-approval fraud check (the actual control this feature exists to provide) never triggers, for every employee at that facility, with no error or warning surfaced anywhere.

**Fix:** Validate `ipAddress` server-side with strict CIDR parsing (reject prefix `< /8` or similar sane floor per business rule; reject malformed octets) before insert, e.g. a zod `.refine()` or a small `parseCidr()` helper that throws `BAD_REQUEST` on invalid/overbroad ranges. Same validation belongs on `update` if one is later added.

## Medium

### M1 — `/upload/session-photo` has no role/permission check, only "any authenticated staff session"
**File:** `apps/api/src/index.ts:76-89`
**Evidence:**
```ts
app.post('/upload/session-photo', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const session = token ? await resolveSession(token) : null;
  if (!session) return c.text('unauthorized', 401);
  ...
```
There is no `requirePermission('sessionEvidence', 'upsertDraft')`-equivalent check — any staff account regardless of role (sale, cskh, etc., not just `giao_vien`/`head_teacher`) can POST arbitrary image bytes and get a content-addressed ref written to disk. Impact is bounded (content-addressed dedup, MIME/magic-byte validated, 8 MB cap, ref alone is useless without linking it via `upsertDraft` which *is* permission-gated per `permissions.ts:69-75`), so this is a storage-abuse/DoS-via-quota vector rather than a data-exposure one, but it is inconsistent with the router-level permission model used everywhere else in this feature set.
**Fix:** Gate the upload route with the same role check as `sessionEvidence.upsertDraft`, or at minimum only accept uploads from users holding that permission.

### M2 — `session_evidence` RLS scopes by facility only, not by teacher/class assignment
**File:** `packages/db/prisma/migrations/20260701010000_session_evidence/migration.sql:81-89`; consumed by `apps/api/src/routers/session-evidence.ts` (`detailForStaff`, `upsertDraft`, `publish`)
**Evidence:** RLS policy: `app_principal_kind() = 'staff' AND facility_id = ANY (app_facility_ids())` — no `teacher_id` predicate. Combined with the permission registry (`sessionEvidence.upsertDraft`/`publish` open to any `giao_vien`/`head_teacher` in the facility, `permissions.ts:69-79`), any teacher at a facility can view, edit the draft, and publish evidence for a class session they are not assigned to teach.
**Note:** This matches the facility-wide teacher-access pattern already accepted for this codebase (recorded in project memory `rbac-teacher-access-decisions`: "teacher sees facility-wide student PII/financials — accepted"). Flagging for visibility only, not blocking, since it is consistent with an existing accepted decision rather than a new regression. If that decision predates this feature, confirm it was meant to extend to session-evidence photo/comment content (student names, participation ratings) as well.

## Low

### L1 — `no-explicit-any` lint warnings (non-blocking, 0 errors)
- `apps/api/src/routers/shift-registration.ts:19` — `tx: any` in `resolveManager`.
- `apps/admin/src/checkin-panel.tsx` (13 occurrences) and `apps/admin/src/shift-reg-detail-panel.tsx` (8 occurrences).
None fail the lint gate (warnings only), but they weaken type safety on transaction-shaped parameters that could otherwise be typed via Prisma's `Prisma.TransactionClient`.

### L2 — Duplicate npm script
`apps/api/package.json` diff adds `test:integration` as an exact duplicate of the existing `test:int` script. Minor DRY violation, not a defect.

## Areas verified clean (no finding)

- **check-in-out.ts**: `ctx.ip` is derived server-side from `x-real-ip` (nginx-set, unforgeable) with a documented, correct fallback to the last XFF hop (`context.ts:21-27`) — client cannot claim an arbitrary "on-WiFi" flag; verification is fully server-side against `FacilityNetwork` rows, not a client-supplied boolean.
- **check-in-out.ts approval/history**: `assertCanApprovePunch`/`canViewStaffPunch` correctly prevent self-approval and restrict cross-user visibility to direct manager or HR/super_admin.
- **shift-config.ts**: all mutating actions (`create`, `createTemplate`, `update`, `archive`) use `superAdminProcedure`, matching the permission registry's `super_admin`-only gate; `list` is read-only and broader.
- **shift-registration.ts**: ownership checks on `updateEntry`/`submit`/`withdraw` (`reg.userId !== ctx.session.userId`) and approver checks (`assertAssignedApprover`, blocks self-approval) are present and correct; `$queryRawUnsafe` in `submit` uses parameterized placeholders ($1/$2), not string interpolation — no SQL injection.
- **photo-store.ts**: filenames are content-addressed SHA-256 hex refs validated by regex (`PHOTO_REF_PATTERN`) before any filesystem path join — no path traversal possible; magic-byte detection (not just client-supplied MIME) for jpeg/png/webp; 8 MB size cap enforced both at buffer-check and at the Hono route layer.
- **facility-ip.ts / facility-network read+delete**: role-gated to `super_admin`/`quan_ly` per registry; RLS additionally scopes by facility.
- **/files/session-photo/:ref**: authorization (RLS-backed visibility check) happens before existence-on-disk check, preventing ref-enumeration oracle; correctly branches published-only visibility for LMS principals vs. facility-wide for staff.
- **permission-parity test**: passes (25/25), confirms UI/nav-permission declarations match backend registry for these new modules.

## Recommended Actions (priority order)

1. Add server-side CIDR/format validation to `facilityNetwork.create` (H1) — reject `/0`-`/7`-ish overbroad ranges and malformed octets.
2. Add a permission check to `/upload/session-photo` matching `sessionEvidence.upsertDraft` (M1).
3. Confirm with product whether the facility-wide (non-teacher-scoped) RLS on `session_evidence` is an intentional extension of the existing accepted RBAC decision (M2) — no code change recommended without that confirmation.
4. Optional cleanup: type the `tx` params instead of `any` in `shift-registration.ts`; remove the duplicate `test:integration` script or make `test:int` an alias of it, not vice versa.

## Unresolved Questions

- Was the RBAC decision "teacher sees facility-wide data" (recorded in prior project memory) explicitly reviewed for session-evidence content specifically, or only for student/financial records in other modules?
- Is `0.0.0.0/0` or similarly broad CIDR ever a legitimate configuration for this product (e.g., a facility intentionally disabling IP verification)? If yes, H1's fix should be a documented allow-with-warning rather than a hard reject.

Status: DONE_WITH_CONCERNS
Summary: Typecheck/lint/permission-parity all pass clean; found one High (missing CIDR validation lets an insider silently disable facility IP-attendance verification) and two Medium findings (unscoped photo-upload endpoint; facility-wide, non-teacher-scoped session-evidence RLS consistent with a prior accepted decision).
Concerns: H1 should be fixed before this ships since it undermines the core anti-fraud purpose of the IP allow-list feature; M1/M2 are lower urgency but worth a decision.
