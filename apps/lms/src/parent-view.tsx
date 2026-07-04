import { useCallback, useEffect, useState } from 'react';
import {
  trpc,
  useNotificationStream,
  API_URL,
  BadgeShelf,
  Leaderboard,
  NotificationCenter,
  PdfAnnotator,
  notifyError,
  notifySuccess,
  type LmsPrincipal,
  type LiveNotification,
  type AnnotationData,
} from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCircleCheck, IconClock, IconCircleX, IconAlertCircle, IconStar } from '@tabler/icons-react';
import { SessionEvidenceTab } from './session-evidence-tab';
import { CurriculumSessionsTab } from './curriculum-sessions-tab';
import { AttendanceHistoryCard } from './attendance-history-card';

export type ParentTab = 'overview' | 'schedule' | 'sessions' | 'gradebook' | 'notifications' | 'rewards' | 'profile';

type Submission = Awaited<ReturnType<typeof trpc.submission.forStudent.query>>[number];
type Gradebook = Awaited<ReturnType<typeof trpc.assessment.gradebook.query>>;
type FinalGrade = Gradebook['finalGrades'][number];
type Exercise = Awaited<ReturnType<typeof trpc.exercise.listForPrincipal.query>>[number];

const PROGRAM_LABEL: Record<string, string> = {
  UCREA: 'UCREA',
  BRIGHT_IG: 'Bright I.G',
  BLACK_HOLE: 'Black Hole',
};
const PERIOD_LABEL: Record<string, string> = {
  MONTHLY: 'Hàng tháng',
  END_LEVEL: 'Cuối cấp độ',
};

function fmtScore(n: number | null): string {
  return n == null ? '—' : n.toFixed(1);
}

const STATUS_LABEL: Record<Submission['status'], string> = {
  draft: 'Nháp',
  submitted: 'Đã nộp',
  graded: 'Đã chấm',
};
const STATUS_COLOR: Record<Submission['status'], string> = {
  draft: 'gray',
  submitted: 'blue',
  graded: 'teal',
};
const STATUS_ICON: Record<Submission['status'], React.ReactNode> = {
  draft: <IconAlertCircle size={12} color="var(--cmc-text-faint)" />,
  submitted: <IconClock size={12} color="var(--cmc-brand)" />,
  graded: <IconCircleCheck size={12} color="var(--cmc-status-active)" />,
};

function fmtDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function sortNewestFirst(rows: Submission[]): Submission[] {
  return [...rows].sort((a, b) => {
    const ta = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const tb = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return tb - ta;
  });
}

type LevelRow = Awaited<ReturnType<typeof trpc.levelProgress.forStudent.query>>[number];
const LEVEL_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Chờ duyệt', color: 'yellow' },
  approved: { label: 'Đã duyệt', color: 'teal' },
  rejected: { label: 'Từ chối', color: 'red' },
};

