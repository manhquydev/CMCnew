import { useEffect, useState } from 'react';
import { trpc, useSession, notifyError, notifySuccess, required, minLength, combine } from '@cmc/ui';
import { can } from '@cmc/auth/permissions';
import { useForm } from '@mantine/form';
import {
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { CourseExerciseManager } from './course-exercise-manager.js';

type Course = Awaited<ReturnType<typeof trpc.course.list.query>>[number];
type Program = 'UCREA' | 'BRIGHT_IG' | 'BLACK_HOLE';

const TH_STYLE: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--cmc-text-muted)',
  fontWeight: 600,
};

export function CoursesPanel() {
  const { me } = useSession();
  // Any staff may browse the catalogue (course.list is open), but only roles with course.create
  // (quản lý / GĐ Đào tạo) may create — hide the button for everyone else so they never hit FORBIDDEN.
  const canCreate = me ? can(me.roles, me.isSuperAdmin, 'course', 'create') : false;
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { code: '', name: '', program: 'UCREA' as Program },
    validate: {
      code: combine(required('Nhập mã khóa'), minLength(2, 'Mã cần tối thiểu 2 ký tự')),
      name: required('Nhập tên khóa'),
      program: required('Chọn chương trình'),
    },
  });

  const load = () =>
    trpc.course.list
      .query()
      .then(setCourses)
      .catch((e) => notifyError(e, 'Không tải được danh sách khóa học'));

  useEffect(() => { load(); }, []);

  async function create(values: typeof form.values) {
    setBusy(true);
    try {
      await trpc.course.create.mutate(values);
      notifySuccess(`Đã tạo khóa "${values.name}"`);
      close();
      form.reset();
      load();
    } catch (e) {
      notifyError(e, 'Tạo khóa học thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      <Group justify="space-between" mb="xs">
        <Text size="xl" fw={600} style={{ color: 'var(--cmc-text)' }}>Khóa học</Text>
        {canCreate && (
          <Button variant="filled" radius={9999} leftSection={<IconPlus size={16} />} onClick={open}>
            Tạo khóa
          </Button>
        )}
      </Group>

      <Card radius="lg" p="xl" style={{ border: '1px solid var(--cmc-border)' }}>
        <Table striped highlightOnHover withTableBorder={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={TH_STYLE}>Mã</Table.Th>
              <Table.Th style={TH_STYLE}>Tên</Table.Th>
              <Table.Th style={TH_STYLE}>Chương trình</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {courses.map((c) => (
              <Table.Tr
                key={c.id}
                style={{ cursor: 'pointer' }}
                bg={selectedCourseId === c.id ? 'var(--mantine-color-cmc-0)' : undefined}
                onClick={() => setSelectedCourseId((cur) => (cur === c.id ? null : c.id))}
              >
                <Table.Td>{c.code}</Table.Td>
                <Table.Td>{c.name}</Table.Td>
                <Table.Td>{c.program}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {courses.length === 0 && (
          <Text c="dimmed" size="sm" mt="sm">Chưa có khóa học.</Text>
        )}
      </Card>

      {selectedCourseId && (
        <CourseExerciseManager course={courses.find((course) => course.id === selectedCourseId)!} />
      )}

      <Modal opened={opened} onClose={close} title="Tạo khóa học" radius="xl" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack>
            <TextInput label="Mã" withAsterisk {...form.getInputProps('code')} />
            <TextInput label="Tên" withAsterisk {...form.getInputProps('name')} />
            <Select
              label="Chương trình" withAsterisk
              data={['UCREA', 'BRIGHT_IG', 'BLACK_HOLE']}
              {...form.getInputProps('program')}
            />
            <Group justify="flex-end" mt="xs">
              <Button variant="subtle" onClick={close}>Hủy</Button>
              <Button type="submit" variant="filled" radius={9999} loading={busy}>Tạo</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
