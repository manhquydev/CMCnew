import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Grid,
  Group,
  Loader,
  NumberInput,
  Rating,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconCheck, IconFile } from '@tabler/icons-react';
import { notifyError, notifySuccess, trpc } from '@cmc/ui';

type Exercise = Awaited<ReturnType<typeof trpc.exercise.listByClass.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.listByExercise.query>>[number];

interface HomeworkFeedProps {
  batchId: string;
  onBack?: () => void;
}

interface SelectedItem {
  exercise: Exercise;
  submission: Submission;
}

export function HomeworkFeed({ batchId, onBack }: HomeworkFeedProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadingExercises, setLoadingExercises] = useState(true);

  const [submissionMap, setSubmissionMap] = useState<Record<string, Submission[]>>({});
  const [loadingSubmissions, setLoadingSubmissions] = useState<Record<string, boolean>>({});

  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [score, setScore] = useState<number | string>('');
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoadingExercises(true);
    trpc.exercise.listByClass
      .query({ classBatchId: batchId })
      .then(setExercises)
      .catch((e) => notifyError(e, 'Không tải được danh sách bài tập'))
      .finally(() => setLoadingExercises(false));
  }, [batchId]);

  function loadSubmissions(exerciseId: string) {
    if (submissionMap[exerciseId] !== undefined) return;
    setLoadingSubmissions((prev) => ({ ...prev, [exerciseId]: true }));
    trpc.submission.listByExercise
      .query({ exerciseId })
      .then((rows) => setSubmissionMap((prev) => ({ ...prev, [exerciseId]: rows })))
      .catch((e) => notifyError(e, 'Không tải được bài nộp'))
      .finally(() => setLoadingSubmissions((prev) => ({ ...prev, [exerciseId]: false })));
  }

  function selectSubmission(exercise: Exercise, submission: Submission) {
    setSelected({ exercise, submission });
    setScore(submission.grade?.score ?? '');
    setStars(submission.grade?.score != null ? Math.round((submission.grade.score / (submission.grade.maxScore || 10)) * 5) : 0);
    setFeedback(submission.grade?.feedback ?? '');
  }

  async function handleSave() {
    if (!selected || score === '') return;
    setSaving(true);
    try {
      await trpc.grade.grade.mutate({
        submissionId: selected.submission.id,
        score: Number(score),
        feedback: feedback || undefined,
      });
      notifySuccess('Đã lưu điểm');
      setSubmissionMap((prev) => {
        const rows = prev[selected.exercise.id] ?? [];
        return {
          ...prev,
          [selected.exercise.id]: rows.map((s) =>
            s.id === selected.submission.id
              ? { ...s, grade: { id: s.grade?.id ?? '', score: Number(score), maxScore: s.grade?.maxScore ?? 10, feedback: feedback || null, isPublished: s.grade?.isPublished ?? false } }
              : s,
          ),
        };
      });
    } catch (e) {
      notifyError(e, 'Không lưu được điểm');
    } finally {
      setSaving(false);
    }
  }

  const totalSubmissions = Object.values(submissionMap).flat().length;
  const gradedCount = Object.values(submissionMap)
    .flat()
    .filter((s) => s.grade?.score != null).length;

  return (
    <Stack gap={0} h="100%">
      {/* Header */}
      <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap="sm">
          {onBack && (
            <ActionIcon variant="subtle" onClick={onBack} aria-label="Quay lại">
              <IconArrowLeft size={18} />
            </ActionIcon>
          )}
          <Title order={4}>Chấm bài tập</Title>
          {totalSubmissions > 0 && (
            <Badge variant="light" color="blue">
              {gradedCount}/{totalSubmissions} đã chấm
            </Badge>
          )}
        </Group>
      </Box>

      <Grid gutter={0} style={{ flex: 1, overflow: 'hidden' }}>
        {/* LEFT — exercise + submission list */}
        <Grid.Col
          span={{ base: 12, md: 5 }}
          style={{ borderRight: '1px solid var(--mantine-color-default-border)', height: '100%' }}
        >
          <ScrollArea h="100%" p="md">
            {loadingExercises ? (
              <Center py="xl">
                <Loader size="sm" />
              </Center>
            ) : exercises.length === 0 ? (
              <Center py="xl">
                <Text c="dimmed" size="sm">
                  Không có bài tập nào cho lớp này
                </Text>
              </Center>
            ) : (
              <Stack gap="md">
                {exercises.map((ex) => {
                  const subs = submissionMap[ex.id];
                  const isLoadingSubs = loadingSubmissions[ex.id];

                  return (
                    <Box key={ex.id}>
                      <Group
                        gap="xs"
                        mb="xs"
                        style={{ cursor: 'pointer' }}
                        onClick={() => loadSubmissions(ex.id)}
                      >
                        <IconFile size={14} color="var(--mantine-color-blue-6)" />
                        <Text fw={600} size="sm" style={{ flex: 1 }}>
                          {ex.title}
                        </Text>
                        {subs && (
                          <Badge size="xs" variant="light">
                            {subs.filter((s) => s.grade?.score != null).length}/{subs.length}
                          </Badge>
                        )}
                      </Group>

                      {isLoadingSubs && (
                        <Center py="xs">
                          <Loader size="xs" />
                        </Center>
                      )}

                      {subs && (
                        <Stack gap={4} pl="md">
                          {subs.length === 0 ? (
                            <Text size="xs" c="dimmed">
                              Chưa có bài nộp
                            </Text>
                          ) : (
                            subs.map((sub) => {
                              const isGraded = sub.grade?.score != null;
                              const isSelected = selected?.submission.id === sub.id;
                              return (
                                <Card
                                  key={sub.id}
                                  withBorder
                                  p="xs"
                                  radius="sm"
                                  style={{
                                    cursor: 'pointer',
                                    backgroundColor: isSelected ? 'var(--mantine-color-blue-light)' : undefined,
                                  }}
                                  onClick={() => selectSubmission(ex, sub)}
                                >
                                  <Group justify="space-between" wrap="nowrap">
                                    <Box style={{ flex: 1, minWidth: 0 }}>
                                      <Text size="xs" fw={500} truncate>
                                        {sub.student.fullName}
                                      </Text>
                                      <Text size="xs" c="dimmed">
                                        {dayjs(sub.submittedAt ?? sub.createdAt).format('DD/MM HH:mm')}
                                      </Text>
                                    </Box>
                                    <Badge
                                      size="xs"
                                      color={isGraded ? 'green' : 'orange'}
                                      variant="light"
                                      leftSection={isGraded ? <IconCheck size={10} /> : undefined}
                                    >
                                      {isGraded ? `${sub.grade!.score}đ` : 'Chưa chấm'}
                                    </Badge>
                                  </Group>
                                </Card>
                              );
                            })
                          )}
                        </Stack>
                      )}
                      <Divider mt="sm" />
                    </Box>
                  );
                })}
              </Stack>
            )}
          </ScrollArea>
        </Grid.Col>

        {/* RIGHT — grading panel */}
        <Grid.Col span={{ base: 12, md: 7 }} style={{ height: '100%' }}>
          <ScrollArea h="100%" p="md">
            {!selected ? (
              <Center py="xl" h="100%">
                <Stack align="center" gap="xs">
                  <Text c="dimmed">Chọn một bài nộp để chấm điểm</Text>
                </Stack>
              </Center>
            ) : (
              <Stack gap="md">
                <Box>
                  <Text size="xs" c="dimmed">
                    {selected.exercise.title}
                  </Text>
                  <Title order={5}>{selected.submission.student.fullName}</Title>
                  <Text size="xs" c="dimmed">
                    Mã HS: {selected.submission.student.studentCode} ·{' '}
                    {dayjs(selected.submission.submittedAt ?? selected.submission.createdAt).format('DD/MM/YYYY HH:mm')}
                  </Text>
                </Box>

                {selected.submission.answerText && (
                  <Card withBorder radius="sm" p="sm" bg="var(--mantine-color-default-hover)">
                    <Text size="xs" fw={600} mb={4}>
                      Bài làm
                    </Text>
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                      {selected.submission.answerText}
                    </Text>
                  </Card>
                )}

                <Divider />

                <Box>
                  <Text size="sm" fw={600} mb="xs">
                    Điểm số (0–{selected.submission.grade?.maxScore ?? 10})
                  </Text>
                  <NumberInput
                    value={score}
                    onChange={setScore}
                    min={0}
                    max={selected.submission.grade?.maxScore ?? 10}
                    step={0.5}
                    placeholder="Nhập điểm"
                    w={120}
                  />
                </Box>

                <Box>
                  <Text size="sm" fw={600} mb="xs">
                    Đánh giá sao
                  </Text>
                  <Rating value={stars} onChange={setStars} size="lg" />
                </Box>

                <Box>
                  <Text size="sm" fw={600} mb="xs">
                    Nhận xét
                  </Text>
                  <Textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.currentTarget.value)}
                    placeholder="Nhận xét cho học sinh..."
                    minRows={3}
                    autosize
                  />
                </Box>

                <Group gap="sm">
                  <Button
                    color="blue"
                    loading={saving}
                    disabled={score === ''}
                    onClick={handleSave}
                  >
                    Lưu điểm
                  </Button>
                </Group>
              </Stack>
            )}
          </ScrollArea>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
