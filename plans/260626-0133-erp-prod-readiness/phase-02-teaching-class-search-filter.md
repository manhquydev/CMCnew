---
phase: 2
title: "Teaching class search+filter"
status: pending
priority: P1
dependencies: []
---

# Phase 2: Teaching class search+filter

## Overview

Class list trong Teaching có 233 lớp từ seed data. Thêm search text + status filter để tìm lớp nhanh. Filter hoàn toàn client-side (data đã load sẵn).

## Requirements

- TextInput search lọc theo batch code + course code (case-insensitive)
- Status filter chips: Tất cả / Planned / Open / Running / Closed / Cancelled
- Filter không ảnh hưởng đến workspace (lớp đang chọn giữ nguyên)

## Architecture

Trong `apps/teaching/src/App.tsx`, component `ClassListPanel` (hoặc inline trong Workspace):

```
Trước class list:
  [🔍 Tìm lớp...]  [Tất cả][Planned][Open][Running][Closed][Cancelled]

Sau:
  Lớp học (12/233)   ← show filtered count
  <list items>
```

Filter logic: `useMemo` trên `batches` array.

## Related Code Files

- Modify: `apps/teaching/src/App.tsx` — tìm phần render class list (component `Workspace` hoặc class list section)

## Implementation Steps

### 1. Tìm class list render trong App.tsx

Xác định chính xác đoạn render danh sách lớp (có text "Lớp học (233)").

### 2. Thêm state

```tsx
const [classSearch, setClassSearch] = useState('');
const [classStatusFilter, setClassStatusFilter] = useState<string>('all');
```

### 3. Tính filteredBatches

```tsx
const filteredBatches = useMemo(() => {
  return batches.filter(b => {
    const matchText = !classSearch ||
      b.code.toLowerCase().includes(classSearch.toLowerCase()) ||
      b.courseCode?.toLowerCase().includes(classSearch.toLowerCase());
    const matchStatus = classStatusFilter === 'all' || b.status === classStatusFilter;
    return matchText && matchStatus;
  });
}, [batches, classSearch, classStatusFilter]);
```

### 4. Render filter UI

```tsx
// Phía trên danh sách:
<Stack gap="xs" mb="sm">
  <TextInput
    placeholder="Tìm lớp..."
    leftSection={<IconSearch size={14} />}
    value={classSearch}
    onChange={e => setClassSearch(e.currentTarget.value)}
    size="xs"
  />
  <SegmentedControl
    size="xs"
    value={classStatusFilter}
    onChange={setClassStatusFilter}
    data={[
      { value: 'all', label: 'Tất cả' },
      { value: 'planned', label: 'Planned' },
      { value: 'open', label: 'Open' },
      { value: 'running', label: 'Running' },
      { value: 'closed', label: 'Closed' },
    ]}
  />
</Stack>

// Header thay: "Lớp học ({filteredBatches.length}/{batches.length})"
// Render filteredBatches thay vì batches
```

### 5. Verify

```bash
pnpm --filter @cmc/teaching build
pnpm -r typecheck
# Kiểm tra browser: gõ "CB-S4" → chỉ thấy lớp Class-S4
```

## Success Criteria

- [ ] Search text lọc được theo batch code
- [ ] Status filter hoạt động
- [ ] Header count update khi filter
- [ ] Typecheck pass

## Risk Assessment

**Minimal** — filter hoàn toàn client-side, không động API. Chỉ thêm state và useMemo.
