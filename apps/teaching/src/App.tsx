import '@mantine/dates/styles.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { LoginGate, useSession, trpc, Chatter, notifyError, notifySuccess, required } from '@cmc/ui';
import { useForm } from '@mantine/form';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Modal,
  NumberInput,
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
import { GradingPanel } from './grading';
import { AssessmentPanel } from './assessment-panel';
import { LevelApprovalPanel } from './level-approval-panel';
import { FinancePanel } from './finance-panel';
import { CrmPanel } from './crm-panel';
import { CskhPanel } from './cskh-panel';
import { CertificatePanel } from './certificate-panel';
import { PayrollPanel } from './payroll-panel';
import { MyPayslipsPanel } from './my-payslips-panel';
import { Shell, ALL_TEACHING_KEYS, type SectionKey } from './shell';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type Batch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type Session = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];
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

// Map sidebar section keys that belong inside Workspace to their ClassDetail tab value
const SECTION_TO_CLASS_TAB: Partial<Record<SectionKey, string>> = {
  schedule: 'schedule',
  sessions: 'sessions',
  attendance: 'attendance',
  meetings: 'meetings',
  classlog: 'log',
  enrollment: 'enroll',
};

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
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { courseId: '' as string, name: '', capacity: '' as number | string },
    validate: {
      courseId: required('Chọn khóa học'),
      name: required('Nhập tên lớp'),
    },
  });

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.classBatch.create.mutate({
        facilityId,
        courseId: values.courseId,
        name: values.name,
        startDate: toApiDate(startDate),
        endDate: toApiDate(endDate),
        capacity: typeof values.capacity === 'number' ? values.capacity : undefined,
      });
      notifySuccess(`Đã tạo lớp "${values.name}"`);
      close();
      form.reset();
      setStartDate(null);
      setEndDate(null);
      onCreated();
    } catch (e) {
      notifyError(e, 'Tạo lớp học thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="filled" radius={9999} size="sm" onClick={open}>
        + Tạo lớp
      </Button>
      <Modal opened={opened} onClose={close} title="Tạo lớp học" radius="xl" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack>
            <Select
              label="Khóa học"
              withAsterisk
              placeholder={courses.length ? 'Chọn khóa' : 'Chưa có khóa học (tạo ở Admin)'}
              data={courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name} (${c.program})` }))}
              {...form.getInputProps('courseId')}
            />
            <TextInput label="Tên lớp" withAsterisk {...form.getInputProps('name')} />
            <Group grow>
              <DateInput label="Khai giảng" value={startDate} onChange={setStartDate} valueFormat="DD/MM/YYYY" clearable />
              <DateInput label="Kết thúc" value={endDate} onChange={setEndDate} valueFormat="DD/MM/YYYY" clearable />
            </Group>
            <NumberInput label="Sĩ số tối đa (tùy chọn)" min={1} {...form.getInputProps('capacity')} />
            <Button type="submit" loading={busy} variant="filled" radius={9999}>
              Tạo
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

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
  const [slots, setSlots] = useState<Awaited<ReturnType<typeof trpc.schedule.listSlots.query>>>([]);
  const [day, setDay] = useState<string | null>('1');
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('19:30');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });
  const [generateMsg, setGenerateMsg] = useState('');
  const roomLabel = useCallback(
    (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.code ?? '—') : '—'),
    [rooms],
  );
  const teacherLabel = useCallback(
    (id: string | null) => (id ? (teachers.find((t) => t.id === id)?.displayName ?? '—') : '—'),
    [teachers],
  );
  const load = useCallback(() => {
    trpc.schedule.listSlots.query({ classBatchId: batch.id }).then(setSlots).catch((e) => notifyError(e, 'Không tải được lịch học'));
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
      notifySuccess('Đã thêm khung lịch');
      load();
    } catch (e) {
      notifyError(e, 'Thêm khung lịch thất bại');
    }
  }
  async function generate() {
    setGenerateMsg('');
    try {
      const r = await trpc.schedule.generateSessions.mutate({
        classBatchId: batch.id,
        startDate: toApiDate(range.from)!,
        endDate: toApiDate(range.to)!,
      });
      setGenerateMsg(`Đã tạo ${r.created} buổi (bỏ qua ${r.skipped}).`);
    } catch (e) {
      notifyError(e, 'Sinh buổi học thất bại');
    }
  }

  return (
    <Stack>
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="xs" style={{ color: 'var(--cmc-text)' }}>
          Khung lịch tuần
        </Text>
        <Group align="flex-end">
          <Select
            label="Thứ"
            w={110}
            data={DOW.map((l, i) => ({ value: String(i), label: l }))}
            value={day}
            onChange={setDay}
          />
          <TextInput label="Bắt đầu" w={90} value={start} onChange={(e) => setStart(e.currentTarget.value)} />
          <TextInput label="Kết thúc" w={90} value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
          <Select
            label="Phòng"
            w={150}
            clearable
            placeholder={rooms.length ? 'Chọn phòng' : 'Chưa có phòng'}
            data={rooms.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))}
            value={roomId}
            onChange={setRoomId}
          />
          <Select
            label="Giáo viên"
            w={170}
            clearable
            searchable
            placeholder={teachers.length ? 'Chọn GV' : 'Chưa có GV'}
            data={teachers.map((t) => ({ value: t.id, label: t.displayName }))}
            value={teacherId}
            onChange={setTeacherId}
          />
          <Button onClick={addSlot} variant="filled" radius={9999}>Thêm khung</Button>
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          Gán phòng/giáo viên để hệ thống chặn cứng trùng phòng và trùng giáo viên khi sinh lịch.
        </Text>
        <Table mt="sm" striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Thứ</Table.Th>
              <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Giờ</Table.Th>
              <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Phòng</Table.Th>
              <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Giáo viên</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {slots.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td>{DOW[s.dayOfWeek]}</Table.Td>
                <Table.Td>
                  {s.startTime} - {s.endTime}
                </Table.Td>
                <Table.Td>{roomLabel(s.roomId)}</Table.Td>
                <Table.Td>{teacherLabel(s.teacherId)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="xs" style={{ color: 'var(--cmc-text)' }}>
          Sinh buổi học
        </Text>
        <Group align="flex-end">
          <DateInput
            label="Từ ngày"
            value={range.from}
            onChange={(d) => setRange((r) => ({ ...r, from: d }))}
            valueFormat="DD/MM/YYYY"
          />
          <DateInput
            label="Đến ngày"
            value={range.to}
            onChange={(d) => setRange((r) => ({ ...r, to: d }))}
            valueFormat="DD/MM/YYYY"
          />
          <Button onClick={generate} disabled={!range.from || !range.to} variant="filled" radius={9999}>
            Sinh lịch
          </Button>
        </Group>
        {generateMsg && (
          <Text size="sm" mt="xs" c="green">
            {generateMsg}
          </Text>
        )}
      </Card>
    </Stack>
  );
}

function SessionsTab({ batchId, rooms, teachers }: { batchId: string; rooms: Room[]; teachers: Teacher[] }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    trpc.schedule.listSessions.query({ classBatchId: batchId }).then(setSessions).catch((e) => notifyError(e, 'Không tải được buổi học'));
  }, [batchId]);
  const roomLabel = (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.code ?? '—') : '—');
  const teacherLabel = (id: string | null) =>
    id ? (teachers.find((t) => t.id === id)?.displayName ?? '—') : '—';
  return (
    <Table striped highlightOnHover withTableBorder={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Ngày</Table.Th>
          <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Giờ</Table.Th>
          <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Phòng</Table.Th>
          <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Giáo viên</Table.Th>
          <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Trạng thái</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sessions.map((s) => (
          <Table.Tr key={s.id}>
            <Table.Td>{fmtDate(s.sessionDate)}</Table.Td>
            <Table.Td>
              {s.startTime} - {s.endTime}
            </Table.Td>
            <Table.Td>{roomLabel(s.roomId)}</Table.Td>
            <Table.Td>{teacherLabel(s.teacherId)}</Table.Td>
            <Table.Td>
              <Badge size="sm" color={STATUS_COLOR[s.status]} variant="light" radius="xl">
                {s.status}
              </Badge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function CreateStudentModal({ facilityId, onCreated }: { facilityId: number; onCreated: () => void }) {
  const [opened, { open, close }] = useDisclosure(false);
  const [dob, setDob] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { studentCode: '', fullName: '', program: 'UCREA' as string },
    validate: {
      studentCode: required('Nhập mã học sinh'),
      fullName: required('Nhập họ tên'),
      program: required('Chọn chương trình'),
    },
  });

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.student.create.mutate({
        facilityId,
        studentCode: values.studentCode,
        fullName: values.fullName,
        program: values.program as 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE',
        dateOfBirth: toApiDate(dob),
      });
      notifySuccess(`Đã tạo học sinh "${values.fullName}"`);
      close();
      form.reset();
      setDob(null);
      onCreated();
    } catch (e) {
      notifyError(e, 'Tạo học sinh thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="subtle" onClick={open}>
        + Tạo học sinh
      </Button>
      <Modal opened={opened} onClose={close} title="Tạo học sinh" radius="xl" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack>
            <TextInput label="Mã học sinh" withAsterisk {...form.getInputProps('studentCode')} />
            <TextInput label="Họ tên" withAsterisk {...form.getInputProps('fullName')} />
            <Select
              label="Chương trình"
              withAsterisk
              data={['UCREA', 'BRIGHT_IG', 'BLACK_HOLE']}
              {...form.getInputProps('program')}
            />
            <DateInput label="Ngày sinh" value={dob} onChange={setDob} valueFormat="DD/MM/YYYY" clearable />
            <Button type="submit" loading={busy} variant="filled" radius={9999}>
              Tạo
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

function EnrollTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [enrollMsg, setEnrollMsg] = useState('');
  const load = useCallback(() => {
    trpc.enrollment.listByBatch.query({ classBatchId: batch.id }).then(setEnrollments).catch((e) => notifyError(e, 'Không tải được danh sách ghi danh'));
    trpc.student.list.query().then(setStudents).catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
  }, [batch.id]);
  useEffect(load, [load]);

  async function enroll() {
    if (!studentId) return;
    setEnrollMsg('');
    try {
      const r = await trpc.enrollment.enroll.mutate({ facilityId, classBatchId: batch.id, studentId });
      if (r.overCapacity) {
        setEnrollMsg(`Vượt sĩ số (${r.enrolledCount}/${r.capacity}) — vẫn ghi danh.`);
      } else {
        notifySuccess('Đã ghi danh thành công');
      }
      setStudentId(null);
      load();
    } catch (e) {
      notifyError(e, 'Ghi danh thất bại');
    }
  }

  async function complete(id: string) {
    try {
      await trpc.enrollment.complete.mutate({ id });
      notifySuccess('Đã hoàn tất ghi danh');
      load();
    } catch (e) {
      notifyError(e, 'Hoàn tất ghi danh thất bại');
    }
  }

  const enrolledIds = new Set(enrollments.map((e) => e.studentId));
  const enrollable = students.filter((s) => !enrolledIds.has(s.id));

  return (
    <Stack>
      <Group align="flex-end">
        <Select
          label="Học sinh"
          style={{ flex: 1 }}
          searchable
          placeholder={enrollable.length ? 'Chọn học sinh' : 'Không còn học sinh để ghi danh'}
          data={enrollable.map((s) => ({ value: s.id, label: `${s.studentCode} — ${s.fullName}` }))}
          value={studentId}
          onChange={setStudentId}
        />
        <Button onClick={enroll} disabled={!studentId} variant="filled" radius={9999}>
          Ghi danh
        </Button>
        <CreateStudentModal facilityId={facilityId} onCreated={load} />
      </Group>
      {enrollMsg && (
        <Text size="sm" c="orange">
          {enrollMsg}
        </Text>
      )}
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Tbody>
          {enrollments.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>{e.student.studentCode}</Table.Td>
              <Table.Td>{e.student.fullName}</Table.Td>
              <Table.Td>
                <Badge size="sm" color={e.status === 'completed' ? 'teal' : undefined} variant="light" radius="xl">
                  {e.status}
                </Badge>
              </Table.Td>
              <Table.Td w={110}>
                {e.status === 'active' && (
                  <Button size="compact-xs" variant="subtle" onClick={() => complete(e.id)}>
                    Hoàn tất
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

type ParentMeeting = Awaited<ReturnType<typeof trpc.parentMeeting.list.query>>[number];

function MeetingsTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const [meetings, setMeetings] = useState<ParentMeeting[]>([]);

  const load = useCallback(() => {
    trpc.parentMeeting.list.query({ facilityId, classBatchId: batch.id }).then(setMeetings).catch((e) => notifyError(e, 'Không tải được lịch họp phụ huynh'));
  }, [facilityId, batch.id]);
  useEffect(load, [load]);

  async function setStatus(id: string, status: 'done' | 'cancelled') {
    try {
      await trpc.parentMeeting.setStatus.mutate({ id, status });
      notifySuccess(status === 'done' ? 'Đã đánh dấu đã họp' : 'Đã hủy cuộc họp');
      load();
    } catch (e) {
      notifyError(e, 'Cập nhật trạng thái họp thất bại');
    }
  }

  const ST: Record<string, { label: string; color: string }> = {
    scheduled: { label: 'Đã lên lịch', color: 'blue' },
    done: { label: 'Đã họp', color: 'teal' },
    cancelled: { label: 'Đã hủy', color: 'gray' },
  };

  return (
    <Stack>
      <Alert color="blue" variant="light">
        Lịch họp phụ huynh được hệ thống tự sinh theo định kỳ của chương trình (UCREA 5 tháng; Bright I.G &amp; Black Hole 3 tháng), tính từ ngày khai giảng lớp. Không tạo họp đột xuất — nhân viên chỉ đánh dấu đã họp / hủy.
      </Alert>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Tbody>
          {meetings.map((m) => {
            const st = ST[m.status] ?? { label: m.status, color: 'gray' };
            return (
              <Table.Tr key={m.id}>
                <Table.Td>{dayjs(m.scheduledAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
                <Table.Td>{m.title}</Table.Td>
                <Table.Td>{m.location ?? ''}</Table.Td>
                <Table.Td>
                  <Badge size="sm" color={st.color} variant="light" radius="xl">{st.label}</Badge>
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
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function AttendanceTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, { status: string; excused: boolean }>>({});

  useEffect(() => {
    trpc.schedule.listSessions.query({ classBatchId: batch.id }).then(setSessions).catch((e) => notifyError(e, 'Không tải được danh sách buổi học'));
    trpc.enrollment.listByBatch.query({ classBatchId: batch.id }).then(setEnrollments).catch((e) => notifyError(e, 'Không tải được danh sách học sinh'));
  }, [batch.id]);

  useEffect(() => {
    if (!sessionId) return;
    trpc.attendance.listBySession.query({ classSessionId: sessionId }).then((rows) => {
      const m: Record<string, { status: string; excused: boolean }> = {};
      for (const r of rows) m[r.enrollmentId] = { status: r.status, excused: r.excused };
      setMarks(m);
    }).catch((e) => notifyError(e, 'Không tải được điểm danh'));
  }, [sessionId]);

  async function mark(enrollmentId: string, status: string, excused: boolean) {
    if (!sessionId || !status) return;
    try {
      await trpc.attendance.mark.mutate({
        facilityId,
        classSessionId: sessionId,
        enrollmentId,
        status: status as 'present' | 'absent' | 'late',
        excused,
      });
      setMarks((m) => ({ ...m, [enrollmentId]: { status, excused } }));
    } catch (e) {
      notifyError(e, 'Điểm danh thất bại');
    }
  }

  return (
    <Stack>
      <Select
        label="Chọn buổi học"
        placeholder="Chọn buổi"
        data={sessions.map((s) => ({ value: s.id, label: `${fmtDate(s.sessionDate)} ${s.startTime}` }))}
        value={sessionId}
        onChange={setSessionId}
      />
      {sessionId && (
        <Table striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Học sinh</Table.Th>
              <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Điểm danh</Table.Th>
              <Table.Th style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--cmc-text-muted)' }}>Có phép</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {enrollments.map((e) => {
              const cur = marks[e.id];
              return (
                <Table.Tr key={e.id}>
                  <Table.Td>{e.student.fullName}</Table.Td>
                  <Table.Td>
                    <SegmentedControl
                      size="xs"
                      data={[
                        { value: 'present', label: 'Có mặt' },
                        { value: 'late', label: 'Muộn' },
                        { value: 'absent', label: 'Vắng' },
                      ]}
                      value={cur?.status ?? ''}
                      onChange={(v) => mark(e.id, v, cur?.excused ?? false)}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Checkbox
                      checked={cur?.excused ?? false}
                      disabled={!cur?.status}
                      onChange={(ev) => mark(e.id, cur?.status ?? '', ev.currentTarget.checked)}
                    />
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

function ClassDetail({
  batch,
  facilityId,
  rooms,
  teachers,
  onChanged,
  initialTab,
}: {
  batch: Batch;
  facilityId: number;
  rooms: Room[];
  teachers: Teacher[];
  onChanged: () => void;
  initialTab?: string;
}) {
  const [cancelOpen, cancel] = useDisclosure(false);
  const [reason, setReason] = useState('');

  async function doCancel() {
    try {
      await trpc.classBatch.cancel.mutate({ id: batch.id, reason });
      notifySuccess('Đã hủy lớp học');
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
      notifySuccess('Đã mở lại lớp học');
      onChanged();
    } catch (e) {
      notifyError(e, 'Mở lại lớp thất bại');
    }
  }
  async function setStatus(status: string) {
    try {
      await trpc.classBatch.setStatus.mutate({ id: batch.id, status: status as 'open' | 'running' | 'closed' });
      notifySuccess(`Đã đổi trạng thái lớp sang "${status}"`);
      onChanged();
    } catch (e) {
      notifyError(e, 'Đổi trạng thái lớp thất bại');
    }
  }

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Group justify="space-between" mb="md">
        <div>
          <Group gap="xs">
            <Title order={5} style={{ color: 'var(--cmc-text)' }}>{batch.code}</Title>
            <Badge color={STATUS_COLOR[batch.status]} variant="light" radius="xl">{batch.status}</Badge>
          </Group>
          <Text c="dimmed" size="sm">
            {batch.name} · {batch.course.code}
          </Text>
        </div>
        <Group gap="xs">
          {batch.status !== 'cancelled' ? (
            <>
              <Select
                size="xs"
                w={130}
                placeholder="Đổi trạng thái"
                data={['open', 'running', 'closed']}
                onChange={(v) => v && setStatus(v)}
              />
              <Button size="xs" color="red" variant="light" onClick={cancel.open}>
                Hủy lớp
              </Button>
            </>
          ) : (
            <Button size="xs" variant="filled" radius={9999} onClick={doReopen}>
              Mở lại
            </Button>
          )}
        </Group>
      </Group>

      <Tabs defaultValue={initialTab ?? 'schedule'}>
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

      <Modal opened={cancelOpen} onClose={cancel.close} title="Hủy lớp" radius="xl" centered>
        <Stack>
          <TextInput
            label="Lý do hủy (bắt buộc)"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={cancel.close}>Hủy bỏ</Button>
            <Button color="red" variant="filled" onClick={doCancel} disabled={!reason}>
              Xác nhận hủy
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

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
  const [busy, setBusy] = useState(false);

  const form = useForm({
    initialValues: { code: '', name: '', capacity: '' as number | string },
    validate: {
      code: required('Nhập mã phòng'),
      name: required('Nhập tên phòng'),
    },
  });

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.room.create.mutate({
        facilityId,
        code: values.code,
        name: values.name,
        capacity: typeof values.capacity === 'number' ? values.capacity : undefined,
      });
      notifySuccess(`Đã thêm phòng "${values.name}"`);
      form.reset();
      reload();
    } catch (e) {
      notifyError(e, 'Thêm phòng thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="xs" variant="subtle" onClick={open}>
        Quản lý phòng ({rooms.length})
      </Button>
      <Modal opened={opened} onClose={close} title="Phòng học (theo cơ sở)" radius="xl" centered>
        <Stack>
          <form onSubmit={form.onSubmit(create)}>
            <Group align="flex-end">
              <TextInput label="Mã" w={90} withAsterisk {...form.getInputProps('code')} />
              <TextInput label="Tên" style={{ flex: 1 }} withAsterisk {...form.getInputProps('name')} />
              <NumberInput label="Sức chứa" w={100} min={1} {...form.getInputProps('capacity')} />
              <Button type="submit" loading={busy} disabled={!form.values.code || !form.values.name} variant="filled" radius={9999}>
                Thêm
              </Button>
            </Group>
          </form>
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Tbody>
              {rooms.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td w={80}>
                    <b>{r.code}</b>
                  </Table.Td>
                  <Table.Td>{r.name}</Table.Td>
                  <Table.Td w={80}>{r.capacity ?? '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rooms.length === 0 && (
            <Text c="dimmed" size="sm">
              Chưa có phòng cho cơ sở này.
            </Text>
          )}
        </Stack>
      </Modal>
    </>
  );
}

function Workspace({ initialTab }: { initialTab?: string }) {
  const { me } = useSession();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selected, setSelected] = useState<Batch | null>(null);

  useEffect(() => {
    trpc.facility.list.query().then((fs) => {
      setFacilities(fs);
      setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
    }).catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'));
    trpc.course.list.query().then(setCourses).catch((e) => notifyError(e, 'Không tải được danh sách khóa học'));
  }, []);

  const loadBatches = useCallback(() => {
    trpc.classBatch.list.query().then((bs) => {
      setBatches(bs);
      setSelected((sel) => (sel ? (bs.find((b) => b.id === sel.id) ?? null) : null));
    }).catch((e) => notifyError(e, 'Không tải được danh sách lớp học'));
  }, []);
  useEffect(loadBatches, [loadBatches]);

  const loadRooms = useCallback(() => {
    trpc.room.list.query().then(setRooms).catch((e) => notifyError(e, 'Không tải được danh sách phòng'));
  }, []);
  useEffect(loadRooms, [loadRooms]);

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  useEffect(() => {
    if (!facilityId) return;
    trpc.user.listTeachers.query({ facilityId }).then(setTeachers).catch(() => setTeachers([]));
  }, [facilityId]);

  const visible = facilityId ? batches.filter((b) => b.facilityId === facilityId) : batches;
  const facilityRooms = facilityId ? rooms.filter((r) => r.facilityId === facilityId) : rooms;

  const [classSearch, setClassSearch] = useState('');
  const [classStatusFilter, setClassStatusFilter] = useState('all');
  const filteredBatches = useMemo(() => {
    const q = classSearch.toLowerCase();
    return visible.filter((b) => {
      const matchText = !q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q);
      const matchStatus = classStatusFilter === 'all' || b.status === classStatusFilter;
      return matchText && matchStatus;
    });
  }, [visible, classSearch, classStatusFilter]);

  return (
    <Stack>
      <Group justify="space-between" mb="xl">
        <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }}>Lớp học</Text>
        <Group gap="xs" align="flex-end">
          <Select
            label="Cơ sở"
            data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
            value={facilityId ? String(facilityId) : null}
            onChange={(v) => setFacilityId(v ? Number(v) : null)}
            w={240}
          />
          {facilityId && (
            <>
              <RoomsManager facilityId={facilityId} rooms={facilityRooms} reload={loadRooms} />
              <CreateClassModal facilityId={facilityId} courses={courses} onCreated={loadBatches} />
            </>
          )}
        </Group>
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
            <Text size="lg" fw={600} mb="sm" style={{ color: 'var(--cmc-text)' }}>
              Lớp học ({filteredBatches.length}{filteredBatches.length !== visible.length ? `/${visible.length}` : ''})
            </Text>
            <Stack gap="xs" mb="sm">
              <TextInput
                placeholder="Tìm lớp..."
                size="xs"
                value={classSearch}
                onChange={(e) => setClassSearch(e.currentTarget.value)}
              />
              <SegmentedControl
                size="xs"
                value={classStatusFilter}
                onChange={setClassStatusFilter}
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
            <Table highlightOnHover withTableBorder={false}>
              <Table.Tbody>
                {filteredBatches.map((b) => (
                  <Table.Tr
                    key={b.id}
                    style={{ cursor: 'pointer' }}
                    bg={selected?.id === b.id ? 'var(--cmc-brand-muted)' : undefined}
                    onClick={() => setSelected(b)}
                  >
                    <Table.Td>
                      <Text fw={600} style={{ color: 'var(--cmc-text)' }}>{b.code}</Text>
                      <Text size="xs" c="dimmed">
                        {b.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLOR[b.status]} variant="light" radius="xl">
                        {b.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {visible.length === 0 && (
              <Text c="dimmed" size="sm">
                Chưa có lớp. Bấm "Tạo lớp".
              </Text>
            )}
            {visible.length > 0 && filteredBatches.length === 0 && (
              <Text c="dimmed" size="sm">
                Không tìm thấy lớp phù hợp.
              </Text>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          {selected && facilityId ? (
            <ClassDetail
              batch={selected}
              facilityId={facilityId}
              rooms={facilityRooms}
              teachers={teachers}
              onChanged={loadBatches}
              initialTab={initialTab}
            />
          ) : (
            <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
              <Text c="dimmed">
                Chọn một lớp để xem chi tiết, hoặc tạo lớp mới. Xin chào {me.displayName}.
              </Text>
            </Card>
          )}
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

// Sections that map to the Workspace/classes view with a specific sub-tab
const CLASS_CONTEXT_SECTIONS = new Set<SectionKey>([
  'schedule', 'sessions', 'attendance', 'enrollment', 'meetings', 'classlog', 'classes',
]);

function Workbench() {
  const { me } = useSession();
  const canPayroll = me.isSuperAdmin || me.roles.includes('hr') || me.roles.includes('ke_toan');

  const hashKey = window.location.hash.slice(1);
  const initialSection: SectionKey = ALL_TEACHING_KEYS.has(hashKey) ? (hashKey as SectionKey) : 'classes';
  const [activeSection, setActiveSection] = useState<SectionKey>(initialSection);

  function handleSectionChange(key: SectionKey) {
    window.location.hash = key;
    setActiveSection(key);
  }

  function renderContent() {
    if (CLASS_CONTEXT_SECTIONS.has(activeSection)) {
      const classTab = SECTION_TO_CLASS_TAB[activeSection];
      return <Workspace key={activeSection} initialTab={classTab} />;
    }
    switch (activeSection) {
      case 'grading':
        return <GradingPanel />;
      case 'assessment':
        return <AssessmentPanel />;
      case 'levelup':
        return <LevelApprovalPanel />;
      case 'crm':
        return <CrmPanel />;
      case 'finance':
        return <FinancePanel />;
      case 'cskh':
        return <CskhPanel />;
      case 'certificate':
        return <CertificatePanel />;
      case 'my-payslips':
        return <MyPayslipsPanel />;
      case 'payroll':
        return canPayroll ? <PayrollPanel /> : null;
      default:
        return null;
    }
  }

  return (
    <Shell activeSection={activeSection} onSectionChange={handleSectionChange}>
      {renderContent()}
    </Shell>
  );
}

export function App() {
  return (
    <LoginGate appTitle="Teaching / ERP">
      <Workbench />
    </LoginGate>
  );
}
