import { useCallback, useEffect, useState } from 'react';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconSearch, IconRefresh } from '@tabler/icons-react';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];

const PROGRAMS = [
  { value: 'UCREA', label: 'UCREA' },
  { value: 'BRIGHT_IG', label: 'Bright I.G' },
  { value: 'BLACK_HOLE', label: 'Black Hole' },
];

const LIFECYCLES = [
  { value: 'admitted', label: 'Đã nhận' },
  { value: 'active', label: 'Đang học' },
  { value: 'on_hold', label: 'Tạm dừng' },
  { value: 'transferred', label: 'Chuyển' },
  { value: 'withdrawn', label: 'Nghỉ' },
  { value: 'completed', label: 'Hoàn thành' },
];

const LIFECYCLE_COLOR: Record<string, string> = {
  admitted: 'blue',
  active: 'teal',
  on_hold: 'yellow',
  transferred: 'orange',
  withdrawn: 'red',
  completed: 'green',
};

const PAGE_SIZE = 20;

type LoadState = 'loading' | 'empty' | 'error' | 'ok';

export function StudentsPanel() {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');

  // Filters
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Edit modal
  const [editTarget, setEditTarget] = useState<StudentT | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const editForm = useForm({
    initialValues: {
      fullName: '',
      program: '' as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE' | '',
      dateOfBirth: '',
      lifecycle: '' as string,
    },
  });

  const load = useCallback(() => {
    setLoadState('loading');
    setLoadError('');
    trpc.student.list
      .query()
      .then((rows) => {
        setStudents(rows);
        setLoadState(rows.length === 0 ? 'empty' : 'ok');
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Lỗi tải danh sách học sinh';
        setLoadError(msg);
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    load();
    trpc.facility.list
      .query()
      .then(setFacilities)
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  }, [load]);

  // Client-side filtering
  const filtered = students.filter((s) => {
    if (facilityId && String(s.facilityId) !== facilityId) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!s.fullName.toLowerCase().includes(q) && !s.studentCode.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openEdit(s: StudentT) {
    setEditTarget(s);
    editForm.setValues({
      fullName: s.fullName,
      program: s.program as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE',
      dateOfBirth: s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().split('T')[0] : '',
      lifecycle: s.lifecycle ?? '',
    });
  }

  async function onEdit(values: typeof editForm.values) {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      await trpc.student.update.mutate({
        id: editTarget.id,
        fullName: values.fullName.trim() || undefined,
        program: (values.program || undefined) as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE' | undefined,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth : null,
        lifecycle: (values.lifecycle ||
          undefined) as
          | 'admitted'
          | 'active'
          | 'on_hold'
          | 'transferred'
          | 'withdrawn'
          | 'completed'
          | undefined,
      });
      notifySuccess('Đã cập nhật hồ sơ học sinh');
      setEditTarget(null);
      load();
    } catch (e) {
      notifyError(e, 'Cập nhật học sinh thất bại');
    } finally {
      setEditBusy(false);
    }
  }

  // Reset page on filter change
  const handleFacilityChange = (v: string | null) => {
    setFacilityId(v);
    setPage(1);
  };
  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  return (
    <Stack>
      <Title order={5}>Học sinh ({filtered.length})</Title>

      {/* ─── Filters ── */}
      <Group align="flex-end">
        <Select
          label="Cơ sở"
          placeholder="Tất cả"
          data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
          value={facilityId}
          onChange={handleFacilityChange}
          clearable
          w={220}
        />
        <TextInput
          label="Tìm kiếm"
          placeholder="Mã hoặc tên học sinh"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => handleSearchChange(e.currentTarget.value)}
          w={260}
        />
        <Button
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          onClick={load}
          disabled={loadState === 'loading'}
        >
          Làm mới
        </Button>
      </Group>

      {/* ─── Table ── */}
      <Card withBorder>
        {loadState === 'loading' && (
          <Text c="dimmed" ta="center" py="xl">
            Đang tải...
          </Text>
        )}
        {loadState === 'error' && (
          <Alert color="red" title="Lỗi tải dữ liệu" withCloseButton={false}>
            {loadError}
            <Button size="xs" variant="subtle" mt="sm" onClick={load}>
              Thử lại
            </Button>
          </Alert>
        )}
        {loadState === 'empty' && (
          <Text c="dimmed" ta="center" py="xl">
            Chưa có học sinh nào. Hãy tạo học sinh đầu tiên.
          </Text>
        )}
        {loadState === 'ok' && paged.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">
            Không tìm thấy học sinh phù hợp.
          </Text>
        )}
        {loadState === 'ok' && paged.length > 0 && (
          <>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Mã</Table.Th>
                  <Table.Th>Họ tên</Table.Th>
                  <Table.Th>Chương trình</Table.Th>
                  <Table.Th>Vòng đời</Table.Th>
                  <Table.Th>Cơ sở</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {paged.map((s) => {
                  const fac = facilities.find((f) => f.id === s.facilityId);
                  const lc = LIFECYCLES.find((l) => l.value === s.lifecycle);
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {s.studentCode}
                        </Text>
                      </Table.Td>
                      <Table.Td>{s.fullName}</Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="light">
                          {s.program}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="xs"
                          variant="dot"
                          color={LIFECYCLE_COLOR[s.lifecycle ?? ''] ?? 'gray'}
                        >
                          {lc?.label ?? s.lifecycle ?? '—'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {fac?.code ?? `#${s.facilityId}`}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          onClick={() => openEdit(s)}
                        >
                          Sửa
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            {totalPages > 1 && (
              <Group justify="center" mt="md">
                <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
              </Group>
            )}
          </>
        )}
      </Card>



      {/* ─── Edit modal ── */}
      <Modal
        opened={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Sửa: ${editTarget?.fullName ?? ''}`}
        radius="xl"
        centered
      >
        <form onSubmit={editForm.onSubmit(onEdit)}>
          <Stack>
            <TextInput label="Họ tên" {...editForm.getInputProps('fullName')} />
            <Select label="Chương trình" data={PROGRAMS} {...editForm.getInputProps('program')} />
            <TextInput
              label="Ngày sinh"
              placeholder="YYYY-MM-DD hoặc để trống để xóa"
              {...editForm.getInputProps('dateOfBirth')}
            />
            <Select
              label="Vòng đời"
              data={LIFECYCLES}
              {...editForm.getInputProps('lifecycle')}
              clearable
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={() => setEditTarget(null)}>
                Hủy
              </Button>
              <Button type="submit" variant="filled" radius={9999} loading={editBusy}>
                Lưu
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
