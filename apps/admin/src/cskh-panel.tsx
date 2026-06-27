import { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess, Chatter } from '@cmc/ui';
import {
  Alert,
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
type StaffUser = { id: string; displayName: string };

const CASE_STATUS = [
  { value: 'open', label: 'Mới' },
  { value: 'in_progress', label: 'Đang xử lý' },
  { value: 'resolved', label: 'Đã xử lý' },
  { value: 'closed', label: 'Đóng' },
];

const STATUS_COLOR: Record<string, string> = {
  open: 'gray',
  in_progress: 'blue',
  resolved: 'teal',
  closed: 'dark',
};

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

type LoadState = 'loading' | 'error' | 'ok';

export function CskhPanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [caseLoadState, setCaseLoadState] = useState<LoadState>('loading');
  const [caseLoadError, setCaseLoadError] = useState('');

  // Create form
  const [subject, setSubject] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [priority, setPriority] = useState('normal');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  // Lifecycle modal
  const [lcTarget, setLcTarget] = useState<Case | null>(null);
  const [lcValue, setLcValue] = useState<string | null>(null);

  // Assign modal
  const [assignTarget, setAssignTarget] = useState<Case | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  // Chatter modal
  const [chatterTarget, setChatterTarget] = useState<Case | null>(null);

  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));

    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));

    // Load staff eligible to be assigned after-sale cases (cskh/quan_ly in this facility).
    // Uses listAssignableForAfterSale so cskh/quan_ly callers are not blocked by the
    // super-admin/director gate on user.list.
    trpc.user.listAssignableForAfterSale
      .query()
      .then(setStaffUsers)
      .catch((e) => notifyError(e, 'Không tải được danh sách nhân sự'));
  }, []);

  const studentName = useCallback(
    (id: string | null) => (id ? (students.find((s) => s.id === id)?.fullName ?? '—') : '—'),
    [students],
  );

  const staffName = useCallback(
    (id: string | null) => (id ? (staffUsers.find((u) => u.id === id)?.displayName ?? '—') : 'Chưa giao'),
    [staffUsers],
  );

  const load = useCallback(() => {
    if (!facilityId) return;
    setCaseLoadState('loading');
    setCaseLoadError('');
    trpc.afterSale.list
      .query({ facilityId })
      .then((rows) => {
        setCases(rows);
        setCaseLoadState('ok');
      })
      .catch((e: unknown) => {
        setCaseLoadError(e instanceof Error ? e.message : 'Lỗi tải danh sách ca');
        setCaseLoadState('error');
      });
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
        lifecycle: lcValue as
          | 'admitted'
          | 'active'
          | 'on_hold'
          | 'transferred'
          | 'withdrawn'
          | 'completed',
        caseId: lcTarget.id,
      });
      notifySuccess('Đã đổi vòng đời học sinh');
      setLcTarget(null);
      setLcValue(null);
    } catch (e) {
      notifyError(e, 'Đổi vòng đời học sinh thất bại');
    }
  }

  async function doAssign() {
    if (!assignTarget) return;
    setAssignBusy(true);
    try {
      await trpc.afterSale.assign.mutate({
        id: assignTarget.id,
        assignedToId: assigneeId ?? null,
      });
      notifySuccess(assigneeId ? 'Đã giao ca cho nhân viên' : 'Đã bỏ giao ca');
      setAssignTarget(null);
      setAssigneeId(null);
      load();
    } catch (e) {
      notifyError(e, 'Giao ca thất bại');
    } finally {
      setAssignBusy(false);
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

      {/* ─── Create ── */}
      <Card withBorder>
        <Title order={5} mb="sm">
          Tạo ca CSKH
        </Title>
        <Group grow align="flex-end">
          <TextInput
            label="Tiêu đề"
            value={subject}
            onChange={(e) => setSubject(e.currentTarget.value)}
          />
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
          <TextInput
            label="Phân loại (tùy chọn)"
            placeholder="complaint / request…"
            value={category}
            onChange={(e) => setCategory(e.currentTarget.value)}
          />
          <Select
            label="Ưu tiên"
            data={PRIORITY}
            value={priority}
            onChange={(v) => v && setPriority(v)}
            allowDeselect={false}
          />
        </Group>
        <Group mt="md">
          <Button onClick={createCase} loading={busy}>
            Tạo ca
          </Button>
        </Group>
      </Card>

      {/* ─── Case list ── */}
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={6}>Ca CSKH ({cases.length})</Title>
          <Button variant="subtle" size="xs" onClick={load} disabled={caseLoadState === 'loading'}>
            Làm mới
          </Button>
        </Group>

        {caseLoadState === 'loading' && (
          <Text c="dimmed" ta="center" py="md">Đang tải...</Text>
        )}

        {caseLoadState === 'error' && (
          <Alert color="red" title="Lỗi tải ca CSKH">
            {caseLoadError}
            <Button size="xs" variant="subtle" mt="xs" onClick={load}>Thử lại</Button>
          </Alert>
        )}

        {caseLoadState === 'ok' && cases.length === 0 && (
          <Text c="dimmed" size="sm">Chưa có ca nào.</Text>
        )}

        {caseLoadState === 'ok' && cases.length > 0 && (
          <Table fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tiêu đề</Table.Th>
                <Table.Th>Học sinh</Table.Th>
                <Table.Th>Ưu tiên</Table.Th>
                <Table.Th>Giao cho</Table.Th>
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
                    <Badge
                      color={
                        c.priority === 'high' ? 'red' : c.priority === 'low' ? 'gray' : 'blue'
                      }
                      variant="light"
                      size="xs"
                    >
                      {PRIORITY.find((p) => p.value === c.priority)?.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={c.assignedToId ? undefined : 'dimmed'}>
                      {staffName(c.assignedToId ?? null)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      data={CASE_STATUS}
                      value={c.status}
                      onChange={(v) => v && transition(c, v)}
                      allowDeselect={false}
                      styles={{ input: { borderColor: `var(--mantine-color-${STATUS_COLOR[c.status]}-4)` } }}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {/* Chatter / notes timeline */}
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => setChatterTarget(c)}
                      >
                        Nhật ký
                      </Button>
                      {/* Assign to staff */}
                      <Button
                        size="compact-xs"
                        variant="light"
                        onClick={() => {
                          setAssignTarget(c);
                          setAssigneeId(c.assignedToId ?? null);
                        }}
                      >
                        Giao ca
                      </Button>
                      {/* Student lifecycle change */}
                      {c.studentId && (
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="teal"
                          onClick={() => setLcTarget(c)}
                        >
                          Vòng đời HS
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {/* ─── Chatter modal ── */}
      <Modal
        opened={!!chatterTarget}
        onClose={() => setChatterTarget(null)}
        title={`Nhật ký — ${chatterTarget?.subject ?? ''}`}
        size="lg"
      >
        {chatterTarget && (
          <Chatter entityType="after_sale_case" entityId={chatterTarget.id} />
        )}
      </Modal>

      {/* ─── Assign modal ── */}
      <Modal
        opened={!!assignTarget}
        onClose={() => { setAssignTarget(null); setAssigneeId(null); }}
        title={`Giao ca: ${assignTarget?.subject ?? ''}`}
        centered
      >
        <Stack>
          <Select
            label="Nhân viên xử lý"
            placeholder="Không giao (xóa giao)"
            clearable
            searchable
            data={staffUsers.map((u) => ({ value: u.id, label: u.displayName }))}
            value={assigneeId}
            onChange={setAssigneeId}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => { setAssignTarget(null); setAssigneeId(null); }}
            >
              Hủy
            </Button>
            <Button loading={assignBusy} onClick={() => void doAssign()}>
              Lưu
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ─── Lifecycle modal ── */}
      <Modal
        opened={!!lcTarget}
        onClose={() => setLcTarget(null)}
        title="Đổi vòng đời học sinh"
        centered
      >
        <Stack>
          <Text size="sm">{studentName(lcTarget?.studentId ?? null)}</Text>
          <Select
            label="Vòng đời mới"
            data={LIFECYCLE}
            value={lcValue}
            onChange={setLcValue}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLcTarget(null)}>Đóng</Button>
            <Button disabled={!lcValue} onClick={applyLifecycle}>Áp dụng</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