// ── Shared table header style ─────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function LevelHistoryCard({ childId, refreshKey }: { childId: string; refreshKey: number }) {
  const [rows, setRows] = useState<LevelRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    trpc.levelProgress.forStudent
      .query({ studentId: childId })
      .then(setRows)
      .catch((e) => {
        setError('Không tải được tiến trình cấp độ: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải tiến trình cấp độ thất bại');
      });
  }, [childId, refreshKey]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!rows || rows.length === 0) return null;

  return (
    <Card className="cmc-clay-card" p="xl">
      <Text size="sm" fw={800} mb="sm" style={{ color: 'var(--cmc-text-2)', fontFamily: 'var(--cmc-font-bubble)' }}>
        Tiến trình cấp độ của con
      </Text>
      <Stack gap="xs">
        {rows.map((r) => (
          <Group key={r.id} gap="xs">
            <Badge variant="light" radius="xl" size="md" style={{ fontFamily: 'var(--cmc-font-bubble)' }}>{r.fromLevel ?? '—'} → {r.toLevel}</Badge>
            <Badge size="sm" color={LEVEL_STATUS[r.status]?.color} variant="light" radius="xl" style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 700 }}>
              {LEVEL_STATUS[r.status]?.label ?? r.status}
            </Badge>
            {r.reason && (
              <Text size="sm" c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 500 }}>{r.reason}</Text>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

type Meeting = Awaited<ReturnType<typeof trpc.parentMeeting.myMeetings.query>>[number];

/** Render a single meeting row (shared by upcoming and past sections). */
function MeetingRow({ m }: { m: Meeting }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge variant="light" color="cmc" radius="xl">
        {m.timeConfirmed
          ? fmtDateTime(m.scheduledAt)
          : new Date(m.scheduledAt).toLocaleDateString('vi-VN')}
      </Badge>
      {!m.timeConfirmed && (
        <Text size="xs" c="dimmed">(chưa chốt giờ)</Text>
      )}
      <Text fw={600} size="sm">{m.title}</Text>
      {m.location && <Text size="sm" c="dimmed">· {m.location}</Text>}
      {m.note && <Text size="sm" c="dimmed">— {m.note}</Text>}
    </Group>
  );
}

/**
 * Shows all parent meetings split into upcoming and past sections so parents can
 * see meeting history, not just future meetings (previously hidden when empty upcoming).
 */
function MeetingsCard({ refreshKey }: { refreshKey: number }) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setMeetings(null);
    setError('');
    trpc.parentMeeting.myMeetings
      .query()
      .then(setMeetings)
      .catch((e) => {
        setError('Không tải được lịch họp phụ huynh: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải lịch họp thất bại');
      });
  }, [refreshKey]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!meetings || meetings.length === 0) return null;

  const now = Date.now();
  const upcoming = meetings
    .filter((m) => new Date(m.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const past = meetings
    .filter((m) => new Date(m.scheduledAt).getTime() < now)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      {upcoming.length > 0 && (
        <>
          <Text size="sm" fw={600} mb="sm" style={{ color: 'var(--cmc-text-2)' }}>
            Lịch họp sắp tới ({upcoming.length})
          </Text>
          <Stack gap="xs" mb={past.length > 0 ? 'md' : 0}>
            {upcoming.map((m) => <MeetingRow key={m.id} m={m} />)}
          </Stack>
        </>
      )}
      {past.length > 0 && (
        <>
          <Text size="sm" fw={600} mb="sm" style={{ color: 'var(--cmc-text-2)' }}>
            Lịch họp đã qua ({past.length})
          </Text>
          <Stack gap="xs">
            {past.map((m) => <MeetingRow key={m.id} m={m} />)}
          </Stack>
        </>
      )}
    </Card>
  );
}

type ParentNotif = Awaited<ReturnType<typeof trpc.notification.list.query>>[number];

/** Human-readable label for each notification type shown in the parent inbox. */
function describeNotif(n: ParentNotif): { icon: string; text: string } {
  const p = n.payload as Record<string, unknown>;
  switch (n.type) {
    case 'grade_published': {
      const score = p.score != null ? ` ${p.score} điểm` : '';
      const stars = p.starsEarned ? ` · +${p.starsEarned} ⭐` : '';
      return { icon: '📝', text: `Bài "${p.exercise ?? ''}" đã có điểm:${score}${stars}` };
    }
    case 'badge_awarded':
      return { icon: '🏅', text: `Con đạt huy hiệu "${p.badge ?? ''}"` };
    case 'level_up':
      return { icon: '🎉', text: `Con lên cấp độ ${p.toLevel ?? ''}` };
    case 'new_exercise_open':
      return { icon: '📚', text: 'Bài tập mới đã mở cho con' };
    case 'parent_meeting_reminder':
      return { icon: '📅', text: `Sắp có buổi họp phụ huynh${p.title ? `: ${p.title}` : ''}` };
    default:
      return { icon: '🔔', text: 'Thông báo mới' };
  }
}

/**
 * Inline parent notification list — shows all LMS notifications from the parent's
 * session inbox (grade published, badge earned, level-up events for their child).
 * Refresh-keyed so it re-fetches when a live event arrives.
 */
