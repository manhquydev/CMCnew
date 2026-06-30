// Session Detail — the connected read view for ONE lesson, reached from /#schedule.
// Assembled from existing queries (no new endpoint, no schema change): the session row carries
// header data; the roster comes from enrollment.listByBatch; attendance reuses AttendanceRoster;
// the activity log reuses the already-whitelisted class_batch Chatter. Roster rows deep-link to
// the existing StudentDetailPanel (rendered as an in-place overlay), and the class card links back
// to the Class Workspace. No user/facility timeline is touched here.

import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { trpc, Chatter, notifyError } from '@cmc/ui';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconExternalLink, IconUser } from '@tabler/icons-react';
import { AttendanceRoster } from './attendance-roster.js';
import { StudentDetailPanel } from './student-detail.js';

type MySession = Awaited<ReturnType<typeof trpc.schedule.mySessions.query>>[number];
type Enrollment = Awaited<ReturnType<typeof trpc.enrollment.listByBatch.query>>[number];

const STATUS_COLOR: Record<string, string> = {
  planned: 'gray',
  open: 'blue',
  running: 'green',
  closed: 'dark',
  cancelled: 'red',
};

const fmtDate = (d: string | Date) => dayjs(d).format('DD/MM/YYYY');
const sessionMoment = (d: string | Date, time: string) => dayjs(`${dayjs(d).format('YYYY-MM-DD')}T${time}:00`);

type SessionPhase = 'before' | 'attendance_open' | 'running' | 'post_class';

function getSessionPhase(session: MySession, now = dayjs()): SessionPhase {
  const start = sessionMoment(session.sessionDate, session.startTime);
  const end = sessionMoment(session.sessionDate, session.endTime);
  if (now.isBefore(start.subtract(15, 'minute'))) return 'before';
  if (now.isBefore(start)) return 'attendance_open';
  if (now.isBefore(end)) return 'running';
  return 'post_class';
}

const PHASE_META: Record<SessionPhase, { label: string; color: string; hint: string }> = {
  before: {
    label: 'Chưa tới giờ',
    color: 'gray',
    hint: 'GV xem thông tin lớp, roster và chuẩn bị nội dung.',
  },
  attendance_open: {
    label: 'Mở điểm danh',
    color: 'blue',
    hint: 'Trong 15 phút trước giờ học, hệ thống mở điểm danh.',
  },
  running: {
    label: 'Đang học',
    color: 'green',
    hint: 'GV cập nhật điểm danh và ghi chú vận hành trong buổi.',
  },
  post_class: {
    label: 'Sau buổi học',
    color: 'teal',
    hint: 'Hết giờ học, hệ thống mở các việc sau buổi: bài tập, nhận xét, ảnh lớp, publish LMS.',
  },
};

/** Two-column read-only field row (matches student/staff detail visual language). */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" style={{ textAlign: 'right' }}>{value ?? '—'}</Text>
    </Group>
  );
}

function WorkflowCard({
  title,
  description,
  enabled,
  children,
}: {
  title: string;
  description: string;
  enabled: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="md" style={{ opacity: enabled ? 1 : 0.62 }}>
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Text fw={600} size="sm">{title}</Text>
            <Text size="xs" c="dimmed">{description}</Text>
          </div>
          <Badge size="sm" color={enabled ? 'teal' : 'gray'} variant="light">
            {enabled ? 'Đã mở' : 'Chưa mở'}
          </Badge>
        </Group>
        {enabled && children}
      </Stack>
    </Card>
  );
}

function SessionWorkflowPanel({ session }: { session: MySession }) {
  const phase = getSessionPhase(session);
  const meta = PHASE_META[phase];
  const attendanceEnabled = phase !== 'before';
  const postClassEnabled = phase === 'post_class';

  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={600}>Quy trình buổi học 360</Text>
            <Text size="sm" c="dimmed">{meta.hint}</Text>
          </div>
          <Badge color={meta.color} variant="light" radius="xl">{meta.label}</Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <WorkflowCard
            title="Điểm danh"
            description="Tự mở từ 15 phút trước giờ bắt đầu."
            enabled={attendanceEnabled}
          >
            <Text size="xs" c="dimmed">
              Dùng bảng điểm danh thật bên dưới. Trạng thái này chỉ điều khiển luồng thao tác, không thay quyền backend.
            </Text>
          </WorkflowCard>

          <WorkflowCard
            title="Phát bài tập LMS"
            description="Mở sau giờ kết thúc buổi học."
            enabled={postClassEnabled}
          >
            <Group gap="xs">
              <Button size="xs" variant="light">Chọn bài tập mẫu</Button>
              <Button size="xs">Phát lên LMS</Button>
            </Group>
          </WorkflowCard>

          <WorkflowCard
            title="Nhận xét theo form"
            description="Mock trước; form template sẽ thay thế nội dung tự do."
            enabled={postClassEnabled}
          >
            <Textarea
              size="xs"
              minRows={2}
              defaultValue="Mức độ tham gia: Tốt. Kỹ năng nổi bật: quan sát và trình bày. Cần rèn: hoàn thiện sản phẩm đúng thời gian."
            />
          </WorkflowCard>

          <WorkflowCard
            title="Ảnh lớp và publish PH"
            description="Ảnh là bằng chứng cả lớp; nhận xét là riêng từng học sinh."
            enabled={postClassEnabled}
          >
            <Group gap="xs">
              <Button size="xs" variant="light">Upload ảnh lớp</Button>
              <Button size="xs" color="teal">Publish LMS</Button>
            </Group>
          </WorkflowCard>
        </SimpleGrid>
      </Stack>
    </Card>
  );
}

