import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, notifyError, notifySuccess, FacilityPicker, CalendarView, type CalendarEvent, type CalendarViewMode } from '@cmc/ui';
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type ParentMeeting = Awaited<ReturnType<typeof trpc.parentMeeting.list.query>>[number];

// Meetings have no native duration field (scheduledAt only) — CalendarView requires `end`,
// so synthesize a default 60-minute block (P6 phase file, P3's "caller must synthesize end" note).
const DEFAULT_MEETING_DURATION_MIN = 60;

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

// CalendarView has no inline-action slot (onEventClick only) — clicking a meeting event opens
// this detail/action dispatcher instead of the old table row's inline buttons (P6 red-team note).
function MeetingDetailModal({
  meeting,
  onClose,
  onSetStatus,
  onSchedule,
  onNote,
}: {
  meeting: ParentMeeting;
  onClose: () => void;
  onSetStatus: (status: 'done' | 'cancelled') => void;
  onSchedule: () => void;
  onNote: () => void;
}) {
  const st = MEETING_ST[meeting.status] ?? { label: meeting.status, color: 'gray' };
  return (
    <Modal opened onClose={onClose} title={meeting.title}>
      <Stack>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">Thời gian</Text>
          <Group gap={6} wrap="nowrap">
            <Text size="sm">{dayjs(meeting.scheduledAt).format('DD/MM/YYYY HH:mm')}</Text>
            {!meeting.timeConfirmed && <Badge size="xs" color="orange" variant="light">Chưa chốt</Badge>}
          </Group>
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">Địa điểm</Text>
          <Text size="sm">{meeting.location ?? '—'}</Text>
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">Trạng thái</Text>
          <Badge size="sm" color={st.color}>{st.label}</Badge>
        </Group>
        {meeting.note && (
          <Stack gap={2}>
            <Text size="sm" c="dimmed">Ghi chú</Text>
            <Text size="sm">{meeting.note}</Text>
          </Stack>
        )}
        <Group justify="flex-end" gap="xs" wrap="wrap">
          {meeting.status === 'scheduled' && (
            <>
              <Button size="compact-xs" variant="subtle" onClick={onSchedule}>Chốt giờ</Button>
              <Button size="compact-xs" color="teal" variant="subtle" onClick={() => onSetStatus('done')}>Đã họp</Button>
              <Button size="compact-xs" color="gray" variant="subtle" onClick={() => onSetStatus('cancelled')}>Hủy</Button>
            </>
          )}
          <Button size="compact-xs" variant="subtle" color="grape" onClick={onNote}>
            {meeting.note ? 'Sửa ghi chú' : 'Ghi chú'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Cross-class parent-meeting panel — shows all meetings for the active facility
 * (no single-batch filter). Mirrors MeetingsTab logic but operates facility-wide.
 * Confirms / marks done / cancels via parentMeeting.setStatus. Renders on @cmc/ui's
 * CalendarView primitive (P6 — first real consumer of P3's calendar-view.tsx for
 * parentMeeting); per-row actions moved into a click-triggered detail modal since
 * the primitive has no inline-action slot.
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
  const [selected, setSelected] = useState<ParentMeeting | null>(null);
  const [scheduling, setScheduling] = useState<ParentMeeting | null>(null);
  const [notingMeeting, setNotingMeeting] = useState<ParentMeeting | null>(null);
  const [calView, setCalView] = useState<CalendarViewMode>('week');
  const [calDate, setCalDate] = useState(new Date());

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
      setSelected(null);
      loadMeetings();
    } catch (e) {
      notifyError(e, 'Cập nhật thất bại');
    }
  }

  const filtered: ParentMeeting[] =
    statusFilter === 'all' ? meetings : meetings.filter((m) => m.status === statusFilter);

  const events: CalendarEvent[] = useMemo(
    () =>
      filtered.map((m) => ({
        id: m.id,
        title: m.title,
        start: new Date(m.scheduledAt),
        end: dayjs(m.scheduledAt).add(DEFAULT_MEETING_DURATION_MIN, 'minute').toDate(),
        status: m.status,
        color: `var(--mantine-color-${(MEETING_ST[m.status] ?? MEETING_ST.scheduled)!.color}-6)`,
      })),
    [filtered],
  );

  function handleEventClick(event: CalendarEvent) {
    const meeting = meetings.find((m) => m.id === event.id);
    if (meeting) setSelected(meeting);
  }

  return (
    <Stack>
      <Group align="flex-end" wrap="wrap">
        <FacilityPicker
          facilities={facilities}
          w={220}
          clearable={false}
          value={facilityId}
          onChange={setFacilityId}
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
        <CalendarView
          events={events}
          view={calView}
          onViewChange={setCalView}
          date={calDate}
          onDateChange={setCalDate}
          onEventClick={handleEventClick}
        />
      )}

      {selected && (
        <MeetingDetailModal
          meeting={selected}
          onClose={() => setSelected(null)}
          onSetStatus={(status) => setStatus(selected.id, status)}
          onSchedule={() => { setScheduling(selected); setSelected(null); }}
          onNote={() => { setNotingMeeting(selected); setSelected(null); }}
        />
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