function ParentNotifCard({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<ParentNotif[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null);
    setError('');
    trpc.notification.list
      .query()
      .then(setItems)
      .catch((e) => {
        setError('Không tải được thông báo: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải thông báo thất bại');
      });
  }, [refreshKey]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (items === null) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }
  if (items.length === 0) {
    return (
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text c="dimmed" size="sm" ta="center">Chưa có thông báo nào.</Text>
      </Card>
    );
  }

  return (
    <Card radius="lg" p={0} style={{ border: '1px solid var(--cmc-border)' }}>
      <Text size="sm" fw={600} p="md" style={{ color: 'var(--cmc-text-2)', borderBottom: '1px solid var(--cmc-border-faint)' }}>
        Thông báo ({items.length})
      </Text>
      <Stack gap={0}>
        {items.map((n) => {
          const d = describeNotif(n);
          return (
            <Group
              key={n.id}
              align="flex-start"
              wrap="nowrap"
              px="md"
              py="xs"
              bg={n.readAt ? undefined : 'var(--mantine-color-cmc-0)'}
              style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}
            >
              <Text>{d.icon}</Text>
              <div style={{ flex: 1 }}>
                <Text size="sm">{d.text}</Text>
                <Text c="dimmed" size="xs">{fmtDateTime(n.createdAt)}</Text>
              </div>
              {!n.readAt && <Badge size="xs" color="red" variant="filled" circle />}
            </Group>
          );
        })}
      </Stack>
    </Card>
  );
}

/**
 * Read-only drawn-work view for a parent: the child's marks plus the published teacher
 * correction, if any. Reuses PdfAnnotator's existing `editable={false}` + `readOnlyLayers`
 * contract (same one student-view.tsx uses for a graded exercise) — no annotator changes.
 * No draft/save controls; this is a viewer, never an editing surface.
 */
function DrawnWorkModal({
  opened,
  onClose,
  exercise,
  studentId,
}: {
  opened: boolean;
  onClose: () => void;
  exercise: Exercise | null;
  studentId: string;
}) {
  const [student, setStudent] = useState<AnnotationData | null>(null);
  const [teacher, setTeacher] = useState<AnnotationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!opened || !exercise) return;
    setLoading(true);
    setError('');
    setStudent(null);
    setTeacher(null);
    trpc.submission.layerForGuardian
      .query({ exerciseId: exercise.id, studentId })
      .then((layers) => {
        setStudent(layers.student);
        setTeacher(layers.teacher);
      })
      .catch((e) => {
        setError('Không tải được bài làm: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải bài làm thất bại');
      })
      .finally(() => setLoading(false));
  }, [opened, exercise, studentId]);

  return (
    <Modal opened={opened} onClose={onClose} title={exercise?.title ?? 'Bài làm'} size="lg" radius="xl" centered>
      {loading && (
        <Center py="xl">
          <Loader />
        </Center>
      )}
      {!loading && error && <Alert color="red">{error}</Alert>}
      {!loading && !error && exercise?.basePdfRef && (
        <PdfAnnotator
          pdfRef={exercise.basePdfRef}
          value={student}
          editable={false}
          readOnlyLayers={teacher ? [{ items: teacher.items, opacity: 1 }] : []}
        />
      )}
    </Modal>
  );
}

type LinkRequestRow = Awaited<ReturnType<typeof trpc.guardian.linkRequestListMine.query>>[number];

const LINK_REQUEST_STATUS: Record<LinkRequestRow['status'], { label: string; color: string }> = {
  pending: { label: 'Chờ duyệt', color: 'yellow' },
  approved: { label: 'Đã duyệt', color: 'teal' },
  rejected: { label: 'Từ chối', color: 'red' },
};

/**
 * Account-level self-service: profile edit (scoped server-side to the parent's own row) and a
 * staff-reviewed self-link request. Anti-takeover: submitting a phone/student-code only queues a
 * request — it never creates a Guardian row directly, so this tab cannot grant access by itself.
 */
