/**
 * Class workspace — the full class management panel ported from apps/teaching.
 * Contains class list, room management, schedule, enrollment, attendance, and
 * parent-meeting management. Exported Workspace component is driven by NavAction
 * so that SchedulePanel's goToClass can pre-open a specific class + tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, Chatter, notifyError, useSession } from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import {
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { AttendanceRoster } from './attendance-roster.js';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type Batch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type ClassSession = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];
type Enrollment = Awaited<ReturnType<typeof trpc.enrollment.listByBatch.query>>[number];
type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type Room = Awaited<ReturnType<typeof trpc.room.list.query>>[number];
type Teacher = Awaited<ReturnType<typeof trpc.user.listTeachers.query>>[number];

const STATUS_COLOR: Record<string, string> = {
  planned: 'gray',
  open: 'blue',
  running: 'green',
  closed: 'dark',
  cancelled: 'red',
};
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const fmtDate = (d: string | Date) => dayjs(d).format('DD/MM/YYYY');
const toApiDate = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : undefined);
const PAGE_SIZE = 20;

// ─── NavAction ────────────────────────────────────────────────────────────────

/**
 * Describes a programmatic navigation into the class workspace.
 * ts is a monotonic timestamp so repeated calls with the same args still trigger.
 */
export interface NavAction {
  batchId?: string;
  tab: string;
  ts: number;
}

// ─── CreateClassModal ─────────────────────────────────────────────────────────

