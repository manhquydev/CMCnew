import { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type Case = Awaited<ReturnType<typeof trpc.afterSale.list.query>>[number];

const STATUS = [
  { value: 'open', label: 'Mới' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'resolved', label: 'Đã xử lý' },
  { value: 'closed', label: 'Đóng' },
];
const _STATUS_COLOR: Record<string, string> = { open: 'gray', in_progress: 'blue', resolved: 'teal', closed: 'dark' };
const PRIORITY = [
  { value: 'low', label: 'Thấp' },
  { value: 'normal', label: 'Bình thường' },
  { value: 'high', label: 'Cao' },
];
const LIFECYCLE = [
  { value: 'admitted', label: 'Đã nhận' },
  { value: 'active', label: 'Đang học' },
  { value: 'on_hold', label: 'Tạm dừng' },
  { value: 'transferred', label: 'Chuyển' },
  { value: 'withdrawn', label: 'Nghỉ' },
  { value: 'completed', label: 'Hoàn thành' },
];

export function CskhPanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [subject, setSubject] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [priority, setPriority] = useState('normal');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [lcTarget, setLcTarget] = useState<Case | null>(null);
  const [lcValue, setLcValue] = useState<string | null>(null);

  useEffect(() => {
    trpc.facility.list.query().then((fs) => {
      setFacilities(fs);
      setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
    });
    trpc.student.list.query().then(setStudents).catch(() => setStudents([]));
  }, []);

  const studentName = useCallback(
    (id: string | null) => (id ? students.find((s) => s.id === id)?.fullName ?? '—' : '—'),
    [students],
  );

  const load = useCallback(() => {
    if (!facilityId) return;
    trpc.afterSale.list.query({ facilityId }).then(setCases).catch(() => setCases([]));
  }, [facilityId]);
  useEffect(load, [load]);

  async function createCase() {
    if (!facilityId || !subject.trim()) {
      notifyError(new Error('Nhập tiêu đề ca'), 'Tạo ca CSKH thất bại');
      return;
    }
    setBusy(true);
    try {
      await trpc.afterSale.create.mutate({
        facilityId,
        subject: subject.trim(),
        studentId: studentId ?? undefined,
        category: category.trim() || undefined,
        priority: priority as 'low' | 'normal' | 'high',
      });
      notifySuccess('Đã tạo ca CSKH');
      setSubject('');
      setStudentId(null);
      setCategory('');
      setPriority('normal');
      load();
    } catch (e) {
      notifyError(e, 'Tạo ca CSKH thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function transition(c: Case, status: string) {
    try {
      await trpc.afterSale.transition.mutate({ id: c.id, status: status as Case['status'] });
      load();
    } catch (e) {
      notifyError(e, 'Cập nhật trạng thái ca thất bại');
    }
  }

  async function applyLifecycle() {
    if (!lcTarget?.studentId || !lcValue) return;
    try {
      await trpc.afterSale.setStudentLifecycle.mutate({
        studentId: lcTarget.studentId,
        lifecycle: lcValue as 'admitted' | 'active' | 'on_hold' | 'transferred' | 'withdrawn' | 'completed',
        caseId: lcTarget.id,
      });
      notifySuccess('Đã đổi vòng đời học sinh');
      setLcTarget(null);
      setLcValue(null);
    } catch (e) {
      notifyError(e, 'Đổi vòng đời học sinh thất bại');
    }
  }

  return (
    <Stack>
      <Select
        label="Cơ sở"
        w={280}
        data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
        value={facilityId ? String(facilityId) : null}
        onChange={(v) => setFacilityId(v ? Number(v) : null)}
        allowDeselect={false}
      />

      <Card withBorder>
        <Title order={5} mb="sm">
          Tạo ca CSKH
        </Title>
        <Group grow align="flex-end">
          <TextInput label="Tiêu đề" value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
          <Select
            label="Học sinh (tùy chọn)"
            searchable
            clearable
            placeholder="Chọn học sinh"
            data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
            value={studentId}
            onChange={setStudentId}
          />
        </Group>
        <Group grow align="flex-end" mt="sm">
          <TextInput label="Phân loại (tùy chọn)" placeholder="complaint / request…" value={category} onChange={(e) => setCategory(e.currentTarget.value)} />
          <Select label="Ưu tiên" data={PRIORITY} value={priority} onChange={(v) => v && setPriority(v)} allowDeselect={false} />
        </Group>
        <Group mt="md">
          <Button onClick={createCase} loading={busy}>
            Tạo ca
          </Button>
        </Group>
      </Card>

      <Card withBorder>
        <Title order={6} mb="sm">
          Ca CSKH
        </Title>
        {cases.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có ca nào.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tiêu đề</Table.Th>
                <Table.Th>Học sinh</Table.Th>
                <Table.Th>Ưu tiên</Table.Th>
                <Table.Th w={180}>Trạng thái</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cases.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.subject}</Table.Td>
                  <Table.Td>{studentName(c.studentId)}</Table.Td>
                  <Table.Td>
                    <Badge color={c.priority === 'high' ? 'red' : c.priority === 'low' ? 'gray' : 'blue'} variant="light">
                      {PRIORITY.find((p) => p.value === c.priority)?.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={STATUS}
                      value={c.status}
                      onChange={(v) => v && transition(c, v)}
                      allowDeselect={false}
                    />
                  </Table.Td>
                  <Table.Td>
                    {c.studentId && (
                      <Button size="compact-xs" variant="light" onClick={() => setLcTarget(c)}>
                        Đổi vòng đời HS
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      <Modal opened={!!lcTarget} onClose={() => setLcTarget(null)} title="Đổi vòng đời học sinh">
        <Stack>
          <Text size="sm">{studentName(lcTarget?.studentId ?? null)}</Text>
          <Select label="Vòng đời mới" data={LIFECYCLE} value={lcValue} onChange={setLcValue} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLcTarget(null)}>
              Đóng
            </Button>
            <Button disabled={!lcValue} onClick={applyLifecycle}>
              Áp dụng
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
