# Code Review: New Frontend Shift/Check-in Panels

**Date**: 2026-06-30 | **Reviewer**: code-reviewer | **Files**: 6 | **Severity**: 2 CRITICAL, 4 HIGH, 5 MEDIUM, 3 LOW

## Scope

| File | Status | Lines |
|------|--------|-------|
| `apps/admin/src/checkin-panel.tsx` | New (untracked) | 179 |
| `apps/admin/src/shift-reg-list-panel.tsx` | New (untracked) | 109 |
| `apps/admin/src/shift-reg-detail-panel.tsx` | New (untracked) | 357 |
| `apps/admin/src/App.tsx` | Modified | LL 586-594, 807, 816 |
| `apps/admin/src/shell.tsx` | Modified | LL 420-425, 462-463 |
| `apps/admin/src/nav-permissions.ts` | Modified | LL 103-104 |

## Backend API Verification

Verified against:
- `apps/api/src/routers/check-in-out.ts` — `checkIP`, `punch`, `todayStatus`
- `apps/api/src/routers/shift-registration.ts` — `list`, `get`, `create`, `updateEntry`, `submit`
- `apps/api/src/routers/shift-config.ts` — `list`
- `apps/api/src/routers/index.ts` — router registration: `checkInOut`, `shiftRegistration`, `shiftConfig`
- `packages/auth/src/permissions.ts` — all permission entries confirmed in registry
- `apps/api/test/fixtures/permission-snapshot.json` — all permission entries confirmed in snapshot

---

## CRITICAL Issues

### C1. `saveDay` defined but NEVER called from UI — shift toggles never persist

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`  
**Lines**: 111 (definition), 268 (Radio onChange)  
**Severity**: CRITICAL

The `saveDay` function at line 111-127 correctly calls `updateEntry` mutation but is **never invoked** from any JSX event handler. The grid's `Radio` `onChange` at line 268 only calls `toggle(date, t.id)` which updates local `selected` state. No database mutation ever fires.

```tsx
// Line 268 — ONLY calls toggle, never saveDay:
<Radio
  checked={cur.has(t.id)}
  onChange={() => isDraft && toggle(date, t.id)}  // BUG: saveDay never called
  disabled={!isDraft}
/>
```

All shift selections are lost on navigation away from the detail view. The entire grid-editing feature is non-functional for persistence.

**Fix**: The `onChange` handler must either:
- (A) Call `saveDay(date)` after each toggle: `toggle(date, t.id); saveDay(date);` — but this causes N API calls per row edit.
- (B) Better: Add a "Lưu" button per row in the grid that calls `saveDay(date)` for that date, and change the Radio onChange to a no-op or only update local state with a visual "unsaved" indicator.

Option B recommended — a per-row save button avoids flooding the API and gives users clear save semantics.

---

### C2. NAV_GATES set `checkin` and `shift-registration` to `open` but backend routes require specific permissions

**File**: `apps/admin/src/nav-permissions.ts`  
**Lines**: 103-104  
**Severity**: CRITICAL

```ts
checkin:              { kind: 'open' },
'shift-registration': { kind: 'open' },
```

Both nav items are `kind: 'open'` (visible to any authenticated staff), but the backend procedures require specific permissions:

| Nav item | Backend procedure | Required permission | Roles missing |
|----------|-------------------|---------------------|---------------|
| checkin | `checkInOut.todayStatus` | `checkInOut.todayStatus` | `hr`, `ke_toan`, `bgd`, `quan_ly`, directors |
| checkin | `checkInOut.punch` | `checkInOut.checkIn` | `hr`, `ke_toan`, `bgd`, `quan_ly`, directors |
| shift-registration | `shiftReg.list` | `shiftReg.list` | `super_admin`, `ke_toan` |

Users with roles like `ke_toan`, `bgd`, `quan_ly` (for checkin) and `ke_toan` (for shiftReg) will see these nav items but receive FORBIDDEN errors on load. The `notifyError` calls will show "Không tải được trạng thái" / "Không tải được danh sách" to these users.

**Fix**: Gate both nav items with appropriate permission checks matching their primary load queries:

```ts
checkin:              { kind: 'permission', module: 'checkInOut', action: 'todayStatus' },
'shift-registration': { kind: 'permission', module: 'shiftReg', action: 'list' },
```

---

## HIGH Priority Issues

### H1. `Radio` component used for MULTIPLE selection mode — should use `Checkbox`

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`  
**Lines**: 266-271  
**Severity**: HIGH

