# Phase 0 — Decision sign-off + `normalizeLoginPhone` + `DEFAULT_STUDENT_PASSWORD`

Status: pending · Depends: — · Owns: `packages/auth` (new helper file + index export + unit
test), decision doc copy to `docs/decisions/`.

## Goal

Land the two pure primitives the rest of the plan builds on, and register decision 0032, with
zero behavior change to any router yet.

## Context

- Decision: `../decisions/0032-student-login-phone-identity.md` (D1, D2, D3).
- `crm.ts:62 normalizePhone` emits `+84…` — DO NOT reuse or touch (scout notes).
- `packages/auth` is already a dependency of finance/student/guardian routers + the LMS auth
  package; helpers exported from its index are importable everywhere they are needed.

## Requirements

1. `normalizeLoginPhone(raw: string | null | undefined): string | null`
   - Strip all non-digit chars first.
   - `0084xxxxxxxxx` / `+84xxxxxxxxx` / `84xxxxxxxxx` → `84xxxxxxxxx`.
   - `0xxxxxxxxx` (10-digit VN mobile) → `84xxxxxxxxx`.
   - Anything else (too short/long, non-VN) → `null`.
   - Final guard: return the value only if it matches `/^84\d{9}$/`, else `null`.
   - Pure, no I/O. Do NOT mutate CRM formatting.
2. `DEFAULT_STUDENT_PASSWORD = 'Cmc2026@'` exported const.
3. Export both from the `packages/auth` index.
4. Copy `0032` to `docs/decisions/0032-student-login-phone-identity.md` and register via
   `scripts/bin/harness-cli.exe decision add …` (durable record).

## Files

- Create: `packages/auth/src/login-phone.ts` (helper + const). New file (KISS — one cohesive
  concern; keeps `lms.ts` focused).
- Modify: `packages/auth/src/index.ts` (re-export). Verify the real index path/name first
  (grep the package's `main`/exports).
- Create: `packages/auth/test/login-phone.test.ts` (or the package's existing test dir/runner —
  confirm before writing).
- Create: `docs/decisions/0032-student-login-phone-identity.md` (copy).

## Implementation steps

1. Grep `packages/auth` for its index/export file and existing unit-test convention (vitest?).
2. Write `login-phone.ts`; export from index.
3. Write exhaustive unit tests (table below).
4. Copy + register the decision doc.

## Tests (unit — exhaustive)

| Input | Expect |
|---|---|
| `'0912345678'` | `'84912345678'` |
| `'+84912345678'` | `'84912345678'` |
| `'84912345678'` | `'84912345678'` |
| `'0084912345678'` | `'84912345678'` |
| `'0912 345 678'` / `'091-234-5678'` | `'84912345678'` |
| `'091234567'` (too short) | `null` |
| `'0912345678901'` (too long) | `null` |
| `'not a phone'` / `''` / `null` / `undefined` | `null` |
| `DEFAULT_STUDENT_PASSWORD` | `=== 'Cmc2026@'` (NOT random; assert exact value) |

## Risks / rollback

- Risk: LOW. Pure additions; nothing imports them yet. Rollback = delete the file + revert the
  index line.
- Failure mode to avoid: accidentally importing/altering `crm.ts normalizePhone` — verify
  `detect_changes` touches only the auth helper + index + test.

## Done =

Helper + const exported and green unit tests; decision 0032 copied to `docs/decisions/` and
registered; gitnexus `detect_changes` scope = only the new auth files.