function ProfileTab({ principal }: { principal: LmsPrincipal }) {
  const [displayName, setDisplayName] = useState(principal.displayName);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  const [linkCode, setLinkCode] = useState('');
  const [linkPhone, setLinkPhone] = useState('');
  const [submittingLink, setSubmittingLink] = useState(false);
  const [requests, setRequests] = useState<LinkRequestRow[] | null>(null);

  const loadRequests = useCallback(() => {
    trpc.guardian.linkRequestListMine
      .query()
      .then(setRequests)
      .catch((e) => notifyError(e, 'Không tải được danh sách yêu cầu liên kết'));
  }, []);
  useEffect(loadRequests, [loadRequests]);

  async function saveProfile() {
    if (!displayName.trim()) {
      notifyError(new Error('Nhập họ tên.'), 'Thông tin chưa đủ');
      return;
    }
    setSavingProfile(true);
    try {
      await trpc.guardian.profileUpdate.mutate({
        displayName: displayName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        emailNotifications,
      });
      notifySuccess('Đã cập nhật thông tin cá nhân');
    } catch (e) {
      notifyError(e, 'Cập nhật thất bại');
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitLinkRequest() {
    if (!linkCode.trim() && !linkPhone.trim()) {
      notifyError(new Error('Nhập mã học sinh hoặc số điện thoại đăng ký của con.'), 'Thông tin chưa đủ');
      return;
    }
    setSubmittingLink(true);
    try {
      await trpc.guardian.requestLink.mutate({
        studentCode: linkCode.trim() || undefined,
        studentPhone: linkPhone.trim() || undefined,
      });
      notifySuccess('Đã gửi yêu cầu liên kết. Nhà trường sẽ xét duyệt trong ít ngày.');
      setLinkCode('');
      setLinkPhone('');
      loadRequests();
    } catch (e) {
      notifyError(e, 'Gửi yêu cầu thất bại');
    } finally {
      setSubmittingLink(false);
    }
  }

  return (
    <Stack gap="xl">
      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="md" style={{ color: 'var(--cmc-text)' }}>Thông tin cá nhân</Text>
        <Stack gap="sm">
          <TextInput label="Họ tên" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
          <Group grow>
            <TextInput label="Email" placeholder="Không đổi nếu để trống" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <TextInput label="Số điện thoại" placeholder="Không đổi nếu để trống" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
          </Group>
          <Switch
            label="Nhận email thông báo"
            checked={emailNotifications}
            onChange={(e) => setEmailNotifications(e.currentTarget.checked)}
          />
          <Group justify="flex-end">
            <Button variant="filled" radius={9999} loading={savingProfile} onClick={saveProfile}>
              Lưu thay đổi
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="xs" style={{ color: 'var(--cmc-text)' }}>Liên kết thêm con</Text>
        <Text size="sm" c="dimmed" mb="md">
          Nhập mã học sinh hoặc số điện thoại đã đăng ký của con. Yêu cầu sẽ được nhà trường xét duyệt trước khi liên kết.
        </Text>
        <Group grow align="flex-end">
          <TextInput label="Mã học sinh" value={linkCode} onChange={(e) => setLinkCode(e.currentTarget.value)} />
          <TextInput label="Số điện thoại đã đăng ký" value={linkPhone} onChange={(e) => setLinkPhone(e.currentTarget.value)} />
        </Group>
        <Group justify="flex-end" mt="md">
          <Button variant="filled" radius={9999} loading={submittingLink} onClick={submitLinkRequest}>
            Gửi yêu cầu
          </Button>
        </Group>
      </Card>

      {requests && requests.length > 0 && (
        <Card radius="lg" p={0} style={{ border: '1px solid var(--cmc-border)' }}>
          <Text size="sm" fw={600} p="md" style={{ color: 'var(--cmc-text-2)', borderBottom: '1px solid var(--cmc-border-faint)' }}>
            Yêu cầu liên kết đã gửi ({requests.length})
          </Text>
          <Stack gap={0}>
            {requests.map((r) => (
              <Group key={r.id} justify="space-between" px="md" py="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
                <Text size="sm">{r.studentCode ?? r.studentPhone} · {fmtDateTime(r.createdAt)}</Text>
                <Badge size="sm" color={LINK_REQUEST_STATUS[r.status].color} variant="light" radius="xl">
                  {LINK_REQUEST_STATUS[r.status].label}
                </Badge>
              </Group>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

type CertificateRow = Awaited<ReturnType<typeof trpc.certificate.forStudent.query>>[number];

/**
 * Certificates issued to the child, each with its own PDF download link — served by the
 * LMS-authorized `/files/certificate/:id` route (ownership checked server-side against the
 * parent's session, never the client-supplied id alone).
 */
function CertificatesCard({ studentId, refreshKey }: { studentId: string; refreshKey: number }) {
  const [rows, setRows] = useState<CertificateRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    trpc.certificate.forStudent
      .query({ studentId })
      .then(setRows)
      .catch((e) => {
        setError('Không tải được danh sách chứng chỉ: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải chứng chỉ thất bại');
      });
  }, [studentId, refreshKey]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (rows === null) return <Center py="md"><Loader size="sm" /></Center>;
  if (rows.length === 0) return null;

  return (
    <Card radius="lg" p={0} style={{ border: '1px solid var(--cmc-border)' }}>
      <Text size="sm" fw={600} p="md" style={{ color: 'var(--cmc-text-2)', borderBottom: '1px solid var(--cmc-border-faint)' }}>
        Chứng chỉ ({rows.length})
      </Text>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={thStyle}>Chứng chỉ</Table.Th>
            <Table.Th style={thStyle}>Ngày cấp</Table.Th>
            <Table.Th style={{ ...thStyle, width: 120 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((cert) => (
            <Table.Tr key={cert.id}>
              <Table.Td>
                <Text size="sm">{cert.title}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{new Date(cert.issuedAt).toLocaleDateString('vi-VN')}</Text>
              </Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  variant="subtle"
                  color="cmc"
                  radius={9999}
                  onClick={() => window.open(`${API_URL}/files/certificate/${cert.id}`, '_blank', 'noopener')}
                >
                  Tải PDF
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function ChildDashboard({
  childId,
  refreshKey,
  tab,
}: {
  childId: string;
  refreshKey: number;
  tab: ParentTab;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [gradebook, setGradebook] = useState<Gradebook | null>(null);
  const [exercisesById, setExercisesById] = useState<Map<string, Exercise>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawnWorkExercise, setDrawnWorkExercise] = useState<Exercise | null>(null);
  const [drawnWorkOpened, { open: openDrawnWork, close: closeDrawnWork }] = useDisclosure(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    setBalance(null);
    setSubmissions(null);
    setGradebook(null);
    Promise.all([
      trpc.rewards.balance.query({ studentId: childId }),
      trpc.submission.forStudent.query({ studentId: childId }),
      trpc.assessment.gradebook.query({ studentId: childId }),
      trpc.exercise.listForPrincipal.query(),
    ])
      .then(([bal, subs, gb, exercises]) => {
        setBalance(bal);
        setSubmissions(sortNewestFirst(subs));
        setGradebook(gb);
        setExercisesById(new Map(exercises.map((ex) => [ex.id, ex])));
      })
      .catch((e) => {
        setError('Không tải được dữ liệu: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải dữ liệu học sinh thất bại');
      })
      .finally(() => setLoading(false));
  }, [childId]);

  useEffect(load, [load, refreshKey]);

  function openDrawnWorkFor(exerciseId: string) {
    const exercise = exercisesById.get(exerciseId);
    if (!exercise?.basePdfRef) return;
    setDrawnWorkExercise(exercise);
    openDrawnWork();
  }

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" mt="md">{error}</Alert>
    );
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  if (tab === 'overview') {
    const submitted = (submissions ?? []).filter(
      (s) => s.status === 'submitted' || s.status === 'graded',
    ).length;
    const graded = (submissions ?? []).filter(
      (s) => s.status === 'graded' && s.grade?.isPublished,
    ).length;

    return (
      <Stack gap="xl">
        <Group grow>
          <Card className="cmc-clay-card" p="xl">
            <Group justify="space-between" align="center" mb="xs">
              <Text size="xs" fw={800} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--cmc-font-friendly)' }}>Sao tích lũy của con</Text>
              <IconStar size={20} fill="#f59e0b" color="#d97706" />
            </Group>
            <Text size="32px" fw={900} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-warn-text)', fontFamily: 'var(--cmc-font-bubble)' }}>
              {balance ?? 0} <Text span size="sm" fw={700} c="dimmed">sao</Text>
            </Text>
          </Card>
          <Card className="cmc-clay-card" p="xl">
            <Group justify="space-between" align="center" mb="xs">
              <Text size="xs" fw={800} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--cmc-font-friendly)' }}>Đã nộp / Đã chấm</Text>
              <IconCircleCheck size={20} color="var(--cmc-ok-text)" />
            </Group>
            <Text size="32px" fw={900} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-ok-text)', fontFamily: 'var(--cmc-font-bubble)' }}>
              {submitted} <Text span size="md" fw={700} c="dimmed">/</Text> {graded}
            </Text>
          </Card>
        </Group>
        <LevelHistoryCard childId={childId} refreshKey={refreshKey} />
      </Stack>
    );
  }

  if (tab === 'schedule') {
    return <CurriculumSessionsTab studentId={childId} refreshKey={refreshKey} />;
  }

  if (tab === 'sessions') {
    return (
      <Stack gap="xl">
        <AttendanceHistoryCard studentId={childId} refreshKey={refreshKey} />
        <SessionEvidenceTab studentId={childId} refreshKey={refreshKey} />
      </Stack>
    );
  }

  // ── Học bạ ────────────────────────────────────────────────────────────────
  if (tab === 'gradebook') {
    return (
      <Stack>
        <Group justify="flex-end">
          <Button
            size="xs"
            variant="light"
            color="cmc"
            radius={9999}
            onClick={() => window.open(`${API_URL}/files/transcript/${childId}`, '_blank', 'noopener')}
          >
            Tải học bạ (PDF)
          </Button>
        </Group>

        <Card radius="lg" p={0} style={{ border: '1px solid var(--cmc-border)' }}>
          <Text size="sm" fw={600} p="md" style={{ color: 'var(--cmc-text-2)', borderBottom: '1px solid var(--cmc-border-faint)' }}>
            Bài tập &amp; kết quả ({submissions?.length ?? 0})
          </Text>
          {submissions && submissions.length > 0 ? (
            <Table striped highlightOnHover withTableBorder={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={thStyle}>Bài tập</Table.Th>
                  <Table.Th style={thStyle}>Trạng thái</Table.Th>
                  <Table.Th style={thStyle}>Điểm</Table.Th>
                  <Table.Th style={thStyle}>Nhận xét</Table.Th>
                  <Table.Th style={thStyle}>Thời gian nộp</Table.Th>
                  <Table.Th style={{ ...thStyle, width: 120 }} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {submissions.map((s) => {
                  const published = s.grade && s.grade.isPublished;
                  const hasDrawnWork = exercisesById.get(s.exerciseId)?.basePdfRef;
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>
                        <Text size="sm">{s.exercise.title}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {STATUS_ICON[s.status]}
                          <Badge size="sm" color={STATUS_COLOR[s.status]} variant="light" radius="xl">
                            {STATUS_LABEL[s.status]}
                          </Badge>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {published ? `${s.grade!.score}/${s.grade!.maxScore}` : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {published && s.grade!.feedback ? (
                          <Text size="sm">{s.grade!.feedback}</Text>
                        ) : (
                          <Text c="dimmed" size="sm" span>—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{fmtDateTime(s.submittedAt)}</Text>
                      </Table.Td>
                      <Table.Td>
                        {hasDrawnWork && (
                          <Button
                            size="xs"
                            variant="subtle"
                            color="cmc"
                            radius={9999}
                            onClick={() => openDrawnWorkFor(s.exerciseId)}
                          >
                            Xem bài làm
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          ) : (
            <Text c="dimmed" size="sm" p="xl">
              Chưa có bài tập nào cho học sinh này.
            </Text>
          )}
        </Card>

        {gradebook && gradebook.finalGrades.length > 0 && (
          <Card radius="lg" p={0} style={{ border: '1px solid var(--cmc-border)' }}>
            <Text size="sm" fw={600} p="md" style={{ color: 'var(--cmc-text-2)', borderBottom: '1px solid var(--cmc-border-faint)' }}>
              Điểm tổng hợp ({gradebook.finalGrades.length})
            </Text>
            <Table striped highlightOnHover withTableBorder={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={thStyle}>Chương trình</Table.Th>
                  <Table.Th style={thStyle}>Kỳ</Table.Th>
                  <Table.Th style={thStyle}>Bài tập</Table.Th>
                  <Table.Th style={thStyle}>Kiểm tra</Table.Th>
                  <Table.Th style={thStyle}>Chuyên cần</Table.Th>
                  <Table.Th style={thStyle}>Định tính</Table.Th>
                  <Table.Th style={thStyle}>Tổng kết</Table.Th>
                  <Table.Th style={thStyle}>Kết quả</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {gradebook.finalGrades.map((g: FinalGrade) => (
                  <Table.Tr key={g.id}>
                    <Table.Td>
                      <Text size="sm">
                        {PROGRAM_LABEL[g.program] ?? g.program}
                        {g.level ? ` · ${g.level}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td><Text size="sm">{g.periodKey}</Text></Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtScore(g.homeworkAvg)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtScore(g.testScore)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {g.attendanceRate == null ? '—' : `${Math.round(g.attendanceRate * 100)}%`}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtScore(g.qualitativeScore)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={600} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtScore(g.finalScore)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {!g.complete ? (
                        <Group gap={4}>
                          <IconAlertCircle size={12} color="var(--cmc-text-faint)" />
                          <Badge size="sm" color="gray" variant="light" radius="xl">Chưa đủ dữ liệu</Badge>
                        </Group>
                      ) : (
                        <Group gap={4}>
                          {g.passed
                            ? <IconCircleCheck size={12} color="var(--cmc-status-active)" />
                            : <IconCircleX size={12} color="var(--cmc-status-rejected)" />}
                          <Badge size="sm" color={g.passed ? 'teal' : 'red'} variant="light" radius="xl">
                            {g.passed ? 'Đạt' : 'Chưa đạt'}
                          </Badge>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        )}

        {gradebook && gradebook.qualitative.length > 0 && (
          <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
            <Text size="sm" fw={600} mb="md" style={{ color: 'var(--cmc-text-2)' }}>
              Đánh giá định tính ({gradebook.qualitative.length})
            </Text>
            <Stack gap="sm">
              {gradebook.qualitative.map((q) => (
                <div key={q.id}>
                  <Group gap="xs" mb={4}>
                    <Text fw={600} size="sm">{q.periodKey}</Text>
                    <Badge size="xs" variant="light" radius="xl">
                      {PERIOD_LABEL[q.period] ?? q.period}
                    </Badge>
                  </Group>
                  <Group gap="xs" mb={q.narrative ? 4 : 0}>
                    {Object.entries(q.criteria).map(([pillar, score]) => (
                      <Badge key={pillar} size="sm" variant="outline" color="cmc" radius="xl">
                        {pillar}: {score}
                      </Badge>
                    ))}
                  </Group>
                  {q.narrative && (
                    <Text size="sm" c="dimmed">{q.narrative}</Text>
                  )}
                </div>
              ))}
            </Stack>
          </Card>
        )}

        <CertificatesCard studentId={childId} refreshKey={refreshKey} />

        <DrawnWorkModal
          opened={drawnWorkOpened}
          onClose={closeDrawnWork}
          exercise={drawnWorkExercise}
          studentId={childId}
        />
      </Stack>
    );
  }

  // ── Thông báo ─────────────────────────────────────────────────────────────
  if (tab === 'notifications') {
    return (
      <Stack>
        <ParentNotifCard refreshKey={refreshKey} />
        <LevelHistoryCard childId={childId} refreshKey={refreshKey} />
      </Stack>
    );
  }

  // ── Phần thưởng ───────────────────────────────────────────────────────────
  if (tab === 'rewards') {
    return (
      <Stack gap="xl">
        <Card className="cmc-clay-card" p="xl">
          <Group gap="xs" align="center" mb={4}>
            <Text size="xs" fw={800} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--cmc-font-friendly)' }}>Sao tích lũy của con</Text>
            <IconStar size={16} fill="#f59e0b" color="#d97706" />
          </Group>
          <Text size="32px" fw={900} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-warn-text)', fontFamily: 'var(--cmc-font-bubble)' }}>
            {balance ?? 0} <Text span size="sm" fw={700} c="dimmed">sao</Text>
          </Text>
        </Card>
        <Card className="cmc-clay-card" p="xl">
          <Text size="sm" fw={800} mb="md" style={{ color: 'var(--cmc-text-2)', fontFamily: 'var(--cmc-font-bubble)' }}>Huy hiệu của con</Text>
          <BadgeShelf studentId={childId} refreshKey={refreshKey} />
        </Card>
        <Card className="cmc-clay-card" p="xl">
          <Text size="sm" fw={800} mb="md" style={{ color: 'var(--cmc-text-2)', fontFamily: 'var(--cmc-font-bubble)' }}>Bảng xếp hạng lớp học</Text>
          <Leaderboard studentId={childId} refreshKey={refreshKey} />
        </Card>
      </Stack>
    );
  }

  return null;
}

function liveMessage(n: LiveNotification): string {
  if (n.type === 'grade_published') {
    const score = n.payload.score != null ? ` ${n.payload.score} điểm` : '';
    const stars = n.payload.starsEarned ? ` · +${n.payload.starsEarned} sao` : '';
    return `Con vừa có điểm bài "${n.payload.exercise ?? ''}":${score}${stars}`;
  }
  if (n.type === 'badge_awarded') {
    return `Con vừa đạt huy hiệu "${n.payload.badge ?? ''}"!`;
  }
  if (n.type === 'level_up') {
    return `Con vừa được lên cấp độ ${n.payload.toLevel ?? ''}!`;
  }
  return 'Có thông báo mới về con của bạn';
}

interface ParentViewProps {
  principal: LmsPrincipal;
  /** Controlled active tab — driven by the sidebar in ParentShell. */
  activeTab?: ParentTab;
  onTabChange?: (tab: ParentTab) => void;
  /** Called when a real-time notification arrives so parent shell can update badge count. */
  onNotification?: () => void;
}

export function ParentView({ principal, activeTab, onTabChange: _onTabChange, onNotification }: ParentViewProps) {
  const students = principal.students;
  const [childId, setChildId] = useState<string | null>(students[0]?.id ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const isControlled = activeTab !== undefined;
  const currentTab: ParentTab = isControlled ? activeTab : 'overview';

  useNotificationStream((n) => {
    setBanner(liveMessage(n));
    setRefreshKey((k) => k + 1);
    onNotification?.();
  });

  // Profile/link-request is account-level, not child-scoped — must stay reachable even for a
  // parent with zero linked children (that's exactly who most needs the self-link request form).
  if (currentTab === 'profile') {
    return (
      <Stack>
        {!isControlled && (
          <Group justify="space-between" align="flex-end">
            <div>
              <Title order={4}>Hồ sơ &amp; liên kết</Title>
              <Text c="dimmed" size="sm">Xin chào {principal.displayName}.</Text>
            </div>
            <NotificationCenter pulse={refreshKey} />
          </Group>
        )}
        <ProfileTab principal={principal} />
      </Stack>
    );
  }

  if (students.length === 0) {
    return (
      <Card radius="lg" p="xl" maw={520} style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="xs">Theo dõi học tập</Text>
        <Text c="dimmed" size="sm">
          Chưa có học sinh được liên kết với tài khoản này. Vào mục "Hồ sơ &amp; liên kết" để gửi yêu cầu liên kết con.
        </Text>
      </Card>
    );
  }

  // Standalone mode (no shell) — render a self-contained header.
  const standaloneHeader = !isControlled && (
    <Group justify="space-between" align="flex-end">
      <div>
        <Title order={4}>Theo dõi học tập</Title>
        <Text c="dimmed" size="sm">Xin chào {principal.displayName}.</Text>
      </div>
      <NotificationCenter pulse={refreshKey} />
    </Group>
  );

  return (
    <Stack>
      {standaloneHeader}

      {/* Child selector — always visible when there are multiple children */}
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed">
          {students.length > 1 ? 'Chọn con để xem:' : `Học sinh: ${students[0]?.fullName ?? ''}`}
        </Text>
        {students.length > 1 && (
          <Select
            label="Học sinh"
            w={260}
            allowDeselect={false}
            data={students.map((s) => ({ value: s.id, label: s.fullName }))}
            value={childId}
            onChange={(v) => v && setChildId(v)}
            radius="md"
          />
        )}
      </Group>

      {banner && (
        <Alert
          color="green"
          withCloseButton
          onClose={() => setBanner(null)}
          icon={<IconCircleCheck size={16} />}
        >
          {banner}
        </Alert>
      )}

      <MeetingsCard refreshKey={refreshKey} />

      {childId && (
        <ChildDashboard
          key={childId}
          childId={childId}
          refreshKey={refreshKey}
          tab={currentTab}
        />
      )}
    </Stack>
  );
}
