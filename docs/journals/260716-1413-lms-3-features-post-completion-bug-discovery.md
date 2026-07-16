# LMS 3-Features: Cooked, Code-Reviewed, Then User Testing Found 2 Real Bugs

**Date**: 2026-07-16 14:13  
**Severity**: Medium (UI bug user-visible; data-loss bug contained to test scope)  
**Component**: LMS (gift rewards shop, schedule visibility, upcoming exercises counter)  
**Status**: Resolved

## What Happened

Cooked plan `plans/260716-0856-lms-schedule-rewards-exercises/plan.md` — 6 phases implementing 3 LMS student features:

1. Hide schedule tab from students/parents (read-only for teachers only)
2. Gift-photo store: new `Gift` schema with `@@unique([facilityId, name])` migration, upload UI, reward-shop rendering, seeded 21 real gift photos across all facilities
3. Upcoming exercises counter: read-only UX showing "you have N exercises" (respects decision 0038: never leak exercise identity before session ends)

Each phase was test-first + independently code-reviewed; one bug was found and fixed during Phase 3 review (cross-record photo-ref leak during mid-upload gift-switch). Committed as `0feefac` (implementation) + `1b7aad4` (plan status + acceptance).

Then: user provided a screenshot showing the reward shop rendered with huge empty white space and tiny photos. During investigation, discovered the 21 seeded gifts had been **silently deleted** from the production database.

## The Brutal Truth

"Looks done in staging" is not "actually correct in the field." Two real bugs only surfaced when a human clicked through the feature with real data.

The first is embarrassing: CSS replaced-element sizing interaction with flexbox (my fault for not verifying computed dimensions after the fix). The second is **worse** — an integration test was silently destroying production data every time it ran. That's not a test bug; that's a data-loss vulnerability that hid in plain sight because the test passed and nobody looked at the database afterward.

The integration-test isolation pattern will haunt me until I fix it systematically across the codebase.

## Technical Details

### Bug 1: Gift Card UI — Huge Empty Space, Tiny Photos

**Symptom**: Gift cards in reward shop rendered with 120px of content but ~326px of vertical height, photos looked small/cropped, massive white space below redeem button.

**Root cause** (found via live-browser CSS forensics with `getComputedStyle()` and `getBoundingClientRect()`):

The `<Image>` component had explicit `h={120}` but no explicit `width` — it relied on the parent `Stack` CSS (`align-items:stretch` in flex column) to size width to fill the card. With only ONE dimension pinned, the browser recomputed the rendered height from the photo's intrinsic aspect ratio once width was stretched — silently overriding `h={120}`.

Even `!important` inline height overrides had zero effect, which proved it wasn't CSS cascade/specificity but a replaced-element sizing interaction (the browser's intrinsic aspect ratio calculation overrides explicit CSS height when computing the other dimension in flex layout).

**The fix**: Pin BOTH dimensions explicitly (`w="100%"` + `h={120}` + `flexShrink:0`). Also removed a pre-existing unrelated `Stack h="100%"` + `Button mt="auto"` pattern that was compounding the wasted space. Result after fix: larger, more prominent photos, zero wasted card space.

**Commit**: `dbe0ec5`

### Bug 2: Integration Test Silently Deleting Production Gift Data

**Symptom**: The 21 seeded gift rows existed in dev just after `seed-gifts.ts` ran, but were gone by the time the reward shop loaded.

**Root cause**:

File `apps/api/test/seed-gifts.int.test.ts`:

```typescript
beforeAll(async () => {
  facility = await tx.facility.findFirst(); // Returns facility id=1 (HQ) — the REAL facility
});

afterAll(async () => {
  await tx.gift.deleteMany({ where: { name: { in: REAL_GIFT_NAMES } } });
  // Deletes all gifts matching the test's fixture names from the REAL facility
});
```

The test intentionally reused real gift names (`'Con quay'`, `'Hộp lego'`, etc.) because it was testing the shape of the production seed data. But `findFirst()` returned the same real facility (id=1) that the production seed script (`apps/api/scripts/seed-gifts.ts`) had just seeded moments earlier in the same session. Every time the integration test suite ran — including in later verification passes — it silently wiped or corrupted the real seeded data for facility 1.

**The fix**: Made the test create its own throwaway `Facility` row in `beforeAll` and tear it down (delete its gifts + itself) in `afterAll`, so it can never touch facility 1/2's real data. Re-ran the real seed script to restore the 21 gifts.

**Commit**: `dbe0ec5`

## What We Tried

1. **Bug 1 diagnosis**: Live CSS inspection via DevTools evaluate_script, traced computed dimensions, forced style overrides to rule out cascade issues, examined Mantine Stack/Image component internals.
2. **Bug 2 diagnosis**: Database query `SELECT * FROM gift WHERE facility_id = 1;` showed zero rows; checked `_prisma_migrations` and test file history; found `afterAll` matching real facility + real gift names; confirmed test ran recently via git log.

## Root Cause Analysis

**Bug 1**: Insufficient verification of UI dimensions after a CSS fix. Should have run the fix, then immediately verified both `computed` width/height in DevTools, not just "it looks better now."

**Bug 2**: A unit/integration test that reuses "real-shaped" fixture data (same names/values as production seed data, for test realism) is **unsafe isolation** unless it's also scoped to its own throwaway tenant/scope. Reusing a shared "first facility" lookup for convenience is a landmine once real data with matching identifiers exists in that same scope. The test *passed* silently while destroying data — no error, no warning, no red flag.

## Lessons Learned

1. **"Looks fixed" requires dimension verification.** After any CSS sizing fix, check `getComputedStyle()` or DevTools computed tab. Replaced elements (images, video, canvas) have intrinsic aspect ratios that silently override CSS height when flex layout stretches width.

2. **Integration tests using "real-shaped" fixture data must not share scope with real data.** If a test seeds `gift.name = 'Con quay'` to test that exact production data's behavior, it MUST also create its own facility/tenant/domain to query against. Fixture-name reuse + shared facility lookup = data-loss bomb.

3. **Silent test pass with data mutation is worse than a loud failure.** The test passed, the database was corrupted, nobody knew. A test that touches shared scope but doesn't validate the scope afterward is untrustworthy.

4. **This pattern exists elsewhere in the codebase.** Any integration test that calls `findFirst()` or relies on "the first X" without creating its own test row is vulnerable to this. Worth a systematic audit.

## Next Steps

- [x] Fix both bugs; re-run real seed script; verify gifts present in dev + production
- [ ] Audit all integration tests in `apps/api/test/**/*.int.test.ts` for the "findFirst() into real fixture reuse" pattern — at least `curriculum.int.test.ts` and `class.int.test.ts` are likely candidates
- [ ] Consider a test-isolation convention: all integration tests that seed/mutate data get a throwaway facility row or dedicated test-only enum value, never reuse production IDs
- [ ] Update code review checklist for integration tests: "Does this test query a real facility/shared scope? If yes, does it create its own test row?"
