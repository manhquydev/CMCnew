import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  trpc,
  useNotificationStream,
  PdfAnnotator,
  BadgeShelf,
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
  Tabs,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

type Exercise = Awaited<ReturnType<typeof trpc.exercise.listForPrincipal.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.mine.query>>[number];
type Gift = Awaited<ReturnType<typeof trpc.rewards.gifts.query>>[number];

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

function ExerciseModal({
  exercise,
  submission,
  opened,
  onClose,
  onChanged,
}: {
  exercise: Exercise;
  submission: Submission | undefined;
  opened: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [answer, setAnswer] = useState('');
  const [annotation, setAnnotation] = useState<AnnotationData | null>(null);
  const [teacherLayer, setTeacherLayer] = useState<AnnotationData | null>(null);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const status = workStatus(submission);
  const isGraded = status === 'graded';

  // Reset the editor from the latest submission each time the modal opens; pull the saved
  // annotation layer (and the teacher's, once published) for the base PDF.
  useEffect(() => {
    if (!opened) return;
    setAnswer(submission?.answerText ?? '');
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
      await onChanged();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : 'không lưu được nháp'));
    } finally {
      setBusy(null);
    }
  }

  async function submitWork() {
    setBusy('submit');
    setMsg('');
    setErr('');
    try {
      // Persist the current text + annotation layer before turning the work in.
      await trpc.submission.save.mutate({
        exerciseId: exercise.id,
        answerText: answer,
        annotationLayer: annotation ?? undefined,
      });
      await trpc.submission.submit.mutate({ exerciseId: exercise.id });
      await onChanged();
      onClose();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : 'không nộp được bài'));
    } finally {
      setBusy(null);
    }
  }

  const grade = submission?.grade;

  return (
    <Modal opened={opened} onClose={onClose} title={exercise.title} size="lg">
      <Stack>
        {exercise.description && (
          <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
            {exercise.description}
          </Text>
        )}
        <Group gap="xs">
          <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>
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
            <Button variant="default" onClick={saveDraft} loading={busy === 'save'} disabled={busy !== null}>
              Lưu nháp
            </Button>
            <Button onClick={submitWork} loading={busy === 'submit'} disabled={busy !== null}>
              Nộp bài
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

function ExercisesTab({ refreshKey }: { refreshKey: number }) {
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
    } finally {
      setLoading(false);
    }
  }, []);

  // refreshKey bumps when a realtime notification arrives → re-fetch so a freshly published grade appears live.
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Index submissions by exercise for an O(1) join.
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

  return (
    <Card withBorder mt="md">
      {exercises.length === 0 ? (
        <Text c="dimmed">Chưa có bài tập nào.</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Bài tập</Table.Th>
              <Table.Th>Hạn nộp</Table.Th>
              <Table.Th>Trạng thái</Table.Th>
              <Table.Th>Điểm</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {exercises.map((ex) => {
              const sub = subByExercise.get(ex.id);
              const status = workStatus(sub);
              const grade = sub?.grade;
              const showGrade = status === 'graded' && grade?.isPublished;
              return (
                <Table.Tr key={ex.id}>
                  <Table.Td>
                    <Text fw={600}>{ex.title}</Text>
                  </Table.Td>
                  <Table.Td>{fmtDate(ex.dueAt)}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={STATUS_COLOR[status]}>
                      {STATUS_LABEL[status]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {showGrade && grade ? (
                      <Stack gap={2}>
                        <Text size="sm" fw={600}>
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
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td w={120}>
                    <Button size="xs" variant="light" onClick={() => openExercise(ex)}>
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
    } finally {
      setLoading(false);
    }
  }, []);

  // refreshKey bumps on a realtime star earn → the balance updates without a manual reload.
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function redeem(gift: Gift) {
    setRedeemingId(gift.id);
    setMsg('');
    setRedeemErr('');
    try {
      await trpc.rewards.redeem.mutate({ giftId: gift.id });
      setMsg(`Đã đổi quà "${gift.name}". Vui lòng chờ duyệt.`);
      await load();
    } catch (e) {
      setRedeemErr(friendlyRedeemError(e instanceof Error ? e.message : ''));
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
    <Stack mt="md">
      <Card withBorder>
        <Text size="sm" c="dimmed">
          Số sao hiện có
        </Text>
        <Title order={2} c="yellow.7">
          ⭐ {stars} sao
        </Title>
      </Card>

      {msg && (
        <Alert color="green" withCloseButton onClose={() => setMsg('')}>
          {msg}
        </Alert>
      )}
      {redeemErr && (
        <Alert color="red" withCloseButton onClose={() => setRedeemErr('')}>
          {redeemErr}
        </Alert>
      )}

      {gifts.length === 0 ? (
        <Card withBorder>
          <Text c="dimmed">Chưa có quà nào.</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {gifts.map((g) => {
            const outOfStock = g.stock === 0;
            const notEnough = stars < g.starsRequired;
            const disabled = outOfStock || notEnough || redeemingId !== null;
            return (
              <Card key={g.id} withBorder>
                <Stack gap="xs" h="100%">
                  <Text fw={600}>{g.name}</Text>
                  {g.description && (
                    <Text size="sm" c="dimmed" lineClamp={2}>
                      {g.description}
                    </Text>
                  )}
                  <Group gap="xs">
                    <Badge color="yellow">⭐ {g.starsRequired} sao</Badge>
                    <Badge color={outOfStock ? 'red' : 'gray'} variant="light">
                      {giftStockLabel(g.stock)}
                    </Badge>
                  </Group>
                  <Button
                    mt="auto"
                    size="xs"
                    onClick={() => redeem(g)}
                    loading={redeemingId === g.id}
                    disabled={disabled}
                  >
                    {outOfStock ? 'Hết hàng' : notEnough ? 'Không đủ sao' : 'Đổi'}
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

function liveMessage(n: LiveNotification): string {
  if (n.type === 'grade_published') {
    const score = n.payload.score != null ? ` ${n.payload.score} điểm` : '';
    const stars = n.payload.starsEarned ? ` · +${n.payload.starsEarned} sao ⭐` : '';
    return `🔔 Bài "${n.payload.exercise ?? ''}" đã có điểm:${score}${stars}`;
  }
  if (n.type === 'badge_awarded') {
    return `🏅 Bạn vừa đạt huy hiệu "${n.payload.badge ?? ''}"!`;
  }
  return '🔔 Bạn có thông báo mới';
}

export function StudentView({ principal }: { principal: LmsPrincipal }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  useNotificationStream((n) => {
    setBanner(liveMessage(n));
    setRefreshKey((k) => k + 1);
  });

  return (
    <Stack>
      <Title order={3}>Xin chào, {principal.displayName}</Title>
      {banner && (
        <Alert color="green" withCloseButton onClose={() => setBanner(null)}>
          {banner}
        </Alert>
      )}
      <Tabs defaultValue="exercises">
        <Tabs.List>
          <Tabs.Tab value="exercises">Bài tập</Tabs.Tab>
          <Tabs.Tab value="rewards">Phần thưởng</Tabs.Tab>
          <Tabs.Tab value="badges">Huy hiệu</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="exercises">
          <ExercisesTab refreshKey={refreshKey} />
        </Tabs.Panel>
        <Tabs.Panel value="rewards">
          <RewardsTab refreshKey={refreshKey} />
        </Tabs.Panel>
        <Tabs.Panel value="badges" pt="md">
          {principal.studentIds[0] ? (
            <BadgeShelf studentId={principal.studentIds[0]} refreshKey={refreshKey} />
          ) : (
            <Text c="dimmed">Không có học sinh liên kết.</Text>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
