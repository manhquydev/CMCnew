import { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError } from '@cmc/ui';
import { Alert, Button, Card, Group, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

type Scope = 'student' | 'class' | 'term';
type ReportResult = Awaited<ReturnType<typeof trpc.attendance.report.query>>;

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'student', label: 'Theo học sinh' },
  { value: 'class', label: 'Theo lớp' },
  { value: 'term', label: 'Theo kỳ học' },
];

// Report backend already exists and is permission-gated (attendance.report) + integration-tested
// (attendance-report-markall.int.test.ts) — this panel is the missing UI caller (DEBT.md).
// giao_vien sees only sessions they taught; giam_doc_dao_tao/super_admin see the full facility —
// enforced server-side, this panel just renders whatever the backend returns.
export function AttendanceReportPanel({ facilityId }: { facilityId: number }) {
  const [scope, setScope] = useState<Scope>('class');
  const [id, setId] = useState<string | null>(null);
  const [students, setStudents] = useState<{ value: string; label: string }[]>([]);
  const [batches, setBatches] = useState<{ value: string; label: string }[]>([]);
  const [terms, setTerms] = useState<{ value: string; label: string }[]>([]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [load, setLoad] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [error, setError] = useState('');

  // Load the id-picker options for the current scope.
  useEffect(() => {
    setId(null);
    setResult(null);
    if (scope === 'student') {
      trpc.student.list
        .query()
        .then((rows) =>
          setStudents(
            rows.filter((s) => s.facilityId === facilityId).map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` })),
          ),
        )
        .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
    } else if (scope === 'class') {
      trpc.classBatch.list
        .query()
        .then((rows) => setBatches(rows.filter((b) => b.facilityId === facilityId).map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }))))
        .catch((e) => notifyError(e, 'Không tải được danh sách lớp'));
    } else {
      trpc.assessment.termList
        .query({ facilityId })
        .then((rows) => setTerms(rows.map((t) => ({ value: t.id, label: t.name }))))
        .catch((e) => notifyError(e, 'Không tải được danh sách kỳ học'));
    }
  }, [scope, facilityId]);

  const runReport = useCallback(() => {
    if (!id) return;
    setLoad('loading');
    setError('');
    trpc.attendance.report
      .query({ scope, id })
      .then((data) => {
        setResult(data);
        setLoad('ok');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Lỗi tải báo cáo điểm danh');
        setLoad('error');
      });
  }, [scope, id]);

  const idOptions = scope === 'student' ? students : scope === 'class' ? batches : terms;

  return (
    <Card withBorder>
      <Title order={5} mb="sm">Báo cáo điểm danh</Title>

      <Group align="flex-end" mb="sm">
        <Select
          label="Phạm vi"
          data={SCOPE_OPTIONS}
          value={scope}
          onChange={(v) => v && setScope(v as Scope)}
          allowDeselect={false}
          w={160}
        />
        <Select
          label={scope === 'student' ? 'Học sinh' : scope === 'class' ? 'Lớp' : 'Kỳ học'}
          searchable
          data={idOptions}
          value={id}
          onChange={setId}
          placeholder={idOptions.length ? 'Chọn' : 'Không có dữ liệu'}
          w={280}
        />
        <Button leftSection={<IconRefresh size={14} />} onClick={runReport} loading={load === 'loading'} disabled={!id}>
          Xem báo cáo
        </Button>
      </Group>

      {error && <Alert color="red" mb="sm">{error}</Alert>}

      {result && (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 2, sm: 5 }}>
            <Card withBorder p="sm"><Text size="xs" c="dimmed">Tổng buổi</Text><Text fw={700}>{result.counts.total}</Text></Card>
            <Card withBorder p="sm"><Text size="xs" c="dimmed">Có mặt</Text><Text fw={700} c="teal">{result.counts.present}</Text></Card>
            <Card withBorder p="sm"><Text size="xs" c="dimmed">Trễ</Text><Text fw={700} c="orange">{result.counts.late}</Text></Card>
            <Card withBorder p="sm"><Text size="xs" c="dimmed">Vắng</Text><Text fw={700} c="red">{result.counts.absent}</Text></Card>
            <Card withBorder p="sm"><Text size="xs" c="dimmed">Tỉ lệ chuyên cần</Text><Text fw={700}>{result.rate != null ? `${(result.rate * 100).toFixed(1)}%` : '—'}</Text></Card>
          </SimpleGrid>

          {'byMonth' in result && result.byMonth && result.byMonth.length > 0 && (
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Tháng</Table.Th>
                  <Table.Th>Có mặt</Table.Th>
                  <Table.Th>Trễ</Table.Th>
                  <Table.Th>Vắng</Table.Th>
                  <Table.Th>Tổng</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.byMonth.map((m) => (
                  <Table.Tr key={m.month}>
                    <Table.Td>{m.month}</Table.Td>
                    <Table.Td>{m.present}</Table.Td>
                    <Table.Td>{m.late}</Table.Td>
                    <Table.Td>{m.absent}</Table.Td>
                    <Table.Td>{m.total}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      )}
    </Card>
  );
}