The grid always renders `Radio` components regardless of `selectionMode`. In MULTIPLE mode, the `toggle` function correctly implements checkbox behavior (add/remove from Set), but the visual `Radio` component misleads users into thinking only one shift can be selected per day.

```tsx
// Line 266 — always a Radio, even for MULTIPLE mode:
<Radio
  checked={cur.has(t.id)}
  onChange={() => isDraft && toggle(date, t.id)}
  disabled={!isDraft}
/>
```

**Fix**: Conditionally render based on mode:
```tsx
{group?.selectionMode === 'SINGLE' ? (
  <Radio checked={cur.has(t.id)} onChange={() => isDraft && toggle(date, t.id)} disabled={!isDraft} />
) : (
  <Checkbox checked={cur.has(t.id)} onChange={() => isDraft && toggle(date, t.id)} disabled={!isDraft} />
)}
```

### H2. `as any` casts on ALL tRPC calls in shift panels — complete type-safety loss

**File**: `apps/admin/src/shift-reg-list-panel.tsx` (line 43), `apps/admin/src/shift-reg-detail-panel.tsx` (lines 55, 73, 119, 134, 147)  
**Severity**: HIGH

Every tRPC call in both shift panels uses `(trpc.shiftRegistration as any)` or `(trpc.shiftConfig as any)`. The typed client `trpc` is correctly typed as `TRPCClient<AppRouter>` and the backend routers are registered as `shiftRegistration` and `shiftConfig`. The `as any` casts bypass TypeScript entirely.

This means:
- No compile-time detection of input shape mismatches
- No autocomplete for procedure names or parameters
- If the backend API changes, these call sites silently break at runtime

**Likely cause**: The `Awaited<ReturnType<typeof trpc.shiftRegistration.list.query>>` type on line 12 suggests the author tried to use proper types but hit inference issues and resorted to `as any` as a workaround.

**Fix**: Remove all `as any` casts. Verify the tRPC client proxy chain resolves `trpc.shiftRegistration.list.query` and `trpc.shiftConfig.list.query` correctly. If the issue is that the tRPC v11 client proxy doesn't resolve nested properties in TypeScript, add explicit return type annotations on the query wrappers.

### H3. `handleSubmit` does not update local `reg` state after success — UI stale for new registrations

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`  
**Lines**: 130-139  
**Severity**: HIGH

```ts
async function handleSubmit() {
  if (!reg?.id) return;
  setBusy(true);
  try {
    await (trpc.shiftRegistration as any).submit.mutate({ id: reg.id });
    notifySuccess('Đã gửi phiếu duyệt');
    loadReg();  // BUG: loadReg returns immediately if isNew is true (regId === 'new')
  } catch (e) {
    notifyError(e, 'Không gửi được');
  } finally { setBusy(false); }
}
```

`loadReg()` at line 136 checks `if (isNew) { setLoading(false); return; }` on line 53. For registrations created via the "Tạo phiếu" flow, `regId` is still `'new'`, so `loadReg()` is a no-op. The local `reg.status` remains `'draft'`, the grid stays editable, and the "Gửi duyệt" button remains visible. Clicking it again sends a second submit request, which the backend rejects with CONFLICT ("Chỉ nộp được phiếu nháp").

**Fix**: Update local state directly after success:
```ts
const result = await (trpc.shiftRegistration as any).submit.mutate({ id: reg.id });
setReg((prev: any) => ({ ...prev, status: 'submitted', code: result.code }));
```

### H4. Frontend role-based group resolution differs from backend position-based resolution

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`, lines 76-79  
**File**: `apps/api/src/routers/shift-registration.ts`, lines 10-15  
**Severity**: HIGH

