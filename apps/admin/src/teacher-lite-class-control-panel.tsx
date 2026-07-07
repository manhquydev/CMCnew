import { useCallback, useEffect, useMemo, useState } from 'react';
import { can } from '@cmc/auth/permissions';
import {
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconRefresh } from '@tabler/icons-react';
import { notifyError, notifySuccess, parseApiDate, toApiDate, trpc, useSession } from '@cmc/ui';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type ClassBatch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type ClassSession = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];

const DAYS = [
  { value: '1', label: 'Thứ 2' },
  { value: '2', label: 'Thứ 3' },
  { value: '3', label: 'Thứ 4' },
  { value: '4', label: 'Thứ 5' },
  { value: '5', label: 'Thứ 6' },
  { value: '6', label: 'Thứ 7' },
  { value: '0', label: 'Chủ nhật' },
];

function sessionLabel(session: ClassSession) {
  const date = new Date(session.sessionDate).toISOString().slice(0, 10);
  return `${date} ${session.startTime}-${session.endTime} (${session.status})`;
}

export function TeacherLiteClassControlPanel({ onChanged }: { onChanged?: () => void }) {
  const { me } = useSession();
  const canManage = can(me.roles, me.isSuperAdmin, 'teacherLite', 'createClass');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<ClassBatch[]>([]);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(me.facilityIds[0] ?? null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [capacity, setCapacity] = useState<number | ''>('');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:30');
  const [cancelClassId, setCancelClassId] = useState<string | null>(null);
  const [cancelClassReason, setCancelClassReason] = useState('');
  const [sessionClassId, setSessionClassId] = useState<string | null>(null);
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null);
  const [cancelSessionReason, setCancelSessionReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    trpc.facility.list.query().then(setFacilities).catch((e) => notifyError(e, 'Không tải được cơ sở'));
    trpc.course.list.query().then((rows) => {
      setCourses(rows);
      setCourseId((current) => current ?? rows[0]?.id ?? null);
    }).catch((e) => notifyError(e, 'Không tải được khóa học'));
    trpc.classBatch.list.query().then(setBatches).catch((e) => notifyError(e, 'Không tải được lớp'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!sessionClassId) {
      setSessions([]);
      setCancelSessionId(null);
      return;
    }
    trpc.schedule.listSessions
      .query({ classBatchId: sessionClassId })
      .then((rows) => {
        setSessions(rows);
        setCancelSessionId((current) => current ?? rows.find((s) => s.status !== 'cancelled')?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được buổi học'));
  }, [sessionClassId]);

  const filteredBatches = useMemo(
    () => batches.filter((batch) => !facilityId || batch.facilityId === facilityId),
    [batches, facilityId],
  );
  const activeBatches = filteredBatches.filter((batch) => batch.status !== 'cancelled');

  async function refreshAll() {
    load();
    onChanged?.();
    if (sessionClassId) {
      const rows = await trpc.schedule.listSessions.query({ classBatchId: sessionClassId });
      setSessions(rows);
    }
  }

  async function createClass() {
    if (!facilityId || !courseId || !startDate || !endDate || !startTime || !endTime) {
      notifyError('Điền đủ cơ sở, khóa học, ngày và giờ học.', 'Thiếu thông tin');
      return;
    }
    setBusy(true);
    try {
      const result = await trpc.teacherLite.createClass.mutate({
        facilityId,
        courseId,
        startDate,
        endDate,
        capacity: typeof capacity === 'number' ? capacity : undefined,
        slot: {
          dayOfWeek: Number(dayOfWeek),
          startTime,
          endTime,
        },
        generateSessions: true,
      });
      notifySuccess(`Đã tạo lớp ${result.batch.code} và ${result.sessions.created} buổi.`, 'Teacher Lite');
      setCancelClassId(result.batch.id);
      setSessionClassId(result.batch.id);
      await refreshAll();
    } catch (e) {
      notifyError(e, 'Không tạo được lớp');
    } finally {
      setBusy(false);
    }
  }

  async function cancelClass() {
    if (!cancelClassId || !cancelClassReason.trim()) {
      notifyError('Chọn lớp và nhập lý do hủy.', 'Thiếu thông tin');
      return;
    }
    setBusy(true);
    try {
      const result = await trpc.teacherLite.cancelClass.mutate({ id: cancelClassId, reason: cancelClassReason.trim() });
      notifySuccess(`Đã hủy lớp, ${result.cancelledSessions} buổi tương lai đã hủy.`, 'Teacher Lite');
      setCancelClassReason('');
      await refreshAll();
    } catch (e) {
      notifyError(e, 'Không hủy được lớp');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSession() {
    if (!cancelSessionId || !cancelSessionReason.trim()) {
      notifyError('Chọn buổi và nhập lý do hủy.', 'Thiếu thông tin');
      return;
    }
    setBusy(true);
    try {
      await trpc.teacherLite.cancelSession.mutate({ sessionId: cancelSessionId, reason: cancelSessionReason.trim() });
      notifySuccess('Đã hủy buổi học.', 'Teacher Lite');
      setCancelSessionReason('');
      await refreshAll();
    } catch (e) {
      notifyError(e, 'Không hủy được buổi học');
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return null;

  return (
    <Card withBorder>
      <Group justify="space-between" mb="md">
        <Title order={5}>Lớp học nhanh</Title>
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={load}>
          Tải lại
        </Button>
      </Group>
      <Stack>
        <Group grow align="flex-end">
          <Select
            label="Cơ sở"
            withAsterisk
            searchable
            data={facilities.map((facility) => ({ value: String(facility.id), label: `${facility.code} - ${facility.name}` }))}
            value={facilityId ? String(facilityId) : null}
            onChange={(value) => setFacilityId(value ? Number(value) : null)}
          />
          <Select
            label="Khóa học"
            withAsterisk
            searchable
            data={courses.map((course) => ({ value: course.id, label: `${course.code} - ${course.name}` }))}
            value={courseId}
            onChange={setCourseId}
          />
          <NumberInput label="Sĩ số" min={1} value={capacity} onChange={(value) => setCapacity(typeof value === 'number' ? value : '')} />
        </Group>
        <Group grow align="flex-end">
          <DateInput label="Ngày bắt đầu" withAsterisk valueFormat="DD/MM/YYYY" value={parseApiDate(startDate)} onChange={(date) => setStartDate(toApiDate(date) ?? '')} />
          <DateInput label="Ngày kết thúc" withAsterisk valueFormat="DD/MM/YYYY" value={parseApiDate(endDate)} onChange={(date) => setEndDate(toApiDate(date) ?? '')} />
          <Select label="Thứ" withAsterisk data={DAYS} value={dayOfWeek} onChange={(value) => value && setDayOfWeek(value)} allowDeselect={false} />
          <TextInput label="Bắt đầu" withAsterisk value={startTime} onChange={(e) => setStartTime(e.currentTarget.value)} />
          <TextInput label="Kết thúc" withAsterisk value={endTime} onChange={(e) => setEndTime(e.currentTarget.value)} />
        </Group>
        <Group>
          <Button onClick={createClass} loading={busy}>Tạo lớp</Button>
        </Group>
        <Divider />
        <Group grow align="flex-end">
          <Select
            label="Hủy lớp"
            searchable
            data={activeBatches.map((batch) => ({ value: batch.id, label: `${batch.code} - ${batch.name}` }))}
            value={cancelClassId}
            onChange={setCancelClassId}
          />
          <TextInput label="Lý do" value={cancelClassReason} onChange={(e) => setCancelClassReason(e.currentTarget.value)} />
          <Button color="red" variant="light" onClick={cancelClass} loading={busy}>Hủy lớp</Button>
        </Group>
        <Group grow align="flex-end">
          <Select
            label="Lớp có buổi"
            searchable
            data={activeBatches.map((batch) => ({ value: batch.id, label: `${batch.code} - ${batch.name}` }))}
            value={sessionClassId}
            onChange={setSessionClassId}
          />
          <Select
            label="Hủy buổi"
            searchable
            data={sessions.filter((session) => session.status !== 'cancelled').map((session) => ({ value: session.id, label: sessionLabel(session) }))}
            value={cancelSessionId}
            onChange={setCancelSessionId}
          />
          <TextInput label="Lý do" value={cancelSessionReason} onChange={(e) => setCancelSessionReason(e.currentTarget.value)} />
          <Button color="red" variant="light" onClick={cancelSession} loading={busy}>Hủy buổi</Button>
        </Group>
        <Text size="sm" c="dimmed">Học liệu: Khóa học / Bài tập theo bài.</Text>
      </Stack>
    </Card>
  );
}
