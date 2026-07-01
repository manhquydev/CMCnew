import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  trpc,
  useNotificationStream,
  PdfAnnotator,
  BadgeShelf,
  Leaderboard,
  NotificationCenter,
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
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconCircleCheck, IconClock, IconPencil, IconAlertCircle, IconStar, IconBook2, IconGift, IconTrophy } from '@tabler/icons-react';
import { ClimbView } from './climb-view';
import { SessionEvidenceTab } from './session-evidence-tab';

export type StudentTab = 'overview' | 'exercises' | 'results' | 'gradebook' | 'badges' | 'ranking' | 'rewards' | 'courses' | 'sessions';

type Exercise = Awaited<ReturnType<typeof trpc.exercise.listForPrincipal.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.mine.query>>[number];
type Gift = Awaited<ReturnType<typeof trpc.rewards.gifts.query>>[number];
type EnrollmentRow = Awaited<ReturnType<typeof trpc.enrollment.mine.query>>[number];
type Gradebook = Awaited<ReturnType<typeof trpc.assessment.gradebook.query>>;
type QualitativeRow = Gradebook['qualitative'][number];

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—');

type WorkStatus = 'none' | 'draft' | 'submitted' | 'graded';

const STATUS_LABEL: Record<WorkStatus, string> = {
  none: 'Chưa làm',
  draft: 'Nháp',
  submitted: 'Đã nộp',
  graded: 'Đã chấm',
};

const STATUS_COLOR: Record<WorkStatus, string> = {
  none: 'gray',
  draft: 'yellow',
  submitted: 'blue',
  graded: 'green',
};

const STATUS_ICON: Record<WorkStatus, React.ReactNode> = {
  none: <IconAlertCircle size={12} color="var(--cmc-text-faint)" />,
  draft: <IconPencil size={12} color="var(--cmc-status-pending)" />,
  submitted: <IconClock size={12} color="var(--cmc-brand)" />,
  graded: <IconCircleCheck size={12} color="var(--cmc-status-active)" />,
};

function workStatus(sub: Submission | undefined): WorkStatus {
  if (!sub) return 'none';
  if (sub.status === 'graded') return 'graded';
  if (sub.status === 'submitted') return 'submitted';
  return 'draft';
}

function friendlyRedeemError(message: string): string {
  switch (message) {
    case 'insufficient_stars':
      return 'Không đủ sao';
    case 'out_of_stock':
      return 'Hết hàng';
    case 'inactive':
      return 'Quà ngừng phát';
    default:
      return 'Đổi quà thất bại, vui lòng thử lại';
  }
}

function giftStockLabel(stock: number): string {
  if (stock === -1) return 'Không giới hạn';
  if (stock <= 0) return 'Hết';
  return `Còn ${stock}`;
}

