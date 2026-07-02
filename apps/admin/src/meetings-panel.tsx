import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ParentMeeting = Awaited<ReturnType<typeof trpc.parentMeeting.list.query>>[number];

const MEETING_ST: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Đã lên lịch', color: 'blue' },
  done: { label: 'Đã họp', color: 'teal' },
  cancelled: { label: 'Đã hủy', color: 'gray' },
};

type StatusFilter = 'all' | 'scheduled' | 'done' | 'cancelled';

function SetScheduleModal({
  meeting,
  onClose,
  onSaved,
}: {
  meeting: ParentMeeting;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState<Date | null>(new Date(meeting.scheduledAt));
  const [time, setTime] = useState(dayjs(meeting.scheduledAt).format('HH:mm'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!date || !/^\d{2}:\d{2}$/.test(time)) {
      setErr('Chọn ngày và nhập giờ hợp lệ (HH:mm)');
      return;
    }
    const [hStr, mStr] = time.split(':');
    const scheduledAt = dayjs(date).hour(Number(hStr)).minute(Number(mStr)).second(0).millisecond(0).toDate();
    setBusy(true);
    setErr('');
    try {
      await trpc.parentMeeting.setSchedule.mutate({ id: meeting.id, scheduledAt });
      notifySuccess('Đã chốt giờ họp phụ huynh');
      onSaved();
      onClose();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Chốt giờ họp — ${meeting.title}`}>
      <Stack>
        <Group grow align="flex-end">
          <DateInput label="Ngày" value={date} onChange={setDate} valueFormat="DD/MM/YYYY" />
          <TextInput label="Giờ (HH:mm)" value={time} onChange={(e) => setTime(e.currentTarget.value)} />
        </Group>
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Hủy</Button>
          <Button onClick={save} loading={busy}>Chốt giờ</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function SetNoteModal({
  meeting,
  onClose,
  onSaved,
}: {
  meeting: ParentMeeting;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState(meeting.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true);
    setErr('');
    try {
      await trpc.parentMeeting.setNote.mutate({ id: meeting.id, note });
      notifySuccess('Đã lưu ghi chú cuộc họp');
      onSaved();
      onClose();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Ghi chú kết quả họp — ${meeting.title}`}>
      <Stack>
        <Textarea
          label="Nội dung / kết quả họp"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          minRows={4}
          maxLength={2000}
        />
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Hủy</Button>
          <Button onClick={save} loading={busy}>Lưu</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

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
  const [scheduling, setScheduling] = useState<ParentMeeting | null>(null);
  const [notingMeeting, setNotingMeeting] = useState<ParentMeeting | null>(null);

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
                  <Table.Td>
                    {dayjs(m.scheduledAt).format('DD/MM/YYYY HH:mm')}
                    {!m.timeConfirmed && (
                      <Badge size="xs" color="orange" ml={6} variant="light">Chưa chốt</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{m.title}</Table.Td>
                  <Table.Td>{m.location ?? '—'}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={st.color}>
                      {st.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td w={280}>
                    <Group gap="xs" wrap="wrap">
                      {m.status === 'scheduled' && (
                        <>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() => setScheduling(m)}
                          >
                            Chốt giờ
                          </Button>
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
                        </>
                      )}
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="grape"
                        onClick={() => setNotingMeeting(m)}
                      >
                        {m.note ? 'Sửa ghi chú' : 'Ghi chú'}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      {scheduling && (
        <SetScheduleModal
          meeting={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={loadMeetings}
        />
      )}

      {notingMeeting && (
        <SetNoteModal
          meeting={notingMeeting}
          onClose={() => setNotingMeeting(null)}
          onSaved={loadMeetings}
        />
      )}
    </Stack>
  );
}
