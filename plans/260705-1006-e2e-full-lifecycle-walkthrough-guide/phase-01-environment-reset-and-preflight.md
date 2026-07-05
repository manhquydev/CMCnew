# Phase 01 — Environment reset & preflight (Stage 0)

## Context links
- Design: `plans/reports/brainstorm-260705-1006-e2e-full-lifecycle-walkthrough-guide-report.md`
- Decisions: `docs/decisions/0031-staff-password-login-parallel-to-sso.md`, `0030-email-brevo-external-transport-split.md`

## Overview
- Date: 2026-07-05
- Description: Wipe local DB, apply migrations, minimal seed (super_admin/directors + facility + curriculum catalog), bring stack up, verify super_admin login, resolve two preflight gates (staff password login, parent email transport).
- Priority: P1 (blocks everything)
- Implementation status: pending
- Review status: not reviewed

## Key Insights
- Staff password login is env-gated: `apps/api/src/routers/auth.ts:34` — non-super_admin needs `STAFF_PASSWORD_LOGIN=true`. `.env.example:18` ships `"false"`. MUST flip to `true` locally or stage 1 login verify is impossible.
- Even with the flag on, a staff account has NO usable password until an explicit `user.setPassword` call (decision 0031). So stage 1 must set passwords via UI, not assume seed passwords.
- Parent email uses Brevo for external recipients (decision 0030). `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` empty by default (`.env.example:104-105`) → outbox worker queues but does not send. Detect at stage 0; if empty, stage 6 falls back to outbox-row verification.
- Curriculum content: only UCREA + Bright I.G have units seeded; Black Hole is empty (`packages/db/src/seed-curriculum.ts:84-92`). Class in stage 2 must pick UCREA or Bright I.G.
- Super_admin bootstrap creds: `SEED_SUPERADMIN_EMAIL=admin@cmc.local` / `SEED_SUPERADMIN_PASSWORD=ChangeMe!123` (`.env.example:21-22`).

## Requirements
- Clean DB (no leftover students/staff/classes from prior runs).
- Minimal seed = HQ facility + super_admin + directors + curriculum catalog. No demo staff/students (those are created live in later phases).
- Stack reachable: API :4000, admin :5173, LMS :5175.
- Both preflight gates resolved and recorded before phase 2 starts.

## Architecture (apps/routers/URLs involved)
- DB stack: `docker/docker-compose.dev.yml` — Postgres 16 @ `:5433`, Redis @ `:6380`.
- API: `pnpm --filter @cmc/api start` → `http://localhost:4000`.
- Admin ERP: `pnpm --filter @cmc/admin dev` → `http://localhost:5173`.
- LMS portal: `pnpm --filter @cmc/lms dev` → `http://localhost:5175`.
- Seed: `packages/db/src/seed.ts` (SEED_MODE bootstrap vs full), `packages/db/src/seed-curriculum.ts`.

## Related code files
- `.env.example` (copy to `.env`; flip `STAFF_PASSWORD_LOGIN`, check Brevo keys, `COOKIE_SECURE=false`)
- `apps/api/src/routers/auth.ts:24-38` (password-login gate)
- `packages/db/package.json:9-17` (seed scripts: `seed:bootstrap`, `seed:curriculum`)
- `apps/api/src/lib/brevo-client.ts`, `apps/api/src/lib/email-routing.ts`, `apps/api/src/services/email-outbox.ts`

## Implementation Steps
1. Ensure `.env` exists (copy from `.env.example` if absent). Set:
   - `STAFF_PASSWORD_LOGIN="true"`
   - `COOKIE_SECURE="false"` (already default)
   - Confirm `SSO_ENABLED="false"`.
2. Clean DB volume + restart:
   - `docker compose -f docker/docker-compose.dev.yml down -v`
   - `pnpm db:up` (wait for postgres healthcheck).
3. Reset schema + apply migrations: `pnpm --filter @cmc/db exec prisma migrate reset --force --skip-seed`
   (drops + re-applies all migrations on a clean DB; `--skip-seed` so we control seeding).
4. Minimal seed:
   - `pnpm --filter @cmc/db seed:bootstrap` (HQ facility + super_admin only — lean, not demo data).
   - `pnpm --filter @cmc/db seed:curriculum` (Courses + CurriculumUnits: UCREA, Bright I.G, Black Hole).
   - Directors: if bootstrap does not seed the two director roles, create them live via super_admin UI in phase 2 preflight, or note that super_admin will stand in for "Quản lý" actions. Verify which by checking seeded users (query below).
5. Start stack: `pnpm dev` (turbo runs api+admin+lms) OR three terminals per README.
6. Preflight A — super_admin login: browser → `http://localhost:5173`, login `admin@cmc.local` / `ChangeMe!123`. Screenshot dashboard.
7. Preflight B — staff password login gate: confirm `STAFF_PASSWORD_LOGIN=true` is actually loaded by the running API (env baked at process start — restart API if flag flipped after boot).
8. Preflight C — Brevo/email transport: check `.env` `BREVO_API_KEY` non-empty AND `BREVO_SENDER_EMAIL` set.
   - If both present → stage 6 sends real email.
   - If missing → record "email fallback = outbox verification" for stage 6; do NOT add a key (out of scope, no secret handling).

## Verify queries (behind-the-scenes, read-only)
- Seeded users: `prisma studio` or SQL `SELECT email, role FROM "User";` — expect super_admin (+ directors if seeded), no demo staff/students.
- Curriculum present: `SELECT code, name, program FROM "Course";` — expect UCREA + Bright I.G rows.
- Clean slate: `SELECT count(*) FROM "Student";` → 0.

## Todo list
- [ ] `.env` flags set (STAFF_PASSWORD_LOGIN=true, SSO_ENABLED=false, COOKIE_SECURE=false)
- [ ] DB volume wiped + migrations reset
- [ ] bootstrap + curriculum seed run; verify queries pass
- [ ] Stack up (4000/5173/5175 reachable)
- [ ] super_admin login screenshot captured
- [ ] Brevo-vs-outbox decision recorded for stage 6
- [ ] Guide `docs/guides/e2e-walkthrough/00-reset-preflight/guide.md` written (IT role)

## Success Criteria
- super_admin logs in at :5173; dashboard renders.
- DB has HQ facility + curriculum catalog, zero students/leads/classes.
- STAFF_PASSWORD_LOGIN=true confirmed loaded; email transport mode (real/outbox) recorded.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `migrate reset` blocked by RLS non-owner role | Med | High | reset runs via `DIRECT_URL` (owner `cmc`) — confirm `.env` DIRECT_URL points at owner role |
| Flag flipped after API boot → still 403 on staff login | Med | High | restart API process after editing `.env` |
| bootstrap seed omits director roles | Med | Med | create directors live via super_admin in P2, or use super_admin for manager actions; note in guide |
| Brevo key absent | High | Low | pre-decided fallback to outbox verify; no code change |
| Curriculum seed CSV path/parse fail | Low | Med | inspect `seed-curriculum.ts` CSV source; log as blocking bug if it breaks |

## Security Considerations
- `.env` never committed; screenshots must not show `.env` contents, tokens, or JWT_SECRET.
- Use bootstrap creds only on local; do not reuse prod passwords.
- No secret added for Brevo — absence handled by fallback, not by pasting a key.

## Next steps
Proceed to Phase 02 (staff creation + login verify, class create, generate sessions).
