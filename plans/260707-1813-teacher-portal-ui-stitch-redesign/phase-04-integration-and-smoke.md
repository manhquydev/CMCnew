---
phase: 4
title: "Integration and Smoke"
status: pending
priority: P1
dependencies: [2, 3]
---

# Phase 4: Integration and Smoke

## Overview

Wire all redesigned screens into shell.tsx nav correctly, run full test suite, do a local browser smoke across teacher + director flows, then commit and push.

## Requirements

- Functional: all nav items still resolve to correct panels; no regressions on non-teacher roles
- Non-functional: admin + LMS prod builds pass; chunk-size warnings acceptable

## Architecture

Shell routing: `apps/admin/src/shell.tsx` maps `SectionKey` values to panel components. Only component imports change — section keys, RBAC guards, and nav labels stay the same.

## Related Code Files

- Modify: `apps/admin/src/shell.tsx` — update imports for new panel components (TeacherTodayPanel, SessionWorkspace, HomeworkFeed, DirectorDashboard, QuickClassForm, StudentEnrollPanel)
- Read: `apps/admin/src/__tests__/nav-teacher-consolidation.test.ts` — confirm test expectations match new component names if needed
- Read: `apps/admin/src/__tests__/nav-consistency.test.ts`
- Read: `apps/admin/src/__tests__/nav-director-dt-cockpit-consolidation.test.ts`
- Read: `apps/admin/src/__tests__/nav-director-kd-cockpit-consolidation.test.ts`

## Implementation Steps

1. Update `shell.tsx` imports — replace old panel components with new ones from phases 2–3. Keep all section keys, visibility flags, and RBAC guards identical.

2. Run full nav test suite:
   ```
   pnpm --filter @cmc/admin exec vitest run \
     src/__tests__/nav-teacher-consolidation.test.ts \
     src/__tests__/nav-consistency.test.ts \
     src/__tests__/nav-director-dt-cockpit-consolidation.test.ts \
     src/__tests__/nav-director-kd-cockpit-consolidation.test.ts
   ```

3. Run full typecheck:
   ```
   pnpm --filter @cmc/admin typecheck
   pnpm --filter @cmc/api typecheck
   pnpm --filter @cmc/lms typecheck
   ```

4. Run ESLint:
   ```
   pnpm --filter @cmc/admin exec eslint src --max-warnings 0
   ```

5. Run prod builds:
   ```
   pnpm --filter @cmc/admin build
   pnpm --filter @cmc/lms build
   ```

6. Local browser smoke (start dev servers):
   - API: `pnpm --filter @cmc/api dev`
   - Admin: `pnpm --filter @cmc/admin dev`
   - LMS: `pnpm --filter @cmc/lms dev`

   Teacher smoke checklist:
   - [ ] Login as `giao_vien` → see TeacherTodayPanel with today's class cards
   - [ ] Click class card → SessionWorkspace opens
   - [ ] Mark 1 student absent → attendance saves
   - [ ] Upload 1 photo → appears in evidence grid
   - [ ] Write session comment → saves on blur
   - [ ] Open HomeworkFeed → see submission list
   - [ ] Grade 1 submission → score + stars save

   Director smoke checklist:
   - [ ] Login as `giam_doc_dao_tao` → see DirectorDashboard with stat cards
   - [ ] Open QuickClassForm → fill course + dates → create class → success toast
   - [ ] Open StudentEnrollPanel → fill parent + student info → submit → email queued toast

7. If any smoke step fails: debug with `trpc` network tab, fix in the relevant phase 2/3 component, re-run steps 2–6.

8. Commit: `feat(admin): redesign teacher and director portal UI via stitch`

## Success Criteria

- [ ] All 4 nav test files pass
- [ ] `pnpm --filter @cmc/admin typecheck` clean
- [ ] `pnpm --filter @cmc/api typecheck` clean
- [ ] `pnpm --filter @cmc/lms typecheck` clean
- [ ] ESLint 0 warnings on admin
- [ ] Admin prod build passes (chunk warning acceptable)
- [ ] LMS prod build passes
- [ ] All 7 teacher smoke checkboxes green
- [ ] All 3 director smoke checkboxes green
- [ ] Non-teacher roles (HR, finance, sales) unaffected — spot-check 1 login

## Risk Assessment

- **Low**: shell.tsx import changes are mechanical; RBAC + section keys untouched
- **Medium**: if a nav test asserts on component display text, update the test expectation (not the guard logic)
- **Low**: LMS build has no changes — typecheck is a safety net only
