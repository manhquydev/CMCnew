import React, { useState, useEffect, useCallback } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

// ─── Types ────────────────────────────────────────────────────────────────────
// Explicit local shape to avoid deep AppRouter type inference.

type TermRow = {
  id: string;
  periodKey: string;
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  program?: string | null;
};

// Cast assessment sub-router to a minimal typed interface.
const assessmentApi = trpc.assessment as unknown as {
  termList: { query: (i: { facilityId: number }) => Promise<TermRow[]> };
  termCreate: {
    mutate: (i: {
      facilityId: number;
      periodKey: string;
      name: string;
      startDate: string;
      endDate: string;
    }) => Promise<TermRow>;
  };
  termUpdate: {
    mutate: (i: {
      id: string;
      name?: string;
      startDate?: string;
      endDate?: string;
    }) => Promise<TermRow>;
  };
};

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--mantine-color-gray-6)',
  fontWeight: 600,
};

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateTermModal({
  facilityId,
  opened,
  onClose,
  onCreated,
}: {
  facilityId: number;
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [periodKey, setPeriodKey] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function reset() {
    setPeriodKey('');
    setName('');
    setStartDate('');
    setEndDate('');
    setErr('');
  }

  async function create() {
    if (!periodKey.trim()) { setErr('Nhập mã kỳ (vd: 2026-H1)'); return; }
    if (!name.trim()) { setErr('Nhập tên kỳ'); return; }
    if (!startDate || !endDate) { setErr('Nhập ngày bắt đầu và kết thúc'); return; }
    if (startDate > endDate) { setErr('Ngày bắt đầu phải trước ngày kết thúc'); return; }
    setErr('');
    setBusy(true);
    try {
      await assessmentApi.termCreate.mutate({ facilityId, periodKey: periodKey.trim(), name: name.trim(), startDate, endDate });
      notifySuccess(`Đã tạo kỳ "${name.trim()}"`);
      reset();
      onClose();
      onCreated();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Lỗi tạo kỳ học');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={() => { reset(); onClose(); }} title="Tạo kỳ học" radius="xl" centered>
      <Stack gap="sm">
        {err && <Alert color="red">{err}</Alert>}
        <TextInput
          label="Mã kỳ"
          placeholder="VD: 2026-H1, 2026-Q3"
          description="Khớp với periodKey trong phiếu điểm"
          value={periodKey}
          onChange={(e) => setPeriodKey(e.currentTarget.value)}
          withAsterisk
        />
        <TextInput
          label="Tên kỳ"
          placeholder="Học kỳ 1 năm 2026"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          withAsterisk
        />
        <TextInput
          label="Ngày bắt đầu"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.currentTarget.value)}
          withAsterisk
        />
        <TextInput
          label="Ngày kết thúc"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.currentTarget.value)}
          withAsterisk
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={() => { reset(); onClose(); }}>Hủy</Button>
          <Button variant="filled" radius={9999} loading={busy} onClick={() => void create()}>
            Tạo
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditTermModal({
  term,
  onClose,
  onUpdated,
}: {
  term: TermRow | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!term) return;
    setName(term.name);
    setStartDate(new Date(term.startDate).toISOString().slice(0, 10));
    setEndDate(new Date(term.endDate).toISOString().slice(0, 10));
    setErr('');
  }, [term]);

  async function save() {
    if (!term) return;
    if (!name.trim()) { setErr('Nhập tên kỳ'); return; }
    if (startDate > endDate) { setErr('Ngày bắt đầu phải trước ngày kết thúc'); return; }
    setErr('');
    setBusy(true);
    try {
      await assessmentApi.termUpdate.mutate({ id: term.id, name: name.trim(), startDate, endDate });
      notifySuccess('Đã cập nhật kỳ học');
      onClose();
      onUpdated();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Lỗi cập nhật kỳ học');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={!!term} onClose={onClose} title={`Sửa kỳ: ${term?.periodKey ?? ''}`} radius="xl" centered>
      <Stack gap="sm">
        {err && <Alert color="red">{err}</Alert>}
        <TextInput
          label="Tên kỳ"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          withAsterisk
        />
        <TextInput
          label="Ngày bắt đầu"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.currentTarget.value)}
        />
        <TextInput
          label="Ngày kết thúc"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.currentTarget.value)}
        />
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose}>Hủy</Button>
          <Button variant="filled" radius={9999} loading={busy} onClick={() => void save()}>
            Lưu
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

/**
 * Manages AcademicTerm records for a facility. Terms define the date window used by
 * computeFinalGrade to scope grade/attendance aggregation to the correct period.
 * Requires quan_ly or head_teacher role (backend enforces; super_admin also passes).
 */
export function TermsPanel({ facilityId }: { facilityId: number }) {
  const [terms, setTerms] = useState<TermRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TermRow | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadErr('');
    assessmentApi.termList
      .query({ facilityId })
      .then((rows) => { setTerms(rows); setLoading(false); })
      .catch((e: unknown) => {
        setLoadErr(e instanceof Error ? e.message : 'Lỗi tải danh sách kỳ học');
        setLoading(false);
      });
  }, [facilityId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card withBorder radius="lg" p="xl">
      <Group justify="space-between" mb="md">
        <Title order={5}>Kỳ học (Academic Terms)</Title>
        <Button
          size="xs"
          variant="filled"
          radius={9999}
          leftSection={<IconPlus size={14} />}
          onClick={() => setCreateOpen(true)}
        >
          Tạo kỳ
        </Button>
      </Group>

      {loadErr && (
        <Alert color="red" mb="md">
          {loadErr}
          <Button size="xs" variant="subtle" mt="xs" onClick={load}>Thử lại</Button>
        </Alert>
      )}

      {loading && <Text c="dimmed" size="sm">Đang tải...</Text>}

      {!loading && !loadErr && terms.length === 0 && (
        <Text c="dimmed" size="sm">
          Chưa có kỳ học nào. Tạo kỳ để giới hạn phạm vi tổng hợp điểm theo thời gian.
        </Text>
      )}

      {!loading && terms.length > 0 && (
        <Table striped fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={TH_STYLE}>Mã kỳ</Table.Th>
              <Table.Th style={TH_STYLE}>Tên</Table.Th>
              <Table.Th style={TH_STYLE}>Bắt đầu</Table.Th>
              <Table.Th style={TH_STYLE}>Kết thúc</Table.Th>
              <Table.Th style={TH_STYLE} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {terms.map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>
                  <Badge size="sm" variant="light" radius="sm">{t.periodKey}</Badge>
                </Table.Td>
                <Table.Td>{t.name}</Table.Td>
                <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(t.startDate)}</Table.Td>
                <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(t.endDate)}</Table.Td>
                <Table.Td>
                  <Button size="compact-xs" variant="subtle" onClick={() => setEditing(t)}>
                    Sửa
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <CreateTermModal
        facilityId={facilityId}
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />
      <EditTermModal term={editing} onClose={() => setEditing(null)} onUpdated={load} />
    </Card>
  );
}