**Frontend** (loadGroup):
```ts
const isSales = me.roles.some((r) => ['sale', 'cskh', 'ctv_mkt'].includes(r));
const isTeacher = me.roles.some((r) => ['giao_vien', 'head_teacher'].includes(r));
```

**Backend** (resolveShiftGroup):
```ts
function resolveShiftGroup(position: string): string {
  if (['sale', 'cskh', 'ctv_mkt'].some((r) => position.includes(r))) return 'KINH_DOANH';
  if (['giao_vien', 'head_teacher'].some((r) => position.includes(r))) return 'GIAO_VIEN';
  return 'KINH_DOANH';
}
```

The frontend checks exact role array membership. The backend checks if the `position` string (from `EmploymentProfile.position`) *contains* any of the role strings as a substring. These can diverge:

- A user with role `giao_vien` but `position: "trợ_giảng"` → frontend treats as teacher (GIAO_VIEN), backend falls through to KINH_DOANH (no match)
- The `create` mutation on the backend uses `resolveShiftGroup(profile.position)` to determine the shift group, so the actual group assigned may differ from what the frontend displays

**Fix**: Either (A) pass the shift group ID from the backend as part of a dedicated endpoint instead of client-side inference, or (B) use the same `position` field from the session instead of `roles` for display-only purposes, with a fallback for when the frontend and backend disagree.

---

## MEDIUM Priority Issues

### M1. `saveDay` has no success feedback — silent success even if wired up

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`  
**Lines**: 111-127  
**Severity**: MEDIUM

The try/catch in `saveDay` only handles the error case. On success, nothing happens — no toast, no visual indicator. Even after fixing C1 to wire up `saveDay`, users won't know if their save went through.

**Fix**: Add `notifySuccess('Đã lưu ca')` inside the try block after the await.

### M2. `loadGroup` fetches ALL shift groups and filters in-memory on client

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`  
**Lines**: 72-83  
**Severity**: MEDIUM

`shiftConfig.list.query({ facilityId: fid })` returns every shift group for the facility. The code then iterates to find the matching group based on role. This is fine for 2-3 groups but wasteful if more groups are added later. Additionally, the same query is called even when just viewing a submitted/approved registration (where the group is locked).

**Fix**: The loaded registration (`reg`) already includes `shiftGroupId` from its `create` backend response. Use `reg.shiftGroupId` to fetch only the relevant group, or expose a `getById` endpoint. For the "new" flow where no registration exists yet, continue using the role-based approach but as a fallback.

### M3. `punch` function not wrapped in `useCallback` — unnecessary re-render risk

**File**: `apps/admin/src/checkin-panel.tsx`  
**Lines**: 47-56  
**Severity**: MEDIUM

The `punch` function is recreated on every render of `CheckInPanel`. It is passed as `onClick` to the `Button` component. While the Button re-renders on every state change anyway (clock updates every second via `setClock`), the pattern is inconsistent with `loadStatus` which is wrapped in `useCallback` at line 30.

**Fix**: Either remove `useCallback` from `loadStatus` (it depends on `fid` which is stable) or wrap `punch` in `useCallback` for consistency. Given the 1-second clock re-render, neither approach matters for performance — consistency is the main concern.

### M4. `notifySuccess` parameter ordering verified — no actual bug, but easy to misuse

**File**: `apps/admin/src/checkin-panel.tsx` line 51, `shift-reg-detail-panel.tsx` lines 135, 152  
**Severity**: MEDIUM

`notifySuccess(message: string, title = 'Thành công')` — single-arg calls pass `message`. The calls `notifySuccess('Chấm công thành công!')` and `notifySuccess('Đã gửi phiếu duyệt')` are correct. However, `notifyError(err, title)` takes `(err, title)` — the first arg is an error object, second is the title string. This is correct in all call sites.

