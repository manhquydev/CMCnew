import { useCallback, useEffect, useRef, useState } from 'react';
import {
  trpc,
  notifyError,
  PageHeader,
  DataTable,
  StatusBadge,
  InitialsAvatar,
  EmptyState,
  FacilityPicker,
  type DataTableColumn,
  type StatusDef,
} from '@cmc/ui';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { IconRefresh, IconSchool } from '@tabler/icons-react';
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
        onArchived={() => {
          setDetailStudentId(null);
          load();
        }}
      />
    );
  }

  const rows = facilityId
    ? students.filter((s) => String(s.facilityId) === facilityId)
    : students;

  const columns: DataTableColumn<StudentT>[] = [
    {
      key: 'code',
      header: 'Mã',
      width: 130,
      sortValue: (s) => s.studentCode,
      render: (s) => (
        <Text size="sm" fw={500} c="var(--cmc-brand)" style={{ fontFamily: 'var(--cmc-font-mono)' }}>
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
    </Stack>
  );
}
