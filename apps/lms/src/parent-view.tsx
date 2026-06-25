import { useCallback, useEffect, useState } from 'react';
import {
  trpc,
  useNotificationStream,
  BadgeShelf,
  Leaderboard,
  NotificationCenter,
  notifyError,
  type LmsPrincipal,
  type LiveNotification,
} from '@cmc/ui';
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconCircleCheck, IconClock, IconCircleX, IconAlertCircle } from '@tabler/icons-react';

export type ParentTab = 'overview' | 'gradebook' | 'notifications' | 'rewards';

type Submission = Awaited<ReturnType<typeof trpc.submission.forStudent.query>>[number];
type Gradebook = Awaited<ReturnType<typeof trpc.assessment.gradebook.query>>;
type FinalGrade = Gradebook['finalGrades'][number];

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
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text size="sm" fw={600} mb="sm" style={{ color: 'var(--cmc-text-2)' }}>
        Tiến trình cấp độ
      </Text>
      <Stack gap="xs">
        {rows.map((r) => (
          <Group key={r.id} gap="xs">
            <Badge variant="light" radius="xl">{r.fromLevel ?? '—'} → {r.toLevel}</Badge>
            <Badge size="sm" color={LEVEL_STATUS[r.status]?.color} variant="light" radius="xl">
              {LEVEL_STATUS[r.status]?.label ?? r.status}
            </Badge>
            {r.reason && (
              <Text size="sm" c="dimmed">{r.reason}</Text>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

type Meeting = Awaited<ReturnType<typeof trpc.parentMeeting.myMeetings.query>>[number];

function UpcomingMeetingsCard({ refreshKey }: { refreshKey: number }) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    trpc.parentMeeting.myMeetings
      .query()
      .then((rows) =>
        setMeetings(rows.filter((m) => new Date(m.scheduledAt).getTime() >= Date.now())),
      )
      .catch((e) => {
        setError('Không tải được lịch họp phụ huynh: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải lịch họp thất bại');
      });
  }, [refreshKey]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!meetings || meetings.length === 0) return null;

  return (
    <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
      <Text size="sm" fw={600} mb="sm" style={{ color: 'var(--cmc-text-2)' }}>
        Lịch họp phụ huynh sắp tới ({meetings.length})
      </Text>
      <Stack gap="xs">
        {meetings.map((m) => (
          <Group key={m.id} gap="xs" wrap="nowrap">
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
        ))}
      </Stack>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    ])
      .then(([bal, subs, gb]) => {
        setBalance(bal);
        setSubmissions(sortNewestFirst(subs));
        setGradebook(gb);
      })
      .catch((e) => {
        setError('Không tải được dữ liệu: ' + (e instanceof Error ? e.message : ''));
        notifyError(e, 'Tải dữ liệu học sinh thất bại');
      })
      .finally(() => setLoading(false));
  }, [childId]);

  useEffect(load, [load, refreshKey]);

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
      <Stack>
        <UpcomingMeetingsCard refreshKey={refreshKey} />
        <Group grow>
          <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
            <Text size="sm" c="dimmed" mb={4}>Sao tích lũy</Text>
            <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-warn-text)' }}>
              {balance ?? 0}
            </Text>
          </Card>
          <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
            <Text size="sm" c="dimmed" mb={4}>Đã nộp / Đã chấm</Text>
            <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {submitted} / {graded}
            </Text>
          </Card>
        </Group>
        <LevelHistoryCard childId={childId} refreshKey={refreshKey} />
      </Stack>
    );
  }

  // ── Học bạ ────────────────────────────────────────────────────────────────
  if (tab === 'gradebook') {
    return (
      <Stack>
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
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {submissions.map((s) => {
                  const published = s.grade && s.grade.isPublished;
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
      </Stack>
    );
  }

  // ── Thông báo ─────────────────────────────────────────────────────────────
  if (tab === 'notifications') {
    return (
      <Stack>
        <UpcomingMeetingsCard refreshKey={refreshKey} />
        <LevelHistoryCard childId={childId} refreshKey={refreshKey} />
      </Stack>
    );
  }

  // ── Phần thưởng ───────────────────────────────────────────────────────────
  if (tab === 'rewards') {
    return (
      <Stack>
        <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text size="sm" c="dimmed" mb={4}>Sao tích lũy</Text>
          <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-warn-text)' }}>
            {balance ?? 0}
          </Text>
        </Card>
        <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text size="sm" fw={600} mb="sm" style={{ color: 'var(--cmc-text-2)' }}>Huy hiệu</Text>
          <BadgeShelf studentId={childId} refreshKey={refreshKey} />
        </Card>
        <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text size="sm" fw={600} mb="sm" style={{ color: 'var(--cmc-text-2)' }}>Bảng xếp hạng</Text>
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

  if (students.length === 0) {
    return (
      <Card radius="lg" p="xl" maw={520} style={{ border: '1px solid var(--cmc-border)' }}>
        <Text fw={600} mb="xs">Theo dõi học tập</Text>
        <Text c="dimmed" size="sm">
          Chưa có học sinh được liên kết với tài khoản này.
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
