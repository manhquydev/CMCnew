import { useState } from 'react';
import dayjs from 'dayjs';
import { notifyError, InitialsAvatar, toApiMonth, parseApiMonth } from '@cmc/ui';
import { Badge, Button, Card, Group, Stack, Table, Text } from '@mantine/core';
import { MonthPickerInput } from '@mantine/dates';
import { attendanceApi } from './shallow-trpc';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

type ReportRow = Awaited<ReturnType<typeof attendanceApi.monthlyReport.query>>['rows'][number];

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

export function AttendanceMonthlyReportPanel({ facilityId }: { facilityId: number }) {
  const [periodKey, setPeriodKey] = useState(dayjs().format('YYYY-MM'));
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!periodKey.match(/^\d{4}-\d{2}$/)) return;
    setLoading(true);
    try {
      const report = await attendanceApi.monthlyReport.query({ facilityId, periodKey });
      setRows(report.rows);
      setSelected(null);
    } catch (e) {
      notifyError(e, 'Không tải được báo cáo công tháng');
    } finally {
      setLoading(false);
    }
  }

  const totals = rows.reduce(
    (acc, row) => ({
      workdays: acc.workdays + row.workdays,
      lateMinutes: acc.lateMinutes + row.lateMinutes,
      earlyMinutes: acc.earlyMinutes + row.earlyMinutes,
      penaltyAmount: acc.penaltyAmount + row.penaltyAmount,
    }),
    { workdays: 0, lateMinutes: 0, earlyMinutes: 0, penaltyAmount: 0 },
  );

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }}>Báo cáo công tháng</Text>
          <Text size="sm" style={{ color: 'var(--cmc-text-muted)' }}>
            Tổng hợp theo ca đã duyệt và punch hợp lệ trong kỳ.
          </Text>
        </div>
        <Group align="flex-end">
          <MonthPickerInput
            label="Kỳ"
            valueFormat="YYYY-MM"
            clearable={false}
            value={parseApiMonth(periodKey)}
            onChange={(d) => setPeriodKey(toApiMonth(d) ?? '')}
            error={periodKey && !periodKey.match(/^\d{4}-\d{2}$/) ? 'YYYY-MM' : undefined}
            w={130}
          />
          <Button radius={9999} loading={loading} disabled={!periodKey.match(/^\d{4}-\d{2}$/)} onClick={() => void load()}>
            Tải báo cáo
          </Button>
        </Group>
      </Group>

      <Group gap="sm">
        <Badge variant="light" color="blue" radius="xl" size="lg">{rows.length} nhân sự</Badge>
        <Badge variant="light" color="green" radius="xl" size="lg">{totals.workdays} ngày công</Badge>
        <Badge variant="light" color="orange" radius="xl" size="lg">{totals.lateMinutes}p muộn</Badge>
        <Badge variant="light" color="red" radius="xl" size="lg">{vnd(totals.penaltyAmount)} phạt</Badge>
      </Group>

      <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)', overflowX: 'auto' }}>
        {rows.length === 0 && !loading && <Text c="dimmed" size="sm">Chưa có dữ liệu. Chọn kỳ và tải báo cáo.</Text>}
        {rows.length > 0 && (
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Nhân sự</Table.Th>
                <Table.Th style={TH_STYLE}>Ngày công</Table.Th>
                <Table.Th style={TH_STYLE}>Đi muộn</Table.Th>
                <Table.Th style={TH_STYLE}>Về sớm</Table.Th>
                <Table.Th style={TH_STYLE}>Phạt</Table.Th>
                <Table.Th style={TH_STYLE}>Chi tiết</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.userId}>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap">
                      <InitialsAvatar name={row.displayName} size={22} />
                      <Text fw={500} size="sm">{row.displayName}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{row.workdays}</Table.Td>
                  <Table.Td>{row.lateMinutes}p</Table.Td>
                  <Table.Td>{row.earlyMinutes}p</Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(row.penaltyAmount)}</Table.Td>
                  <Table.Td>
                    <Button size="compact-xs" variant="subtle" onClick={() => setSelected(row)}>
                      Xem
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {selected && (
        <Card radius="lg" p="md" style={{ border: '1px solid var(--cmc-border)' }}>
          <Group justify="space-between" mb="sm">
            <Text fw={600}>{selected.displayName} — chi tiết {periodKey}</Text>
            <Button size="compact-xs" variant="subtle" onClick={() => setSelected(null)}>Đóng</Button>
          </Group>
          <Table striped withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={TH_STYLE}>Ngày</Table.Th>
                <Table.Th style={TH_STYLE}>Ca</Table.Th>
                <Table.Th style={TH_STYLE}>Vào</Table.Th>
                <Table.Th style={TH_STYLE}>Ra</Table.Th>
                <Table.Th style={TH_STYLE}>Muộn/sớm</Table.Th>
                <Table.Th style={TH_STYLE}>Phạt</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {selected.days.map((day) => (
                <Table.Tr key={`${day.date}:${day.shiftTemplateId}`}>
                  <Table.Td>{dayjs(day.date).format('DD/MM')}</Table.Td>
                  <Table.Td>{day.shiftName ?? '—'}</Table.Td>
                  <Table.Td>{day.checkIn ? dayjs(day.checkIn).format('HH:mm') : '—'}</Table.Td>
                  <Table.Td>{day.checkOut ? dayjs(day.checkOut).format('HH:mm') : '—'}</Table.Td>
                  <Table.Td>{day.lateMinutes}p / {day.earlyMinutes}p</Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{vnd(day.penaltyAmount)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );
}
