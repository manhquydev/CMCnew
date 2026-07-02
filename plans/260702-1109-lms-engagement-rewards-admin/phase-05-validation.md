# Phase 05 — Validation

## Context

- Runs LAST (depends P1-P4). Consolidates integration + manual checks; adds the RLS anti-takeover coverage that INTAKE marks mandatory for P4.
- Test harness: existing `*.int.test.ts` pattern under `apps/api/src` (seed facility + RLS ctx). Reuse the `withRls`/SYSTEM_CTX seeding helpers the reward/badge/guardian tests already use. No new framework.
- LMS live verification harness (seed accounts + tRPC-over-curl) available for manual parent/student feed checks.

## Requirements (acceptance → test mapping)

- **P1 cron:** integration — ended session + published exercise + active enrollment → tick creates 1 `new_exercise_open`; re-tick → 0 (idempotent). Cancelled session / draft exercise / withdrawn enrollment → 0. Manual: parent+student feed shows new label AND `parent_meeting_reminder` label (no "Thông báo mới" fallback).
- **P2 rewards:** integration — `giftUpdate`/`giftArchive`/`stockAdjust` audit + effect; `starAdjust` net-balance + distinct manual refs + amount-0 reject; `markDelivered` approved→delivered terminal (re-transition rejected). Manual: non-director FORBIDDEN.
- **P3 badge:** manual only (API pre-covered) — director create/archive/grant, GV list+grant, re-grant no-op toast, other roles nav hidden. Typecheck + admin build.
- **P4 parent:** integration (RLS mandatory) — profileUpdate cross-parent isolation; requestLink creates ZERO Guardian (anti-takeover); staff approve → exactly 1 Guardian, reject → 0; email collision → BAD_REQUEST not 500; linkRequestListMine own-only. Manual: full parent journey (edit profile, request by phone + code, staff approve).

## Validation gates (run in order)

1. `pnpm --filter @cmc/db prisma migrate status` — 0 drift (P2 enum + P4 table migrations applied).
2. Narrow first: `pnpm --filter @cmc/api test` for new int tests, then broaden to typecheck across touched packages (`@cmc/auth`, `@cmc/db`, api, admin, lms).
3. `pnpm --filter admin build` + `pnpm --filter lms build` (new panels/tabs compile).
4. Manual checklist (below) on the live stack.

## Files

- CREATE `apps/api/src/routers/exercise-open-notify.int.test.ts` (P1 idempotency).
- CREATE `apps/api/src/routers/rewards-admin.int.test.ts` (P2 gift/star/delivered).
- CREATE `apps/api/src/routers/guardian-self-service.int.test.ts` (P4 profile isolation + anti-takeover + review).
- CREATE manual checklist section in `plans/260702-1109-lms-engagement-rewards-admin/reports/` at validation time (not a code file).

## Manual checklist

- [ ] Student/parent feed: new-exercise + meeting labels render friendly text.
- [ ] KD director: gift edit/archive/stock, manual star adjust (with reason), mark delivered; non-director blocked.
- [ ] Đào tạo director: badge create/archive/grant; GV grant only; other roles no badge nav.
- [ ] Parent: profile edit persists; link-request by phone + by code queues; staff approves → child appears; parent cannot create a link directly.

## Risks & rollback

| Risk | L×I | Mitigation |
|------|-----|------------|
| Cron test flaky on time-window boundary | M×M | Inject fixed `now` into `runExerciseOpenNotifications(now)`; never rely on wall clock |
| RLS test passes under SYSTEM_CTX bypass, masking real gap | M×**H** | Run cross-parent assertions under a real parent RLS ctx, not SYSTEM_CTX |
| Migration drift blocks CI | L×M | Gate 1 first; resolve drift before running suites |

- Rollback: tests are additive — deleting them reverts this phase with no product impact.
