import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text, Textarea, Timeline } from '@mantine/core';
import { trpc } from './client.js';

// Explicit shape (deriving via the tRPC client blows TS's instantiation depth).
interface TimelineEvent {
  id: string;
  type: string;
  body: string | null;
  changes: unknown;
  createdAt: string | Date;
}
type Change = { field: string; old: unknown; new: unknown };

const TYPE_LABEL: Record<string, string> = {
  created: 'Tạo mới',
  updated: 'Cập nhật',
  status_changed: 'Đổi trạng thái',
  archived: 'Lưu trữ',
  restored: 'Khôi phục',
  note: 'Ghi chú',
};

function fmt(d: string | Date): string {
  return new Date(d).toLocaleString('vi-VN');
}

/** Reusable Odoo-style chatter: auto change-log + manual notes on any record. */
export function Chatter({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    trpc.audit.timeline
      .query({ entityType, entityId })
      .then((r) => setEvents(r as TimelineEvent[]))
      .catch(() => {});
  }, [entityType, entityId]);

  useEffect(load, [load]);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await trpc.audit.postNote.mutate({ entityType, entityId, body });
      setBody('');
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Text fw={600} mb="sm">
        Nhật ký & ghi chú
      </Text>
      <Group align="flex-end" mb="md" wrap="nowrap">
        <Textarea
          style={{ flex: 1 }}
          placeholder="Thêm ghi chú cho hồ sơ này…"
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          autosize
          minRows={1}
        />
        <Button onClick={post} loading={busy}>
          Gửi
        </Button>
      </Group>
      {events.length === 0 ? (
        <Text c="dimmed" size="sm">
          Chưa có hoạt động.
        </Text>
      ) : (
        <Timeline active={events.length} bulletSize={16} lineWidth={2}>
          {events.map((e) => (
            <Timeline.Item
              key={e.id}
              title={
                <Group gap="xs">
                  <Badge size="sm" variant="light" color={e.type === 'status_changed' ? 'orange' : 'cmc'}>
                    {TYPE_LABEL[e.type] ?? e.type}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {fmt(e.createdAt)}
                  </Text>
                </Group>
              }
            >
              {e.body && <Text size="sm">{e.body}</Text>}
              {Array.isArray(e.changes) &&
                (e.changes as Change[]).map((c, i) => (
                  <Text key={i} size="sm" c="dimmed">
                    {c.field}: {String(c.old)} → {String(c.new)}
                  </Text>
                ))}
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </Card>
  );
}
