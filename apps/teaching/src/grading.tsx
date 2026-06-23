import { useCallback, useEffect, useState } from 'react';
import { trpc } from '@cmc/ui';
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

type Facility = Awaited<ReturnType<typeof trpc.facility.list.query>>[number];
type Batch = Awaited<ReturnType<typeof trpc.classBatch.list.query>>[number];
type Exercise = Awaited<ReturnType<typeof trpc.exercise.listByClass.query>>[number];
type Submission = Awaited<ReturnType<typeof trpc.submission.listByExercise.query>>[number];
type Grade = NonNullable<Submission['grade']>;

const EX_STATUS_COLOR: Record<string, string> = {
  draft: 'gray',
  published: 'green',
  closed: 'dark',
};
const EX_STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp',
  published: 'Đã phát hành',
  closed: 'Đã đóng',
};
const SUB_STATUS_COLOR: Record<string, string> = {
  draft: 'gray',
  submitted: 'blue',
  graded: 'teal',
};
const SUB_STATUS_LABEL: Record<string, string> = {
  draft: 'Nháp',
  submitted: 'Đã nộp',
  graded: 'Đã chấm',
};
const EX_TYPE_LABEL: Record<string, string> = {
  homework: 'Bài tập',
  test_entrance: 'KT đầu vào',
  test_periodic: 'KT định kỳ',
};

