import { useCallback, useEffect, useMemo, useState } from 'react';
import { trpc, notifyError, StatCard } from '@cmc/ui';
import { Alert, Box, Button, Card, Group, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

type Scope = 'student' | 'class' | 'term' | 'facility';
type ReportResult = Awaited<ReturnType<typeof trpc.attendance.report.query>>;

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'facility', label: 'Toàn cơ sở (xu hướng 6 tháng)' },
  { value: 'student', label: 'Theo học sinh' },
  { value: 'class', label: 'Theo lớp' },
  { value: 'term', label: 'Theo kỳ học' },
];

function monthRate(m: { present: number; late: number; total: number }): number | null {
  return m.total > 0 ? (m.present + m.late) / m.total : null;
}

// Hand-built bar chart (no charting library in this workspace — matches calendar-view.tsx's
// precedent of composing Mantine layout primitives directly rather than adding a dependency).
function TrendBarChart({ data }: { data: { month: string; total: number; present: number; late: number }[] }) {
  if (data.length === 0) return null;
  return (
    <Group align="flex-end" gap="xs" wrap="nowrap" style={{ height: 140, overflowX: 'auto' }}>
      {data.map((m) => {
        const rate = monthRate(m);
        return (
          <Stack key={m.month} gap={4} align="center" style={{ flex: '1 0 44px', minWidth: 44 }}>
            <Box
              style={{
                width: '100%', maxWidth: 36, height: 96,
                display: 'flex', alignItems: 'flex-end',
                backgroundColor: 'var(--cmc-surface-2)', borderRadius: 4,
              }}
            >
              <Box
                style={{
                  width: '100%',
                  height: rate != null ? `${Math.round(rate * 100)}%` : 0,
                  minHeight: m.total > 0 ? 2 : 0,
                  backgroundColor: 'var(--cmc-brand)',
                  borderRadius: 4,
                }}
              />
            </Box>
            <Text size="xs" c="dimmed">Th{m.month.slice(5)}</Text>
            <Text size="xs" fw={600}>{rate != null ? `${Math.round(rate * 100)}%` : '—'}</Text>
          </Stack>
        );
      })}
    </Group>
  );
}

