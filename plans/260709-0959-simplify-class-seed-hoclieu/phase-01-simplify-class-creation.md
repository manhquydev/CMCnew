# Phase 01: Simplify Class Creation

## Context

- Parent: [plan.md](plan.md)
- Brainstorm: [report](../reports/brainstorm-260709-0959-simplify-class-creation-seed-hoclieu-report.md)

## Overview

- **Date:** 2026-07-09
- **Priority:** P2
- **Effort:** 30m
- **Status:** pending
- **Review:** pending

## Key Insights

- `CreateClassModal` receives `courses: Course[]` prop, renders a `<Select>` dropdown filtered to courses with `unitCount > 0`
- `courseId` state drives: curriculum preview fetch, end-date auto-estimate, and `classBatch.create` API call
- API contract (`classBatch.create`) unchanged — still receives `courseId`
- Auto-selecting L1 = find first course sorted by `levelCode ASC` with `unitCount > 0`

## Requirements

1. Remove course `<Select>` dropdown from CreateClassModal
2. Auto-resolve `courseId` to UCREA L1 (smallest levelCode with curriculum data)
3. Preserve curriculum preview display for auto-selected course
4. Preserve end-date auto-estimate logic
5. Show fallback message if no course has curriculum data

## Related Code Files

| File | Role |
|------|------|
| `apps/admin/src/class-workspace.tsx` L148-310 | CreateClassModal component |
| `apps/api/src/routers/class-batch.ts` | API router (no changes needed) |

## Implementation Steps

### Step 1: Auto-resolve courseId

Replace `useState<string | null>(null)` for `courseId` with a derived value:

```tsx
// Inside CreateClassModal, replace:
const [courseId, setCourseId] = useState<string | null>(null);

// With:
const autoCoure = courses
  .filter((c) => c.unitCount > 0)
  .sort((a, b) => a.code.localeCompare(b.code))[0];
const courseId = autoCoure?.id ?? null;
```

### Step 2: Remove Select dropdown

Remove the `<Select label="Khung chương trình ...">` block (L287-301).

Replace with a read-only info display:

```tsx
{autoCoure ? (
  <Text size="sm" fw={500}>
    Khung chương trình: {autoCoure.code} — {autoCoure.name}
    ({autoCoure.unitCount} unit / {autoCoure.totalSessions} buổi)
  </Text>
) : (
  <Text size="sm" c="red">Chưa có khung chương trình (chạy seed:curriculum)</Text>
)}
```

### Step 3: Update curriculum preview effect

The `useEffect` fetching `curriculum.listByCourse` still works — `courseId` is now auto-derived but still triggers the effect. However, since `courseId` is no longer state, move the initial fetch to be eager (run on mount when `autoCoure` is available).

### Step 4: Update create() validation

Remove the `if (!courseId)` check (L223-226) — `courseId` is now auto-resolved. If `autoCoure` is null, the button should be disabled instead.

### Step 5: Update reset()

Remove `setCourseId(null)` from `reset()` — no longer state.

## Todo

- [ ] Replace courseId state with derived value from courses prop
- [ ] Remove Select dropdown, add read-only course display
- [ ] Ensure preview + end-date auto-estimate still work
- [ ] Disable create button when no course available
- [ ] Clean up reset() function

## Success Criteria

1. Modal opens without course dropdown
2. Shows "UCREA L1" info automatically
3. Curriculum preview loads for L1
4. End-date auto-estimate works
5. Class creation succeeds with auto-assigned courseId
6. Fallback renders when no curriculum exists

## Risk Assessment

- **Low risk**: single-file UI change, no API modification
- Regression: if `courses` prop is empty or none have curriculum → fallback message covers this

## Security Considerations

None — no auth/authz/data changes.

## Next Steps

→ Phase 02: Seed exercise PDFs
