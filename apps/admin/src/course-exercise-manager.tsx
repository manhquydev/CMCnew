import { useCallback, useEffect, useMemo, useState } from 'react';
import { can } from '@cmc/auth/permissions';
import { uploadExercisePdf, trpc, useSession, notifyError, notifySuccess, StatusBadge, type StatusDef } from '@cmc/ui';
import {
  Button,
  Card,
  FileInput,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';

type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type CurriculumUnit = Awaited<ReturnType<typeof trpc.curriculum.listByCourse.query>>['units'][number];
type CurriculumLesson = CurriculumUnit['lessons'][number];
type Exercise = Awaited<ReturnType<typeof trpc.exercise.listByLesson.query>>[number];
type ExerciseType = 'homework' | 'test_entrance' | 'test_periodic';
type ExerciseStatus = 'draft' | 'published' | 'closed';

const TYPE_LABEL: Record<ExerciseType, string> = {
  homework: 'Bài tập',
  test_entrance: 'KT đầu vào',
  test_periodic: 'KT định kỳ',
};

const STATUS_LABEL: Record<ExerciseStatus, string> = {
  draft: 'Nháp',
  published: 'Đã phát hành',
  closed: 'Đã đóng',
};

// Preserves original 2-tone grouping: published→green(active), draft/closed→gray(draft/inactive).
const EXERCISE_STATUS_MAP: Record<string, StatusDef> = {
  draft: { label: STATUS_LABEL.draft, tone: 'draft' },
  published: { label: STATUS_LABEL.published, tone: 'active' },
  closed: { label: STATUS_LABEL.closed, tone: 'inactive' },
};

function ExerciseBadge({ exercise }: { exercise?: Exercise }) {
  if (!exercise) return <StatusBadge status="none" label="Chưa upload" tone="inactive" pill />;
  return <StatusBadge status={exercise.status} map={EXERCISE_STATUS_MAP} pill />;
}

export function CourseExerciseManager({ course }: { course: Course }) {
  const { me } = useSession();
  const canUpsert = can(me.roles, me.isSuperAdmin, 'exercise', 'upsert');
  const [units, setUnits] = useState<CurriculumUnit[]>([]);
  const [exerciseByLesson, setExerciseByLesson] = useState<Record<string, Exercise[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ unit: CurriculumUnit; lesson: CurriculumLesson; type: ExerciseType; current?: Exercise } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const preview = await trpc.curriculum.listByCourse.query({ courseId: course.id });
      setUnits(preview.units);
      const pairs = await Promise.all(
        preview.units.map(async (unit) => [unit.id, await trpc.exercise.listByUnit.query({ curriculumUnitId: unit.id })] as const),
      );
      const byLesson: Record<string, Exercise[]> = {};
      for (const [, exercises] of pairs) {
        for (const exercise of exercises) {
          if (!exercise.curriculumLessonId) continue;
          byLesson[exercise.curriculumLessonId] = [...(byLesson[exercise.curriculumLessonId] ?? []), exercise as Exercise];
        }
      }
      setExerciseByLesson(byLesson);
    } catch (e) {
      notifyError(e, 'Không tải được bài tập theo buổi');
    } finally {
      setLoading(false);
    }
  }, [course.id]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () => units.flatMap((unit) => unit.lessons.map((lesson) => ({
      unit,
      lesson,
      exercises: exerciseByLesson[lesson.id] ?? [],
    }))),
    [units, exerciseByLesson],
  );

  const exerciseOf = (lessonId: string, type: ExerciseType) =>
    (exerciseByLesson[lessonId] ?? []).find((exercise) => exercise.type === type);

  if (!canUpsert) return null;

  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="md">
        <div>
          <Text fw={600}>Bài tập theo bài</Text>
          <Text size="sm" c="dimmed">
            Upload bài tập theo từng buổi trong khung chương trình. Một unit 4 buổi có 4 slot upload riêng, bài tự mở sau buổi tương ứng.
          </Text>
        </div>
        {loading ? (
          <Loader size="sm" />
        ) : rows.length === 0 ? (
          <Text c="dimmed" size="sm">Khóa này chưa có buổi trong khung chương trình.</Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Buổi</Table.Th>
                <Table.Th>Bài tập</Table.Th>
                <Table.Th>Kiểm tra</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ unit, lesson }) => {
                const homework = exerciseOf(lesson.id, 'homework');
                const test = exerciseOf(lesson.id, 'test_periodic');
                const showTest = unit.unitType === 'REVIEW';
                return (
                  <Table.Tr key={lesson.id}>
                    <Table.Td>
                      <Text fw={600} size="sm">{lesson.lessonCode}</Text>
                      <Text size="xs" c="dimmed">{unit.unitCode} · Buổi {lesson.seqInUnit}/{unit.sessions} · {unit.theme}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <ExerciseBadge exercise={homework} />
                        <Button size="compact-xs" variant="light" onClick={() => setEditing({ unit, lesson, type: 'homework', current: homework })}>
                          Sửa
                        </Button>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {showTest ? (
                        <Group gap="xs">
                          <ExerciseBadge exercise={test} />
                          <Button size="compact-xs" variant="light" onClick={() => setEditing({ unit, lesson, type: 'test_periodic', current: test })}>
                            Sửa
                          </Button>
                        </Group>
                      ) : (
                        <Text size="xs" c="dimmed">Chỉ REVIEW unit</Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
      {editing && (
        <ExerciseEditor
          unit={editing.unit}
          lesson={editing.lesson}
          type={editing.type}
          current={editing.current}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </Card>
  );
}

function ExerciseEditor({
  unit: _unit,
  lesson,
  type,
  current,
  onClose,
  onSaved,
}: {
  unit: CurriculumUnit;
  lesson: CurriculumLesson;
  type: ExerciseType;
  current?: Exercise;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(current?.title ?? `${TYPE_LABEL[type]} ${lesson.lessonCode}`);
  const [description, setDescription] = useState(current?.description ?? '');
  const [basePdfRef, setBasePdfRef] = useState(current?.basePdfRef ?? '');
  const [maxScore, setMaxScore] = useState<number | string>(current?.maxScore ?? 10);
  const [starReward, setStarReward] = useState<number | string>(current?.starReward ?? 10);
  const [status, setStatus] = useState<ExerciseStatus>((current?.status as ExerciseStatus | undefined) ?? 'draft');
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) {
      notifyError(new Error('Nhập tiêu đề bài tập'), 'Lưu bài tập thất bại');
      return;
    }
    setBusy(true);
    try {
      const uploadedRef = pdf ? await uploadExercisePdf(pdf) : undefined;
      await trpc.exercise.upsert.mutate({
        curriculumLessonId: lesson.id,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        basePdfRef: uploadedRef ?? (basePdfRef.trim() || undefined),
        maxScore: typeof maxScore === 'number' ? maxScore : undefined,
        starReward: typeof starReward === 'number' ? starReward : undefined,
        status,
      });
      notifySuccess(`Đã lưu ${TYPE_LABEL[type].toLowerCase()} ${lesson.lessonCode}`);
      onSaved();
    } catch (e) {
      notifyError(e, 'Lưu bài tập thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`${TYPE_LABEL[type]} · ${lesson.lessonCode}`} radius="xl" centered>
      <Stack>
        <TextInput label="Tiêu đề" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
        <Textarea label="Mô tả" value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />
        <Group grow>
          <NumberInput label="Điểm tối đa" value={maxScore} onChange={setMaxScore} min={1} />
          <NumberInput label="Sao thưởng" value={starReward} onChange={setStarReward} min={0} />
        </Group>
        <Select
          label="Trạng thái"
          value={status}
          onChange={(value) => setStatus((value as ExerciseStatus | null) ?? 'draft')}
          data={[
            { value: 'draft', label: 'Nháp' },
            { value: 'published', label: 'Đã phát hành' },
            { value: 'closed', label: 'Đã đóng' },
          ]}
        />
        <TextInput label="PDF ref hiện tại" value={basePdfRef} onChange={(e) => setBasePdfRef(e.currentTarget.value)} />
        <FileInput label="Upload PDF mới" value={pdf} onChange={setPdf} accept="application/pdf" clearable />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>Hủy</Button>
          <Button onClick={save} loading={busy}>Lưu</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
