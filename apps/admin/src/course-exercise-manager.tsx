import { useEffect, useMemo, useState } from 'react';
import { can } from '@cmc/auth/permissions';
import { uploadExercisePdf, trpc, useSession, notifyError, notifySuccess } from '@cmc/ui';
import {
  Badge,
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
type Exercise = Awaited<ReturnType<typeof trpc.exercise.listByUnit.query>>[number];
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

function ExerciseBadge({ exercise }: { exercise?: Exercise }) {
  if (!exercise) return <Badge color="gray" variant="light">Chưa upload</Badge>;
  return (
    <Badge color={exercise.status === 'published' ? 'green' : 'gray'} variant="light">
      {STATUS_LABEL[exercise.status as ExerciseStatus] ?? exercise.status}
    </Badge>
  );
}

export function CourseExerciseManager({ course }: { course: Course }) {
  const { me } = useSession();
  const canUpsert = can(me.roles, me.isSuperAdmin, 'exercise', 'upsert');
  const [units, setUnits] = useState<CurriculumUnit[]>([]);
  const [exerciseByUnit, setExerciseByUnit] = useState<Record<string, Exercise[]>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ unit: CurriculumUnit; type: ExerciseType; current?: Exercise } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const preview = await trpc.curriculum.listByCourse.query({ courseId: course.id });
      setUnits(preview.units);
      const pairs = await Promise.all(
        preview.units.map(async (unit) => [unit.id, await trpc.exercise.listByUnit.query({ curriculumUnitId: unit.id })] as const),
      );
      setExerciseByUnit(Object.fromEntries(pairs));
    } catch (e) {
      notifyError(e, 'Không tải được bài tập theo unit');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [course.id]);

  const rows = useMemo(
    () => units.map((unit) => ({
      unit,
      exercises: exerciseByUnit[unit.id] ?? [],
    })),
    [units, exerciseByUnit],
  );

  const exerciseOf = (unitId: string, type: ExerciseType) =>
    (exerciseByUnit[unitId] ?? []).find((exercise) => exercise.type === type);

  if (!canUpsert) return null;

  return (
    <Card radius="lg" p="lg" style={{ border: '1px solid var(--cmc-border)' }}>
      <Stack gap="md">
        <div>
          <Text fw={600}>Bài tập theo bài</Text>
          <Text size="sm" c="dimmed">
            Upload một bài tập và một bài kiểm tra cho từng unit khi cần. Bài tự mở sau buổi học của unit đó.
          </Text>
        </div>
        {loading ? (
          <Loader size="sm" />
        ) : rows.length === 0 ? (
          <Text c="dimmed" size="sm">Khóa này chưa có curriculum unit.</Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Unit</Table.Th>
                <Table.Th>Bài tập</Table.Th>
                <Table.Th>Kiểm tra</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map(({ unit }) => {
                const homework = exerciseOf(unit.id, 'homework');
                const test = exerciseOf(unit.id, 'test_periodic');
                const showTest = unit.unitType === 'REVIEW';
                return (
                  <Table.Tr key={unit.id}>
                    <Table.Td>
                      <Text fw={600} size="sm">{unit.unitCode}</Text>
                      <Text size="xs" c="dimmed">{unit.theme}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <ExerciseBadge exercise={homework} />
                        <Button size="compact-xs" variant="light" onClick={() => setEditing({ unit, type: 'homework', current: homework })}>
                          Sửa
                        </Button>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {showTest ? (
                        <Group gap="xs">
                          <ExerciseBadge exercise={test} />
                          <Button size="compact-xs" variant="light" onClick={() => setEditing({ unit, type: 'test_periodic', current: test })}>
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
  unit,
  type,
  current,
  onClose,
  onSaved,
}: {
  unit: CurriculumUnit;
  type: ExerciseType;
  current?: Exercise;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(current?.title ?? `${TYPE_LABEL[type]} ${unit.unitCode}`);
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
        curriculumUnitId: unit.id,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        basePdfRef: uploadedRef ?? (basePdfRef.trim() || undefined),
        maxScore: typeof maxScore === 'number' ? maxScore : undefined,
        starReward: typeof starReward === 'number' ? starReward : undefined,
        status,
      });
      notifySuccess(`Đã lưu ${TYPE_LABEL[type].toLowerCase()} ${unit.unitCode}`);
      onSaved();
    } catch (e) {
      notifyError(e, 'Lưu bài tập thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`${TYPE_LABEL[type]} · ${unit.unitCode}`} radius="xl" centered>
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
