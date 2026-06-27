---
phase: 1
title: "Bell Notification Wiring — Admin + Teaching"
status: pending
priority: P1
dependencies: []
---

# Phase 01: Bell Notification Wiring

## Overview

Wire staffNotif router (đã có backend) vào bell icon của Admin shell và Teaching shell.
Admin bell hiện `display:none`. Teaching bell hiện visible nhưng không connect.

## Architecture

```
SSE endpoint: GET /api/events/staff  (Bearer token)
tRPC:
  staffNotif.unreadCount  → badge số
  staffNotif.list         → danh sách thông báo
  staffNotif.markAllRead  → xóa badge
  staffNotif.markRead(id) → đánh dấu 1 item
```

**Pattern**: Dùng `useQuery` polling (interval 30s) thay vì SSE phức tạp ở frontend.
SSE đã có nhưng cần EventSource setup — polling đơn giản hơn và đủ cho v1.

## Related Code Files

- Modify: `apps/admin/src/shell.tsx` — wire bell, show Popover
- Modify: `apps/teaching/src/shell.tsx` — wire bell, show Popover
- Create: `packages/ui/src/use-staff-notif.ts` — shared hook
- Modify: `packages/ui/src/index.ts` — export hook

## Implementation Steps

### 1. Shared hook `packages/ui/src/use-staff-notif.ts`

```ts
import { trpc } from './trpc';

export function useStaffNotif() {
  const unread = trpc.staffNotif.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const list = trpc.staffNotif.list.useQuery({ limit: 20 }, {
    refetchInterval: 30_000,
    enabled: false, // chỉ fetch khi mở popover
  });
  const markAll = trpc.staffNotif.markAllRead.useMutation({
    onSuccess: () => { unread.refetch(); list.refetch(); },
  });
  return { unread: unread.data ?? 0, list, markAll };
}
```

Export từ `packages/ui/src/index.ts`.

### 2. Admin shell.tsx

Thay `<Badge ... style={{ display: 'none' }}>` placeholder bằng:

```tsx
const { unread, list, markAll } = useStaffNotif();
// Bell button với Popover:
<Popover width={320} position="bottom-end">
  <Popover.Target>
    <ActionIcon aria-label="Thông báo" ...>
      <IconBell size={20} stroke={1.5} />
      {unread > 0 && (
        <Badge size="xs" color="red" variant="filled"
          style={{ position:'absolute', top:4, right:4, minWidth:16, padding:'0 4px', fontSize:9 }}>
          {unread > 99 ? '99+' : unread}
        </Badge>
      )}
    </ActionIcon>
  </Popover.Target>
  <Popover.Dropdown>
    <NotifDropdown list={list} markAll={markAll} />
  </Popover.Dropdown>
</Popover>
```

### 3. NotifDropdown component (inline trong shell.tsx hoặc tách file)

```tsx
function NotifDropdown({ list, markAll }) {
  return (
    <Stack gap={0}>
      <Group justify="space-between" px="sm" py="xs"
        style={{ borderBottom:'1px solid var(--cmc-border)' }}>
        <Text size="sm" fw={600}>Thông báo</Text>
        <Button variant="subtle" size="xs" onClick={() => markAll.mutate()}>
          Đọc tất cả
        </Button>
      </Group>
      <ScrollArea h={320}>
        {list.data?.items.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">Không có thông báo</Text>
        ) : list.data?.items.map(n => (
          <Box key={n.id} px="sm" py="xs"
            style={{ backgroundColor: n.readAt ? 'transparent' : 'var(--cmc-brand-muted)',
              borderBottom:'1px solid var(--cmc-border-faint)' }}>
            <Text size="sm" fw={n.readAt ? 400 : 500}>{n.title}</Text>
            <Text size="xs" c="dimmed">{n.body}</Text>
          </Box>
        ))}
      </ScrollArea>
    </Stack>
  );
}
```

### 4. Teaching shell.tsx

Cùng pattern như Admin — thêm `useStaffNotif()` hook + Popover wrapper quanh bell icon.
Lưu ý: `list.refetch()` chỉ khi Popover `opened` (dùng `onOpen` callback).

## Success Criteria

- [ ] Bell Admin hiển thị badge số khi có unread > 0
- [ ] Bell Teaching hiển thị badge số khi có unread > 0
- [ ] Click bell mở Popover danh sách 20 thông báo gần nhất
- [ ] "Đọc tất cả" → badge về 0
- [ ] Khi không có thông báo: empty state sạch
- [ ] typecheck xanh sau thay đổi

## Risk Assessment

- **Thấp**: staffNotif router và schema đã có, chỉ wire UI
- **Risk**: session cookie khác giữa admin/teaching app — cần verify auth works cho staffNotif
- **Mitigation**: test với account `manager.hq@cmc.local` (quan_ly role nhận notify)