function CreateClassModal({
  facilityId,
  courses,
  onCreated,
}: {
  facilityId: number;
  courses: Course[];
  onCreated: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [capacity, setCapacity] = useState<number | string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    if (!courseId || !name) {
      setErr('Chọn khóa học và nhập tên lớp');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await trpc.classBatch.create.mutate({
        facilityId,
        courseId,
        name,
        startDate: toApiDate(startDate),
        endDate: toApiDate(endDate),
        capacity: typeof capacity === 'number' ? capacity : undefined,
      });
      close();
      setName('');
      setCourseId(null);
      onCreated();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="xs" onClick={open}>
        + Tạo lớp
      </Button>
      <Modal opened={opened} onClose={close} title="Tạo lớp học">
        <Stack>
          <Select
            label="Khóa học"
            placeholder={courses.length ? 'Chọn khóa' : 'Chưa có khóa học (tạo ở Khóa học)'}
            data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name} (${c.program})` }))}
            value={courseId}
            onChange={setCourseId}
          />
          <TextInput label="Tên lớp" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Group grow>
            <DateInput label="Khai giảng" value={startDate} onChange={setStartDate} valueFormat="DD/MM/YYYY" clearable />
            <DateInput label="Kết thúc" value={endDate} onChange={setEndDate} valueFormat="DD/MM/YYYY" clearable />
          </Group>
          <NumberInput label="Sĩ số tối đa (tùy chọn)" value={capacity} onChange={setCapacity} min={1} />
          {err && <Text c="red" size="sm">{err}</Text>}
          <Button onClick={create} loading={busy}>Tạo</Button>
        </Stack>
      </Modal>
    </>
  );
}

// ─── ScheduleTab ──────────────────────────────────────────────────────────────

function ScheduleTab({
  batch,
  facilityId,
  rooms,
  teachers,
}: {
  batch: Batch;
  facilityId: number;
  rooms: Room[];
  teachers: Teacher[];
}) {
  const { me } = useSession();
  const canAddSlot = can(me.roles, me.isSuperAdmin, 'schedule', 'addSlot');
  const [slots, setSlots] = useState<Awaited<ReturnType<typeof trpc.schedule.listSlots.query>>>([]);
  const [day, setDay] = useState<string | null>('1');
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('19:30');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const [msg, setMsg] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const roomLabel = useCallback(
    (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.code ?? '—') : '—'),
    [rooms],
  );
  const teacherLabel = useCallback(
    (id: string | null) => (id ? (teachers.find((t) => t.id === id)?.displayName ?? '—') : '—'),
    [teachers],
  );
  const load = useCallback(() => {
    setLoadingSlots(true);
    trpc.schedule.listSlots
      .query({ classBatchId: batch.id })
      .then(setSlots)
      .catch((e) => notifyError(e, 'Không tải được khung lịch'))
      .finally(() => setLoadingSlots(false));
  }, [batch.id]);
  useEffect(load, [load]);

  async function addSlot() {
    try {
      await trpc.schedule.addSlot.mutate({
        facilityId,
        classBatchId: batch.id,
        dayOfWeek: Number(day),
        startTime: start,
        endTime: end,
        roomId: roomId ?? undefined,
        teacherId: teacherId ?? undefined,
      });
      load();
    } catch (e) {
      notifyError(e, 'Thêm khung lịch thất bại');
    }
  }

  async function generate() {
    setMsg('');
    try {
      const r = await trpc.schedule.generateSessions.mutate({
        classBatchId: batch.id,
        startDate: toApiDate(range.from)!,
        endDate: toApiDate(range.to)!,
      });
      setMsg(`Đã tạo ${r.created} buổi (bỏ qua ${r.skipped}).`);
    } catch (e) {
      setMsg('Lỗi: ' + (e instanceof Error ? e.message : ''));
    }
  }

  return (
    <Stack>
      <Card withBorder>
        <Text fw={600} mb="xs">Khung lịch tuần</Text>
        {canAddSlot && (
          <>
            <Group align="flex-end">
              <Select
                label="Thứ" w={110}
                data={DOW.map((l, i) => ({ value: String(i), label: l }))}
                value={day} onChange={setDay}
              />
              <TextInput label="Bắt đầu" w={90} value={start} onChange={(e) => setStart(e.currentTarget.value)} />
              <TextInput label="Kết thúc" w={90} value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
              <Select
                label="Phòng" w={150} clearable
                placeholder={rooms.length ? 'Chọn phòng' : 'Chưa có phòng'}
                data={rooms.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))}
                value={roomId} onChange={setRoomId}
              />
              <Select
                label="Giáo viên" w={170} clearable searchable
                placeholder={teachers.length ? 'Chọn GV' : 'Chưa có GV'}
                data={teachers.map((t) => ({ value: t.id, label: t.displayName }))}
                value={teacherId} onChange={setTeacherId}
              />
              <Button onClick={addSlot}>Thêm khung</Button>
            </Group>
            <Text size="xs" c="dimmed" mt={6}>
              Gán phòng/giáo viên để hệ thống chặn cứng trùng phòng và trùng giáo viên khi sinh lịch.
            </Text>
          </>
        )}
        {loadingSlots ? (
          <Loader size="sm" mt="sm" />
        ) : (
          <Table mt="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Thứ</Table.Th>
                <Table.Th>Giờ</Table.Th>
                <Table.Th>Phòng</Table.Th>
                <Table.Th>Giáo viên</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {slots.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{DOW[s.dayOfWeek]}</Table.Td>
                  <Table.Td>{s.startTime} - {s.endTime}</Table.Td>
                  <Table.Td>{roomLabel(s.roomId)}</Table.Td>
                  <Table.Td>{teacherLabel(s.teacherId)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
      {canAddSlot && (
        <Card withBorder>
          <Text fw={600} mb="xs">Sinh buổi học</Text>
          <Group align="flex-end">
            <DateInput label="Từ ngày" value={range.from} onChange={(d) => setRange((r) => ({ ...r, from: d }))} valueFormat="DD/MM/YYYY" />
            <DateInput label="Đến ngày" value={range.to} onChange={(d) => setRange((r) => ({ ...r, to: d }))} valueFormat="DD/MM/YYYY" />
            <Button onClick={generate} disabled={!range.from || !range.to}>Sinh lịch</Button>
          </Group>
          {msg && (
            <Text size="sm" mt="xs" c={msg.startsWith('Lỗi') ? 'red' : 'green'}>{msg}</Text>
          )}
        </Card>
      )}
    </Stack>
  );
}

// ─── SessionsTab ──────────────────────────────────────────────────────────────

function SessionsTab({ batchId, rooms, teachers }: { batchId: string; rooms: Room[]; teachers: Teacher[] }) {
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    trpc.schedule.listSessions
      .query({ classBatchId: batchId })
      .then(setSessions)
      .catch((e) => notifyError(e, 'Không tải được buổi học'))
      .finally(() => setLoading(false));
  }, [batchId]);

  const roomLabel = (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.code ?? '—') : '—');
  const teacherLabel = (id: string | null) =>
    id ? (teachers.find((t) => t.id === id)?.displayName ?? '—') : '—';

  if (loading) return <Loader size="sm" />;

  return (
    <Table striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Ngày</Table.Th>
          <Table.Th>Giờ</Table.Th>
          <Table.Th>Phòng</Table.Th>
          <Table.Th>Giáo viên</Table.Th>
          <Table.Th>Trạng thái</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sessions.map((s) => (
          <Table.Tr key={s.id}>
            <Table.Td>{fmtDate(s.sessionDate)}</Table.Td>
            <Table.Td>{s.startTime} - {s.endTime}</Table.Td>
            <Table.Td>{roomLabel(s.roomId)}</Table.Td>
            <Table.Td>{teacherLabel(s.teacherId)}</Table.Td>
            <Table.Td>
              <Badge size="sm" color={STATUS_COLOR[s.status]}>{s.status}</Badge>
            </Table.Td>
          </Table.Tr>
        ))}
        {sessions.length === 0 && (
          <Table.Tr>
            <Table.Td colSpan={5}>
              <Text c="dimmed" size="sm">Chưa có buổi học. Vào tab "Lịch" để sinh buổi.</Text>
            </Table.Td>
          </Table.Tr>
        )}
      </Table.Tbody>
    </Table>
  );
}

// ─── CreateStudentModal (used in EnrollTab) ───────────────────────────────────

function CreateStudentModal({ facilityId, onCreated }: { facilityId: number; onCreated: () => void }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [studentCode, setStudentCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [program, setProgram] = useState<string | null>('UCREA');
  const [dob, setDob] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setBusy(true);
    setErr('');
    try {
      await trpc.student.create.mutate({
        facilityId,
        studentCode,
        fullName,
        program: program as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE',
        dateOfBirth: toApiDate(dob),
      });
      close();
      setStudentCode('');
      setFullName('');
      setDob(null);
      onCreated();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="default" onClick={open}>+ Tạo học sinh</Button>
      <Modal opened={opened} onClose={close} title="Tạo học sinh">
        <Stack>
          <TextInput label="Mã học sinh" value={studentCode} onChange={(e) => setStudentCode(e.currentTarget.value)} />
          <TextInput label="Họ tên" value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
          <Select label="Chương trình" data={['UCREA', 'BRIGHT_IG', 'BLACK_HOLE']} value={program} onChange={setProgram} />
          <DateInput label="Ngày sinh" value={dob} onChange={setDob} valueFormat="DD/MM/YYYY" clearable />
          {err && <Text c="red" size="sm">{err}</Text>}
          <Button onClick={create} loading={busy} disabled={!studentCode || !fullName}>Tạo</Button>
        </Stack>
      </Modal>
    </>
  );
}

// ─── EnrollTab ────────────────────────────────────────────────────────────────

function EnrollTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const { me } = useSession();
  const canEnroll = can(me.roles, me.isSuperAdmin, 'enrollment', 'enroll');
  // student.create is superAdminProcedure — not in PERMISSIONS registry, super_admin only.
  const canCreateStudent = me.isSuperAdmin;
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      trpc.enrollment.listByBatch.query({ classBatchId: batch.id }),
      trpc.student.list.query(),
    ])
      .then(([enrs, studs]) => {
        setEnrollments(enrs);
        setStudents(studs.filter((s) => s.facilityId === facilityId));
      })
      .catch((e) => notifyError(e, 'Không tải được danh sách ghi danh'))
      .finally(() => setLoading(false));
  }, [batch.id, facilityId]);
  useEffect(load, [load]);

  async function enroll() {
    if (!studentId) return;
    setMsg('');
    try {
      const r = await trpc.enrollment.enroll.mutate({ facilityId, classBatchId: batch.id, studentId });
      setMsg(r.overCapacity ? `⚠ Vượt sĩ số (${r.enrolledCount}/${r.capacity}) — vẫn ghi danh.` : 'Đã ghi danh.');
      setStudentId(null);
      load();
    } catch (e) {
      setMsg('Lỗi: ' + (e instanceof Error ? e.message : ''));
    }
  }

  async function complete(id: string) {
    try {
      await trpc.enrollment.complete.mutate({ id });
      load();
    } catch (e) {
      notifyError(e, 'Hoàn tất ghi danh thất bại');
    }
  }

  const enrolledIds = new Set(enrollments.map((e) => e.studentId));
  const enrollable = students.filter((s) => !enrolledIds.has(s.id));

  if (loading) return <Loader size="sm" />;

  return (
    <Stack>
      {(canEnroll || canCreateStudent) && (
        <Group align="flex-end">
          {canEnroll && (
            <>
              <Select
                label="Học sinh"
                style={{ flex: 1 }}
                searchable
                placeholder={enrollable.length ? 'Chọn học sinh' : 'Không còn học sinh để ghi danh'}
                data={enrollable.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
                value={studentId}
                onChange={setStudentId}
              />
              <Button onClick={enroll} disabled={!studentId}>Ghi danh</Button>
            </>
          )}
          {canCreateStudent && (
            <CreateStudentModal facilityId={facilityId} onCreated={load} />
          )}
        </Group>
      )}
      {msg && (
        <Text size="sm" c={msg.startsWith('Lỗi') ? 'red' : msg.startsWith('⚠') ? 'orange' : 'green'}>{msg}</Text>
      )}
      <Table striped>
        <Table.Tbody>
          {enrollments.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>{e.student.studentCode}</Table.Td>
              <Table.Td>{e.student.fullName}</Table.Td>
              <Table.Td>
                <Badge size="sm" color={e.status === 'completed' ? 'teal' : undefined}>{e.status}</Badge>
              </Table.Td>
              <Table.Td w={110}>
                {e.status === 'active' && (
                  <Button size="compact-xs" variant="subtle" onClick={() => complete(e.id)}>Hoàn tất</Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ─── MeetingsTab (class-scoped, inside ClassDetail) ───────────────────────────

type ParentMeeting = Awaited<ReturnType<typeof trpc.parentMeeting.list.query>>[number];

function MeetingsTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const [meetings, setMeetings] = useState<ParentMeeting[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    trpc.parentMeeting.list
      .query({ facilityId, classBatchId: batch.id })
      .then(setMeetings)
      .catch((e) => notifyError(e, 'Không tải được cuộc họp phụ huynh'))
      .finally(() => setLoading(false));
  }, [facilityId, batch.id]);
  useEffect(load, [load]);

  async function setStatus(id: string, status: 'done' | 'cancelled') {
    try {
      await trpc.parentMeeting.setStatus.mutate({ id, status });
      load();
    } catch (e) {
      notifyError(e, 'Cập nhật thất bại');
    }
  }

  const ST: Record<string, { label: string; color: string }> = {
    scheduled: { label: 'Đã lên lịch', color: 'blue' },
    done: { label: 'Đã họp', color: 'teal' },
    cancelled: { label: 'Đã hủy', color: 'gray' },
  };

  if (loading) return <Loader size="sm" />;

  return (
    <Stack>
      <Table striped>
        <Table.Tbody>
          {meetings.map((m) => {
            const st = ST[m.status] ?? { label: m.status, color: 'gray' };
            return (
              <Table.Tr key={m.id}>
                <Table.Td>{dayjs(m.scheduledAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
                <Table.Td>{m.title}</Table.Td>
                <Table.Td>{m.location ?? ''}</Table.Td>
                <Table.Td>
                  <Badge size="sm" color={st.color}>{st.label}</Badge>
                </Table.Td>
                <Table.Td w={170}>
                  {m.status === 'scheduled' && (
                    <Group gap="xs">
                      <Button size="compact-xs" color="teal" variant="subtle" onClick={() => setStatus(m.id, 'done')}>Đã họp</Button>
                      <Button size="compact-xs" color="gray" variant="subtle" onClick={() => setStatus(m.id, 'cancelled')}>Hủy</Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
          {meetings.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={5}>
                <Text c="dimmed" size="sm">Chưa có cuộc họp nào cho lớp này.</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ─── AttendanceTab (class-scoped, inside ClassDetail) ─────────────────────────

function AttendanceTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    trpc.schedule.listSessions
      .query({ classBatchId: batch.id })
      .then(setSessions)
      .catch((e) => notifyError(e, 'Không tải được buổi học'))
      .finally(() => setLoading(false));
  }, [batch.id]);

  if (loading) return <Loader size="sm" />;

  return (
    <Stack>
      <Select
        label="Chọn buổi học"
        placeholder={sessions.length ? 'Chọn buổi' : 'Chưa có buổi học — sinh lịch ở tab Lịch'}
        data={sessions.map((s) => ({ value: s.id, label: `${fmtDate(s.sessionDate)} ${s.startTime}` }))}
        value={sessionId}
        onChange={setSessionId}
        disabled={sessions.length === 0}
      />
      {sessionId && (
        <AttendanceRoster
          key={sessionId}
          classSessionId={sessionId}
          batchId={batch.id}
          facilityId={facilityId}
        />
      )}
    </Stack>
  );
}

// ─── ClassDetail ──────────────────────────────────────────────────────────────

function ClassDetail({
  batch,
  facilityId,
  rooms,
  teachers,
  onChanged,
  initialTab = 'schedule',
}: {
  batch: Batch;
  facilityId: number;
  rooms: Room[];
  teachers: Teacher[];
  onChanged: () => void;
  initialTab?: string;
}) {
  const { me } = useSession();
  const canSetStatus = can(me.roles, me.isSuperAdmin, 'classBatch', 'setStatus');
  const [cancelOpen, cancel] = useDisclosure(false);
  const [reason, setReason] = useState('');

  async function doCancel() {
    try {
      await trpc.classBatch.cancel.mutate({ id: batch.id, reason });
      cancel.close();
      setReason('');
      onChanged();
    } catch (e) {
      notifyError(e, 'Hủy lớp thất bại');
    }
  }

  async function doReopen() {
    try {
      await trpc.classBatch.reopen.mutate({ id: batch.id, toStatus: 'planned', reason: 'Mở lại từ giao diện' });
      onChanged();
    } catch (e) {
      notifyError(e, 'Mở lại lớp thất bại');
    }
  }

  async function setStatus(status: string) {
    try {
      await trpc.classBatch.setStatus.mutate({ id: batch.id, status: status as 'open' | 'running' | 'closed' });
      onChanged();
    } catch (e) {
      notifyError(e, 'Đổi trạng thái thất bại');
    }
  }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="md">
        <div>
          <Group gap="xs">
            <Title order={5}>{batch.code}</Title>
            <Badge color={STATUS_COLOR[batch.status]}>{batch.status}</Badge>
          </Group>
          <Text c="dimmed" size="sm">{batch.name} · {batch.course.code}</Text>
        </div>
        {canSetStatus && (
          <Group gap="xs">
            {batch.status !== 'cancelled' ? (
              <>
                <Select
                  size="xs" w={130} placeholder="Đổi trạng thái"
                  data={['open', 'running', 'closed']}
                  onChange={(v) => v && setStatus(v)}
                />
                <Button size="xs" color="red" variant="light" onClick={cancel.open}>Hủy lớp</Button>
              </>
            ) : (
              <Button size="xs" onClick={doReopen}>Mở lại</Button>
            )}
          </Group>
        )}
      </Group>

      <Tabs defaultValue={initialTab}>
        <Tabs.List>
          <Tabs.Tab value="schedule">Lịch</Tabs.Tab>
          <Tabs.Tab value="sessions">Buổi học</Tabs.Tab>
          <Tabs.Tab value="enroll">Ghi danh</Tabs.Tab>
          <Tabs.Tab value="attendance">Điểm danh</Tabs.Tab>
          <Tabs.Tab value="meetings">Họp PH</Tabs.Tab>
          <Tabs.Tab value="log">Nhật ký</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="schedule" pt="md">
          <ScheduleTab batch={batch} facilityId={facilityId} rooms={rooms} teachers={teachers} />
        </Tabs.Panel>
        <Tabs.Panel value="sessions" pt="md">
          <SessionsTab batchId={batch.id} rooms={rooms} teachers={teachers} />
        </Tabs.Panel>
        <Tabs.Panel value="enroll" pt="md">
          <EnrollTab batch={batch} facilityId={facilityId} />
        </Tabs.Panel>
        <Tabs.Panel value="attendance" pt="md">
          <AttendanceTab batch={batch} facilityId={facilityId} />
        </Tabs.Panel>
        <Tabs.Panel value="meetings" pt="md">
          <MeetingsTab batch={batch} facilityId={facilityId} />
        </Tabs.Panel>
        <Tabs.Panel value="log" pt="md">
          <Chatter entityType="class_batch" entityId={batch.id} />
        </Tabs.Panel>
      </Tabs>

      {canSetStatus && (
        <Modal opened={cancelOpen} onClose={cancel.close} title="Hủy lớp">
          <Stack>
            <TextInput label="Lý do hủy (bắt buộc)" value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
            <Button color="red" onClick={doCancel} disabled={!reason}>Xác nhận hủy</Button>
          </Stack>
        </Modal>
      )}
    </Card>
  );
}

// ─── RoomsManager ─────────────────────────────────────────────────────────────

function RoomsManager({
  facilityId,
  rooms,
  reload,
}: {
  facilityId: number;
  rooms: Room[];
  reload: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState<number | string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setBusy(true);
    setErr('');
    try {
      await trpc.room.create.mutate({
        facilityId,
        code,
        name,
        capacity: typeof capacity === 'number' ? capacity : undefined,
      });
      setCode('');
      setName('');
      setCapacity('');
      reload();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="xs" variant="default" onClick={open}>Quản lý phòng ({rooms.length})</Button>
      <Modal opened={opened} onClose={close} title="Phòng học (theo cơ sở)">
        <Stack>
          <Group align="flex-end">
            <TextInput label="Mã" w={90} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
            <TextInput label="Tên" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.currentTarget.value)} />
            <NumberInput label="Sức chứa" w={100} value={capacity} onChange={setCapacity} min={1} />
            <Button onClick={create} loading={busy} disabled={!code || !name}>Thêm</Button>
          </Group>
          {err && <Text c="red" size="sm">{err}</Text>}
          <Table striped>
            <Table.Tbody>
              {rooms.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td w={80}><b>{r.code}</b></Table.Td>
                  <Table.Td>{r.name}</Table.Td>
                  <Table.Td w={80}>{r.capacity ?? '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rooms.length === 0 && (
            <Text c="dimmed" size="sm">Chưa có phòng cho cơ sở này.</Text>
          )}
        </Stack>
      </Modal>
    </>
  );
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export function Workspace({ navAction }: { navAction: NavAction | null }) {
  const { me } = useSession();
  const canManageClass = me.isSuperAdmin || me.roles.includes('quan_ly');
  // The teacher roster is only used by the (manager-gated) schedule editor; user.listTeachers is
  // permission-gated, so only fetch it for roles that may read it — otherwise non-managers (e.g.
  // giáo viên viewing their classes) hit "Không tải được danh sách giáo viên" FORBIDDEN.
  const canListTeachers = can(me.roles, me.isSuperAdmin, 'user', 'listTeachers');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<Batch | null>(null);
  const [detailKey, setDetailKey] = useState('default');
  const [detailTab, setDetailTab] = useState('schedule');
  const appliedNavTs = useRef<number | undefined>(undefined);

  useEffect(() => {
    trpc.facility.list.query().then((fs) => {
      setFacilities(fs);
      setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
    }).catch((e) => notifyError(e, 'Không tải được cơ sở'));
    trpc.course.list.query().then(setCourses).catch((e) => notifyError(e, 'Không tải được khóa học'));
  }, []);

  const loadBatches = useCallback(() => {
    trpc.classBatch.list.query().then((bs) => {
      setBatches(bs);
      setSelected((sel) => (sel ? (bs.find((b) => b.id === sel.id) ?? null) : null));
    }).catch((e) => notifyError(e, 'Không tải được danh sách lớp'));
  }, []);
  useEffect(loadBatches, [loadBatches]);

  const loadRooms = useCallback(() => {
    trpc.room.list.query().then(setRooms).catch((e) => notifyError(e, 'Không tải được phòng học'));
  }, []);
  useEffect(loadRooms, [loadRooms]);

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  useEffect(() => {
    if (!facilityId || !canListTeachers) return;
    trpc.user.listTeachers
      .query({ facilityId })
      .then(setTeachers)
      .catch((e) => { setTeachers([]); notifyError(e, 'Không tải được danh sách giáo viên'); });
  }, [facilityId, canListTeachers]);

  // Apply navAction when it changes
  useEffect(() => {
    if (!navAction || navAction.ts === appliedNavTs.current) return;
    appliedNavTs.current = navAction.ts;
    setDetailTab(navAction.tab);
    if (navAction.batchId) {
      const found = batches.find((b) => b.id === navAction.batchId);
      if (found) setSelected(found);
    }
    setDetailKey(`nav-${navAction.ts}`);
  }, [navAction, batches]);

  const visible = facilityId ? batches.filter((b) => b.facilityId === facilityId) : batches;
  const facilityRooms = facilityId ? rooms.filter((r) => r.facilityId === facilityId) : rooms;

  const [classSearch, setClassSearch] = useState('');
  const [classStatusFilter, setClassStatusFilter] = useState('all');
  const [classPage, setClassPage] = useState(1);

  const filteredBatches = useMemo(() => {
    const q = classSearch.toLowerCase();
    return visible.filter((b) => {
      const matchText = !q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q);
      const matchStatus = classStatusFilter === 'all' || b.status === classStatusFilter;
      return matchText && matchStatus;
    });
  }, [visible, classSearch, classStatusFilter]);

  const totalPages = Math.ceil(filteredBatches.length / PAGE_SIZE);
  const pageItems = filteredBatches.slice((classPage - 1) * PAGE_SIZE, classPage * PAGE_SIZE);

  function handleSelectBatch(b: Batch) {
    setSelected(b);
    setDetailTab('schedule');
    setDetailKey(`click-${b.id}`);
  }

  const hintText =
    detailTab === 'enroll'
      ? 'Chọn một lớp để ghi danh.'
      : detailTab === 'log'
      ? 'Chọn một lớp để xem nhật ký.'
      : `Chọn một lớp để xem chi tiết.`;

  return (
    <Stack>
      <Group justify="space-between">
        <Select
          label="Cơ sở"
          data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
          value={facilityId ? String(facilityId) : null}
          onChange={(v) => { setFacilityId(v ? Number(v) : null); setClassPage(1); }}
          w={240}
        />
        {facilityId && canManageClass && (
          <Group gap="xs" align="flex-end">
            <RoomsManager facilityId={facilityId} rooms={facilityRooms} reload={loadRooms} />
            <CreateClassModal facilityId={facilityId} courses={courses} onCreated={loadBatches} />
          </Group>
        )}
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder>
            <Title order={5} mb="sm">
              Lớp học ({filteredBatches.length}{filteredBatches.length !== visible.length ? `/${visible.length}` : ''})
            </Title>
            <Stack gap="xs" mb="sm">
              <TextInput
                placeholder="Tìm lớp..." size="xs"
                value={classSearch}
                onChange={(e) => { setClassSearch(e.currentTarget.value); setClassPage(1); }}
              />
              <SegmentedControl
                size="xs"
                value={classStatusFilter}
                onChange={(v) => { setClassStatusFilter(v); setClassPage(1); }}
                data={[
                  { value: 'all', label: 'Tất cả' },
                  { value: 'planned', label: 'Planned' },
                  { value: 'open', label: 'Open' },
                  { value: 'running', label: 'Running' },
                  { value: 'closed', label: 'Closed' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
            </Stack>
            <Table highlightOnHover>
              <Table.Tbody>
                {pageItems.map((b) => (
                  <Table.Tr
                    key={b.id}
                    style={{ cursor: 'pointer' }}
                    bg={selected?.id === b.id ? 'var(--mantine-color-cmc-0)' : undefined}
                    onClick={() => handleSelectBatch(b)}
                  >
                    <Table.Td>
                      <Text fw={600}>{b.code}</Text>
                      <Text size="xs" c="dimmed">{b.name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLOR[b.status]}>{b.status}</Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {totalPages > 1 && (
              <Pagination total={totalPages} value={classPage} onChange={setClassPage} size="sm" mt="md" />
            )}
            {visible.length === 0 && (
              <Text c="dimmed" size="sm">Chưa có lớp. Bấm "Tạo lớp".</Text>
            )}
            {visible.length > 0 && filteredBatches.length === 0 && (
              <Text c="dimmed" size="sm">Không tìm thấy lớp phù hợp.</Text>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          {selected && facilityId ? (
            <ClassDetail
              key={detailKey}
              batch={selected}
              facilityId={facilityId}
              rooms={facilityRooms}
              teachers={teachers}
              initialTab={detailTab}
              onChanged={loadBatches}
            />
          ) : (
            <Card withBorder>
              <Text c="dimmed">{hintText}</Text>
            </Card>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
