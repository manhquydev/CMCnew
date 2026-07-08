/**
 * Class workspace — the full class management panel ported from apps/teaching.
 * Contains class list, room management, schedule, enrollment, attendance, and
 * parent-meeting management. Exported Workspace component is driven by NavAction
 * so that SchedulePanel's goToClass can pre-open a specific class + tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  trpc,
  Chatter,
  notifyError,
  notifySuccess,
  useSession,
  FacilityPicker,
  StatusBadge,
  InitialsAvatar,
  type StatusDef,
} from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import {
  Button,
  Card,
  Checkbox,
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
import { DateInput, TimeInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { AttendanceRoster } from './attendance-roster.js';
import { StudentDetailPanel } from './student-detail.js';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type Batch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type ClassSession = Awaited<ReturnType<typeof trpc.schedule.listSessions.query>>[number];
type Enrollment = Awaited<ReturnType<typeof trpc.enrollment.listByBatch.query>>[number];
type StudentT = Awaited<ReturnType<typeof trpc.student.list.query>>[number];
type Room = Awaited<ReturnType<typeof trpc.room.list.query>>[number];
type Teacher = Awaited<ReturnType<typeof trpc.user.listTeachers.query>>[number];

// ClassStatus tone map — preserves original color semantics: gray→draft, blue→info,
// green→active, dark→inactive, red→rejected.
const BATCH_STATUS_MAP: Record<string, StatusDef> = {
  planned: { label: 'Đã lên kế hoạch', tone: 'draft' },
  open: { label: 'Đang mở', tone: 'info' },
  running: { label: 'Đang học', tone: 'active' },
  closed: { label: 'Đã đóng', tone: 'inactive' },
  cancelled: { label: 'Đã hủy', tone: 'rejected' },
};
// Session table previously reused the class-batch color map keyed by SessionStatus — planned
// matched (gray), cancelled matched (red), confirmed had no entry (Mantine default ≈ blue).
// Preserve that visual outcome explicitly: planned→draft, confirmed→info, cancelled→rejected.
const SESSION_STATUS_MAP: Record<string, StatusDef> = {
  planned: { label: 'Đã lên lịch', tone: 'draft' },
  confirmed: { label: 'Đã xác nhận', tone: 'info' },
  cancelled: { label: 'Đã hủy', tone: 'rejected' },
};
// EnrollmentStatus — original UI only distinguished 'completed' (teal) from everything else
// (default/blue-ish). Preserve that exact grouping rather than inventing new distinctions.
const ENROLLMENT_STATUS_MAP: Record<string, StatusDef> = {
  active: { label: 'active', tone: 'info' },
  completed: { label: 'completed', tone: 'active' },
  reserved: { label: 'reserved', tone: 'info' },
  transferred: { label: 'transferred', tone: 'info' },
  withdrawn: { label: 'withdrawn', tone: 'info' },
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

interface SlotRow {
  key: number;
  day: string;
  start: string;
  end: string;
  roomId: string | null;
  teacherId: string | null;
}
type CurriculumPreview = Awaited<ReturnType<typeof trpc.curriculum.listByCourse.query>>;
const newSlotRow = (key: number): SlotRow => ({ key, day: '1', start: '18:00', end: '19:30', roomId: null, teacherId: null });

function CreateClassModal({
  facilityId,
  courses,
  rooms,
  teachers,
  onCreated,
}: {
  facilityId: number;
  courses: Course[];
  rooms: Room[];
  teachers: Teacher[];
  onCreated: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  // True until the staff member manually edits "Kết thúc" — while true, the auto-estimate
  // effect below keeps overwriting it as start date / curriculum / weekly slots change.
  const [endDateAuto, setEndDateAuto] = useState(true);
  const [capacity, setCapacity] = useState<number | string>('');
  // Multiple weekly slots (nhiều thứ/tuần). Sent as `slots[]`; server rejects duplicate (thứ,giờ).
  const [slots, setSlots] = useState<SlotRow[]>([newSlotRow(0)]);
  const slotKey = useRef(1);
  const [preview, setPreview] = useState<CurriculumPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Fetch the hard-coded curriculum framework for the chosen course (read-only preview).
  useEffect(() => {
    if (!courseId) {
      setPreview(null);
      return;
    }
    let live = true;
    trpc.curriculum.listByCourse
      .query({ courseId })
      .then((r) => live && setPreview(r))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [courseId]);

  // Auto-estimate "Kết thúc": ngày khai giảng + ceil(tổng buổi khóa cứng / số buổi mỗi tuần)
  // tuần. Chỉ là ước tính ban đầu (chưa tính nghỉ lễ/dời buổi) — nhân viên vẫn sửa tay được;
  // một khi đã sửa tay, effect này ngừng ghi đè (endDateAuto=false).
  useEffect(() => {
    if (!endDateAuto || !startDate || !preview || preview.totalSessions <= 0 || slots.length === 0) return;
    const weeks = Math.ceil(preview.totalSessions / slots.length);
    setEndDate(dayjs(startDate).add(weeks * 7 - 1, 'day').toDate());
  }, [endDateAuto, startDate, preview, slots.length]);

  function updateSlot(key: number, patch: Partial<SlotRow>) {
    setSlots((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addSlot() {
    setSlots((rows) => [...rows, newSlotRow(slotKey.current++)]);
  }
  function removeSlot(key: number) {
    setSlots((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  function reset() {
    setCourseId(null);
    setStartDate(null);
    setEndDate(null);
    setEndDateAuto(true);
    setCapacity('');
    setSlots([newSlotRow(0)]);
    slotKey.current = 1;
    setPreview(null);
  }

  async function create() {
    if (!courseId) {
      setErr('Chọn khung chương trình');
      return;
    }
    if (slots.some((s) => !s.day || !s.start || !s.end)) {
      setErr('Mỗi khung lịch cần thứ + giờ bắt đầu/kết thúc');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const created = await trpc.classBatch.create.mutate({
        facilityId,
        courseId,
        startDate: toApiDate(startDate),
        endDate: toApiDate(endDate),
        capacity: typeof capacity === 'number' ? capacity : undefined,
        slots: slots.map((s) => ({
          dayOfWeek: Number(s.day),
          startTime: s.start,
          endTime: s.end,
          roomId: s.roomId ?? undefined,
          teacherId: s.teacherId ?? undefined,
        })),
      });
      notifySuccess(`Đã tạo lớp ${created.code}`);
      close();
      reset();
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
      <Modal opened={opened} onClose={close} title="Tạo lớp học" size="lg">
        <Stack>
          <Select
            label="Khung chương trình (khóa cứng)"
            placeholder={courses.some((c) => c.unitCount > 0) ? 'Chọn chương trình → level' : 'Chưa có khung (chạy seed:curriculum)'}
            searchable
            // Chỉ cho chọn course đã có khung khóa cứng thật (unitCount>0) — course chưa seed
            // curriculum không phải là "khung chương trình" hợp lệ để mở lớp theo.
            data={courses
              .filter((c) => c.unitCount > 0)
              .map((c) => ({
                value: c.id,
                label: `${c.code} — ${c.name} · ${c.unitCount} unit / ${c.totalSessions} buổi`,
              }))}
            value={courseId}
            onChange={setCourseId}
          />
          <Text size="xs" c="dimmed">
            Mã lớp tự sinh theo định dạng [Cơ sở]-[Chương trình]-[Năm]-[STT] (vd HQ-UCR-26-0001)
            — hiển thị ngay sau khi tạo, không cần nhập tay.
          </Text>
          {preview && preview.unitCount > 0 && (
            <Card withBorder bg="var(--mantine-color-gray-0)">
              <Text fw={600} size="sm" mb={4}>
                Khung khóa cứng: {preview.unitCount} unit · {preview.totalSessions} buổi (không sửa được)
              </Text>
              <Table striped fz="xs">
                <Table.Tbody>
                  {preview.units.map((u, i) => (
                    <Table.Tr key={u.id}>
                      <Table.Td w={28}>{i + 1}</Table.Td>
                      <Table.Td>{u.theme}</Table.Td>
                      <Table.Td w={70}>{u.unitType === 'REVIEW' ? 'Ôn/Thi' : 'Bài học'}</Table.Td>
                      <Table.Td w={54}>{u.sessions} buổi</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}
          <Group grow>
            <DateInput label="Khai giảng" value={startDate} onChange={setStartDate} valueFormat="DD/MM/YYYY" clearable />
            <DateInput
              label={endDateAuto ? 'Kết thúc (ước tính, có thể sửa)' : 'Kết thúc'}
              value={endDate}
              onChange={(d) => { setEndDate(d); setEndDateAuto(false); }}
              valueFormat="DD/MM/YYYY"
              clearable
            />
          </Group>
          <NumberInput label="Sĩ số tối đa (tùy chọn)" value={capacity} onChange={setCapacity} min={1} />
          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">Khung giờ trong tuần</Text>
              <Button size="xs" variant="light" onClick={addSlot}>+ Thêm thứ</Button>
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Nhiều thứ/tuần đều được. Gán phòng/GV để hệ thống chặn cứng trùng lịch khi sinh buổi.
            </Text>
            <Stack gap="sm">
              {slots.map((s) => (
                <Group key={s.key} align="flex-end" wrap="nowrap">
                  <Select
                    label="Thứ" w={90}
                    data={DOW.map((l, i) => ({ value: String(i), label: l }))}
                    value={s.day} onChange={(v) => updateSlot(s.key, { day: v ?? '1' })}
                  />
                  <TextInput label="Bắt đầu" w={80} value={s.start} onChange={(e) => updateSlot(s.key, { start: e.currentTarget.value })} />
                  <TextInput label="Kết thúc" w={80} value={s.end} onChange={(e) => updateSlot(s.key, { end: e.currentTarget.value })} />
                  <Select
                    label="Phòng" w={120} clearable
                    placeholder={rooms.length ? 'Phòng' : '—'}
                    data={rooms.map((r) => ({ value: r.id, label: r.code }))}
                    value={s.roomId} onChange={(v) => updateSlot(s.key, { roomId: v })}
                  />
                  <Select
                    label="GV" w={140} clearable searchable
                    placeholder={teachers.length ? 'GV' : '—'}
                    data={teachers.map((t) => ({ value: t.id, label: t.displayName }))}
                    value={s.teacherId} onChange={(v) => updateSlot(s.key, { teacherId: v })}
                  />
                  <Button
                    size="xs" color="red" variant="subtle" px={8}
                    disabled={slots.length === 1}
                    onClick={() => removeSlot(s.key)}
                  >✕</Button>
                </Group>
              ))}
            </Stack>
          </Card>
          {err && <Text c="red" size="sm">{err}</Text>}
          <Button onClick={create} loading={busy}>Tạo lớp (1 click)</Button>
        </Stack>
      </Modal>
    </>
  );
}

// ─── Slot edit/remove ─────────────────────────────────────────────────────────

type Slot = Awaited<ReturnType<typeof trpc.schedule.listSlots.query>>[number];

function SlotEditModal({
  slot,
  rooms,
  teachers,
  onClose,
  onSaved,
}: {
  slot: Slot;
  rooms: Room[];
  teachers: Teacher[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [day, setDay] = useState<string | null>(String(slot.dayOfWeek));
  const [start, setStart] = useState(slot.startTime);
  const [end, setEnd] = useState(slot.endTime);
  const [roomId, setRoomId] = useState<string | null>(slot.roomId);
  const [teacherId, setTeacherId] = useState<string | null>(slot.teacherId);
  const [applyToFuture, setApplyToFuture] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const r = await trpc.schedule.editSlot.mutate({
        slotId: slot.id,
        dayOfWeek: Number(day),
        startTime: start,
        endTime: end,
        roomId: roomId,
        teacherId: teacherId,
        applyToFuture,
      });
      notifySuccess(
        applyToFuture ? `Đã cập nhật khung + ${r.movedSessions} buổi tương lai` : 'Đã cập nhật khung lịch',
      );
      onSaved();
      onClose();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title="Sửa khung lịch">
      <Stack>
        <Group align="flex-end">
          <Select label="Thứ" w={100} data={DOW.map((l, i) => ({ value: String(i), label: l }))} value={day} onChange={setDay} />
          <TextInput label="Bắt đầu" w={90} value={start} onChange={(e) => setStart(e.currentTarget.value)} />
          <TextInput label="Kết thúc" w={90} value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
        </Group>
        <Group grow>
          <Select
            label="Phòng" clearable
            data={rooms.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))}
            value={roomId} onChange={setRoomId}
          />
          <Select
            label="Giáo viên" clearable searchable
            data={teachers.map((t) => ({ value: t.id, label: t.displayName }))}
            value={teacherId} onChange={setTeacherId}
          />
        </Group>
        <Checkbox
          label="Áp dụng cho các buổi tương lai chưa hủy của lớp này"
          checked={applyToFuture}
          onChange={(e) => setApplyToFuture(e.currentTarget.checked)}
        />
        <Text size="xs" c="dimmed">
          Buổi đã qua giữ nguyên. Hệ thống chặn nếu trùng phòng/GV hoặc trùng buổi đã có.
        </Text>
        {err && <Text c="red" size="sm">{err}</Text>}
        <Button onClick={save} loading={busy}>Lưu</Button>
      </Stack>
    </Modal>
  );
}

// ─── ScheduleTab ──────────────────────────────────────────────────────────────

function ScheduleTab({
  batch,
  facilityId,
  rooms,
  teachers,
  onSessionsGenerated,
}: {
  batch: Batch;
  facilityId: number;
  rooms: Room[];
  teachers: Teacher[];
  onSessionsGenerated?: () => void;
}) {
  const { me } = useSession();
  const canAddSlot = can(me.roles, me.isSuperAdmin, 'schedule', 'addSlot');
  const canEditSlot = can(me.roles, me.isSuperAdmin, 'schedule', 'editSlot');
  const canRemoveSlot = can(me.roles, me.isSuperAdmin, 'schedule', 'removeSlot');
  const canRecompute = can(me.roles, me.isSuperAdmin, 'schedule', 'recomputeForBatch');
  const [editing, setEditing] = useState<Slot | null>(null);
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
      onSessionsGenerated?.();
    } catch (e) {
      setMsg('Lỗi: ' + (e instanceof Error ? e.message : ''));
    }
  }

  async function recomputeCurriculum() {
    setMsg('');
    try {
      const r = await trpc.schedule.recomputeForBatch.mutate({ classBatchId: batch.id });
      setMsg(r ? `Map curriculum: ${r.mappedCount} buổi, ${r.overflowCount} dư, ${r.uncoveredUnits} unit chưa phủ.` : 'Khóa này chưa có khung chương trình.');
    } catch (e) {
      setMsg('Lỗi: ' + (e instanceof Error ? e.message : ''));
    }
  }

  async function removeSlot(slot: Slot) {
    if (!window.confirm(`Xóa khung ${DOW[slot.dayOfWeek]} ${slot.startTime}-${slot.endTime}? Buổi đã sinh vẫn giữ nguyên.`)) return;
    try {
      await trpc.schedule.removeSlot.mutate({ slotId: slot.id });
      notifySuccess('Đã xóa khung lịch');
      load();
    } catch (e) {
      notifyError(e, 'Xóa khung lịch thất bại');
    }
  }

  const showActions = canEditSlot || canRemoveSlot;

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
                {showActions && <Table.Th>Thao tác</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {slots.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>{DOW[s.dayOfWeek]}</Table.Td>
                  <Table.Td>{s.startTime} - {s.endTime}</Table.Td>
                  <Table.Td>{roomLabel(s.roomId)}</Table.Td>
                  <Table.Td>{teacherLabel(s.teacherId)}</Table.Td>
                  {showActions && (
                    <Table.Td>
                      <Group gap={6}>
                        {canEditSlot && (
                          <Button size="compact-xs" variant="light" onClick={() => setEditing(s)}>Sửa</Button>
                        )}
                        {canRemoveSlot && (
                          <Button size="compact-xs" variant="light" color="red" onClick={() => removeSlot(s)}>Xóa</Button>
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
      {editing && (
        <SlotEditModal
          slot={editing}
          rooms={rooms}
          teachers={teachers}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {canAddSlot && (
        <Card withBorder>
          <Text fw={600} mb="xs">Sinh buổi học</Text>
          <Group align="flex-end">
            <DateInput label="Từ ngày" value={range.from} onChange={(d) => setRange((r) => ({ ...r, from: d }))} valueFormat="DD/MM/YYYY" />
            <DateInput label="Đến ngày" value={range.to} onChange={(d) => setRange((r) => ({ ...r, to: d }))} valueFormat="DD/MM/YYYY" />
            <Button onClick={generate} disabled={!range.from || !range.to}>Sinh lịch</Button>
            {canRecompute && (
              <Button variant="light" onClick={recomputeCurriculum} title="Gán lại buổi học → bài học khung chương trình (dùng khi bài tập không mở cho học sinh)">
                Map lại khung CT
              </Button>
            )}
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
  const { me } = useSession();
  const canCreateMakeup = can(me.roles, me.isSuperAdmin, 'schedule', 'createMakeupSession');
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    trpc.schedule.listSessions
      .query({ classBatchId: batchId })
      .then(setSessions)
      .catch((e) => notifyError(e, 'Không tải được buổi học'))
      .finally(() => setLoading(false));
  }, [batchId]);
  useEffect(load, [load]);

  const roomLabel = (id: string | null) => (id ? (rooms.find((r) => r.id === id)?.code ?? '—') : '—');
  const teacherLabel = (id: string | null) =>
    id ? (teachers.find((t) => t.id === id)?.displayName ?? '—') : '—';

  if (loading) return <Loader size="sm" />;

  return (
    <Stack>
      {canCreateMakeup && (
        <Group justify="flex-end">
          <CreateMakeupSessionModal batchId={batchId} rooms={rooms} teachers={teachers} onCreated={load} />
        </Group>
      )}
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
              <StatusBadge status={s.status} map={SESSION_STATUS_MAP} pill />
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
    </Stack>
  );
}

// ─── CreateMakeupSessionModal (used in SessionsTab) ────────────────────────────

function CreateMakeupSessionModal({
  batchId,
  rooms,
  teachers,
  onCreated,
}: {
  batchId: string;
  rooms: Room[];
  teachers: Teacher[];
  onCreated: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [sessionDate, setSessionDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    const date = toApiDate(sessionDate);
    if (!date || !startTime || !endTime) {
      setErr('Nhập đủ ngày, giờ bắt đầu và kết thúc');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await trpc.schedule.createMakeupSession.mutate({
        classBatchId: batchId,
        sessionDate: date,
        startTime,
        endTime,
        roomId: roomId ?? undefined,
        teacherId: teacherId ?? undefined,
      });
      notifySuccess('Đã tạo buổi học bù');
      close();
      setSessionDate(null);
      setStartTime('');
      setEndTime('');
      setRoomId(null);
      setTeacherId(null);
      onCreated();
    } catch (e) {
      notifyError(e, 'Tạo buổi học bù thất bại');
      setErr(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={open}>+ Tạo buổi học bù</Button>
      <Modal opened={opened} onClose={close} title="Tạo buổi học bù" size="md">
        <Stack>
          <DateInput label="Ngày" value={sessionDate} onChange={setSessionDate} valueFormat="DD/MM/YYYY" />
          <Group grow>
            <TimeInput label="Giờ bắt đầu" value={startTime} onChange={(e) => setStartTime(e.currentTarget.value)} />
            <TimeInput label="Giờ kết thúc" value={endTime} onChange={(e) => setEndTime(e.currentTarget.value)} />
          </Group>
          <Select
            label="Phòng (tùy chọn)"
            clearable
            data={rooms.map((r) => ({ value: r.id, label: r.code }))}
            value={roomId}
            onChange={setRoomId}
          />
          <Select
            label="Giáo viên (tùy chọn)"
            clearable
            searchable
            data={teachers.map((t) => ({ value: t.id, label: t.displayName }))}
            value={teacherId}
            onChange={setTeacherId}
          />
          <Text size="xs" c="dimmed">
            Buổi bù không mở bài tập cho cả lớp — chỉ học sinh điểm danh present/late trên buổi này mới được mở bài tập riêng.
          </Text>
          {err && <Text c="red" size="sm">{err}</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>Hủy</Button>
            <Button onClick={create} loading={busy}>Tạo buổi bù</Button>
          </Group>
        </Stack>
      </Modal>
    </>
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
  const canTransfer = can(me.roles, me.isSuperAdmin, 'enrollment', 'transfer');
  // student.create is superAdminProcedure — not in PERMISSIONS registry, super_admin only.
  const canCreateStudent = me.isSuperAdmin;
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [students, setStudents] = useState<StudentT[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  // Deep-link: clicking an enrolled student opens the existing StudentDetailPanel in place.
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);
  const [transferEnrollment, setTransferEnrollment] = useState<Enrollment | null>(null);

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

  if (detailStudentId) {
    return <StudentDetailPanel studentId={detailStudentId} onBack={() => setDetailStudentId(null)} />;
  }

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
              <Table.Td
                style={{ cursor: 'pointer' }}
                onClick={() => setDetailStudentId(e.studentId)}
              >
                {e.student.studentCode}
              </Table.Td>
              <Table.Td
                style={{ cursor: 'pointer', color: 'var(--cmc-brand-hover)' }}
                onClick={() => setDetailStudentId(e.studentId)}
                title="Xem hồ sơ học viên"
              >
                <Group gap={8} wrap="nowrap">
                  <InitialsAvatar name={e.student.fullName} size={22} />
                  <span>{e.student.fullName}</span>
                </Group>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={e.status} map={ENROLLMENT_STATUS_MAP} pill />
              </Table.Td>
              <Table.Td w={190}>
                {e.status === 'active' && (
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="subtle" onClick={() => complete(e.id)}>Hoàn tất</Button>
                    {canTransfer && (
                      <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setTransferEnrollment(e)}>Chuyển lớp</Button>
                    )}
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {transferEnrollment && (
        <TransferEnrollmentModal
          enrollment={transferEnrollment}
          facilityId={facilityId}
          opened
          onClose={() => setTransferEnrollment(null)}
          onTransferred={() => { setTransferEnrollment(null); load(); }}
        />
      )}
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

  const ST: Record<string, StatusDef> = {
    scheduled: { label: 'Đã lên lịch', tone: 'info' },
    done: { label: 'Đã họp', tone: 'active' },
    cancelled: { label: 'Đã hủy', tone: 'inactive' },
  };

  if (loading) return <Loader size="sm" />;

  return (
    <Stack>
      <Table striped>
        <Table.Tbody>
          {meetings.map((m) => {
            return (
              <Table.Tr key={m.id}>
                <Table.Td>{dayjs(m.scheduledAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
                <Table.Td>{m.title}</Table.Td>
                <Table.Td>{m.location ?? ''}</Table.Td>
                <Table.Td>
                  <StatusBadge status={m.status} map={ST} pill />
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

function EditClassModal({
  batch,
  opened,
  onClose,
  onSaved,
}: {
  batch: Batch;
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startDate, setStartDate] = useState<Date | null>(batch.startDate ? new Date(batch.startDate) : null);
  const [endDate, setEndDate] = useState<Date | null>(batch.endDate ? new Date(batch.endDate) : null);
  const [capacity, setCapacity] = useState<number | string>(batch.capacity ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!opened) return;
    setStartDate(batch.startDate ? new Date(batch.startDate) : null);
    setEndDate(batch.endDate ? new Date(batch.endDate) : null);
    setCapacity(batch.capacity ?? '');
    setErr('');
  }, [batch, opened]);

  async function save() {
    const start = toApiDate(startDate);
    const end = toApiDate(endDate);
    if (start && end && start > end) {
      setErr('Ngày khai giảng phải trước ngày kết thúc');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await trpc.classBatch.update.mutate({
        id: batch.id,
        startDate: start,
        endDate: end,
        capacity: typeof capacity === 'number' ? capacity : undefined,
      });
      notifySuccess('Đã cập nhật lớp học');
      onClose();
      onSaved();
    } catch (e) {
      notifyError(e, 'Cập nhật lớp thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Sửa lớp học" size="md">
      <Stack>
        <Text size="sm" c="dimmed">Mã lớp: <b>{batch.code}</b> (tự sinh, không sửa được)</Text>
        <Group grow align="flex-start">
          <DateInput label="Ngày khai giảng" value={startDate} onChange={setStartDate} valueFormat="DD/MM/YYYY" clearable />
          <DateInput label="Ngày kết thúc" value={endDate} onChange={setEndDate} valueFormat="DD/MM/YYYY" clearable />
        </Group>
        <NumberInput label="Sĩ số tối đa" value={capacity} onChange={setCapacity} min={1} />
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Hủy</Button>
          <Button onClick={save} loading={busy}>Lưu</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── TransferEnrollmentModal (Chuyển lớp — history-preserving, see enrollment.transfer) ────────

function TransferEnrollmentModal({
  enrollment,
  facilityId,
  opened,
  onClose,
  onTransferred,
}: {
  enrollment: Enrollment;
  facilityId: number;
  opened: boolean;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const [targetBatches, setTargetBatches] = useState<Batch[]>([]);
  const [targetClassBatchId, setTargetClassBatchId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!opened) return;
    setTargetClassBatchId(null);
    setReason('');
    setErr('');
    trpc.classBatch.list
      .query()
      .then((bs) => setTargetBatches(bs.filter((b) => b.facilityId === facilityId && b.id !== enrollment.classBatchId)))
      .catch((e) => notifyError(e, 'Không tải được danh sách lớp'));
  }, [opened, facilityId, enrollment.classBatchId]);

  async function transfer() {
    if (!targetClassBatchId) {
      setErr('Chọn lớp đích');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await trpc.enrollment.transfer.mutate({
        enrollmentId: enrollment.id,
        targetClassBatchId,
        reason: reason.trim() || undefined,
      });
      notifySuccess('Đã chuyển lớp');
      onClose();
      onTransferred();
    } catch (e) {
      notifyError(e, 'Chuyển lớp thất bại');
      setErr(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={`Chuyển lớp — ${enrollment.student.fullName}`} size="md">
      <Stack>
        <Select
          label="Lớp đích"
          searchable
          placeholder={targetBatches.length ? 'Chọn lớp' : 'Không có lớp khác trong cơ sở'}
          data={targetBatches.map((b) => ({ value: b.id, label: b.code }))}
          value={targetClassBatchId}
          onChange={setTargetClassBatchId}
        />
        <TextInput label="Lý do (tùy chọn)" value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} />
        <Text size="xs" c="dimmed">
          Ghi danh cũ chuyển sang trạng thái &quot;transferred&quot;, tạo ghi danh mới ở lớp đích. Điểm danh/điểm số cũ được giữ nguyên.
        </Text>
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Hủy</Button>
          <Button onClick={transfer} loading={busy}>Chuyển lớp</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

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
  const canUpdateClass = can(me.roles, me.isSuperAdmin, 'classBatch', 'update');
  const [cancelOpen, cancel] = useDisclosure(false);
  const [editOpen, edit] = useDisclosure(false);
  const [reason, setReason] = useState('');
  // Bug fix (bug-log #8): generateSessions succeeds but the sibling "Buổi học" tab (SessionsTab)
  // has its own React Query-less local state, so it never re-fetches. Bumping this key remounts
  // SessionsTab, forcing its `useEffect(load, [load])` to refire — mirrors the `key={reloadKey}`
  // pattern already used for ReceiptsCard in finance-panel.tsx.
  const [sessionsReloadKey, setSessionsReloadKey] = useState(0);

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
            <StatusBadge status={batch.status} map={BATCH_STATUS_MAP} pill />
          </Group>
          <Text c="dimmed" size="sm">{batch.course.code} — {batch.course.name}</Text>
        </div>
        {canSetStatus && (
          <Group gap="xs">
            {canUpdateClass && <Button size="xs" variant="default" onClick={edit.open}>Sửa</Button>}
            {batch.status !== 'cancelled' ? (
              <>
                <Select
                  size="xs" w={130} placeholder="Đổi trạng thái"
                  value={null}
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
          <ScheduleTab
            batch={batch}
            facilityId={facilityId}
            rooms={rooms}
            teachers={teachers}
            onSessionsGenerated={() => setSessionsReloadKey((k) => k + 1)}
          />
        </Tabs.Panel>
        <Tabs.Panel value="sessions" pt="md">
          <SessionsTab key={sessionsReloadKey} batchId={batch.id} rooms={rooms} teachers={teachers} />
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

      {canUpdateClass && (
        <EditClassModal batch={batch} opened={editOpen} onClose={edit.close} onSaved={onChanged} />
      )}

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

function RoomEditModal({
  room,
  onClose,
  onSaved,
}: {
  room: Room;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(room.code);
  const [name, setName] = useState(room.name);
  const [capacity, setCapacity] = useState<number | string>(room.capacity ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true);
    setErr('');
    try {
      await trpc.room.update.mutate({
        id: room.id,
        code: code.trim() || undefined,
        name: name.trim() || undefined,
        capacity: typeof capacity === 'number' ? capacity : undefined,
      });
      notifySuccess('Đã cập nhật phòng học');
      onSaved();
      onClose();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title="Sửa phòng học">
      <Stack>
        <Group align="flex-end">
          <TextInput label="Mã" w={90} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
          <TextInput label="Tên" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <NumberInput label="Sức chứa" w={100} value={capacity} onChange={setCapacity} min={1} />
        </Group>
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Hủy</Button>
          <Button onClick={save} loading={busy} disabled={!code.trim() || !name.trim()}>Lưu</Button>
        </Group>
      </Stack>
    </Modal>
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
  const [editing, setEditing] = useState<Room | null>(null);

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

  async function archive(room: Room) {
    if (!window.confirm(`Lưu trữ phòng ${room.code} — ${room.name}? Phòng sẽ ẩn khỏi danh sách chọn.`)) return;
    try {
      await trpc.room.archive.mutate({ id: room.id });
      notifySuccess('Đã lưu trữ phòng học');
      reload();
    } catch (e) {
      notifyError(e, 'Lưu trữ phòng thất bại');
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
                  <Table.Td w={130}>
                    <Group gap={6}>
                      <Button size="compact-xs" variant="light" onClick={() => setEditing(r)}>Sửa</Button>
                      <Button size="compact-xs" variant="light" color="red" onClick={() => archive(r)}>Lưu trữ</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {rooms.length === 0 && (
            <Text c="dimmed" size="sm">Chưa có phòng cho cơ sở này.</Text>
          )}
        </Stack>
      </Modal>
      {editing && (
        <RoomEditModal room={editing} onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </>
  );
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export function Workspace({ navAction }: { navAction: NavAction | null }) {
  const { me } = useSession();
  const canManageClass = me.isSuperAdmin || me.roles.includes('giam_doc_dao_tao');
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

  // Apply navAction when it changes. If a specific batch is requested but `batches` has not
  // loaded yet, do NOT consume the action — return so this effect re-runs when batches arrive
  // and can still select the batch. Otherwise a deep-link (e.g. schedule "Mở lớp học") that
  // fires before the list loads leaves the detail pane empty on the class list.
  useEffect(() => {
    if (!navAction || navAction.ts === appliedNavTs.current) return;
    if (navAction.batchId) {
      const found = batches.find((b) => b.id === navAction.batchId);
      if (!found) return; // batches not loaded yet — wait, don't consume the nav action
      setSelected(found);
    }
    appliedNavTs.current = navAction.ts;
    setDetailTab(navAction.tab);
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
        <FacilityPicker
          facilities={facilities}
          clearable={false}
          value={facilityId}
          onChange={(v) => { setFacilityId(v); setClassPage(1); }}
          w={240}
        />
        {facilityId && canManageClass && (
          <Group gap="xs" align="flex-end">
            <RoomsManager facilityId={facilityId} rooms={facilityRooms} reload={loadRooms} />
            <CreateClassModal
              facilityId={facilityId}
              courses={courses}
              rooms={facilityRooms}
              teachers={teachers}
              onCreated={loadBatches}
            />
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
                  { value: 'planned', label: 'Đã lên kế hoạch' },
                  { value: 'open', label: 'Đang mở' },
                  { value: 'running', label: 'Đang học' },
                  { value: 'closed', label: 'Đã đóng' },
                  { value: 'cancelled', label: 'Đã hủy' },
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
                      {/* name now always equals code (see class-creation form fix) — one line, not two */}
                      <Text fw={600}>{b.code}</Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={b.status} map={BATCH_STATUS_MAP} size="xs" pill />
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
