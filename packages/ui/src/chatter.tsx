import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Text, Textarea, Timeline } from '@mantine/core';
import { trpc } from './client.js';

// Explicit shape (deriving via the tRPC client blows TS's instantiation depth).
interface TimelineEvent {
  id: string;
  type: string;
  body: string | null;
  changes: unknown;
  actorName?: string | null;
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

function genericFormatValue(_field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(trống)';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  return String(v);
}

/** Best-effort human message from a tRPC/network error, with a friendly fallback. */
function msgOf(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : '';
  return m.trim() ? m : fallback;
}

/** Reusable Odoo-style chatter: auto change-log + manual notes on any record. */
export function Chatter({
  entityType,
  entityId,
  fieldLabels = {},
  formatValue = genericFormatValue,
}: {
  entityType: string;
  entityId: string;
  /** field key → human label, e.g. { stage: 'Giai đoạn' }. Falls back to the raw field key. */
  fieldLabels?: Record<string, string>;
  /** optional per-field value formatter; falls back to a generic one (raw string). */
  formatValue?: (field: string, value: unknown) => string;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    trpc.audit.timeline
      .query({ entityType, entityId })
      .then((r) => {
        setEvents(r as TimelineEvent[]);
        setError(null);
      })
      .catch((e: unknown) => setError(msgOf(e, 'Không tải được nhật ký.')));
  }, [entityType, entityId]);

  useEffect(load, [load]);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.audit.postNote.mutate({ entityType, entityId, body });
      setBody('');
      load();
    } catch (e: unknown) {
      // Surface 401/permission/network failures instead of silently dropping the note.
      setError(msgOf(e, 'Gửi ghi chú thất bại. Thử lại.'));
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
      {error && (
        <Alert color="red" variant="light" mb="md" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
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
                  <Text size="xs" fw={500}>{e.actorName || 'Hệ thống'}</Text>
                  <Text size="xs" c="dimmed">
                    {fmt(e.createdAt)}
                  </Text>
                </Group>
              }
            >
              {e.body && <Text size="sm">{e.body}</Text>}
              {Array.isArray(e.changes) &&
                (e.changes as Change[])
                  .map((c) => ({
                    label: fieldLabels[c.field] ?? c.field,
                    from: formatValue(c.field, c.old),
                    to: formatValue(c.field, c.new),
                  }))
                  // Drop no-op lines (X → X) so the log shows only what actually changed.
                  .filter((r) => r.from !== r.to)
                  .map((r, i) => (
                    <Text key={i} size="sm" c="dimmed">
                      {r.label}: {r.from} → {r.to}
                    </Text>
                  ))}
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </Card>
  );
}