function CreateExerciseModal({
  facilityId,
  classBatchId,
  onCreated,
}: {
  facilityId: number;
  classBatchId: string;
  onCreated: () => void;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [maxScore, setMaxScore] = useState<number | string>(10);
  const [starReward, setStarReward] = useState<number | string>(10);
  const [type, setType] = useState<string | null>('homework');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    if (!title.trim()) {
      setErr('Nhập tiêu đề bài tập');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await trpc.exercise.create.mutate({
        facilityId,
        classBatchId,
        title: title.trim(),
        description: description.trim() || undefined,
        maxScore: typeof maxScore === 'number' ? maxScore : undefined,
        starReward: typeof starReward === 'number' ? starReward : undefined,
        type: (type as 'homework' | 'test_entrance' | 'test_periodic') ?? undefined,
      });
      close();
      setTitle('');
      setDescription('');
      setMaxScore(10);
      setStarReward(10);
      setType('homework');
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
        + Tạo bài tập
      </Button>
      <Modal opened={opened} onClose={close} title="Tạo bài tập">
        <Stack>
          <Textarea
            label="Tiêu đề"
            autosize
            minRows={1}
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          <Textarea
            label="Mô tả (tùy chọn)"
            autosize
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <Select
            label="Loại"
            data={[
              { value: 'homework', label: 'Bài tập' },
              { value: 'test_entrance', label: 'KT đầu vào' },
              { value: 'test_periodic', label: 'KT định kỳ' },
            ]}
            value={type}
            onChange={setType}
          />
          <Group grow>
            <NumberInput label="Điểm tối đa" value={maxScore} onChange={setMaxScore} min={1} />
            <NumberInput label="Sao thưởng" value={starReward} onChange={setStarReward} min={0} />
          </Group>
          {err && (
            <Text c="red" size="sm">
              {err}
            </Text>
          )}
          <Button onClick={create} loading={busy} disabled={!title.trim()}>
            Tạo
          </Button>
        </Stack>
      </Modal>
    </>
  );
}

function GradeRow({ submission, maxScore, onChanged }: { submission: Submission; maxScore: number; onChanged: () => void }) {
  const [score, setScore] = useState<number | string>(submission.grade?.score ?? '');
  const [feedback, setFeedback] = useState(submission.grade?.feedback ?? '');
  const [grade, setGrade] = useState<Grade | null>(submission.grade);
  const [grading, setGrading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function doGrade() {
    if (typeof score !== 'number') {
      setErr('Nhập điểm');
      return;
    }
    setGrading(true);
    setErr('');
    setMsg('');
    try {
      const g = await trpc.grade.grade.mutate({
        submissionId: submission.id,
        score,
        feedback: feedback.trim() || undefined,
      });
      setGrade(g);
      setMsg('Đã chấm.');
      onChanged();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setGrading(false);
    }
  }

  async function doPublish() {
    setPublishing(true);
    setErr('');
    setMsg('');
    try {
      const r = await trpc.grade.publish.mutate({ submissionId: submission.id });
      setGrade(r.grade);
      setMsg(`Đã công bố · +${r.starsEarned} sao`);
      onChanged();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setPublishing(false);
    }
  }

  const answer = submission.answerText?.trim();
  const preview = answer ? (answer.length > 160 ? answer.slice(0, 160) + '…' : answer) : null;

  return (
    <Table.Tr>
      <Table.Td>
        <Text fw={600}>{submission.student.fullName}</Text>
        <Text size="xs" c="dimmed">
          {submission.student.studentCode}
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge size="sm" color={SUB_STATUS_COLOR[submission.status]}>
          {SUB_STATUS_LABEL[submission.status] ?? submission.status}
        </Badge>
      </Table.Td>
      <Table.Td style={{ maxWidth: 260 }}>
        {preview ? (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {preview}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            Chưa có bài làm
          </Text>
        )}
      </Table.Td>
      <Table.Td style={{ minWidth: 320 }}>
        <Stack gap={6}>
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <NumberInput
              size="xs"
              w={110}
              label="Điểm"
              placeholder={`0 - ${maxScore}`}
              value={score}
              onChange={setScore}
              min={0}
              max={maxScore}
              clampBehavior="strict"
            />
            <Button size="compact-sm" onClick={doGrade} loading={grading}>
              Chấm
            </Button>
            <Button
              size="compact-sm"
              variant="light"
              color="teal"
              onClick={doPublish}
              loading={publishing}
              disabled={!grade}
            >
              Công bố
            </Button>
          </Group>
          <Textarea
            size="xs"
            placeholder="Nhận xét (tùy chọn)"
            autosize
            minRows={1}
            value={feedback}
            onChange={(e) => setFeedback(e.currentTarget.value)}
          />
          <Group gap="xs">
            {grade && (
              <Text size="xs" c="dimmed">
                Điểm hiện tại: {grade.score}/{grade.maxScore}
              </Text>
            )}
            {grade && (
              <Badge size="xs" color={grade.isPublished ? 'teal' : 'gray'} variant="light">
                {grade.isPublished ? 'Đã công bố' : 'Chưa công bố'}
              </Badge>
            )}
          </Group>
          {msg && (
            <Text size="xs" c="green">
              {msg}
            </Text>
          )}
          {err && (
            <Text size="xs" c="red">
              {err}
            </Text>
          )}
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}

function SubmissionsPanel({ exercise }: { exercise: Exercise }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    trpc.submission.listByExercise
      .query({ exerciseId: exercise.id })
      .then((rows) => setSubmissions(rows))
      .catch((e) => setErr('Lỗi tải bài nộp: ' + (e instanceof Error ? e.message : '')))
      .finally(() => setLoading(false));
  }, [exercise.id]);
  useEffect(load, [load]);

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <div>
          <Group gap="xs">
            <Title order={6}>{exercise.title}</Title>
            <Badge size="sm" color={EX_STATUS_COLOR[exercise.status]}>
              {EX_STATUS_LABEL[exercise.status] ?? exercise.status}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Điểm tối đa {exercise.maxScore} · {exercise.starReward} sao
          </Text>
        </div>
        <Button size="xs" variant="default" onClick={load}>
          Tải lại
        </Button>
      </Group>

      {err && (
        <Alert color="red" mb="sm">
          {err}
        </Alert>
      )}

      {loading ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : submissions.length === 0 ? (
        <Text c="dimmed" size="sm">
          Chưa có bài nộp nào cho bài tập này.
        </Text>
      ) : (
        <Table striped verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Học sinh</Table.Th>
              <Table.Th>Trạng thái</Table.Th>
              <Table.Th>Bài làm</Table.Th>
              <Table.Th>Chấm điểm</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {submissions.map((s) => (
              <GradeRow key={s.id} submission={s} maxScore={exercise.maxScore} onChanged={load} />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

function ClassGrading({ facilityId, classBatchId }: { facilityId: number; classBatchId: string }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    trpc.exercise.listByClass
      .query({ classBatchId })
      .then((rows) => {
        setExercises(rows);
        setSelectedId((cur) => (cur && rows.some((r) => r.id === cur) ? cur : null));
      })
      .catch((e) => setErr('Lỗi tải bài tập: ' + (e instanceof Error ? e.message : '')))
      .finally(() => setLoading(false));
  }, [classBatchId]);
  useEffect(load, [load]);

  async function publish(id: string) {
    setPublishingId(id);
    try {
      await trpc.exercise.publish.mutate({ id });
      load();
    } catch (e) {
      setErr('Lỗi: ' + (e instanceof Error ? e.message : ''));
    } finally {
      setPublishingId(null);
    }
  }

  const selected = exercises.find((e) => e.id === selectedId) ?? null;

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={5}>Bài tập ({exercises.length})</Title>
          <CreateExerciseModal facilityId={facilityId} classBatchId={classBatchId} onCreated={load} />
        </Group>

        {err && (
          <Alert color="red" mb="sm">
            {err}
          </Alert>
        )}

        {loading ? (
          <Center py="md">
            <Loader size="sm" />
          </Center>
        ) : exercises.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có bài tập. Bấm “+ Tạo bài tập”.
          </Text>
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tiêu đề</Table.Th>
                <Table.Th>Loại</Table.Th>
                <Table.Th>Điểm</Table.Th>
                <Table.Th>Trạng thái</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {exercises.map((ex) => (
                <Table.Tr
                  key={ex.id}
                  style={{ cursor: 'pointer' }}
                  bg={selectedId === ex.id ? 'var(--mantine-color-cmc-0)' : undefined}
                  onClick={() => setSelectedId(ex.id)}
                >
                  <Table.Td>
                    <Text fw={600}>{ex.title}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {EX_TYPE_LABEL[ex.type] ?? ex.type}
                    </Text>
                  </Table.Td>
                  <Table.Td>{ex.maxScore}</Table.Td>
                  <Table.Td>
                    <Badge size="sm" color={EX_STATUS_COLOR[ex.status]}>
                      {EX_STATUS_LABEL[ex.status] ?? ex.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td w={110}>
                    {ex.status === 'draft' && (
                      <Button
                        size="compact-xs"
                        variant="light"
                        loading={publishingId === ex.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          publish(ex.id);
                        }}
                      >
                        Phát hành
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {selected ? (
        <SubmissionsPanel key={selected.id} exercise={selected} />
      ) : (
        !loading &&
        exercises.length > 0 && (
          <Card withBorder>
            <Text c="dimmed" size="sm">
              Chọn một bài tập để xem và chấm bài nộp.
            </Text>
          </Card>
        )
      )}
    </Stack>
  );
}

export function GradingPanel() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [loadingFacilities, setLoadingFacilities] = useState(true);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoadingFacilities(true);
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => setErr('Lỗi tải cơ sở: ' + (e instanceof Error ? e.message : '')))
      .finally(() => setLoadingFacilities(false));
  }, []);

  useEffect(() => {
    setLoadingBatches(true);
    trpc.classBatch.list
      .query()
      .then((bs) => setBatches(bs))
      .catch((e) => setErr('Lỗi tải lớp: ' + (e instanceof Error ? e.message : '')))
      .finally(() => setLoadingBatches(false));
  }, []);

  // Reset class selection when switching facility.
  useEffect(() => {
    setBatchId((cur) => {
      if (!cur) return cur;
      const b = batches.find((x) => x.id === cur);
      return b && b.facilityId === facilityId ? cur : null;
    });
  }, [facilityId, batches]);

  const visibleBatches = facilityId ? batches.filter((b) => b.facilityId === facilityId) : [];

  if (loadingFacilities) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack>
      <Group align="flex-end">
        <Select
          label="Cơ sở"
          w={240}
          placeholder={facilities.length ? 'Chọn cơ sở' : 'Chưa có cơ sở'}
          data={facilities.map((f) => ({ value: String(f.id), label: `${f.code} — ${f.name}` }))}
          value={facilityId ? String(facilityId) : null}
          onChange={(v) => setFacilityId(v ? Number(v) : null)}
        />
        <Select
          label="Lớp học"
          w={320}
          searchable
          disabled={!facilityId || loadingBatches}
          placeholder={
            loadingBatches
              ? 'Đang tải...'
              : visibleBatches.length
                ? 'Chọn lớp'
                : 'Cơ sở này chưa có lớp'
          }
          data={visibleBatches.map((b) => ({
            value: b.id,
            label: `${b.code} — ${b.name} (${b.course.code})`,
          }))}
          value={batchId}
          onChange={setBatchId}
        />
      </Group>

      {err && <Alert color="red">{err}</Alert>}

      {facilityId && batchId ? (
        <ClassGrading key={batchId} facilityId={facilityId} classBatchId={batchId} />
      ) : (
        <Card withBorder>
          <Text c="dimmed" size="sm">
            Chọn cơ sở và lớp học để quản lý bài tập và chấm bài.
          </Text>
        </Card>
      )}
    </Stack>
  );
}
