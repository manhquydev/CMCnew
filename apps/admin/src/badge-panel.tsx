import { useCallback, useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess, FacilityPicker } from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import { badgeApi, type BadgeRow } from './shallow-trpc';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';

type CriteriaKind = 'stars_total' | 'homework_count';

type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];

function criteriaSummary(unlockCriteria: unknown): string {
  const c = unlockCriteria as { kind?: CriteriaKind; gte?: number } | null;
  if (!c || !c.kind) return '—';
  if (c.kind === 'stars_total') return `Đạt ${c.gte} sao`;
  if (c.kind === 'homework_count') return `Hoàn thành ${c.gte} bài tập`;
  return '—';
}

// ─── Badge create ───────────────────────────────────────────────────────────

function BadgeCreateCard({ facilityId, onCreated }: { facilityId: number; onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      code: '',
      name: '',
      description: '',
      iconUrl: '',
      criteriaKind: 'stars_total' as CriteriaKind,
      gte: 10,
    },
    validate: {
      code: (v) => (!v.trim() ? 'Nhập mã huy hiệu' : null),
      name: (v) => (!v.trim() ? 'Nhập tên huy hiệu' : null),
      gte: (v) => (v <= 0 ? 'Ngưỡng phải > 0' : null),
    },
  });

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await badgeApi.create.mutate({
        facilityId,
        code: values.code.trim(),
        name: values.name.trim(),
        description: values.description.trim() || undefined,
        iconUrl: values.iconUrl.trim() || undefined,
        unlockCriteria: { kind: values.criteriaKind, gte: values.gte },
      });
      notifySuccess(`Đã tạo huy hiệu "${values.name}"`);
      form.reset();
      onCreated();
    } catch (e) {
      notifyError(e, 'Tạo huy hiệu thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Tạo huy hiệu
      </Title>
      <form onSubmit={form.onSubmit(create)}>
        <Stack>
          <Group grow align="flex-end">
            <TextInput label="Mã huy hiệu" withAsterisk {...form.getInputProps('code')} />
            <TextInput label="Tên huy hiệu" withAsterisk {...form.getInputProps('name')} />
          </Group>
          <Textarea label="Mô tả (tùy chọn)" autosize minRows={2} {...form.getInputProps('description')} />
          <TextInput label="URL biểu tượng (tùy chọn)" placeholder="https://..." {...form.getInputProps('iconUrl')} />
          <Group grow align="flex-end">
            <Select
              label="Điều kiện mở khóa"
              withAsterisk
              data={[
                { value: 'stars_total', label: 'Tổng số sao' },
                { value: 'homework_count', label: 'Số bài tập hoàn thành' },
              ]}
              {...form.getInputProps('criteriaKind')}
            />
            <NumberInput label="Ngưỡng đạt được" withAsterisk min={1} {...form.getInputProps('gte')} />
          </Group>
          <Group mt="xs">
            <Button type="submit" loading={busy}>
              Tạo huy hiệu
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ─── Badge list ───────────────────────────────────────────────────────────────

function BadgeListCard({
  badges,
  loading,
  canArchive,
  onArchived,
}: {
  badges: BadgeRow[];
  loading: boolean;
  canArchive: boolean;
  onArchived: () => void;
}) {
  const [archivingId, setArchivingId] = useState<string | null>(null);

  async function archive(b: BadgeRow) {
    setArchivingId(b.id);
    try {
      await badgeApi.archive.mutate({ id: b.id });
      notifySuccess(`Đã lưu trữ huy hiệu "${b.name}"`);
      onArchived();
    } catch (e) {
      notifyError(e, 'Lưu trữ huy hiệu thất bại');
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Danh sách huy hiệu
      </Title>
      {loading ? (
        <Group justify="center" py="lg">
          <Loader size="sm" />
        </Group>
      ) : badges.length === 0 ? (
        <Text c="dimmed" py="md" ta="center">
          Chưa có huy hiệu nào cho cơ sở này.
        </Text>
      ) : (
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Mã</Table.Th>
              <Table.Th>Tên</Table.Th>
              <Table.Th>Điều kiện</Table.Th>
              <Table.Th>Trạng thái</Table.Th>
              {canArchive && <Table.Th ta="right">Hành động</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {badges.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>{b.code}</Table.Td>
                <Table.Td>{b.name}</Table.Td>
                <Table.Td>{criteriaSummary(b.unlockCriteria)}</Table.Td>
                <Table.Td>
                  {b.isActive ? (
                    <Badge color="teal" variant="light">
                      Đang hoạt động
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="light">
                      Đã lưu trữ
                    </Badge>
                  )}
                </Table.Td>
                {canArchive && (
                  <Table.Td>
                    <Group justify="flex-end">
                      {b.isActive && (
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          loading={archivingId === b.id}
                          onClick={() => void archive(b)}
                        >
                          Lưu trữ
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

// ─── Grant card ─────────────────────────────────────────────────────────────

function GrantCard({ badges, students }: { badges: BadgeRow[]; students: StudentT[] }) {
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { studentId: '', badgeId: '' },
    validate: {
      studentId: (v) => (!v ? 'Chọn học sinh' : null),
      badgeId: (v) => (!v ? 'Chọn huy hiệu' : null),
    },
  });

  const activeBadges = badges.filter((b) => b.isActive);

  async function grant(values: typeof form.values) {
    setBusy(true);
    try {
      const res = await badgeApi.grant.mutate({ studentId: values.studentId, badgeId: values.badgeId });
      notifySuccess(res.awarded ? 'Đã cấp huy hiệu' : 'Học sinh đã có sẵn huy hiệu này');
    } catch (e) {
      notifyError(e, 'Cấp huy hiệu thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Cấp huy hiệu thủ công
      </Title>
      <form onSubmit={form.onSubmit(grant)}>
        <Stack>
          <Group grow align="flex-end">
            <Select
              label="Học sinh"
              withAsterisk
              searchable
              data={students.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
              {...form.getInputProps('studentId')}
            />
            <Select
              label="Huy hiệu"
              withAsterisk
              data={activeBadges.map((b) => ({ value: b.id, label: b.name }))}
              {...form.getInputProps('badgeId')}
            />
          </Group>
          <Group mt="xs">
            <Button type="submit" loading={busy}>
              Cấp huy hiệu
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function BadgePanel() {
  const { me } = useSession();
  const canCreate = me ? can(me.roles, me.isSuperAdmin, 'badge', 'create') : false;
  const canArchive = me ? can(me.roles, me.isSuperAdmin, 'badge', 'archive') : false;

  const [facilities, setFacilities] = useState<{ id: number; code: string; name: string }[]>([]);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => setFacilities(fs.map((f) => ({ id: f.id, code: f.code, name: f.name }))))
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
    trpc.student.list
      .query()
      .then(setStudents)
      .catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
  }, []);

  const loadBadges = useCallback((fid: number) => {
    setLoading(true);
    badgeApi.list
      .query({ facilityId: fid })
      .then(setBadges)
      .catch((e) => notifyError(e, 'Không tải được danh sách huy hiệu'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (facilityId) loadBadges(Number(facilityId));
  }, [facilityId, loadBadges]);

  const selectedFacilityId = facilityId ? Number(facilityId) : null;
  const studentsInFacility = selectedFacilityId
    ? students.filter((s) => s.facilityId === selectedFacilityId)
    : [];

  return (
    <Stack>
      <FacilityPicker
        facilities={facilities}
        withAsterisk
        clearable={false}
        value={facilityId ? Number(facilityId) : null}
        onChange={(v) => setFacilityId(v ? String(v) : null)}
        w={280}
      />

      {selectedFacilityId && (
        <>
          <BadgeListCard
            badges={badges}
            loading={loading}
            canArchive={canArchive}
            onArchived={() => loadBadges(selectedFacilityId)}
          />
          {canCreate && (
            <BadgeCreateCard facilityId={selectedFacilityId} onCreated={() => loadBadges(selectedFacilityId)} />
          )}
          <GrantCard badges={badges} students={studentsInFacility} />
        </>
      )}
    </Stack>
  );
}
