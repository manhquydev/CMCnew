import { useCallback, useEffect, useState } from 'react';
import { trpc, useNotificationStream, BadgeShelf, Leaderboard, NotificationCenter, type LmsPrincipal, type LiveNotification } from '@cmc/ui';
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

function fmtDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** Newest first: submitted ones by submittedAt desc, drafts (no submittedAt) sink to the bottom. */
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

function LevelHistoryCard({ childId, refreshKey }: { childId: string; refreshKey: number }) {
  const [rows, setRows] = useState<LevelRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows(null);
    setError('');
    trpc.levelProgress.forStudent
      .query({ studentId: childId })
      .then(setRows)
      .catch((e) => setError('Không tải được tiến trình cấp độ: ' + (e instanceof Error ? e.message : '')));
  }, [childId, refreshKey]);

  if (error) {
    return (
      <Alert color="red">{error}</Alert>
    );
  }
  if (!rows || rows.length === 0) return null;
  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        Tiến trình cấp độ
      </Title>
      <Stack gap="xs">
        {rows.map((r) => (
          <Group key={r.id} gap="xs">
            <Badge variant="light">{r.fromLevel ?? '—'} → {r.toLevel}</Badge>
            <Badge size="sm" color={LEVEL_STATUS[r.status]?.color}>
              {LEVEL_STATUS[r.status]?.label ?? r.status}
            </Badge>
            {r.reason && (
              <Text size="sm" c="dimmed">
                {r.reason}
              </Text>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

function ChildDashboard({ childId, refreshKey }: { childId: string; refreshKey: number }) {
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
      })
      .finally(() => setLoading(false));
  }, [childId]);

  // Reload on child change, and on each realtime notification (refreshKey bump) so a newly
  // published grade / star earn surfaces without a manual refresh.
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
      <Alert color="red" mt="md">
        {error}
      </Alert>
    );
  }

  return (
    <Stack mt="md">
      <Card withBorder>
        <Text size="sm" c="dimmed">
          Số sao tích lũy
        </Text>
        <Title order={3} c="cmc.7">
          ⭐ {balance ?? 0} sao
        </Title>
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">
          Bài tập &amp; kết quả ({submissions?.length ?? 0})
        </Title>
        {submissions && submissions.length > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Bài tập</Table.Th>
                <Table.Th>Trạng thái</Table.Th>
                <Table.Th>Điểm</Table.Th>
                <Table.Th>Nhận xét</Table.Th>
                <Table.Th>Thời gian nộp</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {submissions.map((s) => {
                const published = s.grade && s.grade.isPublished;
                return (
                  <Table.Tr key={s.id}>
                    <Table.Td>{s.exercise.title}</Table.Td>
                    <Table.Td>
                      <Badge size="sm" color={STATUS_COLOR[s.status]}>
                        {STATUS_LABEL[s.status]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {published ? `${s.grade!.score}/${s.grade!.maxScore}` : '—'}
                    </Table.Td>
                    <Table.Td>
                      {published && s.grade!.feedback ? (
                        s.grade!.feedback
                      ) : (
                        <Text c="dimmed" span>
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{fmtDateTime(s.submittedAt)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" size="sm">
            Chưa có bài tập nào cho học sinh này.
          </Text>
        )}
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">
          Huy hiệu
        </Title>
        <BadgeShelf studentId={childId} refreshKey={refreshKey} />
      </Card>

      <Card withBorder>
        <Title order={5} mb="sm">
          Bảng xếp hạng (trong lớp)
        </Title>
        <Leaderboard studentId={childId} refreshKey={refreshKey} />
      </Card>

      <LevelHistoryCard childId={childId} refreshKey={refreshKey} />

      <Card withBorder>
        <Title order={5} mb="sm">
          Học bạ — Điểm tổng hợp ({gradebook?.finalGrades.length ?? 0})
        </Title>
        {gradebook && gradebook.finalGrades.length > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Chương trình</Table.Th>
                <Table.Th>Kỳ</Table.Th>
                <Table.Th>Bài tập</Table.Th>
                <Table.Th>Kiểm tra</Table.Th>
                <Table.Th>Chuyên cần</Table.Th>
                <Table.Th>Định tính</Table.Th>
                <Table.Th>Tổng kết</Table.Th>
                <Table.Th>Kết quả</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {gradebook.finalGrades.map((g: FinalGrade) => (
                <Table.Tr key={g.id}>
                  <Table.Td>
                    {PROGRAM_LABEL[g.program] ?? g.program}
                    {g.level ? ` · ${g.level}` : ''}
                  </Table.Td>
                  <Table.Td>{g.periodKey}</Table.Td>
                  <Table.Td>{fmtScore(g.homeworkAvg)}</Table.Td>
                  <Table.Td>{fmtScore(g.testScore)}</Table.Td>
                  <Table.Td>
                    {g.attendanceRate == null ? '—' : `${Math.round(g.attendanceRate * 100)}%`}
                  </Table.Td>
                  <Table.Td>{fmtScore(g.qualitativeScore)}</Table.Td>
                  <Table.Td>
                    <Text fw={600}>{fmtScore(g.finalScore)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {!g.complete ? (
                      <Badge size="sm" color="gray">
                        Chưa đủ dữ liệu
                      </Badge>
                    ) : (
                      <Badge size="sm" color={g.passed ? 'teal' : 'red'}>
                        {g.passed ? 'Đạt' : 'Chưa đạt'}
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" size="sm">
            Chưa có điểm tổng hợp.
          </Text>
        )}
      </Card>

      {gradebook && gradebook.qualitative.length > 0 && (
        <Card withBorder>
          <Title order={5} mb="sm">
            Đánh giá định tính ({gradebook.qualitative.length})
          </Title>
          <Stack gap="sm">
            {gradebook.qualitative.map((q) => (
              <div key={q.id}>
                <Group gap="xs" mb={4}>
                  <Text fw={600} size="sm">
                    {q.periodKey}
                  </Text>
                  <Badge size="xs" variant="light">
                    {PERIOD_LABEL[q.period] ?? q.period}
                  </Badge>
                </Group>
                <Group gap="xs" mb={q.narrative ? 4 : 0}>
                  {Object.entries(q.criteria).map(([pillar, score]) => (
                    <Badge key={pillar} size="sm" variant="outline" color="cmc">
                      {pillar}: {score}
                    </Badge>
                  ))}
                </Group>
                {q.narrative && (
                  <Text size="sm" c="dimmed">
                    {q.narrative}
                  </Text>
                )}
              </div>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

type Meeting = Awaited<ReturnType<typeof trpc.parentMeeting.myMeetings.query>>[number];

/** Upcoming parent meetings across all of this parent's children's classes (RLS-scoped). */
function UpcomingMeetingsCard({ refreshKey }: { refreshKey: number }) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    trpc.parentMeeting.myMeetings
      .query()
      .then((rows) => setMeetings(rows.filter((m) => new Date(m.scheduledAt).getTime() >= Date.now())))
      .catch((e) => setError('Không tải được lịch họp phụ huynh: ' + (e instanceof Error ? e.message : '')));
  }, [refreshKey]);

  if (error) {
    return (
      <Alert color="red">{error}</Alert>
    );
  }
  if (!meetings || meetings.length === 0) return null;
  return (
    <Card withBorder>
      <Title order={5} mb="sm">
        📅 Lịch họp phụ huynh sắp tới ({meetings.length})
      </Title>
      <Stack gap="xs">
        {meetings.map((m) => (
          <Group key={m.id} gap="xs" wrap="nowrap">
            <Badge variant="light" color="cmc">
              {m.timeConfirmed
                ? fmtDateTime(m.scheduledAt)
                : new Date(m.scheduledAt).toLocaleDateString('vi-VN')}
            </Badge>
            {!m.timeConfirmed && (
              <Text size="xs" c="dimmed">
                (chưa chốt giờ)
              </Text>
            )}
            <Text fw={600} size="sm">
              {m.title}
            </Text>
            {m.location && (
              <Text size="sm" c="dimmed">
                · {m.location}
              </Text>
            )}
            {m.note && (
              <Text size="sm" c="dimmed">
                — {m.note}
              </Text>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

function liveMessage(n: LiveNotification): string {
  if (n.type === 'grade_published') {
    const score = n.payload.score != null ? ` ${n.payload.score} điểm` : '';
    const stars = n.payload.starsEarned ? ` · +${n.payload.starsEarned} sao ⭐` : '';
    return `🔔 Con vừa có điểm bài "${n.payload.exercise ?? ''}":${score}${stars}`;
  }
  if (n.type === 'badge_awarded') {
    return `🏅 Con vừa đạt huy hiệu "${n.payload.badge ?? ''}"!`;
  }
  if (n.type === 'level_up') {
    return `🎉 Con vừa được lên cấp độ ${n.payload.toLevel ?? ''}!`;
  }
  return '🔔 Có thông báo mới về con của bạn';
}

export function ParentView({ principal }: { principal: LmsPrincipal }) {
  const students = principal.students;
  const [childId, setChildId] = useState<string | null>(students[0]?.id ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  useNotificationStream((n) => {
    setBanner(liveMessage(n));
    setRefreshKey((k) => k + 1);
  });

  if (students.length === 0) {
    return (
      <Card withBorder maw={520}>
        <Title order={5} mb="xs">
          Theo dõi học tập
        </Title>
        <Text c="dimmed" size="sm">
          Chưa có học sinh được liên kết với tài khoản này.
        </Text>
      </Card>
    );
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={4}>Theo dõi học tập</Title>
          <Text c="dimmed" size="sm">
            Xin chào {principal.displayName}.
          </Text>
        </div>
        <Group gap="sm" align="flex-end">
          <NotificationCenter pulse={refreshKey} />
          <Select
          label="Học sinh"
          w={260}
          allowDeselect={false}
          data={students.map((s) => ({ value: s.id, label: s.fullName }))}
          value={childId}
          onChange={(v) => v && setChildId(v)}
        />
        </Group>
      </Group>

      {banner && (
        <Alert color="green" withCloseButton onClose={() => setBanner(null)}>
          {banner}
        </Alert>
      )}

      <UpcomingMeetingsCard refreshKey={refreshKey} />

      {childId && <ChildDashboard key={childId} childId={childId} refreshKey={refreshKey} />}
    </Stack>
  );
}
