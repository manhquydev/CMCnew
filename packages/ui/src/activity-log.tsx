// Reusable activity-log (Odoo-chatter-style) presentation primitive — part of the system-wide
// UX framework (plan: odoo-parity-ux-framework, F1). Presentation-only: each module fetches its
// OWN entries via its secure endpoint (e.g. audit.staffTimeline) and passes them here, so this
// component carries no entity coupling or permission logic. Renders "ai · làm gì · khi nào" with
// human-readable field changes.

import { Card, ScrollArea, Skeleton, Text, Timeline } from '@mantine/core';

export interface ActivityEntry {
  id: string;
  /** event type: created | updated | status_changed | archived | restored | note | … */
  type: string;
  body?: string | null;
  /** tracking values, shape [{ field, old, new }] — kept `unknown` (server Json). */
  changes?: unknown;
  /** resolved human name of the actor (caller resolves; null/"Hệ thống" for automated). */
  actorName?: string | null;
  createdAt: string | Date;
}

export interface ActivityLogProps {
  entries: ActivityEntry[];
  loading?: boolean;
  /** field key → human label, e.g. { primaryRole: 'Vai trò chính' }. */
  fieldLabels?: Record<string, string>;
  /** optional per-field value formatter; falls back to a generic one. */
  formatValue?: (field: string, value: unknown) => string;
  /** event type → label override; merged over the Vietnamese defaults. */
  eventLabels?: Record<string, string>;
  title?: string;
  maxHeight?: number;
}

const DEFAULT_EVENT_LABELS: Record<string, string> = {
  created: 'đã tạo',
  updated: 'đã cập nhật',
  status_changed: 'đã đổi trạng thái',
  archived: 'đã lưu trữ',
  restored: 'đã khôi phục',
  note: 'đã ghi chú',
};

function genericFormat(_field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '(trống)';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function changeRows(
  changes: unknown,
  fieldLabels: Record<string, string>,
  fmt: (field: string, value: unknown) => string,
): { label: string; from: string; to: string }[] {
  if (!Array.isArray(changes)) return [];
  return (changes as { field: string; old: unknown; new: unknown }[])
    .map((c) => ({
      label: fieldLabels[c.field] ?? c.field,
      from: fmt(c.field, c.old),
      to: fmt(c.field, c.new),
    }))
    // Drop no-op lines (X → X) so the log shows only what actually changed.
    .filter((r) => r.from !== r.to);
}

export function ActivityLog({
  entries,
  loading = false,
  fieldLabels = {},
  formatValue,
  eventLabels,
  title = 'Nhật ký hoạt động',
  maxHeight = 420,
}: ActivityLogProps) {
  const fmt = formatValue ?? genericFormat;
  const events = eventLabels ? { ...DEFAULT_EVENT_LABELS, ...eventLabels } : DEFAULT_EVENT_LABELS;

  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text fw={600} mb="sm">{title}</Text>
      {loading ? (
        <Skeleton height={60} radius="md" />
      ) : entries.length === 0 ? (
        <Text size="sm" c="dimmed">Chưa có hoạt động.</Text>
      ) : (
        <ScrollArea.Autosize mah={maxHeight}>
          <Timeline active={-1} bulletSize={14} lineWidth={2}>
            {entries.map((e) => (
              <Timeline.Item
                key={e.id}
                title={<Text size="sm" fw={500}>{e.actorName || 'Hệ thống'} {events[e.type] ?? e.type}</Text>}
              >
                {e.body && <Text size="xs">{e.body}</Text>}
                {changeRows(e.changes, fieldLabels, fmt).map((c, i) => (
                  <Text key={i} size="xs" c="dimmed">{c.label}: {c.from} → {c.to}</Text>
                ))}
                <Text size="xs" c="dimmed">{new Date(e.createdAt).toLocaleString('vi-VN')}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </ScrollArea.Autosize>
      )}
    </Card>
  );
}
