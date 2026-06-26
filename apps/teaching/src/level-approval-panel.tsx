import React, { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import { Badge, Button, Card, Group, Stack, Table, Text, TextInput, Title } from '@mantine/core';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

type Pending = Awaited<ReturnType<typeof trpc.levelProgress.listPending.query>>[number];

// head_teacher queue: approve/reject pending level-up proposals. Approve writes Student.level.
export function LevelApprovalPanel() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    trpc.levelProgress.listPending
      .query()
      .then(setRows)
      .catch((e) => notifyError(e, 'Không tải được danh sách đề xuất'));
  }, []);
  useEffect(load, [load]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(id);
    try {
      await trpc.levelProgress.decide.mutate({ id, decision, reason: reason[id]?.trim() || undefined });
      notifySuccess(decision === 'approve' ? 'Đã duyệt lên cấp độ' : 'Đã từ chối đề xuất');
      load();
    } catch (e) {
      notifyError(e, 'Xử lý đề xuất thất bại');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack>
      <Title order={4}>Duyệt lên cấp độ</Title>
      <Card withBorder>
        {rows && rows.length > 0 ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Học sinh</Table.Th>
                <Table.Th style={TH_STYLE}>Cấp độ</Table.Th>
                <Table.Th style={TH_STYLE}>Lý do đề xuất</Table.Th>
                <Table.Th style={TH_STYLE}>Ghi chú duyệt</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Text fw={600}>{r.student.fullName}</Text>
                    <Text size="xs" c="dimmed">
                      {r.student.studentCode}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{r.fromLevel ?? '—'} → {r.toLevel}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {r.reason ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td w={180}>
                    <TextInput
                      size="xs"
                      placeholder="Ghi chú (tùy chọn)"
                      value={reason[r.id] ?? ''}
                      onChange={(e) => setReason((s) => ({ ...s, [r.id]: e.currentTarget.value }))}
                    />
                  </Table.Td>
                  <Table.Td w={150}>
                    <Group gap="xs">
                      <Button size="compact-xs" color="teal" loading={busy === r.id} onClick={() => decide(r.id, 'approve')}>
                        Duyệt
                      </Button>
                      <Button size="compact-xs" color="red" variant="light" loading={busy === r.id} onClick={() => decide(r.id, 'reject')}>
                        Từ chối
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" size="sm">
            Không có đề xuất nào đang chờ duyệt.
          </Text>
        )}
      </Card>
    </Stack>
  );
}