### M5. `NewRegForm` date validation uses string comparison — fragile

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`  
**Line**: 349  
**Severity**: MEDIUM

```tsx
disabled={!fromDate || !toDate || fromDate > toDate}
```

String comparison `fromDate > toDate` works for `YYYY-MM-DD` format because lexicographic order matches chronological order. However, this is fragile — if the input format ever changes (e.g., `DD/MM/YYYY`), this comparison breaks silently.

**Fix**: Use dayjs for comparison: `dayjs(fromDate).isAfter(dayjs(toDate))`.

---

## LOW Priority Issues

### L1. `TH_STYLE` duplicated across 3 panel files + App.tsx

**Files**: `checkin-panel.tsx` (line 7), `shift-reg-list-panel.tsx` (line 7), `shift-reg-detail-panel.tsx` (line 7), `App.tsx` (line 75)  
**Severity**: LOW

The same CSSProperties object is defined in four files. Duplication risk: if one site changes but others don't, visual inconsistency results.

**Fix**: Export from a shared constants file or the `@cmc/ui` package.

### L2. `Table.Tfoot` uses `Table.Td` instead of `Table.Th` for total row

**File**: `apps/admin/src/shift-reg-detail-panel.tsx`  
**Lines**: 283, 285, 291  
**Severity**: LOW

```tsx
<Table.Tfoot>
  <Table.Tr>
    <Table.Td><Text size="sm" fw={700}>TỔNG</Text></Table.Td>
```

The footer row is semantically a header row for the foot section. `Table.Th` with `scope="row"` would be more semantically correct. No visual impact with current Mantine implementation.

### L3. `Punch` type alias unused in destructured data

**File**: `apps/admin/src/checkin-panel.tsx`  
**Line**: 13  
**Severity**: LOW

```ts
type Punch = { id: string; time: string | Date; method: string };
```

This type is used in the `.map()` callback at line 163: `(p: Punch, i: number)`. That's the only usage. The `status.punches` array from `todayStatus` already has this shape, so the explicit type annotation on the map callback is fine but the separate type alias adds no value.

---

## Positive Observations

1. **Timer cleanup correct**: `useEffect` with `setInterval` in `checkin-panel.tsx` line 24-27 correctly returns `clearInterval(timer)`.
2. **Error handling present in all mutations**: Every try/catch block calls `notifyError` with a user-friendly message.
3. **Loading states covered**: All three panels handle loading, empty, and error states.
4. **`enumerateDates` correct**: Properly includes the end date via `cur.isSame(end, 'day')` check.
5. **`groupByDate` correct**: Uses `YYYY-MM-DD` key format, consistent with `enumerateDates` output.
6. **`toggle` logic correct**: SINGLE mode correctly deselects all when clicking the same item, or replaces with the new item. MULTIPLE mode correctly toggles.
7. **Backend validation present**: `updateEntry` validates SINGLE mode (max 1 entry), `submit` validates non-empty entries, `create` validates no existing submitted registration.
8. **Permission snapshot parity**: All `shiftReg.*`, `checkInOut.*`, and `shiftConfig.*` entries are present in both `permissions.ts` and `permission-snapshot.json`.

---

## Summary

| Severity | Count | Key Findings |
|----------|-------|-------------|
| CRITICAL | 2 | saveDay never called (data loss); nav gates too permissive (broken UX for non-target roles) |
| HIGH | 4 | Radio for MULTIPLE mode; as any on all tRPC calls; stale state after submit; role/position mismatch |
| MEDIUM | 5 | No success feedback in saveDay; wasteful loadGroup query; useCallback gap; fragile date comparison |
| LOW | 3 | Duplicated TH_STYLE; semantic table markup; unused type alias |

### Recommended Fix Order

1. **Wire up `saveDay`** (C1) — the grid is non-functional without it. Add per-row save buttons.
2. **Fix nav gates** (C2) — prevent non-target roles from seeing broken panels.
3. **Fix `handleSubmit` stale state** (H3) — update local reg state after submit.
4. **Replace Radio with Checkbox for MULTIPLE mode** (H1) — UX correctness.
5. **Remove `as any` casts** (H2) — restore type safety.
6. **Add success toast to `saveDay`** (M1).
7. **Address remaining MEDIUM and LOW issues** as bandwidth permits.
