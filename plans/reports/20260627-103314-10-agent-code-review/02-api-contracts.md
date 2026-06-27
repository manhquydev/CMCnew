# 02 API Contracts

Status: DONE_WITH_CONCERNS

## Scope Reviewed

- `apps/api/src/index.ts`
- `apps/api/src/trpc.ts`
- `apps/api/src/context.ts`
- `apps/api/src/routers/**`
- Contract/security tests under `apps/api/test/**`

## Findings

### High: Student detail is over-broad for authenticated staff

Evidence:

- `apps/api/src/routers/student.ts:11`
- `apps/api/src/routers/student.ts:20`
- guardian PII at `apps/api/src/routers/student.ts:29`
- receipts at `apps/api/src/routers/student.ts:59`
- grades at `apps/api/src/routers/student.ts:76`
- LMS login metadata at `apps/api/src/routers/student.ts:89`

Impact: any authenticated staff in facility can read sensitive student detail, including roles that parity tests treat as restricted from non-CRM registry access.

Suggested fix: replace broad `protectedProcedure` with explicit permissions and split sensitive sub-shapes.

### Medium: RLS-hidden reads can surface unstable 500-like errors

Evidence:

- `apps/api/src/trpc.ts:26`
- `apps/api/src/routers/student.ts:23`
- `apps/api/test/student-detail.int.test.ts:177`

Impact: clients cannot reliably map missing/forbidden records because tests accept generic throws and raw `findUniqueOrThrow` can leak as internal error.

Suggested fix: map Prisma `P2025` or replace with `findUnique` + explicit `TRPCError({ code: 'NOT_FOUND' })`.

### Medium: Public CRM lead ingest is token-only and unthrottled

Evidence:

- `apps/api/src/routers/crm.ts:335`
- input facility at `apps/api/src/routers/crm.ts:337`
- token check at `apps/api/src/routers/crm.ts:349`

Impact: leaked or brute-forced token can spam leads into arbitrary facility; min-only strings allow storage/log abuse.

Suggested fix: add rate limits, max lengths, and per-facility/source token binding.

## Verification Gaps

- No exact error-code test for RLS-hidden student detail.
- No negative role tests for student list/detail.
- No public abuse tests for `crm.leadIngest`.

## Positive Controls

- Error formatter strips stack traces.
- Production CORS requires explicit origins.
- Login and OTP routes have throttling and enumeration-conscious behavior.
- User router excludes password hashes/token versions.

## Unresolved Questions

- Which roles should see full student detail, guardian contact, receipts, grades, LMS login metadata?
- Should lead ingest token be global or per facility/source?

