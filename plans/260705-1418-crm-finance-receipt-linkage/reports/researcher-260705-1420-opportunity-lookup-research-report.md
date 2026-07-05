# Opportunity Phone-Based Lookup Research — Plan B Implementation

**Date:** 2026-07-05  
**Scope:** Add "tìm cơ hội theo SĐT" lookup to `finance-panel.tsx` new-student receipt form  
**Based on:** Brainstorm report 260705-1407 (Option B)

---

## 1. Phone Normalization & RLS Pattern

**File:** `apps/api/src/routers/crm.ts`

### Normalization (lines 62–68)
```typescript
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+84')) return digits;
  if (digits.startsWith('84')) return '+' + digits;
  if (digits.startsWith('0')) return '+84' + digits.slice(1);
  return digits;
}
```
**Decision:** All Contact.phone stored normalized to `+84` prefix. Receipt.parentPhone must be normalized before lookup.

### RLS + Permission Pattern (lines 201–212, 216–225)
```typescript
opportunityList: requirePermission('crm', 'opportunityList')
  .input(z.object({ facilityId: z.number().int().positive() }))
  .query(({ ctx, input }) =>
    withRls(rlsContextOf(ctx.session), (tx) =>
      tx.opportunity.findMany({
        where: { facilityId: input.facilityId, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { contact: { select: { fullName: true, phone: true } } },
      }),
    ),
  ),
```
**Pattern:** Facility-scoped via RLS; returns up to 200/facility with contact fields included.

---

## 2. Contact & Opportunity Model Fields

**Schema:** `packages/db/prisma/schema.prisma` (lines 1180–1226)

### Contact (lines 1180–1197)
| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `facilityId` | Int | RLS scope (facility-scoped) |
| `fullName` | String | Parent name for display |
| `phone` | String | Normalized +84 format; unique per facility |
| `email` | String? | Optional |
| `source`, `medium`, `campaign` | String? | CRM metadata |
| `archivedAt` | DateTime? | Soft-delete flag |

### Opportunity (lines 1201–1226)
| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `facilityId` | Int | RLS scope |
| `contactId` | UUID | FK to Contact |
| `contact` | Relation | Includes fullName, phone |
| `studentName` | String? | Student name (may differ from parent fullName) |
| `program` | Program? | UCREA / BRIGHT_IG / BLACK_HOLE |
| `stage` | OpportunityStage | O1–O5 (see below) |
| `ownerId` | UUID? | Sales consultant (commission attribution) |
| `closedAt` | DateTime? | Set when lost or won (O5) |
| `archivedAt` | DateTime? | Soft-delete |

### OpportunityStage enum (lines 1160–1166)
`O1_LEAD`, `O2_CONTACTED`, `O3_TEST_SCHEDULED`, `O4_TESTED`, `O5_ENROLLED`

---

## 3. Receipt → Opportunity Field Mapping

**Reference:** `apps/admin/src/opportunity-detail.tsx` (lines 407–434)

| Opportunity Field | → | Receipt Field |
|-------------------|---|---|
| `contact.phone` | → | `parentPhone` |
| `contact.fullName` | → | `parentName` |
| `studentName` | → | `studentName` (coalesced: `opp.studentName \|\| opp.contact.fullName`) |
| `facilityId` | → | `facilityId` (auto) |
| `id` | → | `opportunityId` |
| `courseId` (from UI) | → | `courseId` (user selects) |
| `classBatchId` (optional) | → | `classBatchId` (optional) |

**Schema:** `packages/db/prisma/schema.prisma` (lines 1104–1110)  
Receipt captures: `parentPhone`, `parentName`, `parentEmail`, `studentName`, `studentDob`, `classBatchId`

---

## 4. Finance Panel New-Student Form (Current State)

**File:** `apps/admin/src/finance-panel.tsx` (lines 1221–1389)

Currently **no CRM lookup**: staff enters `parentPhone` + `studentName` manually in TextInput fields.  
Form passes `opportunityId` **only if** provided via context from opportunity-detail.tsx.

**Add lookup to:** lines ~1383–1396 (parentPhone TextInput section).

---

## 5. Data Volume & Existing Search Patterns

**Query Volume:**
- `opportunityList` capped at **200 rows/facility** (line 208: `take: 200`)
- Contact.phone **indexed + unique** per facility (line 1194) → fast lookup
- Typical facility: 50–150 active opportunities → well under cap

**Existing Searchable UI:**
- `finance-panel.tsx` uses Mantine `Select` with `searchable` prop (e.g., course picker, student picker)
- Consistent pattern across app: `assessment-panel.tsx`, `class-workspace.tsx`, etc.
- **No async/debounce patterns found** — all use static filtered lists

---

## 6. Endpoint Strategy Recommendation

### Option A: New endpoint `crm.opportunityFindByPhone` ✗
**Pros:** Server-side filtering; cleaner semantics  
**Cons:** Adds new permission key; duplicates RLS logic; YAGNI violation for 200 rows

### Option B: Reuse `crm.opportunityList` + client-side filter ✓ **RECOMMENDED**
**Pros:**
- Reuses existing permission `requirePermission('crm', 'opportunityList')`
- RLS boundary already proven (used in CRM pipeline board)
- 200 rows → negligible filter cost on client
- Minimal code change (filter array locally)
- KISS principle: no new query, no new permission gate

**Cons:**
- Fetches all 200 rows per facility (bandwidth, memory)
- If facility scales to 500+ opportunities → revisit (migrate to server-side then)

### Implementation Details

**Lookup logic:**
1. On `parentPhone` field blur or keystroke debounce:
   - Normalize phone via client-side normalizePhone (import from @cmc/auth or copy)
   - Filter `crm.opportunityList` results: `contact.phone === normalized`
   - Filter stage: exclude `closedAt !== null` (only "open" opportunities)
   - Display match: **parent name + student name + stage** for user confirmation

2. **Autofill on match:** populate `parentName`, `studentName` from first match (or show dropdown if multiple)

3. **No match:** leave fields editable (staff can enter manually → new student path)

---

## 7. Unresolved Questions

1. **Stage filter for "open":** Should lookup exclude all `closedAt !== null` (both lost + O5 won), or only `lostReason !== null`?  
   → Brainstorm Q44 notes the decision was deferred to Plan C; suggest: exclude all closed for Plan B (simpler, safer).

2. **Multiple matches (sibling case):** If 2 children share same parent phone, show dropdown picker or take first?  
   → Brainstorm acknowledged sibling case; suggest: show all candidates, let staff pick.

3. **Phone normalization on frontend:** Where should live? (a) import normalizePhone from @cmc/auth, (b) copy to admin app, (c) move to shared lib?  
   → Recommend (a) if @cmc/auth exports it; else (c).

---

## Summary

**Recommendation: Implement Option B (reuse `opportunityList`, filter client-side)**

- **Endpoint:** No new endpoint (reuse `crm.opportunityList` + local filter)
- **Permission:** No new permission key (reuse `crm.opportunityList`)
- **UI component:** Add optional lookup section above parentPhone TextInput
- **Field mapping:** Contact.phone → parentPhone, Contact.fullName → parentName, Opportunity.studentName → studentName
- **Data flow:** lookup async → normalize phone → filter stage=open → show candidates → autofill on select
- **RLS:** Facility-scoped via existing `withRls(rlsContextOf(...))` boundary in `opportunityList`

**Risk:** None identified (read-only query, existing permission, proven RLS pattern). Can increment to server-side endpoint later if sibling matching becomes complex.
