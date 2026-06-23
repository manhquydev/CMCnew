import '@mantine/dates/styles.css';
import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { LoginGate, useSession, trpc, Chatter } from '@cmc/ui';
import {
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
            placeholder={courses.length ? 'Chọn khóa' : 'Chưa có khóa học (tạo ở Admin)'}
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
          {err && (
            <Text c="red" size="sm">
              {err}
            </Text>
          )}
          <Button onClick={create} loading={busy}>
            Tạo
          </Button>
        </Stack>
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
  const [msg, setMsg] = useState('');
  const roomLabel = useCallback(
    (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.code ?? '—') : '—'),
    [rooms],
  );
  const teacherLabel = useCallback(
    (id: string | null) => (id ? (teachers.find((t) => t.id === id)?.displayName ?? '—') : '—'),
    [teachers],
  );
  const load = useCallback(() => {
    trpc.schedule.listSlots.query({ classBatchId: batch.id }).then(setSlots).catch(() => {});
  }, [batch.id]);
  useEffect(load, [load]);

  async function addSlot() {
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
        <Text fw={600} mb="xs">
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
          <Button onClick={addSlot}>Thêm khung</Button>
        </Group>
        <Text size="xs" c="dimmed" mt={6}>
          Gán phòng/giáo viên để hệ thống chặn cứng trùng phòng và trùng giáo viên khi sinh lịch.
        </Text>
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
      <Card withBorder>
        <Text fw={600} mb="xs">
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
          <Button onClick={generate} disabled={!range.from || !range.to}>
            Sinh lịch
          </Button>
        </Group>
        {msg && (
          <Text size="sm" mt="xs" c={msg.startsWith('Lỗi') ? 'red' : 'green'}>
            {msg}
          </Text>
        )}
      </Card>
    </Stack>
  );
}

function SessionsTab({ batchId, rooms, teachers }: { batchId: string; rooms: Room[]; teachers: Teacher[] }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    trpc.schedule.listSessions.query({ classBatchId: batchId }).then(setSessions).catch(() => {});
  }, [batchId]);
  const roomLabel = (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.code ?? '—') : '—');
  const teacherLabel = (id: string | null) =>
    id ? (teachers.find((t) => t.id === id)?.displayName ?? '—') : '—';
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
            <Table.Td>
              {s.startTime} - {s.endTime}
            </Table.Td>
            <Table.Td>{roomLabel(s.roomId)}</Table.Td>
            <Table.Td>{teacherLabel(s.teacherId)}</Table.Td>
            <Table.Td>
              <Badge size="sm" color={STATUS_COLOR[s.status]}>
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
      <Button variant="default" onClick={open}>
        + Tạo học sinh
      </Button>
      <Modal opened={opened} onClose={close} title="Tạo học sinh">
        <Stack>
          <TextInput
            label="Mã học sinh"
            value={studentCode}
            onChange={(e) => setStudentCode(e.currentTarget.value)}
          />
          <TextInput label="Họ tên" value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} />
          <Select label="Chương trình" data={['UCREA', 'BRIGHT_IG', 'BLACK_HOLE']} value={program} onChange={setProgram} />
          <DateInput label="Ngày sinh" value={dob} onChange={setDob} valueFormat="DD/MM/YYYY" clearable />
          {err && (
            <Text c="red" size="sm">
              {err}
            </Text>
          )}
          <Button onClick={create} loading={busy} disabled={!studentCode || !fullName}>
            Tạo
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function EnrollTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    trpc.enrollment.listByBatch.query({ classBatchId: batch.id }).then(setEnrollments).catch(() => {});
    trpc.student.list.query().then(setStudents).catch(() => {});
  }, [batch.id]);
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
    await trpc.enrollment.complete.mutate({ id });
    load();
  }

  // Enroll only students not already in this batch.
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
        <Button onClick={enroll} disabled={!studentId}>
          Ghi danh
        </Button>
        <CreateStudentModal facilityId={facilityId} onCreated={load} />
      </Group>
      {msg && (
        <Text size="sm" c={msg.startsWith('Lỗi') ? 'red' : msg.startsWith('⚠') ? 'orange' : 'green'}>
          {msg}
        </Text>
      )}
      <Table striped>
        <Table.Tbody>
          {enrollments.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>{e.student.studentCode}</Table.Td>
              <Table.Td>{e.student.fullName}</Table.Td>
              <Table.Td>
                <Badge size="sm" color={e.status === 'completed' ? 'teal' : undefined}>
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

function AttendanceTab({ batch, facilityId }: { batch: Batch; facilityId: number }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, { status: string; excused: boolean }>>({});

  useEffect(() => {
    trpc.schedule.listSessions.query({ classBatchId: batch.id }).then(setSessions).catch(() => {});
    trpc.enrollment.listByBatch.query({ classBatchId: batch.id }).then(setEnrollments).catch(() => {});
  }, [batch.id]);

  useEffect(() => {
    if (!sessionId) return;
    trpc.attendance.listBySession.query({ classSessionId: sessionId }).then((rows) => {
      const m: Record<string, { status: string; excused: boolean }> = {};
      for (const r of rows) m[r.enrollmentId] = { status: r.status, excused: r.excused };
      setMarks(m);
    });
  }, [sessionId]);

  async function mark(enrollmentId: string, status: string, excused: boolean) {
    if (!sessionId || !status) return;
    await trpc.attendance.mark.mutate({
      facilityId,
      classSessionId: sessionId,
      enrollmentId,
      status: status as 'present' | 'absent' | 'late',
      excused,
    });
    setMarks((m) => ({ ...m, [enrollmentId]: { status, excused } }));
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
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Học sinh</Table.Th>
              <Table.Th>Điểm danh</Table.Th>
              <Table.Th>Có phép</Table.Th>
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
}: {
  batch: Batch;
  facilityId: number;
  rooms: Room[];
  teachers: Teacher[];
  onChanged: () => void;
}) {
  const [cancelOpen, cancel] = useDisclosure(false);
  const [reason, setReason] = useState('');

  async function doCancel() {
    await trpc.classBatch.cancel.mutate({ id: batch.id, reason });
    cancel.close();
    setReason('');
    onChanged();
  }
  async function doReopen() {
    await trpc.classBatch.reopen.mutate({ id: batch.id, toStatus: 'planned', reason: 'Mở lại từ giao diện' });
    onChanged();
  }
  async function setStatus(status: string) {
    await trpc.classBatch.setStatus.mutate({ id: batch.id, status: status as 'open' | 'running' | 'closed' });
    onChanged();
  }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="md">
        <div>
          <Group gap="xs">
            <Title order={5}>{batch.code}</Title>
            <Badge color={STATUS_COLOR[batch.status]}>{batch.status}</Badge>
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
            <Button size="xs" onClick={doReopen}>
              Mở lại
            </Button>
          )}
        </Group>
      </Group>

      <Tabs defaultValue="schedule">
        <Tabs.List>
          <Tabs.Tab value="schedule">Lịch</Tabs.Tab>
          <Tabs.Tab value="sessions">Buổi học</Tabs.Tab>
          <Tabs.Tab value="enroll">Ghi danh</Tabs.Tab>
          <Tabs.Tab value="attendance">Điểm danh</Tabs.Tab>
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
        <Tabs.Panel value="log" pt="md">
          <Chatter entityType="class_batch" entityId={batch.id} facilityId={facilityId} />
        </Tabs.Panel>
      </Tabs>

      <Modal opened={cancelOpen} onClose={cancel.close} title="Hủy lớp">
        <Stack>
          <TextInput
            label="Lý do hủy (bắt buộc)"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button color="red" onClick={doCancel} disabled={!reason}>
            Xác nhận hủy
          </Button>
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
      <Button size="xs" variant="default" onClick={open}>
        Quản lý phòng ({rooms.length})
      </Button>
      <Modal opened={opened} onClose={close} title="Phòng học (theo cơ sở)">
        <Stack>
          <Group align="flex-end">
            <TextInput label="Mã" w={90} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
            <TextInput
              label="Tên"
              style={{ flex: 1 }}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <NumberInput label="Sức chứa" w={100} value={capacity} onChange={setCapacity} min={1} />
            <Button onClick={create} loading={busy} disabled={!code || !name}>
              Thêm
            </Button>
          </Group>
          {err && (
            <Text c="red" size="sm">
              {err}
            </Text>
          )}
          <Table striped>
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

