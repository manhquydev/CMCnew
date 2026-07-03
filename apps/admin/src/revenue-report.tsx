import { useCallback, useState } from 'react';
import { trpc, notifyError, StatCard } from '@cmc/ui';
import { Alert, Button, Card, Group, Select, SimpleGrid, Table, Text, TextInput, Title } from '@mantine/core';
import { IconCash, IconDownload, IconReceiptRefund, IconRefresh, IconTrendingUp } from '@tabler/icons-react';

type RevenueBucket = Awaited<ReturnType<typeof trpc.finance.revenueReport.query>>[number];
type GroupBy = 'month' | 'facility' | 'course';

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'month', label: 'Theo tháng' },
  { value: 'facility', label: 'Theo cơ sở' },
  { value: 'course', label: 'Theo khóa học' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthAgoIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

// Read-only revenue report (P3): gross/refunds/net by month|facility|course + CSV export.
// This is a LIVE ledger view, not an immutable snapshot — a receipt cancelled after its approval
// month retroactively drops from that month's gross on re-run (status no longer qualifies), so
// the same period can report a different total tomorrow. That is intended accounting behavior,
// not a bug: figures always reflect the CURRENT ledger state.
export function RevenueReportPanel() {
  const [from, setFrom] = useState(monthAgoIso());
  const [to, setTo] = useState(todayIso());
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [rows, setRows] = useState<RevenueBucket[]>([]);
  const [load, setLoad] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [error, setError] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);

  const runReport = useCallback(() => {
    setLoad('loading');
    setError('');
    trpc.finance.revenueReport
      .query({ from, to, groupBy })
      .then((data) => {
        setRows(data);
        setLoad('ok');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Lỗi tải báo cáo doanh thu');
        setLoad('error');
      });
  }, [from, to, groupBy]);

  async function exportCsv() {
    setCsvBusy(true);
    try {
      const { csv } = await trpc.finance.revenueReportCsv.query({ from, to, groupBy });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `doanh-thu_${groupBy}_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notifyError(e, 'Xuất CSV thất bại');
    } finally {
      setCsvBusy(false);
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({ gross: acc.gross + r.gross, refunds: acc.refunds + r.refunds, net: acc.net + r.net }),
    { gross: 0, refunds: 0, net: 0 },
  );

  return (
    <Card withBorder p="lg">
      <Title order={5} mb="sm">
        Báo cáo doanh thu
      </Title>

      <Group align="flex-end" mb="sm">
        <TextInput label="Từ ngày" placeholder="YYYY-MM-DD" value={from} onChange={(e) => setFrom(e.currentTarget.value)} w={160} />
        <TextInput label="Đến ngày (không bao gồm)" placeholder="YYYY-MM-DD" value={to} onChange={(e) => setTo(e.currentTarget.value)} w={200} />
        <Select
          label="Gom nhóm"
          data={GROUP_BY_OPTIONS}
          value={groupBy}
          onChange={(v) => v && setGroupBy(v as GroupBy)}
          allowDeselect={false}
          w={180}
        />
        <Button leftSection={<IconRefresh size={14} />} onClick={runReport} loading={load === 'loading'}>
          Xem báo cáo
        </Button>
        <Button
          variant="light"
          leftSection={<IconDownload size={14} />}
          onClick={exportCsv}
          loading={csvBusy}
          disabled={load !== 'ok'}
        >
          Xuất CSV
        </Button>
      </Group>

      <Text size="xs" c="dimmed" mb="sm">
        Doanh thu tính theo ngày duyệt phiếu (approvedAt); là báo cáo trực tiếp trên sổ hiện tại —
        một phiếu bị hủy sau khi đã duyệt sẽ tự động rời khỏi tổng của kỳ đó khi chạy lại báo cáo.
      </Text>

      {load === 'error' && (
        <Alert color="red" title="Lỗi tải báo cáo">
          {error}
        </Alert>
      )}
      {load === 'idle' && (
        <Text c="dimmed" size="sm">
          Chọn khoảng thời gian rồi bấm "Xem báo cáo".
        </Text>
      )}
      {load === 'ok' && rows.length === 0 && (
        <Text c="dimmed" size="sm">
          Không có doanh thu trong khoảng thời gian này.
        </Text>
      )}
      {load === 'ok' && rows.length > 0 && (
        <>
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md" mb="md">
            <StatCard
              label="Doanh thu gộp"
              value={vnd(totals.gross)}
              icon={<IconCash size={18} stroke={1.5} />}
              accent="brand"
            />
            <StatCard
              label="Hoàn tiền"
              value={vnd(totals.refunds)}
              icon={<IconReceiptRefund size={18} stroke={1.5} />}
              accent="danger"
              muted={totals.refunds === 0}
            />
            <StatCard
              label="Doanh thu ròng"
              value={vnd(totals.net)}
              icon={<IconTrendingUp size={18} stroke={1.5} />}
              accent="ok"
            />
          </SimpleGrid>
          <Table fz="sm" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Kỳ</Table.Th>
                <Table.Th>Doanh thu gộp</Table.Th>
                <Table.Th>Hoàn tiền</Table.Th>
                <Table.Th>Doanh thu ròng</Table.Th>
                <Table.Th>Số phiếu</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.key}>
                  <Table.Td>{r.label}</Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(r.gross)}</Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(r.refunds)}</Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{vnd(r.net)}</Table.Td>
                  <Table.Td>{r.count}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td fw={700}>Tổng</Table.Td>
                <Table.Td fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(totals.gross)}</Table.Td>
                <Table.Td fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(totals.refunds)}</Table.Td>
                <Table.Td fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(totals.net)}</Table.Td>
                <Table.Td fw={700}>{rows.reduce((s, r) => s + r.count, 0)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </>
      )}
    </Card>
  );
}
