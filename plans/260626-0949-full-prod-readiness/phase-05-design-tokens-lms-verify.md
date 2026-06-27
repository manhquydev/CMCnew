---
phase: 5
title: "Design Tokens Content Sweep + LMS Live Verify"
status: pending
priority: P2
dependencies: [1, 2, 3]
---

# Phase 05: Design Tokens Sweep + LMS Verify

## Overview

Sau khi các phase parallel (01–04) xong, sweep toàn bộ content panels để áp đúng design tokens
theo `docs/design-system.md`. Đồng thời verify LMS student/parent views với account thật.

**Scope giới hạn**: Chỉ fix token violations rõ ràng — không redesign layout hay logic.
Anti-pattern cần fix: table header không uppercase, badge không có icon, custom hex colors, shadow thay border.

## Related Code Files

- Sweep: `apps/admin/src/*.tsx` (tất cả panels)
- Sweep: `apps/teaching/src/*.tsx` (tất cả panels)
- Sweep: `apps/lms/src/student-view.tsx`, `parent-view.tsx`
- Reference: `docs/design-system.md` (Anti-Patterns section)
- Reference: `packages/ui/src/tokens.css`

## Design Token Checklist

Áp dụng cho từng panel:

### Table Headers
```tsx
// ❌ Trước
<Table.Th>Tên</Table.Th>

// ✅ Sau (dùng TH_STYLE constant đã define trong admin/App.tsx)
const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};
<Table.Th style={TH_STYLE}>Tên</Table.Th>
```

### Status Badges — phải có icon + color
```tsx
// ❌ Trước
<Badge color="green">Hoạt động</Badge>

// ✅ Sau
<Group gap={4}>
  <IconCircleCheck size={12} color="var(--cmc-status-active)" />
  <Badge color="cmcGreen" variant="light" radius="xl">Hoạt động</Badge>
</Group>
```

### Cards — border không shadow
```tsx
// ❌ Trước
<Card shadow="sm">...</Card>

// ✅ Sau
<Card radius="lg" style={{ border: '1px solid var(--cmc-border)' }}>...</Card>
```

### Buttons
```tsx
// Primary: pill shape
<Button variant="filled" radius={9999}>Tạo mới</Button>

// Secondary: subtle (not outline)
<Button variant="subtle">Xem</Button>
```

### Custom hex → var()
```tsx
// ❌ #007bff, #28a745, etc.
// ✅ var(--cmc-brand), var(--cmc-status-active), etc.
```

## Implementation Approach

1. **Grep** tất cả `color="#` và `shadow="` trong apps/admin/src + apps/teaching/src
2. Fix từng vi phạm — ưu tiên theo panel: finance > crm > payroll > kpi > overview
3. Add `TH_STYLE` constant vào panels chưa có (hoặc import từ @cmc/ui nếu đã export)
4. Badge + icon pair cho status columns

## LMS Live Verify

### Test accounts (từ seed.ts):
- Parent: `ph@cmc.local` / `Parent!123`
- Student: kiểm tra `seed-lms.ts` để lấy account

### Checklist LMS:
- [ ] Login PH → thấy student-shell layout + tab Bài tập / Điểm / Thông báo
- [ ] Login HS → thấy parent-shell layout + tab tương ứng
- [ ] Thông báo LMS (notification router) có data không
- [ ] Bài tập list render đúng
- [ ] Không có console error

## Success Criteria

- [ ] Grep `color="#` trong content panels → 0 kết quả (không còn custom hex)
- [ ] Tất cả table headers có TH_STYLE (uppercase 11px muted)
- [ ] Status badges có icon + color pair
- [ ] Tất cả Card không dùng shadow (chỉ border)
- [ ] LMS: login PH thành công, thấy student list
- [ ] LMS: login HS thành công, thấy bài tập
- [ ] typecheck toàn monorepo xanh sau sweep

## Risk Assessment

- **Thấp**: Chỉ thay đổi style, không thay đổi logic
- **Trung bình**: Số lượng file nhiều → dễ bỏ sót. Dùng grep để tìm vi phạm, không đọc thủ công
- **LMS**: Có thể cần chạy `pnpm --filter @cmc/db seed:lms` nếu seed chưa chạy