function Workspace() {
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
    });
    trpc.course.list.query().then(setCourses).catch(() => {});
  }, []);

  const loadBatches = useCallback(() => {
    trpc.classBatch.list.query().then((bs) => {
      setBatches(bs);
      setSelected((sel) => (sel ? (bs.find((b) => b.id === sel.id) ?? null) : null));
    });
  }, []);
  useEffect(loadBatches, [loadBatches]);

  const loadRooms = useCallback(() => {
    trpc.room.list.query().then(setRooms).catch(() => {});
  }, []);
  useEffect(loadRooms, [loadRooms]);

  // Teachers are RLS-scoped to the caller's facilities; reload per selected facility.
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  useEffect(() => {
    if (!facilityId) return;
    trpc.user.listTeachers.query({ facilityId }).then(setTeachers).catch(() => setTeachers([]));
  }, [facilityId]);

  const visible = facilityId ? batches.filter((b) => b.facilityId === facilityId) : batches;
  const facilityRooms = facilityId ? rooms.filter((r) => r.facilityId === facilityId) : rooms;

  return (
    <Stack>
      <Group justify="space-between">
        <Select
          label="Cơ sở"
          data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
          value={facilityId ? String(facilityId) : null}
          onChange={(v) => setFacilityId(v ? Number(v) : null)}
          w={240}
        />
        {facilityId && (
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
              Lớp học ({visible.length})
            </Title>
            <Table highlightOnHover>
              <Table.Tbody>
                {visible.map((b) => (
                  <Table.Tr
                    key={b.id}
                    style={{ cursor: 'pointer' }}
                    bg={selected?.id === b.id ? 'var(--mantine-color-cmc-0)' : undefined}
                    onClick={() => setSelected(b)}
                  >
                    <Table.Td>
                      <Text fw={600}>{b.code}</Text>
                      <Text size="xs" c="dimmed">
                        {b.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLOR[b.status]}>
                        {b.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {visible.length === 0 && (
              <Text c="dimmed" size="sm">
                Chưa có lớp. Bấm “Tạo lớp”.
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
            />
          ) : (
            <Card withBorder>
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

export function App() {
  return (
    <LoginGate appTitle="Teaching / ERP">
      <Tabs defaultValue="classes" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="classes">Lớp học</Tabs.Tab>
          <Tabs.Tab value="grading">Chấm bài</Tabs.Tab>
          <Tabs.Tab value="assessment">Học bạ</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="classes">
          <Workspace />
        </Tabs.Panel>
        <Tabs.Panel value="grading">
          <GradingPanel />
        </Tabs.Panel>
        <Tabs.Panel value="assessment">
          <AssessmentPanel />
        </Tabs.Panel>
      </Tabs>
    </LoginGate>
  );
}
