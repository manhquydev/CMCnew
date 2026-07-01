import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from '@mantine/core';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ParentMeeting = Awaited<ReturnType<typeof trpc.parentMeeting.list.query>>[number];

const MEETING_ST: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Đã lên lịch', color: 'blue' },
  done: { label: 'Đã họp', color: 'teal' },
  cancelled: { label: 'Đã hủy', color: 'gray' },
};

type StatusFilter = 'all' | 'scheduled' | 'done' | 'cancelled';

/**
 * Cross-class parent-meeting panel — shows all meetings for the active facility
 * (no single-batch filter). Mirrors MeetingsTab logic but operates facility-wide.
 * Confirms / marks done / cancels via parentMeeting.setStatus.
 */
export function MeetingsPanel({
  initialFacilityId,
}: {
  /** Preselect facility when opened from a known session context (e.g. Lịch 360). */
  initialFacilityId?: number;
} = {}) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(initialFacilityId ?? null);
  const [meetings, setMeetings] = useState<ParentMeeting[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load facility list once
  useEffect(() => {
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
  }, []);

  // Reload meetings when facility changes
  const loadMeetings = useCallback(() => {
    if (!facilityId) return;
    setLoading(true);
    setError('');
    trpc.parentMeeting.list
      .query({ facilityId })
      .then(setMeetings)
      .catch((e: Error) => {
        setError(e.message);
        setMeetings([]);
      })
      .finally(() => setLoading(false));
  }, [facilityId]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  async function setStatus(id: string, status: 'done' | 'cancelled') {
    try {
      await trpc.parentMeeting.setStatus.mutate({ id, status });
      notifySuccess('Đã cập nhật trạng thái cuộc họp phụ huynh');
      loadMeetings();
    } catch (e) {
      notifyError(e, 'Cập nhật thất bại');
    }
  }

  const filtered: ParentMeeting[] =
    statusFilter === 'all' ? meetings : meetings.filter((m) => m.status === statusFilter);

  return (
    <Stack>
      <Group align="flex-end" wrap="wrap">
        <Select
          label="Cơ sở"
          w={220}
          data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
          value={facilityId ? String(facilityId) : null}
          onChange={(v) => setFacilityId(v ? Number(v) : null)}
        />
        <SegmentedControl
          size="xs"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          data={[
            { value: 'all', label: 'Tất cả' },
            { value: 'scheduled', label: 'Đã lên lịch' },
            { value: 'done', label: 'Đã họp' },
            { value: 'cancelled', label: 'Đã hủy' },
          ]}
        />
      </Group>

      {loading && <Loader size="sm" />}

      {error && (
        <Text c="red" size="sm">
          Lỗi tải cuộc họp: {error}
        </Text>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Card withBorder>
          <Text c="dimmed" size="sm">
            Không có cuộc họp phụ huynh nào.
          </Text>
        </Card>
      )}

      {!loading && !error && filtered.length > 0 && (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Thời gian</Table.Th>
              <Table.Th>Tiêu đề</Table.Th>
              <Table.Th>Địa điểm</Table.Th>
              <Table.Th>Trạng thái</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((m) => {
              const st = MEETING_ST[m.status] ?? { label: m.status, color: 'gray' };
              return (
                <Table.Tr key={m.id}>
                  <Table.Td>{dayjs(m.scheduledAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
                  <Table.Td>{m.title}</Table.Td>
                  <Table.Td>{m.location ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={st.color}>
                      {st.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td w={180}>
                    {m.status === 'scheduled' && (
                      <Group gap="xs">
                        <Button
                          size="compact-xs"
                          color="teal"
                          variant="subtle"
                          onClick={() => setStatus(m.id, 'done')}
                        >
                          Đã họp
                        </Button>
                        <Button
                          size="compact-xs"
                          color="gray"
                          variant="subtle"
                          onClick={() => setStatus(m.id, 'cancelled')}
                        >
                          Hủy
                        </Button>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
