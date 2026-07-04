import { useCallback, useEffect, useRef, useState } from 'react';
import {
  trpc,
  notifyError,
  notifySuccess,
  PageHeader,
  DataTable,
  StatusBadge,
  InitialsAvatar,
  EmptyState,
  FacilityPicker,
  type DataTableColumn,
  type StatusDef,
} from '@cmc/ui';
import {
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconRefresh, IconExternalLink, IconSchool } from '@tabler/icons-react';
import { StudentDetailPanel } from './student-detail.js';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];

const LIFECYCLE: Record<string, StatusDef> = {
  admitted: { label: 'Đã nhận', tone: 'info' },
  active: { label: 'Đang học', tone: 'active' },
  on_hold: { label: 'Tạm dừng', tone: 'pending' },
  transferred: { label: 'Chuyển', tone: 'pending' },
  withdrawn: { label: 'Nghỉ', tone: 'rejected' },
  completed: { label: 'Hoàn thành', tone: 'active' },
};

export function StudentsPanel({
  initialDetailId,
}: {
  /** Global-search deep link: pre-select a student record on mount/update. `ts` is a
   *  monotonic timestamp (same trick as class-workspace.tsx's NavAction) so selecting the
   *  same student again still re-opens the detail view. */
  initialDetailId?: { id: string; ts: number } | null;
} = {}) {
  const [students, setStudents] = useState<StudentT[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);

  const appliedNavTs = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!initialDetailId || initialDetailId.ts === appliedNavTs.current) return;
    appliedNavTs.current = initialDetailId.ts;
    setDetailStudentId(initialDetailId.id);
  }, [initialDetailId]);

  const [editTarget, setEditTarget] = useState<StudentT | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const editForm = useForm({
    initialValues: { fullName: '', dateOfBirth: '' },
  });

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    trpc.student.list
      .query()
      .then((rows) => setStudents(rows))
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : 'Lỗi tải danh sách học sinh'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    trpc.facility.list
      .query()
      .then(setFacilities)
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  }, [load]);

  if (detailStudentId) {
    return (
      <StudentDetailPanel
        studentId={detailStudentId}
        onBack={() => setDetailStudentId(null)}
      />
    );
  }

  const rows = facilityId
    ? students.filter((s) => String(s.facilityId) === facilityId)
    : students;

  function openEdit(s: StudentT) {
    setEditTarget(s);
    editForm.setValues({
      fullName: s.fullName,
      dateOfBirth: s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().split('T')[0] : '',
    });
  }

  async function onEdit(values: typeof editForm.values) {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      await trpc.student.update.mutate({
        id: editTarget.id,
        fullName: values.fullName.trim() || undefined,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth : null,
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

  const columns: DataTableColumn<StudentT>[] = [
    {
      key: 'code',
      header: 'Mã',
      width: 130,
      sortValue: (s) => s.studentCode,
      render: (s) => (
        <Text size="sm" fw={500} style={{ fontFamily: 'var(--cmc-font-mono)' }}>
          {s.studentCode}
        </Text>
      ),
    },
    {
      key: 'name',
      header: 'Họ tên',
      sortValue: (s) => s.fullName,
      render: (s) => (
        <Group gap={6} wrap="nowrap">
          <InitialsAvatar name={s.fullName} size={22} />
          <Text size="sm" lineClamp={1}>{s.fullName}</Text>
        </Group>
      ),
    },
    {
      key: 'program',
      header: 'Chương trình',
      render: (s) => (
        <Badge size="sm" variant="light" radius="xl">
          {s.program}
        </Badge>
      ),
    },
    {
      key: 'lifecycle',
      header: 'Vòng đời',
      sortValue: (s) => s.lifecycle ?? '',
      render: (s) => <StatusBadge status={s.lifecycle ?? ''} map={LIFECYCLE} pill />,
    },
    {
      key: 'facility',
      header: 'Cơ sở',
      width: 90,
      render: (s) => {
        const fac = facilities.find((f) => f.id === s.facilityId);
        return (
          <Text size="xs" c="dimmed">
            {fac?.code ?? `#${s.facilityId}`}
          </Text>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: 150,
      align: 'right',
      render: (s) => (
        <Group gap={4} wrap="nowrap" justify="flex-end">
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconExternalLink size={12} />}
            onClick={() => setDetailStudentId(s.id)}
          >
            Chi tiết
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={() => openEdit(s)}>
            Sửa
          </Button>
        </Group>
      ),
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Học sinh"
        subtitle={`${rows.length} hồ sơ`}
        actions={
          <Button
            variant="subtle"
            leftSection={<IconRefresh size={14} />}
            onClick={load}
            disabled={loading}
          >
            Làm mới
          </Button>
        }
      />

      <DataTable
        data={rows}
        columns={columns}
        getRowKey={(s) => s.id}
        loading={loading}
        error={loadError}
        onRetry={load}
        searchText={(s) => `${s.fullName} ${s.studentCode}`}
        searchPlaceholder="Mã hoặc tên học sinh"
        onRowClick={(s) => setDetailStudentId(s.id)}
        toolbar={
          <FacilityPicker
            facilities={facilities}
            placeholder="Tất cả"
            value={facilityId ? Number(facilityId) : null}
            onChange={(v) => setFacilityId(v ? String(v) : null)}
            w={220}
          />
        }
        emptyState={
          <EmptyState
            icon={<IconSchool size={28} stroke={1.5} />}
            title="Chưa có học sinh"
            description="Học sinh được tạo qua phiếu thu hoặc nhập học từ CRM."
          />
        }
      />

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
            <TextInput
              label="Ngày sinh"
              placeholder="YYYY-MM-DD hoặc để trống để xóa"
              {...editForm.getInputProps('dateOfBirth')}
            />
            <Text size="xs" c="dimmed">
              Đổi chương trình: thực hiện qua phiếu thu. Đổi vòng đời: thực hiện qua Chăm sóc KH.
            </Text>
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