// Report backend already exists and is permission-gated (attendance.report) + integration-tested
// (attendance-report-markall.int.test.ts) — this panel is the missing UI caller (DEBT.md).
// giao_vien sees only sessions they taught; giam_doc_dao_tao/super_admin see the full facility —
// enforced server-side, this panel just renders whatever the backend returns.
//
// P6 redesign (finding #29): from a flat monthly table into a trend/summary report — StatCard KPIs
// (with vs-last-month delta for scopes that produce a month trend), a trend bar chart, and — for the
// new facility-wide scope — a per-class drill-down table. student/class/term scopes are preserved
// unchanged in behavior, just re-skinned onto the same StatCard/chart components.
export function AttendanceReportPanel({ facilityId }: { facilityId: number }) {
  const [scope, setScope] = useState<Scope>('facility');
  const [id, setId] = useState<string | null>(null);
  const [students, setStudents] = useState<{ value: string; label: string }[]>([]);
  const [batches, setBatches] = useState<{ value: string; label: string }[]>([]);
  const [terms, setTerms] = useState<{ value: string; label: string }[]>([]);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [load, setLoad] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [error, setError] = useState('');

  const runReport = useCallback(() => {
    if (scope !== 'facility' && !id) return;
    setLoad('loading');
    setError('');
    trpc.attendance.report
      .query(scope === 'facility' ? { scope, facilityId } : { scope, id: id! })
      .then((data) => {
        setResult(data);
        setLoad('ok');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Lỗi tải báo cáo điểm danh');
        setLoad('error');
      });
  }, [scope, id, facilityId]);

  // Load the id-picker options for the current scope (facility scope needs no id picker).
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
    } else if (scope === 'term') {
      trpc.assessment.termList
        .query({ facilityId })
        .then((rows) => setTerms(rows.map((t) => ({ value: t.id, label: t.name }))))
        .catch((e) => notifyError(e, 'Không tải được danh sách kỳ học'));
    }
  }, [scope, facilityId]);

  // Facility scope has no id to pick — auto-run (and re-run on facility switch).
  useEffect(() => {
    if (scope === 'facility') runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, facilityId]);

  const idOptions = scope === 'student' ? students : scope === 'class' ? batches : scope === 'term' ? terms : [];

  const byMonth = result && 'byMonth' in result ? result.byMonth : undefined;
  const byClass = result && 'byClass' in result ? result.byClass : undefined;

  const monthDelta = useMemo(() => {
    if (!byMonth || byMonth.length < 2) return null;
    const last = monthRate(byMonth[byMonth.length - 1]!);
    const prev = monthRate(byMonth[byMonth.length - 2]!);
    if (last == null || prev == null) return null;
    return (last - prev) * 100;
  }, [byMonth]);

  return (
    <Card withBorder>
      <Title order={5} mb="sm">Báo cáo điểm danh</Title>

      <Group align="flex-end" mb="sm" wrap="wrap">
        <Select
          label="Phạm vi"
          data={SCOPE_OPTIONS}
          value={scope}
          onChange={(v) => v && setScope(v as Scope)}
          allowDeselect={false}
          w={220}
        />
        {scope !== 'facility' && (
          <Select
            label={scope === 'student' ? 'Học sinh' : scope === 'class' ? 'Lớp' : 'Kỳ học'}
            searchable
            data={idOptions}
            value={id}
            onChange={setId}
            placeholder={idOptions.length ? 'Chọn' : 'Không có dữ liệu'}
            w={280}
          />
        )}
        <Button
          leftSection={<IconRefresh size={14} />}
          onClick={runReport}
          loading={load === 'loading'}
          disabled={scope !== 'facility' && !id}
        >
          {scope === 'facility' ? 'Làm mới' : 'Xem báo cáo'}
        </Button>
      </Group>

      {error && <Alert color="red" mb="sm">{error}</Alert>}

      {result && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 2, sm: 5 }}>
            <StatCard label="Tổng buổi" value={result.counts.total} />
            <StatCard label="Có mặt" value={result.counts.present} />
            <StatCard label="Trễ" value={result.counts.late} />
            <StatCard label="Vắng" value={result.counts.absent} />
            <StatCard
              label="Tỉ lệ chuyên cần"
              value={result.rate != null ? `${(result.rate * 100).toFixed(1)}%` : '—'}
              delta={monthDelta != null ? `${monthDelta >= 0 ? '+' : ''}${monthDelta.toFixed(1)}%` : undefined}
              deltaDir={monthDelta == null ? 'flat' : monthDelta > 0.5 ? 'up' : monthDelta < -0.5 ? 'down' : 'flat'}
              deltaHint={monthDelta != null ? 'so với tháng trước' : undefined}
            />
          </SimpleGrid>

          {byMonth && byMonth.length > 0 && (
            <Stack gap={4}>
              <Text size="sm" fw={600}>Xu hướng theo tháng</Text>
              <TrendBarChart data={byMonth} />
            </Stack>
          )}

          {byClass && byClass.length > 0 && (
            <Stack gap={4}>
              <Text size="sm" fw={600}>Chi tiết theo lớp</Text>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Lớp</Table.Th>
                    <Table.Th>Có mặt</Table.Th>
                    <Table.Th>Trễ</Table.Th>
                    <Table.Th>Vắng</Table.Th>
                    <Table.Th>Tổng</Table.Th>
                    <Table.Th>Tỉ lệ</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {byClass.map((c) => (
                    <Table.Tr key={c.code}>
                      <Table.Td>{c.code} — {c.name}</Table.Td>
                      <Table.Td>{c.present}</Table.Td>
                      <Table.Td>{c.late}</Table.Td>
                      <Table.Td>{c.absent}</Table.Td>
                      <Table.Td>{c.total}</Table.Td>
                      <Table.Td>{c.rate != null ? `${(c.rate * 100).toFixed(1)}%` : '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Stack>
          )}
        </Stack>
      )}
    </Card>
  );
}
