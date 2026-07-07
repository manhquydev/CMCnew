import { useCallback, useEffect, useMemo, useState } from 'react';
import { can } from '@cmc/auth/permissions';
import {
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconCalendar, IconPlus, IconX } from '@tabler/icons-react';
import { notifyError, notifySuccess, parseApiDate, toApiDate, trpc, useSession } from '@cmc/ui';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type ClassBatch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type ClassSession = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];

const DAYS = [
  { value: '1', label: 'T2' },
  { value: '2', label: 'T3' },
  { value: '3', label: 'T4' },
  { value: '4', label: 'T5' },
  { value: '5', label: 'T6' },
  { value: '6', label: 'T7' },
  { value: '0', label: 'CN' },
];

function sessionLabel(session: ClassSession) {
  const date = new Date(session.sessionDate).toISOString().slice(0, 10);
  return `${date} ${session.startTime}-${session.endTime} (${session.status})`;
}

function estimateSessionCount(startDate: string, endDate: string, dayOfWeek: string): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start >= end) return 0;
  const targetDay = Number(dayOfWeek);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() === targetDay) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function TeacherLiteClassControlPanel({ onChanged }: { onChanged?: () => void }) {
  const { me } = useSession();
  const canManage = can(me.roles, me.isSuperAdmin, 'teacherLite', 'createClass');

  const [step, setStep] = useState(0);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<ClassBatch[]>([]);
  const [sessions, setSessions] = useState<ClassSession[]>([]);

  const [facilityId, setFacilityId] = useState<number | null>(me.facilityIds[0] ?? null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('19:30');

  const [cancelClassId, setCancelClassId] = useState<string | null>(null);
  const [cancelClassReason, setCancelClassReason] = useState('');
  const [sessionClassId, setSessionClassId] = useState<string | null>(null);
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null);
  const [cancelSessionReason, setCancelSessionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  const load = useCallback(() => {
    trpc.facility.list.query().then(setFacilities).catch((e) => notifyError(e, 'Không tải được cơ sở'));
    trpc.course.list.query().then((rows) => {
      setCourses(rows);
      setCourseId((current) => current ?? rows[0]?.id ?? null);
    }).catch((e) => notifyError(e, 'Không tải được khóa học'));
    trpc.classBatch.list.query().then(setBatches).catch((e) => notifyError(e, 'Không tải được lớp'));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!sessionClassId) { setSessions([]); setCancelSessionId(null); return; }
    trpc.schedule.listSessions
      .query({ classBatchId: sessionClassId })
      .then((rows) => {
        setSessions(rows);
        setCancelSessionId((cur) => cur ?? rows.find((s) => s.status !== 'cancelled')?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được buổi học'));
  }, [sessionClassId]);

  const filteredBatches = useMemo(
    () => batches.filter((b) => !facilityId || b.facilityId === facilityId),
    [batches, facilityId],
  );
  const activeBatches = filteredBatches.filter((b) => b.status !== 'cancelled');
  const estimatedSessions = estimateSessionCount(startDate, endDate, dayOfWeek);

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
        slot: { dayOfWeek: Number(dayOfWeek), startTime, endTime },
        generateSessions: true,
      });
      notifySuccess(`Đã tạo lớp ${result.batch.code} và ${result.sessions.created} buổi.`, 'Tạo lớp thành công');
      setCancelClassId(result.batch.id);
      setSessionClassId(result.batch.id);
      setStep(0);
      await load();
      onChanged?.();
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
      notifySuccess(`Đã hủy lớp, ${result.cancelledSessions} buổi tương lai đã hủy.`);
      setCancelClassReason('');
      await load();
      onChanged?.();
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
      notifySuccess('Đã hủy buổi học.');
      setCancelSessionReason('');
      const rows = await trpc.schedule.listSessions.query({ classBatchId: sessionClassId! });
      setSessions(rows);
      onChanged?.();
    } catch (e) {
      notifyError(e, 'Không hủy được buổi học');
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return null;

  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconCalendar size={18} />
          <Title order={5}>Tạo lớp học</Title>
        </Group>
        <Button
          size="xs"
          variant={showCancel ? 'filled' : 'subtle'}
          color="red"
          leftSection={<IconX size={14} />}
          onClick={() => setShowCancel((v) => !v)}
        >
          Hủy lớp / buổi
        </Button>
      </Group>

      <Stepper active={step} onStepClick={setStep} size="sm" mb="lg">
        <Stepper.Step label="Khóa học" description="Cơ sở & khóa" />
        <Stepper.Step label="Lịch học" description="Ngày & giờ" />
      </Stepper>

      {step === 0 && (
        <Stack gap="sm">
          <Group grow align="flex-end">
            <Select
              label="Cơ sở"
              withAsterisk
              searchable
              data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} – ${f.name}` }))}
              value={facilityId ? String(facilityId) : null}
              onChange={(v) => setFacilityId(v ? Number(v) : null)}
            />
            <Select
              label="Khóa học"
              withAsterisk
              searchable
              data={courses.map((c) => ({ value: c.id, label: `${c.code} – ${c.name}` }))}
              value={courseId}
              onChange={setCourseId}
            />
            <NumberInput
              label="Sĩ số (tùy chọn)"
              min={1}
              value={capacity}
              onChange={(v) => setCapacity(typeof v === 'number' ? v : '')}
            />
          </Group>
          <Group>
            <Button
              disabled={!facilityId || !courseId}
              onClick={() => setStep(1)}
              leftSection={<IconPlus size={14} />}
            >
              Tiếp theo
            </Button>
          </Group>
        </Stack>
      )}

      {step === 1 && (
        <Stack gap="sm">
          <Group grow align="flex-end">
            <DateInput
              label="Ngày bắt đầu"
              withAsterisk
              valueFormat="DD/MM/YYYY"
              value={parseApiDate(startDate)}
              onChange={(d) => setStartDate(toApiDate(d) ?? '')}
            />
            <DateInput
              label="Ngày kết thúc"
              withAsterisk
              valueFormat="DD/MM/YYYY"
              value={parseApiDate(endDate)}
              onChange={(d) => setEndDate(toApiDate(d) ?? '')}
            />
          </Group>

          <Box>
            <Text size="sm" fw={500} mb={6}>
              Thứ học <Text component="span" c="red">*</Text>
            </Text>
            <Chip.Group value={dayOfWeek} onChange={(v) => v && setDayOfWeek(v as string)}>
              <Group gap="xs">
                {DAYS.map((d) => (
                  <Chip key={d.value} value={d.value} size="sm">
                    {d.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Box>

          <Group grow align="flex-end">
            <TextInput
              label="Giờ bắt đầu"
              withAsterisk
              placeholder="18:00"
              value={startTime}
              onChange={(e) => setStartTime(e.currentTarget.value)}
            />
            <TextInput
              label="Giờ kết thúc"
              withAsterisk
              placeholder="19:30"
              value={endTime}
              onChange={(e) => setEndTime(e.currentTarget.value)}
            />
          </Group>

          {estimatedSessions > 0 && (
            <Badge variant="light" color="blue" size="sm">
              Ước tính {estimatedSessions} buổi học
            </Badge>
          )}

          <Group>
            <Button variant="subtle" onClick={() => setStep(0)}>Quay lại</Button>
            <Button
              loading={busy}
              disabled={!startDate || !endDate || !startTime || !endTime}
              onClick={createClass}
              leftSection={<IconPlus size={14} />}
            >
              Tạo lớp
            </Button>
          </Group>
        </Stack>
      )}

      {showCancel && (
        <>
          <Divider my="md" />
          <Stack gap="sm">
            <Text size="sm" fw={600} c="red">Hủy lớp</Text>
            <Group grow align="flex-end">
              <Select
                label="Chọn lớp"
                searchable
                data={activeBatches.map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))}
                value={cancelClassId}
                onChange={setCancelClassId}
              />
              <TextInput
                label="Lý do"
                value={cancelClassReason}
                onChange={(e) => setCancelClassReason(e.currentTarget.value)}
              />
              <Button color="red" variant="light" loading={busy} onClick={cancelClass}>
                Hủy lớp
              </Button>
            </Group>

            <Text size="sm" fw={600} c="orange">Hủy buổi học</Text>
            <Group grow align="flex-end">
              <Select
                label="Chọn lớp"
                searchable
                data={activeBatches.map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))}
                value={sessionClassId}
                onChange={setSessionClassId}
              />
              <Select
                label="Chọn buổi"
                searchable
                data={sessions.filter((s) => s.status !== 'cancelled').map((s) => ({ value: s.id, label: sessionLabel(s) }))}
                value={cancelSessionId}
                onChange={setCancelSessionId}
              />
              <TextInput
                label="Lý do"
                value={cancelSessionReason}
                onChange={(e) => setCancelSessionReason(e.currentTarget.value)}
              />
              <Button color="orange" variant="light" loading={busy} onClick={cancelSession}>
                Hủy buổi
              </Button>
            </Group>
          </Stack>
        </>
      )}
    </Card>
  );
}