export function ExerciseModal({
  exercise,
  submission,
  opened,
  onClose,
  onChanged,
  onSubmitted,
}: {
  exercise: Exercise;
  submission: Submission | undefined;
  opened: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  /** Called after a successful submit (not a draft save) — used by the climb to celebrate. */
  onSubmitted?: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [annotation, setAnnotation] = useState<AnnotationData | null>(null);
  const [teacherLayer, setTeacherLayer] = useState<AnnotationData | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const status = workStatus(submission);
  const isGraded = status === 'graded';

  useEffect(() => {
    if (!opened) return;
    setAnswer(submission?.answerText ?? '');
    // Always clear both annotation layers first so a PDF annotation from a previously-opened
    // exercise never carries over to a text-only exercise (or a different PDF exercise).
    setAnnotation(null);
    setTeacherLayer(null);
    setMsg('');
    setErr('');
    if (exercise.basePdfRef) {
      trpc.submission.myLayer
        .query({ exerciseId: exercise.id })
        .then(({ mine, teacher }) => {
          setAnnotation(mine);
          setTeacherLayer(teacher);
        })
        .catch(() => {
          /* a missing layer is fine — start blank */
        });
    }
  }, [opened, exercise.id, exercise.basePdfRef, submission?.answerText]);

  async function saveDraft() {
    setBusy('save');
    setMsg('');
    setErr('');
    try {
      await trpc.submission.save.mutate({
        exerciseId: exercise.id,
        answerText: answer,
        annotationLayer: annotation ?? undefined,
      });
      setMsg('Đã lưu nháp.');
      notifySuccess('Đã lưu nháp bài làm');
      await onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Không lưu được nháp';
      setErr('Lỗi: ' + msg);
      notifyError(e, 'Lưu nháp thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function submitWork() {
    const hasText = answer.trim().length > 0;
    const hasAnnotation = annotation != null && annotation.items.length > 0;
    if (!hasText && !hasAnnotation) {
      setErr('Vui lòng nhập bài làm trước khi nộp.');
      return;
    }

    setBusy('submit');
    setMsg('');
    setErr('');
    try {
      await trpc.submission.save.mutate({
        exerciseId: exercise.id,
        answerText: answer,
        annotationLayer: annotation ?? undefined,
      });
      await trpc.submission.submit.mutate({ exerciseId: exercise.id });
      notifySuccess('Đã nộp bài thành công');
      await onChanged();
      onSubmitted?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Không nộp được bài';
      setErr('Lỗi: ' + msg);
      notifyError(e, 'Nộp bài thất bại');
    } finally {
      setBusy(null);
    }
  }

  const grade = submission?.grade;

  return (
    <Modal opened={opened} onClose={onClose} title={exercise.title} size="lg" radius="xl" centered>
      <Stack>
        {exercise.description && (
          <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            {exercise.description}
          </Text>
        )}
        <Group gap="xs">
          <Group gap={4}>
            {STATUS_ICON[status]}
            <Badge color={STATUS_COLOR[status]} variant="light" radius="xl">
              {STATUS_LABEL[status]}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Hạn nộp: {fmtDate(exercise.dueAt)} · Điểm tối đa: {exercise.maxScore}
          </Text>
        </Group>

        {isGraded && grade?.isPublished && (
          <Alert color="green" title="Kết quả">
            <Stack gap={4}>
              <Text fw={600}>
                Điểm: {grade.score}/{grade.maxScore}
                {exercise.starReward > 0 ? ` · +${exercise.starReward} sao` : ''}
              </Text>
              {grade.feedback && (
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  Nhận xét: {grade.feedback}
                </Text>
              )}
            </Stack>
          </Alert>
        )}

        {exercise.basePdfRef && (
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              {isGraded ? 'Đề bài & bài làm' : 'Đề bài — làm trực tiếp lên đề'}
            </Text>
            <PdfAnnotator
              pdfRef={exercise.basePdfRef}
              value={annotation}
              onChange={setAnnotation}
              editable={!isGraded}
              readOnlyLayers={teacherLayer ? [{ items: teacherLayer.items, opacity: 1 }] : []}
            />
          </Stack>
        )}

        <Textarea
          label="Bài làm"
          placeholder="Nhập bài làm của bạn..."
          autosize
          minRows={6}
          maxRows={16}
          value={answer}
          onChange={(e) => setAnswer(e.currentTarget.value)}
          disabled={isGraded}
          radius="md"
        />

        {isGraded && (
          <Text size="sm" c="dimmed">
            Bài đã được chấm — không thể chỉnh sửa.
          </Text>
        )}
        {msg && (
          <Text size="sm" c="green">
            {msg}
          </Text>
        )}
        {err && (
          <Text size="sm" c="red">
            {err}
          </Text>
        )}

        {!isGraded && (
          <Group justify="flex-end">
            <Button variant="subtle" color="cmc" onClick={saveDraft} loading={busy === 'save'} disabled={busy !== null}>
              Lưu nháp
            </Button>
            <Button variant="filled" radius={9999} onClick={submitWork} loading={busy === 'submit'} disabled={busy !== null}>
              Nộp bài
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

function ExercisesTab({ refreshKey, gradedOnly }: { refreshKey: number; gradedOnly?: boolean }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [active, setActive] = useState<Exercise | null>(null);
  const [opened, { open, close }] = useDisclosure(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [ex, subs] = await Promise.all([
        trpc.exercise.listForPrincipal.query(),
        trpc.submission.mine.query(),
      ]);
      setExercises(ex);
      setSubmissions(subs);
    } catch (e) {
      setErr('Không tải được danh sách bài tập: ' + (e instanceof Error ? e.message : ''));
      notifyError(e, 'Tải bài tập thất bại');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const subByExercise = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of submissions) m.set(s.exerciseId, s);
    return m;
  }, [submissions]);

  const activeSub = active ? subByExercise.get(active.id) : undefined;

  function openExercise(ex: Exercise) {
    setActive(ex);
    open();
  }

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (err) {
    return (
      <Alert color="red" mt="md">
        {err}
      </Alert>
    );
  }

  const visibleExercises = gradedOnly
    ? exercises.filter((ex) => subByExercise.get(ex.id)?.grade?.isPublished)
    : exercises;

  return (
    <Card radius="lg" style={{ border: '1px solid var(--cmc-border)' }} p={0}>
      {visibleExercises.length === 0 ? (
        <Text c="dimmed" p="xl">{gradedOnly ? 'Chưa có bài tập nào được chấm điểm.' : 'Chưa có bài tập nào.'}</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={thStyle}>Bài tập</Table.Th>
              <Table.Th style={thStyle}>Hạn nộp</Table.Th>
              <Table.Th style={thStyle}>Trạng thái</Table.Th>
              <Table.Th style={thStyle}>Điểm</Table.Th>
              <Table.Th style={{ ...thStyle, width: 120 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibleExercises.map((ex) => {
              const sub = subByExercise.get(ex.id);
              const status = workStatus(sub);
              const grade = sub?.grade;
              const showGrade = status === 'graded' && grade?.isPublished;
              return (
                <Table.Tr key={ex.id}>
                  <Table.Td>
                    <Text fw={600} size="sm">{ex.title}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{fmtDate(ex.dueAt)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {STATUS_ICON[status]}
                      <Badge size="sm" color={STATUS_COLOR[status]} variant="light" radius="xl">
                        {STATUS_LABEL[status]}
                      </Badge>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {showGrade && grade ? (
                      <Stack gap={2}>
                        <Text size="sm" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {grade.score}/{grade.maxScore}
                          {ex.starReward > 0 ? ` · +${ex.starReward} sao` : ''}
                        </Text>
                        {grade.feedback && (
                          <Text size="xs" c="dimmed">
                            {grade.feedback}
                          </Text>
                        )}
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="subtle" color="cmc" radius={9999} onClick={() => openExercise(ex)}>
                      {status === 'graded' ? 'Xem' : 'Làm bài'}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      {active && (
        <ExerciseModal
          exercise={active}
          submission={activeSub}
          opened={opened}
          onClose={close}
          onChanged={load}
        />
      )}
    </Card>
  );
}

type FinalGrade = Gradebook['finalGrades'][number];

const PERIOD_LABEL: Record<string, string> = {
  MONTHLY: 'Hàng tháng',
  END_LEVEL: 'Cuối cấp độ',
};

function StudentGradebookTab({ studentId, refreshKey }: { studentId: string; refreshKey: number }) {
  const [gradebook, setGradebook] = useState<Gradebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    setErr('');
    trpc.assessment.gradebook
      .query({ studentId })
      .then(setGradebook)
      .catch((e) => {
        setErr('Không tải được học bạ.');
        notifyError(e, 'Tải học bạ thất bại');
      })
      .finally(() => setLoading(false));
  }, [studentId, refreshKey]);

  if (loading) return <Center py="xl"><Loader /></Center>;
  if (err) return <Alert color="red" mt="md">{err}</Alert>;

  const grades = gradebook?.finalGrades ?? [];
  const qualitative = gradebook?.qualitative ?? [];

  if (grades.length === 0 && qualitative.length === 0) {
    return <Text c="dimmed" p="xl">Chưa có kết quả học kỳ nào.</Text>;
  }

  return (
    <Stack>
      {grades.length > 0 && (
        <Card radius="lg" style={{ border: '1px solid var(--cmc-border)' }} p={0}>
          <Table striped withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Kỳ</Table.Th>
                <Table.Th>Chương trình</Table.Th>
                <Table.Th>Bài tập TB</Table.Th>
                <Table.Th>Thi</Table.Th>
                <Table.Th>Điểm tổng</Table.Th>
                <Table.Th>Kết quả</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {grades.map((g: FinalGrade) => (
                <Table.Tr key={g.id}>
                  <Table.Td>{g.periodKey}</Table.Td>
                  <Table.Td>{g.program}</Table.Td>
                  <Table.Td>{g.homeworkAvg != null ? g.homeworkAvg.toFixed(1) : '—'}</Table.Td>
                  <Table.Td>{g.testScore != null ? g.testScore.toFixed(1) : '—'}</Table.Td>
                  <Table.Td fw={600}>{g.finalScore != null ? g.finalScore.toFixed(1) : '—'}</Table.Td>
                  <Table.Td>
                    {g.complete ? (
                      <Badge color={g.passed ? 'teal' : 'red'} variant="light" radius="xl">
                        {g.passed ? 'Đạt' : 'Chưa đạt'}
                      </Badge>
                    ) : (
                      <Badge color="gray" variant="light" radius="xl">Đang học</Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {/* Qualitative assessments — mirrors the parent gradebook view */}
      {qualitative.length > 0 && (
        <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
          <Text size="sm" fw={600} mb="md" style={{ color: 'var(--cmc-text-2)' }}>
            Đánh giá định tính ({qualitative.length})
          </Text>
          <Stack gap="sm">
            {qualitative.map((q: QualitativeRow) => (
              <div key={q.id}>
                <Group gap="xs" mb={4}>
                  <Text fw={600} size="sm">{q.periodKey}</Text>
                  <Badge size="xs" variant="light" radius="xl">
                    {PERIOD_LABEL[q.period] ?? q.period}
                  </Badge>
                </Group>
                <Group gap="xs" mb={q.narrative ? 4 : 0}>
                  {Object.entries(q.criteria as Record<string, number>).map(([pillar, score]) => (
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

// ── Courses tab — lists the student's active enrollments (RLS-scoped via enrollment.mine) ──

const ENROLL_STATUS_LABEL: Record<string, string> = {
  active: 'Đang học',
  completed: 'Đã hoàn thành',
  withdrawn: 'Đã rút',
};

function CoursesTab({ refreshKey }: { refreshKey: number }) {
  const [enrollments, setEnrollments] = useState<EnrollmentRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setEnrollments(null);
    setErr('');
    trpc.enrollment.mine
      .query()
      .then(setEnrollments)
      .catch((e) => {
        setErr('Không tải được danh sách lớp học.');
        notifyError(e, 'Tải khóa học thất bại');
      });
  }, [refreshKey]);

  if (!enrollments) return <Center py="xl"><Loader /></Center>;
  if (err) return <Alert color="red" mt="md">{err}</Alert>;
  if (enrollments.length === 0) {
    return (
      <Card radius="lg" style={{ border: '1px solid var(--cmc-border)' }} p="xl">
        <Text c="dimmed">Bạn chưa được ghi danh vào lớp nào.</Text>
      </Card>
    );
  }

  return (
    <Card radius="lg" style={{ border: '1px solid var(--cmc-border)' }} p={0}>
      <Table striped highlightOnHover withTableBorder={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={thStyle}>Lớp học</Table.Th>
            <Table.Th style={thStyle}>Khóa học</Table.Th>
            <Table.Th style={thStyle}>Chương trình</Table.Th>
            <Table.Th style={thStyle}>Trạng thái</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {enrollments.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>
                <Stack gap={0}>
                  <Text size="sm" fw={600}>{e.batch.name}</Text>
                  <Text size="xs" c="dimmed">{e.batch.code}</Text>
                </Stack>
              </Table.Td>
              <Table.Td>
                <Stack gap={0}>
                  <Text size="sm">{e.batch.course.name}</Text>
                  <Text size="xs" c="dimmed">{e.batch.course.code}</Text>
                </Stack>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{e.batch.course.program}</Text>
              </Table.Td>
              <Table.Td>
                <Badge
                  size="sm"
                  variant="light"
                  color={e.status === 'active' ? 'teal' : 'gray'}
                  radius="xl"
                >
                  {ENROLL_STATUS_LABEL[e.status] ?? e.status}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function RewardsTab({ refreshKey }: { refreshKey: number }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [redeemErr, setRedeemErr] = useState('');
  const [redeemingId, setRedeemingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [bal, gs] = await Promise.all([
        trpc.rewards.balance.query(),
        trpc.rewards.gifts.query(),
      ]);
      setBalance(bal);
      setGifts(gs);
    } catch (e) {
      setErr('Không tải được phần thưởng: ' + (e instanceof Error ? e.message : ''));
      notifyError(e, 'Tải phần thưởng thất bại');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function redeem(gift: Gift) {
    setRedeemingId(gift.id);
    setMsg('');
    setRedeemErr('');
    try {
      await trpc.rewards.redeem.mutate({ giftId: gift.id });
      const successMsg = `Đã đổi quà "${gift.name}". Vui lòng chờ duyệt.`;
      setMsg(successMsg);
      notifySuccess(successMsg, 'Đổi quà thành công');
      await load();
    } catch (e) {
      const friendly = friendlyRedeemError(e instanceof Error ? e.message : '');
      setRedeemErr(friendly);
      notifyError(friendly, 'Đổi quà thất bại');
    } finally {
      setRedeemingId(null);
    }
  }

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (err) {
    return (
      <Alert color="red" mt="md">
        {err}
      </Alert>
    );
  }

  const stars = balance ?? 0;

  return (
    <Stack gap="xl">
      <Card className="cmc-clay-card" p="xl">
        <Group gap="xs" align="center" mb={4}>
          <Text size="xs" fw={800} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--cmc-font-friendly)' }}>Số sao hiện có của con</Text>
          <IconStar size={16} fill="#f59e0b" color="#d97706" />
        </Group>
        <Text size="38px" fw={900} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-warn-text)', fontFamily: 'var(--cmc-font-bubble)' }}>
          {stars} <Text span size="lg" fw={700} c="dimmed">sao</Text>
        </Text>
      </Card>

      {msg && (
        <Alert color="green" withCloseButton onClose={() => setMsg('')} radius="lg">
          {msg}
        </Alert>
      )}
      {redeemErr && (
        <Alert color="red" withCloseButton onClose={() => setRedeemErr('')} radius="lg">
          {redeemErr}
        </Alert>
      )}

      {gifts.length === 0 ? (
        <Card className="cmc-clay-card" p="xl">
          <Text c="dimmed" style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 600 }}>Chưa có quà nào trong cửa hàng đổi thưởng.</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} gap="xl">
          {gifts.map((g) => {
            const outOfStock = g.stock === 0;
            const notEnough = stars < g.starsRequired;
            const disabled = outOfStock || notEnough || redeemingId !== null;
            return (
              <Card
                key={g.id}
                className="cmc-clay-card"
                p="xl"
              >
                <Stack gap="xs" h="100%">
                  <Group gap="xs" align="center">
                    <IconGift size={22} color="var(--cmc-brand)" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 113, 227, 0.15))' }} />
                    <Text fw={800} size="md" style={{ color: '#1C3D5A', fontFamily: 'var(--cmc-font-bubble)' }}>{g.name}</Text>
                  </Group>
                  {g.description && (
                    <Text size="xs" c="dimmed" lineClamp={2} style={{ fontFamily: 'var(--cmc-font-friendly)', fontWeight: 500 }}>
                      {g.description}
                    </Text>
                  )}
                  <Group gap="xs" mt="xs">
                    <Badge color="yellow" variant="light" radius="xl" size="sm" style={{ fontFamily: 'var(--cmc-font-bubble)' }}>{g.starsRequired} sao</Badge>
                    <Badge color={outOfStock ? 'red' : 'gray'} variant="light" radius="xl" size="sm" style={{ fontFamily: 'var(--cmc-font-friendly)' }}>
                      {giftStockLabel(g.stock)}
                    </Badge>
                  </Group>
                  <Button
                    className="cmc-clay-btn"
                    mt="auto"
                    size="sm"
                    onClick={() => redeem(g)}
                    loading={redeemingId === g.id}
                    disabled={disabled}
                    style={{ height: 38 }}
                  >
                    {outOfStock ? 'Hết hàng' : notEnough ? 'Không đủ sao' : 'Đổi quà ngay'}
                  </Button>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}

function OverviewTab({ principal, refreshKey }: { principal: LmsPrincipal; refreshKey: number }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      trpc.rewards.balance.query(),
      trpc.exercise.listForPrincipal.query(),
      trpc.submission.mine.query(),
    ])
      .then(([bal, ex, subs]) => {
        setBalance(bal);
        setExercises(ex);
        setSubmissions(subs);
      })
      .catch((e) => notifyError(e, 'Tải tổng quan thất bại'))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const submitted = submissions.filter((s) => s.status === 'submitted' || s.status === 'graded').length;
  const graded = submissions.filter((s) => s.status === 'graded' && s.grade?.isPublished).length;

  return (
    <Stack gap="xl">
      <Title order={2} style={{ color: 'var(--cmc-text)', fontSize: 24, fontWeight: 800 }}>
        Xin chào con yêu, {principal.displayName}! 👋
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }} gap="xl">
        <Card className="cmc-clay-card" p="xl">
          <Group justify="space-between" align="center" mb="xs">
            <Text size="xs" fw={800} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--cmc-font-friendly)' }}>Số sao tích lũy</Text>
            <IconStar size={24} fill="#f59e0b" color="#d97706" />
          </Group>
          <Text size="38px" fw={900} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-warn-text)', fontFamily: 'var(--cmc-font-bubble)' }}>
            {balance ?? 0} <Text span size="lg" fw={700} c="dimmed">sao</Text>
          </Text>
        </Card>
        <Card className="cmc-clay-card" p="xl">
          <Group justify="space-between" align="center" mb="xs">
            <Text size="xs" fw={800} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--cmc-font-friendly)' }}>Tổng bài tập</Text>
            <IconBook2 size={24} color="var(--cmc-brand)" />
          </Group>
          <Text size="38px" fw={900} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-brand)', fontFamily: 'var(--cmc-font-bubble)' }}>
            {exercises.length} <Text span size="lg" fw={700} c="dimmed">bài</Text>
          </Text>
        </Card>
        <Card className="cmc-clay-card" p="xl">
          <Group justify="space-between" align="center" mb="xs">
            <Text size="xs" fw={800} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--cmc-font-friendly)' }}>Đã nộp / Đã chấm</Text>
            <IconCircleCheck size={24} color="var(--cmc-ok-text)" />
          </Group>
          <Text size="38px" fw={900} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--cmc-ok-text)', fontFamily: 'var(--cmc-font-bubble)' }}>
            {submitted} <Text span size="xl" fw={700} c="dimmed">/</Text> {graded}
          </Text>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}

function liveMessage(n: LiveNotification): string {
  if (n.type === 'grade_published') {
    const score = n.payload.score != null ? ` ${n.payload.score} điểm` : '';
    const stars = n.payload.starsEarned ? ` · +${n.payload.starsEarned} sao` : '';
    return `Bài "${n.payload.exercise ?? ''}" đã có điểm:${score}${stars}`;
  }
  if (n.type === 'badge_awarded') {
    return `Bạn vừa đạt huy hiệu "${n.payload.badge ?? ''}"!`;
  }
  return 'Bạn có thông báo mới';
}

interface StudentViewProps {
  principal: LmsPrincipal;
  /** Controlled active tab — driven by the sidebar in StudentShell. */
  activeTab?: StudentTab;
  onTabChange?: (tab: StudentTab) => void;
  /** Called when a real-time notification arrives so parent shell can update badge count. */
  onNotification?: () => void;
}

export function StudentView({ principal, activeTab, onTabChange: _onTabChange, onNotification }: StudentViewProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const currentTab = activeTab ?? 'exercises';

  useNotificationStream((n) => {
    setBanner(liveMessage(n));
    setRefreshKey((k) => k + 1);
    onNotification?.();
  });

  // In standalone mode the view renders its own minimal header with NotificationCenter.
  const standaloneHeader = activeTab === undefined && (
    <Group justify="space-between" align="center">
      <Title order={3}>Xin chào, {principal.displayName}</Title>
      <NotificationCenter pulse={refreshKey} />
    </Group>
  );

  function renderPanel() {
    switch (currentTab) {
      case 'overview':
        return <OverviewTab principal={principal} refreshKey={refreshKey} />;
      case 'exercises':
        return <ClimbView refreshKey={refreshKey} />;
      case 'results':
        return <ExercisesTab refreshKey={refreshKey} gradedOnly />;
      case 'gradebook':
        return principal.studentIds[0] ? (
          <StudentGradebookTab studentId={principal.studentIds[0]} refreshKey={refreshKey} />
        ) : (
          <Text c="dimmed">Không có học sinh liên kết.</Text>
        );
      case 'badges':
        return principal.studentIds[0] ? (
          <BadgeShelf studentId={principal.studentIds[0]} refreshKey={refreshKey} />
        ) : (
          <Text c="dimmed">Không có học sinh liên kết.</Text>
        );
      case 'ranking':
        return principal.studentIds[0] ? (
          <Leaderboard studentId={principal.studentIds[0]} refreshKey={refreshKey} />
        ) : (
          <Text c="dimmed">Không có học sinh liên kết.</Text>
        );
      case 'rewards':
        return <RewardsTab refreshKey={refreshKey} />;
      case 'courses':
        return <CoursesTab refreshKey={refreshKey} />;
      case 'sessions':
        return principal.studentIds[0] ? (
          <SessionEvidenceTab studentId={principal.studentIds[0]} refreshKey={refreshKey} />
        ) : (
          <Text c="dimmed">Không có học sinh liên kết.</Text>
        );
      default:
        return <ExercisesTab refreshKey={refreshKey} />;
    }
  }

  return (
    <Stack>
      {standaloneHeader}
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
      {renderPanel()}
    </Stack>
  );
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
};
