import { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess, FacilityPicker } from '@cmc/ui';
import { Alert, Badge, Button, Card, Group, Table, Text, TextInput, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

type WorklistRow = Awaited<ReturnType<typeof trpc.finance.reconcileWorklist.query>>[number];
type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  approved: { label: 'Đã duyệt', color: 'teal' },
  sent: { label: 'Đã gửi', color: 'blue' },
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthAgoIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

// "Chưa đối soát kỳ này" (P3): lists approved/sent receipts in a period that have not yet been
// reconciled, bucketed by the same approvedAt key as the revenue report. Reuses the EXISTING
// finance.receiptReconcile mutation per row — no new money mutation is introduced here.
export function ReconcileWorklistPanel() {
  const [from, setFrom] = useState(monthAgoIso());
  const [to, setTo] = useState(todayIso());
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [rows, setRows] = useState<WorklistRow[]>([]);
  const [load, setLoad] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    trpc.facility.list
      .query()
      .then(setFacilities)
      .catch(() => {});
  }, []);

  const runQuery = useCallback(() => {
    setLoad('loading');
    setError('');
    trpc.finance.reconcileWorklist
      .query({ from, to, facilityId: facilityId ? Number(facilityId) : undefined })
      .then((data) => {
        setRows(data);
        setLoad('ok');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Lỗi tải danh sách chưa đối soát');
        setLoad('error');
      });
  }, [from, to, facilityId]);

  async function reconcile(id: string) {
    setBusyId(id);
    try {
      await trpc.finance.receiptReconcile.mutate({ id });
      notifySuccess('Đã đối soát phiếu');
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      notifyError(e, 'Đối soát phiếu thất bại');
    } finally {
      setBusyId(null);
    }
  }

  const facilityName = (id: number) => {
    const f = facilities.find((x) => x.id === id);
    return f ? `${f.code} — ${f.name}` : `#${id}`;
  };

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Đối soát theo kỳ
      </Title>

      <Group align="flex-end" mb="sm">
        <TextInput label="Từ ngày" placeholder="YYYY-MM-DD" value={from} onChange={(e) => setFrom(e.currentTarget.value)} w={160} />
        <TextInput label="Đến ngày (không bao gồm)" placeholder="YYYY-MM-DD" value={to} onChange={(e) => setTo(e.currentTarget.value)} w={200} />
        <FacilityPicker
          facilities={facilities}
          placeholder="Tất cả"
          value={facilityId ? Number(facilityId) : null}
          onChange={(v) => setFacilityId(v ? String(v) : null)}
          w={220}
        />
        <Button leftSection={<IconRefresh size={14} />} onClick={runQuery} loading={load === 'loading'}>
          Xem danh sách
        </Button>
      </Group>

      {load === 'error' && (
        <Alert color="red" title="Lỗi tải danh sách">
          {error}
        </Alert>
      )}
      {load === 'idle' && (
        <Text c="dimmed" size="sm">
          Chọn khoảng thời gian rồi bấm "Xem danh sách".
        </Text>
      )}
      {load === 'ok' && rows.length === 0 && (
        <Text c="dimmed" size="sm">
          Không còn phiếu nào chưa đối soát trong kỳ này.
        </Text>
      )}
      {load === 'ok' && rows.length > 0 && (
        <Table fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Mã phiếu</Table.Th>
              <Table.Th>Cơ sở</Table.Th>
              <Table.Th>Thành tiền</Table.Th>
              <Table.Th>Ngày duyệt</Table.Th>
              <Table.Th>Trạng thái</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => {
              const st = STATUS_LABEL[r.status] ?? { label: r.status, color: 'gray' };
              return (
                <Table.Tr key={r.id}>
                  <Table.Td>{r.code ?? '—'}</Table.Td>
                  <Table.Td>{facilityName(r.facilityId)}</Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(r.netAmount)}</Table.Td>
                  <Table.Td>{r.approvedAt ? new Date(r.approvedAt).toLocaleDateString('vi-VN') : '—'}</Table.Td>
                  <Table.Td>
                    <Badge color={st.color}>{st.label}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="green"
                      loading={busyId === r.id}
                      onClick={() => reconcile(r.id)}
                    >
                      Đối soát
                    </Button>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}
