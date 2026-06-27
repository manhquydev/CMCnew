---
phase: 3
title: "Teaching — Logo Fix + Class Pagination + Status Filter"
status: pending
priority: P1
dependencies: []
---

# Phase 03: Teaching Logo + Pagination + Filter

## Overview

3 issues độc lập trong Teaching app:
1. Topbar logo hiện "C" trong blue box → đổi thành "CMC" text như Admin shell
2. Class list tải 233 lớp không phân trang → thêm pagination 20/page
3. Status filter (radio Tất cả/Planned/Open/Running/Closed/Cancelled) đã có nhưng cần verify UX

## Related Code Files

- Modify: `apps/teaching/src/shell.tsx` — logo fix (lines ~188–202)
- Modify: `apps/teaching/src/App.tsx` — Classes component: add pagination state + slice

## Implementation Steps

### 1. Logo fix trong shell.tsx

**Hiện tại** (lines ~187–206):
```tsx
<Box style={{ width:28, height:28, borderRadius:6, backgroundColor:'var(--cmc-brand)',
  display:'flex', alignItems:'center', justifyContent:'center' }}>
  <Text size="xs" fw={700} style={{ color:'#fff', lineHeight:1 }}>C</Text>
</Box>
<Text size="sm" fw={600} style={{ color:'var(--cmc-text)' }}>
  {SECTION_LABEL[activeSection]}
</Text>
```

**Đổi thành** (giống Admin shell.tsx):
```tsx
<Text fw={700} style={{ color:'var(--cmc-brand)', fontSize:18, letterSpacing:'-0.02em' }}>
  CMC
</Text>
<Text size="sm" style={{ color:'var(--cmc-text-muted)' }}>
  {SECTION_LABEL[activeSection]}
</Text>
```

### 2. Pagination trong Classes component (App.tsx)

Tìm Classes component trong App.tsx. Hiện load toàn bộ class list.

```tsx
const PAGE_SIZE = 20;
const [page, setPage] = useState(1);

// Sau filter (status + search text):
const filteredClasses = allClasses
  .filter(c => statusFilter === 'all' || c.status === statusFilter)
  .filter(c => !searchText || c.code.includes(searchText) || c.name.includes(searchText));

const totalPages = Math.ceil(filteredClasses.length / PAGE_SIZE);
const pageClasses = filteredClasses.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

// Reset page khi đổi filter:
const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(1); };
const handleSearch = (v: string) => { setSearchText(v); setPage(1); };

// Thêm Pagination component dưới list:
<Pagination total={totalPages} value={page} onChange={setPage} size="sm" mt="md" />
```

**Lưu ý**: Không thay đổi API call — vẫn fetch toàn bộ rồi paginate client-side.
Với 233 lớp dữ liệu seed này là OK. Nếu prod có >1000 lớp thì cần server-side pagination (để phase sau).

### 3. Verify status filter

Hiện filter radio đã có trong UI nhưng cần check:
- Reset page về 1 khi đổi filter ✓ (covered trên)
- Filter "Planned" hiển thị đúng count
- Search text + status filter hoạt động cùng nhau

## Success Criteria

- [ ] Teaching topbar: "CMC" text thay vì "C" trong blue box
- [ ] Teaching topbar: nhất quán visual với Admin topbar
- [ ] Class list: chỉ hiển thị 20 lớp/page
- [ ] Pagination control hiển thị dưới list, navigate đúng
- [ ] Filter status + search reset page về 1
- [ ] typecheck + build xanh

## Risk Assessment

- **Thấp**: Logo là thay đổi CSS đơn giản
- **Thấp**: Pagination là client-side slice, không thay đổi API
- **Trung bình**: Cần tìm đúng Classes component trong App.tsx (có thể là component lớn nhiều state)