// ─── Roster (deep-links each student to StudentDetailPanel) ────────────────────
function SessionRoster({
  classBatchId,
  onOpenStudent,
}: {
  classBatchId: string;
  onOpenStudent: (studentId: string) => void;
}) {
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    trpc.enrollment.listByBatch
      .query({ classBatchId })
      .then(setRows)
      .catch((e) => notifyError(e, 'Không tải được danh sách học viên'))
      .finally(() => setLoading(false));
  }, [classBatchId]);

  if (loading) return <Loader size="sm" />;
  if (rows.length === 0) {
    return <Text c="dimmed" size="sm">Chưa có học viên ghi danh lớp này.</Text>;
  }

  return (
    <Table highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Mã HV</Table.Th>
          <Table.Th>Họ tên</Table.Th>
          <Table.Th>Trạng thái</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((e) => (
          <Table.Tr
            key={e.id}
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenStudent(e.studentId)}
          >
            <Table.Td>
              <Text size="sm" ff="monospace">{e.student.studentCode}</Text>
            </Table.Td>
            <Table.Td>{e.student.fullName}</Table.Td>
            <Table.Td>
              <Badge size="sm" variant="dot" color={e.status === 'completed' ? 'teal' : undefined}>
                {e.status}
              </Badge>
            </Table.Td>
            <Table.Td w={40}>
              <ActionIcon variant="subtle" aria-label="Xem học viên">
                <IconUser size={16} />
              </ActionIcon>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────
export function ScheduleDetailPanel({
  session,
  goToClass,
  onBack,
}: {
  session: MySession;
  /** Open the Class Workspace at the given batch + tab (deep-link to class detail). */
  goToClass: (batchId: string, tab: string) => void;
  onBack: () => void;
}) {
  // Roster rows open the existing StudentDetailPanel as an in-place overlay so navigation stays
  // inside the schedule section (no cross-section routing, matches StudentsPanel's own pattern).
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);

  if (detailStudentId) {
    return (
      <StudentDetailPanel
        studentId={detailStudentId}
        onBack={() => setDetailStudentId(null)}
      />
    );
  }

  return (
    <Stack>
      <Group>
        <ActionIcon variant="subtle" onClick={onBack} title="Quay lại lịch">
          <IconArrowLeft size={18} />
        </ActionIcon>
        <Title order={5}>
          Buổi học {fmtDate(session.sessionDate)} · {session.startTime}–{session.endTime}
        </Title>
        <Badge size="sm" color={STATUS_COLOR[session.status] ?? 'gray'}>{session.status}</Badge>
      </Group>

      {/* Header + class card */}
      <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text fw={600}>{session.batch.code} — {session.batch.name}</Text>
              <Text size="xs" c="dimmed">Lớp học của buổi này</Text>
            </div>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconExternalLink size={14} />}
              onClick={() => goToClass(session.batch.id, 'sessions')}
            >
              Mở lớp học
            </Button>
          </Group>
          <Field label="Ngày" value={fmtDate(session.sessionDate)} />
          <Field label="Giờ" value={`${session.startTime} – ${session.endTime}`} />
          <Field label="Phòng" value={session.roomName ?? '—'} />
        </Stack>
      </Card>

      <SessionWorkflowPanel session={session} />

      {/* Roster — deep-links to student detail */}
      <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="sm">Học viên trong buổi</Text>
        <SessionRoster classBatchId={session.classBatchId} onOpenStudent={setDetailStudentId} />
      </Card>

      {/* Attendance — reuse the shared roster marker (permission self-gated) */}
      <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="sm">Điểm danh</Text>
        <AttendanceRoster
          classSessionId={session.id}
          batchId={session.classBatchId}
          facilityId={session.facilityId}
        />
      </Card>

      {/* Activity log — existing whitelisted class_batch Chatter (NOT user/facility) */}
      <Chatter entityType="class_batch" entityId={session.classBatchId} />
    </Stack>
  );
}
