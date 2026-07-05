import { useCallback, useEffect, useState } from 'react';
import {
  trpc,
  PdfAnnotator,
  type AnnotationData,
  notifyError,
  notifySuccess,
  FacilityPicker,
  StatusBadge,
  InitialsAvatar,
  type StatusDef,
} from '@cmc/ui';
import {
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

// Preserves original color semantics: gray→draft, green→active, dark→inactive.
const EX_STATUS_MAP: Record<string, StatusDef> = {
  draft: { label: 'Nháp', tone: 'draft' },
  published: { label: 'Đã phát hành', tone: 'active' },
  closed: { label: 'Đã đóng', tone: 'inactive' },
};
// Preserves original color semantics: gray→draft, blue→info, teal→active.
const SUB_STATUS_MAP: Record<string, StatusDef> = {
  draft: { label: 'Nháp', tone: 'draft' },
  submitted: { label: 'Đã nộp', tone: 'info' },
  graded: { label: 'Đã chấm', tone: 'active' },
};
const EX_TYPE_LABEL: Record<string, string> = {
  homework: 'Bài tập',
  test_entrance: 'KT đầu vào',
  test_periodic: 'KT định kỳ',
};

// Full-page grade-on-PDF: render the student's annotation layer (read-only) under the teacher's
// editable layer, set score/feedback, save (grade.grade with annotationLayer), then publish.
function GradePdfModal({
  submission,
  maxScore,
  basePdfRef,
  opened,
  onClose,
  onChanged,
}: {
  submission: Submission;
  maxScore: number;
  basePdfRef: string;
  opened: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [studentLayer, setStudentLayer] = useState<AnnotationData | null>(null);
  const [teacherLayer, setTeacherLayer] = useState<AnnotationData | null>(null);
  const [score, setScore] = useState<number | string>(submission.grade?.score ?? '');
  const [feedback, setFeedback] = useState(submission.grade?.feedback ?? '');
  const [hasGrade, setHasGrade] = useState(!!submission.grade);
  const [busy, setBusy] = useState<'grade' | 'publish' | null>(null);

  useEffect(() => {
    if (!opened) return;
    trpc.submission.layerForGrading
      .query({ submissionId: submission.id })
      .then(({ student, teacher }) => {
        setStudentLayer(student);
        setTeacherLayer(teacher);
      })
      .catch(() => {
        /* missing layer → start blank */
      });
  }, [opened, submission.id]);

  async function doGrade() {
    if (typeof score !== 'number') {
      notifyError(new Error('Nhập điểm'), 'Chấm bài thất bại');
      return;
    }
    setBusy('grade');
    try {
      await trpc.grade.grade.mutate({
        submissionId: submission.id,
        score,
        feedback: feedback.trim() || undefined,
        annotationLayer: teacherLayer ?? undefined,
      });
      setHasGrade(true);
      notifySuccess('Đã chấm (kèm chú thích)');
      onChanged();
    } catch (e) {
      notifyError(e, 'Chấm bài thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function doPublish() {
    setBusy('publish');
    try {
      const r = await trpc.grade.publish.mutate({ submissionId: submission.id });
      notifySuccess(`Đã công bố · +${r.starsEarned} sao`);
      onChanged();
    } catch (e) {
      notifyError(e, 'Công bố điểm thất bại');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={`Chấm bài: ${submission.student.fullName}`} size="xl">
      <Stack>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput
            size="xs"
            w={120}
            label="Điểm"
            placeholder={`0 - ${maxScore}`}
            value={score}
            onChange={setScore}
            min={0}
            max={maxScore}
            clampBehavior="strict"
          />
          <Button size="compact-sm" onClick={doGrade} loading={busy === 'grade'} disabled={busy !== null}>
            Chấm
          </Button>
          <Button
            size="compact-sm"
            variant="light"
            color="teal"
            onClick={doPublish}
            loading={busy === 'publish'}
            disabled={!hasGrade || busy !== null}
          >
            Công bố
          </Button>
        </Group>
        <Textarea
          size="xs"
          label="Nhận xét (tùy chọn)"
          autosize
          minRows={1}
          value={feedback}
          onChange={(e) => setFeedback(e.currentTarget.value)}
        />
        <Text size="xs" c="dimmed">
          Nét xanh nhạt là bài làm của học sinh; chấm/ghi chú của bạn vẽ chồng lên trên.
        </Text>
        <PdfAnnotator
          pdfRef={basePdfRef}
          value={teacherLayer}
          onChange={setTeacherLayer}
          editable
          readOnlyLayers={studentLayer ? [{ items: studentLayer.items, opacity: 0.6 }] : []}
        />
      </Stack>
    </Modal>
  );
}

function GradeRow({
  submission,
  maxScore,
  basePdfRef,
  onChanged,
}: {
  submission: Submission;
  maxScore: number;
  basePdfRef?: string | null;
  onChanged: () => void;
}) {
  const [pdfOpen, { open: openPdf, close: closePdf }] = useDisclosure(false);
  const [score, setScore] = useState<number | string>(submission.grade?.score ?? '');
  const [feedback, setFeedback] = useState(submission.grade?.feedback ?? '');
  const [grade, setGrade] = useState<Grade | null>(submission.grade);
  const [grading, setGrading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function doGrade() {
    if (typeof score !== 'number') {
      notifyError(new Error('Nhập điểm'), 'Chấm bài thất bại');
      return;
    }
    setGrading(true);
    try {
      const g = await trpc.grade.grade.mutate({
        submissionId: submission.id,
        score,
        feedback: feedback.trim() || undefined,
      });
      setGrade(g);
      notifySuccess('Đã chấm điểm');
      onChanged();
    } catch (e) {
      notifyError(e, 'Chấm bài thất bại');
    } finally {
      setGrading(false);
    }
  }

  async function doPublish() {
    setPublishing(true);
    try {
      const r = await trpc.grade.publish.mutate({ submissionId: submission.id });
      setGrade(r.grade);
      notifySuccess(`Đã công bố · +${r.starsEarned} sao`);
      onChanged();
    } catch (e) {
      notifyError(e, 'Công bố điểm thất bại');
    } finally {
      setPublishing(false);
    }
  }

  const answer = submission.answerText?.trim();
  const preview = answer ? (answer.length > 160 ? answer.slice(0, 160) + '…' : answer) : null;

  return (
    <Table.Tr>
      <Table.Td>
        <Group gap={8} wrap="nowrap">
          <InitialsAvatar name={submission.student.fullName} size={22} />
          <div>
            <Text fw={600}>{submission.student.fullName}</Text>
            <Text size="xs" c="dimmed">
              {submission.student.studentCode}
            </Text>
          </div>
        </Group>
      </Table.Td>
      <Table.Td>
        <StatusBadge status={submission.status} map={SUB_STATUS_MAP} pill />
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
            {basePdfRef && (
              <Button size="compact-sm" variant="light" onClick={openPdf}>
                Chấm trên đề
              </Button>
            )}
          </Group>
          {basePdfRef && (
            <GradePdfModal
              submission={submission}
              maxScore={maxScore}
              basePdfRef={basePdfRef}
              opened={pdfOpen}
              onClose={closePdf}
              onChanged={onChanged}
            />
          )}
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
              <StatusBadge
                status={grade.isPublished ? 'published' : 'unpublished'}
                map={{
                  published: { label: 'Đã công bố', tone: 'active' },
                  unpublished: { label: 'Chưa công bố', tone: 'draft' },
                }}
                size="xs"
                pill
              />
            )}
          </Group>
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}

function SubmissionsPanel({ exercise }: { exercise: Exercise }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    trpc.submission.listByExercise
      .query({ exerciseId: exercise.id })
      .then((rows) => setSubmissions(rows))
      .catch((e) => notifyError(e, 'Không tải được bài nộp'))
      .finally(() => setLoading(false));
  }, [exercise.id]);
  useEffect(load, [load]);

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <div>
          <Group gap="xs">
            <Title order={6}>{exercise.title}</Title>
            <StatusBadge status={exercise.status} map={EX_STATUS_MAP} pill />
          </Group>
          <Text size="xs" c="dimmed">
            Điểm tối đa {exercise.maxScore} · {exercise.starReward} sao
          </Text>
        </div>
        <Button size="xs" variant="default" onClick={load}>
          Tải lại
        </Button>
      </Group>

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
              <GradeRow
                key={s.id}
                submission={s}
                maxScore={exercise.maxScore}
                basePdfRef={exercise.basePdfRef}
                onChanged={load}
              />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}

function ClassGrading({ classBatchId }: { facilityId: number; classBatchId: string }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    trpc.exercise.listByClass
      .query({ classBatchId })
      .then((rows) => {
        setExercises(rows);
        setSelectedId((cur) => (cur && rows.some((r) => r.id === cur) ? cur : null));
      })
      .catch((e) => notifyError(e, 'Không tải được danh sách bài tập'))
      .finally(() => setLoading(false));
  }, [classBatchId]);
  useEffect(load, [load]);

  const selected = exercises.find((e) => e.id === selectedId) ?? null;

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={5}>Bài tập ({exercises.length})</Title>
        </Group>

        {loading ? (
          <Center py="md">
            <Loader size="sm" />
          </Center>
        ) : exercises.length === 0 ? (
          <Text c="dimmed" size="sm">
            Chưa có bài tập theo unit đã dạy. Bài tập được giám đốc upload trong khung chương trình và tự mở sau buổi học.
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
                    <StatusBadge status={ex.status} map={EX_STATUS_MAP} pill />
                  </Table.Td>
                  <Table.Td />
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

export function GradingPanel({
  initialFacilityId,
  initialBatchId,
}: {
  /** Preselect facility + class when opened from a known session context (e.g. Lịch 360). */
  initialFacilityId?: number;
  initialBatchId?: string;
} = {}) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState<number | null>(initialFacilityId ?? null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchId, setBatchId] = useState<string | null>(initialBatchId ?? null);
  const [loadingFacilities, setLoadingFacilities] = useState(true);
  const [loadingBatches, setLoadingBatches] = useState(true);

  useEffect(() => {
    setLoadingFacilities(true);
    trpc.facility.list
      .query()
      .then((fs) => {
        setFacilities(fs);
        setFacilityId((cur) => cur ?? fs[0]?.id ?? null);
      })
      .catch((e) => notifyError(e, 'Không tải được danh sách cơ sở'))
      .finally(() => setLoadingFacilities(false));
  }, []);

  useEffect(() => {
    setLoadingBatches(true);
    trpc.classBatch.list
      .query()
      .then((bs) => setBatches(bs))
      .catch((e) => notifyError(e, 'Không tải được danh sách lớp'))
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
        <FacilityPicker
          facilities={facilities}
          w={240}
          placeholder={facilities.length ? 'Chọn cơ sở' : 'Chưa có cơ sở'}
          clearable={false}
          value={facilityId}
          onChange={setFacilityId}
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
            label: `${b.code} (${b.course.code})`,
          }))}
          value={batchId}
          onChange={setBatchId}
        />
      </Group>

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
