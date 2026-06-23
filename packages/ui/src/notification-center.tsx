import { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { trpc } from './client.js';

type Notif = Awaited<ReturnType<typeof trpc.notification.list.query>>[number];

/** Human label + icon per notification type. Falls back to a generic line for unknown types
 * so a newly-added server event still renders before the UI learns its copy. */
function describe(n: Notif): { icon: string; text: string } {
  const p = n.payload;
  switch (n.type) {
    case 'grade_published': {
      const score = p.score != null ? ` ${p.score} điểm` : '';
      const stars = p.starsEarned ? ` · +${p.starsEarned} ⭐` : '';
      return { icon: '📝', text: `Bài "${p.exercise ?? ''}" đã có điểm:${score}${stars}` };
    }
    case 'badge_awarded':
      return { icon: '🏅', text: `Đạt huy hiệu "${p.badge ?? ''}"` };
    case 'level_up':
      return { icon: '🎉', text: `Lên cấp độ ${p.toLevel ?? ''}` };
    default:
      return { icon: '🔔', text: 'Thông báo mới' };
  }
}

/** Relative time in Vietnamese, coarse buckets — enough for an inbox glance. */
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

/**
 * Persistent notification inbox for an LMS principal. Reads the durable history
 * (notification.list/unreadCount) and re-pulls whenever `pulse` bumps — the caller
 * bumps it from the live SSE stream so a freshly-pushed alert lands in the bell.
 * Opening the popover marks everything read.
 */
export function NotificationCenter({ pulse = 0 }: { pulse?: number }) {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [opened, setOpened] = useState(false);

  const load = useCallback(() => {
    void trpc.notification.list.query().then(setItems).catch(() => setItems([]));
    void trpc.notification.unreadCount.query().then(setUnread).catch(() => setUnread(0));
  }, []);
  useEffect(load, [load, pulse]);

  const markRead = useCallback(() => {
    if (unread === 0) return;
    void trpc.notification.markAllRead
      .mutate()
      .then(() => {
        setUnread(0);
        setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      })
      .catch(() => {
        /* keep the badge; a later open retries */
      });
  }, [unread]);

  return (
    <Popover
      width={340}
      position="bottom-end"
      shadow="md"
      opened={opened}
      onChange={setOpened}
      onClose={markRead}
    >
      <Popover.Target>
        <Indicator label={unread > 9 ? '9+' : unread} disabled={unread === 0} color="red" size={16} offset={4}>
          <ActionIcon
            variant="subtle"
            size="lg"
            aria-label="Thông báo"
            onClick={() => setOpened((o) => !o)}
          >
            <Text size="xl">🔔</Text>
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="xs">
          <Text fw={600} size="sm">
            Thông báo
          </Text>
          {unread > 0 && (
            <Button variant="subtle" size="compact-xs" onClick={markRead}>
              Đánh dấu đã đọc
            </Button>
          )}
        </Group>
        <ScrollArea.Autosize mah={360}>
          {items.length === 0 ? (
            <Text c="dimmed" size="sm" px="md" py="lg" ta="center">
              Chưa có thông báo nào.
            </Text>
          ) : (
            <Stack gap={0}>
              {items.map((n) => {
                const d = describe(n);
                return (
                  <Group
                    key={n.id}
                    align="flex-start"
                    wrap="nowrap"
                    px="md"
                    py="xs"
                    bg={n.readAt ? undefined : 'var(--mantine-color-cmc-0)'}
                    style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}
                  >
                    <Text>{d.icon}</Text>
                    <div style={{ flex: 1 }}>
                      <Text size="sm">{d.text}</Text>
                      <Text c="dimmed" size="xs">
                        {ago(n.createdAt)}
                      </Text>
                    </div>
                    {!n.readAt && <Badge size="xs" color="red" variant="filled" circle />}
                  </Group>
                );
              })}
            </Stack>
          )}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
